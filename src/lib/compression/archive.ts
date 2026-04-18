/**
 * ZIP 아카이브 빌더 및 파서
 *
 * fflate의 zipSync / unzipSync를 래핑하여 InputFile 인터페이스로 통일한다.
 *
 * 표준 참조:
 *   PKWARE APPNOTE 6.3.10  — ZIP 파일 포맷
 *   ISO/IEC 21320-1:2015   — Document Container File (ZIP 기반)
 *
 * 파일명 인코딩:
 *   General Purpose Bit Flag bit 11 (EFS) — UTF-8 파일명 표시
 *   fflate는 기본적으로 UTF-8로 인코딩하며 EFS 플래그를 설정한다.
 */
import { zipSync, unzipSync, strFromU8, type Zippable } from 'fflate';
import type { InputFile } from './compression-types';

// ─────────────────────────────────────────────────────────
// 이미 압축된 파일 확장자 — ZIP 내부에서 STORE(무압축) 처리
// ─────────────────────────────────────────────────────────

const INCOMPRESSIBLE_EXTS = new Set([
  // 문서 (내부 ZIP/Flate)
  'pdf', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'epub',
  // 이미지 (손실/무손실 압축)
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'heic', 'heif', 'jxl',
  // 오디오/비디오
  'mp3', 'mp4', 'mkv', 'avi', 'mov', 'webm', 'flac', 'aac', 'ogg', 'opus', 'm4a', 'm4v',
  // 압축 아카이브
  'zip', 'gz', 'bz2', 'xz', 'zst', '7z', 'rar', 'lz4', 'br',
  // 기타 바이너리
  'woff2', 'woff', 'wasm',
]);

function isIncompressible(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return INCOMPRESSIBLE_EXTS.has(ext);
}

// ─────────────────────────────────────────────────────────
// 필터: ZIP 내부 메타 파일 무시 (macOS, Windows)
// ─────────────────────────────────────────────────────────

const IGNORE_PATTERNS = [
  '__MACOSX/',
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini',
  '._.', // macOS resource fork
];

function shouldIgnore(name: string): boolean {
  return IGNORE_PATTERNS.some(p => name.startsWith(p) || name.endsWith(p) || name.includes('/' + p));
}

function isDirectory(name: string): boolean {
  return name.endsWith('/');
}

// ─────────────────────────────────────────────────────────
// buildZip — InputFile[] → ZIP 아카이브
// ─────────────────────────────────────────────────────────

/**
 * InputFile 배열을 ZIP 아카이브로 직렬화한다.
 *
 * - 파일명 UTF-8 인코딩 (fflate 기본, EFS bit 11 설정)
 * - 디렉토리 구조는 name 필드의 '/' 구분자를 그대로 반영
 * - 이미 압축된 파일(PDF, JPEG 등) → STORE(level 0)
 * - 텍스트/비압축 파일 → DEFLATE(level 6)
 * - 256B 미만 파일 → STORE (압축 효과 없음)
 *
 * @param files 압축할 파일 목록
 * @returns ZIP 아카이브 바이트
 */
export function buildZip(files: InputFile[]): Uint8Array {
  const zippable: Zippable = {};

  for (const file of files) {
    const name = normalizeZipPath(file.name);
    const small = file.data.byteLength < 256;
    const incomp = isIncompressible(file.name);
    const level = (small || incomp) ? 0 : 6;

    zippable[name] = [file.data, {
      level: level as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9,
      mtime: file.lastModified ? new Date(file.lastModified) : new Date(),
    }];
  }

  return zipSync(zippable);
}

// ─────────────────────────────────────────────────────────
// parseZip — ZIP 아카이브 → InputFile[]
// ─────────────────────────────────────────────────────────

/**
 * ZIP 아카이브를 InputFile 배열로 역직렬화한다.
 *
 * - 디렉토리 엔트리(이름이 '/'로 끝남) 건너뜀
 * - __MACOSX/, .DS_Store 등 메타 파일 건너뜀
 *
 * @param zipData ZIP 아카이브 바이트
 * @returns 파일 목록
 */
export function parseZip(zipData: Uint8Array): InputFile[] {
  const unzipped = unzipSync(zipData);
  const files: InputFile[] = [];

  for (const [name, data] of Object.entries(unzipped)) {
    if (isDirectory(name)) continue;
    if (shouldIgnore(name)) continue;

    files.push({
      name,
      data,
      lastModified: Date.now(), // fflate unzipSync doesn't expose mtime
    });
  }

  return files;
}

// ─────────────────────────────────────────────────────────
// listZipEntries — ZIP Central Directory 직접 파싱
// 실제 압축 해제 없이 파일 목록만 반환 (미리보기용)
// ─────────────────────────────────────────────────────────

/**
 * ZIP 아카이브에서 Central Directory만 읽어 파일 목록을 반환한다.
 *
 * ZIP 구조:
 *   Local File Headers + Data ...
 *   Central Directory Headers ...
 *   End of Central Directory (EOCD)
 *
 * EOCD 시그니처: 0x06054b50
 * CD 헤더 시그니처: 0x02014b50
 *
 * @param zipData ZIP 아카이브 바이트
 * @returns 파일 항목 목록 (name, size, compressedSize)
 */
export function listZipEntries(
  zipData: Uint8Array
): Array<{ name: string; size: number; compressedSize: number }> {
  const view = new DataView(zipData.buffer, zipData.byteOffset, zipData.byteLength);

  // End of Central Directory 찾기 (뒤에서 역순 탐색)
  // EOCD 최소 크기: 22 bytes. comment가 있으면 더 길어짐 (최대 65535 + 22)
  const searchStart = Math.max(0, zipData.byteLength - 65557);
  let eocdOffset = -1;

  for (let i = zipData.byteLength - 22; i >= searchStart; i--) {
    if (
      zipData[i] === 0x50 && zipData[i + 1] === 0x4B &&
      zipData[i + 2] === 0x05 && zipData[i + 3] === 0x06
    ) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error('ZIP EOCD 시그니처를 찾을 수 없습니다');
  }

  // EOCD 파싱
  const cdEntryCount = view.getUint16(eocdOffset + 10, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);

  // Central Directory 파싱
  const entries: Array<{ name: string; size: number; compressedSize: number }> = [];
  let offset = cdOffset;
  const decoder = new TextDecoder('utf-8', { fatal: false });

  for (let i = 0; i < cdEntryCount && offset + 46 <= zipData.byteLength; i++) {
    // CD 헤더 시그니처 확인 (0x02014b50)
    if (
      zipData[offset] !== 0x50 || zipData[offset + 1] !== 0x4B ||
      zipData[offset + 2] !== 0x01 || zipData[offset + 3] !== 0x02
    ) {
      break; // 시그니처 불일치 → 중단
    }

    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);

    const nameBytes = zipData.slice(offset + 46, offset + 46 + nameLen);
    const name = decoder.decode(nameBytes);

    // 디렉토리와 메타 파일 건너뜀
    if (!isDirectory(name) && !shouldIgnore(name)) {
      entries.push({ name, size: uncompressedSize, compressedSize });
    }

    offset += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}

// ─────────────────────────────────────────────────────────
// 유틸리티
// ─────────────────────────────────────────────────────────

/** ZIP 경로 정규화: 백슬래시 → 슬래시, 선행 슬래시 제거 */
function normalizeZipPath(name: string): string {
  return name.replace(/\\/g, '/').replace(/^\/+/, '');
}
