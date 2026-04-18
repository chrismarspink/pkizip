/**
 * CMS RFC 3274 호환 압축/압축해제 모듈
 *
 * 압축 전략:
 *   단일 파일 → ZLIB 직접 압축 (RFC 3274 id-alg-zlibCompress)
 *   다중 파일 또는 폴더 → ZIP 아카이브 (PKWARE APPNOTE)
 *
 * CMS CompressedData 구조 (RFC 3274):
 *   CompressedData ::= SEQUENCE {
 *     version          CMSVersion,                -- 0
 *     compressionAlgorithm  AlgorithmIdentifier,  -- id-alg-zlibCompress
 *     encapContentInfo EncapContentInfo            -- eContent: OCTET STRING
 *   }
 *
 *   eContent 내용물:
 *     [단일 파일]  ZLIB(원본 데이터)
 *     [다중 파일]  ZIP 아카이브 바이트
 *
 * 레거시 역호환 (읽기 전용):
 *   v1: [4B metaLen][JSON array][tar.gz]
 *   v2: [4B metaLen][JSON {version:2}][per-file deflate]
 */
import { zlibSync, unzlibSync, gunzipSync, inflateSync, strFromU8 } from 'fflate';
import { buildZip, parseZip, listZipEntries } from './archive';
import {
  CMS_ZLIB_OID,
  type InputFile,
  type FileEntry,
  type CompressResult,
  type DecompressResult,
  type LegacyV1Meta,
  type LegacyV2Meta,
  toFileEntries,
  toInputFiles,
  fmtSize,
} from './compression-types';

// Re-export for backward compatibility
export type { FileEntry, InputFile, CompressResult, DecompressResult };
export { toFileEntries, toInputFiles };

// ─────────────────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────────────────

/** RFC 3274 권장 ZLIB 압축 레벨 (속도/압축률 균형) */
const ZLIB_LEVEL = 6;

/** 레거시 메타 헤더 합리적 상한 */
const LEGACY_META_MAX_BYTES = 65536;

// 매직 바이트
const ZIP_MAGIC_0 = 0x50;  // 'P'
const ZIP_MAGIC_1 = 0x4B;  // 'K'
const ZLIB_CMF    = 0x78;  // deflate, 32K window
const GZIP_MAGIC_0 = 0x1F;
const GZIP_MAGIC_1 = 0x8B;

// ─────────────────────────────────────────────────────────
// 공개 API: compress
// ─────────────────────────────────────────────────────────

/**
 * 파일 목록을 CMS 호환 형식으로 압축한다.
 *
 *   files.length === 1  →  ZLIB (RFC 3274 id-alg-zlibCompress 직접 호환)
 *   files.length > 1    →  ZIP  (다중 파일, 폴더 구조 보존, PKWARE APPNOTE)
 *
 * @param files 압축할 파일 목록 (1개 이상)
 * @returns CompressResult
 * @throws RangeError files가 비어 있을 때
 */
export function compress(files: InputFile[]): CompressResult {
  if (files.length === 0) {
    throw new RangeError('compress: 파일 목록이 비어 있습니다');
  }

  const originalSize = files.reduce((sum, f) => sum + f.data.byteLength, 0);

  // ── 단일 파일: ZLIB 직접 압축 (RFC 1950) ──
  if (files.length === 1) {
    const file = files[0];
    const compressed = zlibSync(file.data, { level: ZLIB_LEVEL });

    const result: CompressResult = {
      data: compressed,
      method: 'zlib',
      algorithmOID: CMS_ZLIB_OID,
      fileCount: 1,
      originalSize,
      compressedSize: compressed.byteLength,
      entries: [{ name: file.name, size: file.data.byteLength, mimeType: file.mimeType }],
    };

    logCompressStats(result, files);
    return result;
  }

  // ── 다중 파일 / 폴더: ZIP 아카이브 ──
  const zipData = buildZip(files);

  const result: CompressResult = {
    data: zipData,
    method: 'zip',
    algorithmOID: CMS_ZLIB_OID,
    fileCount: files.length,
    originalSize,
    compressedSize: zipData.byteLength,
    entries: files.map(f => ({
      name: f.name,
      size: f.data.byteLength,
      mimeType: f.mimeType,
    })),
  };

  logCompressStats(result, files);
  return result;
}

// ─────────────────────────────────────────────────────────
// 공개 API: decompress
// ─────────────────────────────────────────────────────────

/**
 * 압축된 데이터를 복원한다. 포맷 자동 감지.
 *
 *   ZIP 매직 (0x50 0x4B)    → ZIP 역직렬화
 *   ZLIB 매직 (0x78)        → ZLIB 압축 해제
 *   레거시 포맷              → v1(tar+gzip) 또는 v2(per-file deflate)
 *
 * @param data 압축된 바이트
 * @param fallbackName 단일 파일 복원 시 사용할 파일명 (기본값: 'file')
 */
export function decompress(
  data: Uint8Array,
  fallbackName = 'file'
): DecompressResult {
  if (data.byteLength < 2) {
    throw new RangeError('decompress: 데이터가 너무 짧습니다');
  }

  const format = detectFormat(data);

  switch (format) {
    case 'zip':
      return { files: parseZip(data), method: 'zip' };

    case 'zlib': {
      const raw = unzlibSync(data);
      return {
        method: 'zlib',
        files: [{ name: fallbackName, data: raw, lastModified: Date.now() }],
      };
    }

    case 'legacy':
      return decompressLegacy(data, fallbackName);
  }
}

// ─────────────────────────────────────────────────────────
// 공개 API: listEntries
// ─────────────────────────────────────────────────────────

/**
 * 압축된 데이터의 파일 목록만 반환한다.
 * ZIP인 경우 Central Directory만 파싱 (실제 압축 해제 없음).
 *
 * @param data CompressResult.data
 */
export function listEntries(
  data: Uint8Array
): Array<{ name: string; size: number; compressedSize: number }> {
  if (data.byteLength < 2) return [];

  // ZIP → Central Directory 직접 파싱 (빠름)
  if (data[0] === ZIP_MAGIC_0 && data[1] === ZIP_MAGIC_1) {
    return listZipEntries(data);
  }

  // ZLIB 또는 레거시 → 압축 해제 후 반환 (파일 소수이므로 비용 낮음)
  const result = decompress(data);
  return result.files.map(f => ({
    name: f.name,
    size: f.data.byteLength,
    compressedSize: data.byteLength,
  }));
}

// ─────────────────────────────────────────────────────────
// 역호환 래퍼: serializeEntries / deserializeEntries
// 기존 코드(CreatePage, FilesTempPage, pki-operations)에서 계속 사용
// ─────────────────────────────────────────────────────────

/**
 * @deprecated compress() 사용 권장. 기존 호환용 래퍼.
 */
export function serializeEntries(entries: FileEntry[]): Uint8Array {
  const inputFiles = toInputFiles(entries);
  const result = compress(inputFiles);
  return result.data;
}

/**
 * @deprecated decompress() 사용 권장. 기존 호환용 래퍼.
 */
export function deserializeEntries(data: Uint8Array): FileEntry[] {
  const result = decompress(data);
  return toFileEntries(result.files);
}

// ─────────────────────────────────────────────────────────
// 포맷 감지
// ─────────────────────────────────────────────────────────

function detectFormat(data: Uint8Array): 'zip' | 'zlib' | 'legacy' {
  if (data.byteLength < 4) return 'legacy';

  // ZIP: 'PK' 시그니처 (Local File Header 0x04034b50)
  if (data[0] === ZIP_MAGIC_0 && data[1] === ZIP_MAGIC_1) {
    return 'zip';
  }

  // ZLIB: CMF 바이트 0x78 + FLG 체크섬 유효
  if (data[0] === ZLIB_CMF) {
    const cmfFlg = (data[0] << 8) | data[1];
    if (cmfFlg % 31 === 0) {
      // ZLIB 헤더 유효 — 레거시 v2와 충돌 가능성 검사
      // 레거시 v2 첫 4바이트는 metaLen (little-endian uint32)
      // metaLen이 합리적이고 그 뒤에 유효한 JSON이 있으면 레거시
      if (isLikelyLegacyHeader(data)) {
        return 'legacy';
      }
      return 'zlib';
    }
  }

  return 'legacy';
}

/** 레거시 [4B metaLen][JSON] 헤더 패턴 탐지 */
function isLikelyLegacyHeader(data: Uint8Array): boolean {
  try {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const metaLen = view.getUint32(0, true); // little-endian
    if (metaLen === 0 || metaLen > LEGACY_META_MAX_BYTES || metaLen + 4 > data.byteLength) {
      return false;
    }
    const metaBytes = data.slice(4, 4 + metaLen);
    const str = new TextDecoder('utf-8', { fatal: true }).decode(metaBytes);
    // 유효한 JSON이고 객체 또는 배열이면 레거시
    const parsed = JSON.parse(str);
    return typeof parsed === 'object' && parsed !== null;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────
// 레거시 역호환 파서
// ─────────────────────────────────────────────────────────

function decompressLegacy(data: Uint8Array, fallbackName: string): DecompressResult {
  try {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const metaLen = view.getUint32(0, true); // little-endian

    if (metaLen === 0 || metaLen > LEGACY_META_MAX_BYTES || metaLen + 4 > data.byteLength) {
      return decompressRawGzip(data, fallbackName);
    }

    const metaBytes = data.slice(4, 4 + metaLen);
    const metaStr = strFromU8(metaBytes);
    const meta = JSON.parse(metaStr);

    // v2: { version: 2, files: [...] }
    if (meta && meta.version === 2 && Array.isArray(meta.files)) {
      return decompressLegacyV2(data, meta as LegacyV2Meta);
    }

    // v1: Array of file metas + tar.gz
    if (Array.isArray(meta)) {
      return decompressLegacyV1(data, metaLen, meta as LegacyV1Meta[]);
    }

    // 알 수 없는 형태 → gzip 시도
    return decompressRawGzip(data, fallbackName);
  } catch {
    // 최후 수단: 바이트 그대로 반환
    return {
      method: 'legacy',
      files: [{ name: fallbackName, data, lastModified: Date.now() }],
    };
  }
}

/**
 * 레거시 v1: [4B metaLen][JSON array][tar.gz]
 *
 * tar 내부 파일명은 f0, f1... (인덱스)
 * metadata JSON에 원본 파일명이 보관됨
 */
function decompressLegacyV1(
  data: Uint8Array,
  metaLen: number,
  metadata: LegacyV1Meta[]
): DecompressResult {
  const compressedData = data.slice(4 + metaLen);
  const tar = gunzipSync(compressedData);
  const tarFiles = extractTar(tar);

  const files: InputFile[] = tarFiles.map((tf, i) => ({
    name: metadata[i]?.name ?? tf.name,
    data: tf.data,
    lastModified: metadata[i]?.lastModified ?? Date.now(),
    mimeType: metadata[i]?.type,
  }));

  return { files, method: 'legacy' };
}

/**
 * 레거시 v2: [4B metaLen][JSON {version:2, files:[...]}][file0][file1]...
 *
 * 각 파일은 method에 따라 deflate 압축 또는 원본 저장
 */
function decompressLegacyV2(data: Uint8Array, meta: LegacyV2Meta): DecompressResult {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const metaLen = view.getUint32(0, true);
  let offset = 4 + metaLen;

  const files: InputFile[] = [];

  for (const fm of meta.files) {
    const stored = data.slice(offset, offset + fm.storedSize);
    offset += fm.storedSize;

    const fileData = fm.method === 'deflate'
      ? inflateSync(stored)
      : new Uint8Array(stored);

    files.push({
      name: fm.name,
      data: fileData,
      lastModified: fm.lastModified,
      mimeType: fm.type,
    });
  }

  return { files, method: 'legacy' };
}

/** raw gzip 스트림 처리 (메타 헤더 없는 경우) */
function decompressRawGzip(data: Uint8Array, fallbackName: string): DecompressResult {
  if (data[0] === GZIP_MAGIC_0 && data[1] === GZIP_MAGIC_1) {
    const raw = gunzipSync(data);
    return {
      method: 'legacy',
      files: [{ name: fallbackName, data: raw, lastModified: Date.now() }],
    };
  }
  // gzip도 아님 → 원본 그대로
  return {
    method: 'legacy',
    files: [{ name: fallbackName, data, lastModified: Date.now() }],
  };
}

// ─────────────────────────────────────────────────────────
// 레거시 tar 파서 (읽기 전용)
// ─────────────────────────────────────────────────────────

interface TarEntry {
  name: string;
  data: Uint8Array;
}

/**
 * tar 바이너리를 파일 목록으로 파싱한다 (POSIX ustar).
 *
 * tar 헤더 구조 (512B 블록):
 *   offset  0: 파일명 (100B, NUL 종료)
 *   offset124: 파일 크기 (12B, octal ASCII)
 *   offset136: mtime (12B, octal ASCII, Unix epoch)
 *   offset156: 타입 플래그 (1B): '0'=일반파일
 */
function extractTar(tar: Uint8Array): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;
  const dec = new TextDecoder('utf-8', { fatal: false });

  while (offset + 512 <= tar.byteLength) {
    const header = tar.slice(offset, offset + 512);
    if (header.every(b => b === 0)) break;

    let nameEnd = 0;
    while (nameEnd < 100 && header[nameEnd] !== 0) nameEnd++;
    const name = dec.decode(header.slice(0, nameEnd));

    const sizeStr = dec.decode(header.slice(124, 136)).replace(/\0/g, '').trim();
    const size = parseInt(sizeStr, 8) || 0;

    const typeFlag = header[156];
    offset += 512;

    // 일반 파일만 추출 (typeFlag '0' 또는 NUL)
    if (typeFlag === 0x30 || typeFlag === 0) {
      const data = tar.slice(offset, offset + size);
      entries.push({ name, data: new Uint8Array(data) });
    }

    // 512B 블록 경계 정렬
    offset += Math.ceil(size / 512) * 512;
  }

  return entries;
}

// ─────────────────────────────────────────────────────────
// 로깅
// ─────────────────────────────────────────────────────────

function logCompressStats(result: CompressResult, files: InputFile[]) {
  const ratio = result.originalSize > 0
    ? ((1 - result.compressedSize / result.originalSize) * 100).toFixed(1)
    : '0';
  const method = result.method === 'zlib' ? 'ZLIB (RFC 3274)' : 'ZIP (PKWARE)';
  const stats = files.map(f =>
    `  ${f.name} (${fmtSize(f.data.byteLength)})`
  ).join('\n');
  console.log(
    `[PKIZIP] ${method} 압축: ${fmtSize(result.originalSize)} → ${fmtSize(result.compressedSize)} (${ratio}% 절감)\n${stats}`
  );
}
