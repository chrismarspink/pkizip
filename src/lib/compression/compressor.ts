/**
 * Compression Engine - tar + gzip 기반 아카이브
 *
 * 파일명/디렉토리 구조를 보존하는 tar 포맷으로 묶은 뒤 gzip 압축.
 * tar 헤더는 POSIX ustar 호환으로 직접 구현 (브라우저 순수 동작).
 * gzip은 fflate 사용.
 */
import { gzipSync, gunzipSync, strToU8, strFromU8 } from 'fflate';

export interface FileEntry {
  name: string;          // 파일 경로 (폴더 포함, 예: "docs/계약서.pdf")
  data: Uint8Array;      // 원본 파일 데이터
  size: number;          // 원본 크기
  lastModified: number;  // 타임스탬프
  type: string;          // MIME 타입
}

export interface CompressedEntry {
  name: string;
  data: Uint8Array;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  method: 'tar+gzip' | 'store';
  lastModified: number;
  type: string;
}

// === TAR 포맷 구현 (POSIX ustar) ===
// 각 파일: 512바이트 헤더 + 데이터 (512바이트 단위 패딩) + EOF: 1024바이트 0

const BLOCK_SIZE = 512;

function encodeTarHeader(name: string, size: number, mtime: number): Uint8Array {
  const header = new Uint8Array(BLOCK_SIZE);
  const encoder = new TextEncoder();

  // 파일명 (0~99, 최대 100바이트)
  const nameBytes = encoder.encode(name);
  header.set(nameBytes.slice(0, 100), 0);

  // 파일 모드 (100~107): 0644
  writeOctal(header, 100, 8, 0o644);

  // uid/gid (108~123): 0
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);

  // 파일 크기 (124~135): 11자리 8진수
  writeOctal(header, 124, 12, size);

  // mtime (136~147): Unix timestamp
  writeOctal(header, 136, 12, Math.floor(mtime / 1000));

  // 타입 플래그 (156): '0' = 일반 파일
  header[156] = 0x30; // '0'

  // ustar 매직 (257~262): "ustar\0"
  const magic = encoder.encode('ustar\0');
  header.set(magic, 257);

  // ustar 버전 (263~264): "00"
  header[263] = 0x30;
  header[264] = 0x30;

  // 체크섬 계산 (148~155): 체크섬 필드 자체는 공백으로 채움
  // 먼저 체크섬 필드를 공백으로
  for (let i = 148; i < 156; i++) header[i] = 0x20;

  let checksum = 0;
  for (let i = 0; i < BLOCK_SIZE; i++) checksum += header[i];

  writeOctal(header, 148, 7, checksum);
  header[155] = 0x20; // 체크섬 뒤 공백

  return header;
}

function writeOctal(buf: Uint8Array, offset: number, length: number, value: number) {
  const str = value.toString(8).padStart(length - 1, '0');
  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);
  buf.set(bytes.slice(0, length - 1), offset);
  buf[offset + length - 1] = 0; // null terminator
}

/**
 * 여러 파일을 tar 아카이브로 묶기
 */
function createTar(entries: FileEntry[]): Uint8Array {
  const blocks: Uint8Array[] = [];

  for (const entry of entries) {
    // 헤더
    const header = encodeTarHeader(entry.name, entry.data.length, entry.lastModified);
    blocks.push(header);

    // 데이터
    blocks.push(entry.data);

    // 512바이트 정렬 패딩
    const remainder = entry.data.length % BLOCK_SIZE;
    if (remainder > 0) {
      blocks.push(new Uint8Array(BLOCK_SIZE - remainder));
    }
  }

  // EOF: 2개의 빈 블록
  blocks.push(new Uint8Array(BLOCK_SIZE * 2));

  // 전체 연결
  const totalSize = blocks.reduce((sum, b) => sum + b.length, 0);
  const tar = new Uint8Array(totalSize);
  let offset = 0;
  for (const block of blocks) {
    tar.set(block, offset);
    offset += block.length;
  }

  return tar;
}

/**
 * tar 아카이브에서 파일 추출
 */
function extractTar(tar: Uint8Array): FileEntry[] {
  const entries: FileEntry[] = [];
  let offset = 0;
  const decoder = new TextDecoder();

  while (offset + BLOCK_SIZE <= tar.length) {
    const header = tar.slice(offset, offset + BLOCK_SIZE);

    // EOF 체크: 빈 블록이면 종료
    if (header.every(b => b === 0)) break;

    // 파일명 추출 (null terminated)
    let nameEnd = 0;
    while (nameEnd < 100 && header[nameEnd] !== 0) nameEnd++;
    const name = decoder.decode(header.slice(0, nameEnd));

    // 파일 크기 추출 (8진수)
    const sizeStr = decoder.decode(header.slice(124, 135)).replace(/\0/g, '').trim();
    const size = parseInt(sizeStr, 8) || 0;

    // mtime 추출
    const mtimeStr = decoder.decode(header.slice(136, 147)).replace(/\0/g, '').trim();
    const mtime = (parseInt(mtimeStr, 8) || 0) * 1000;

    // 타입 플래그
    const typeFlag = header[156];

    offset += BLOCK_SIZE;

    // 일반 파일만 추출 (typeFlag '0' 또는 '\0')
    if (typeFlag === 0x30 || typeFlag === 0) {
      const data = tar.slice(offset, offset + size);
      entries.push({
        name,
        data: new Uint8Array(data),
        size,
        lastModified: mtime || Date.now(),
        type: guessType(name),
      });
    }

    // 데이터 블록 건너뛰기 (512바이트 정렬)
    offset += Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE;
  }

  return entries;
}

// === 공개 API ===

/**
 * 메타데이터 + tar.gz로 파일 엔트리 직렬화
 *
 * 구조: [4 bytes: meta length][meta JSON][tar.gz data]
 * 메타데이터에 원본 파일명, 크기, 타입, 수정일 보존
 */
export function serializeEntries(entries: FileEntry[]): Uint8Array {
  // 메타데이터에 원본 파일명 완전 보존 (tar 100바이트 한계 우회)
  const metadata = entries.map((e, i) => ({
    name: e.name,        // 원본 파일명 (한글/긴 이름 완전 보존)
    tarName: `f${i}`,    // tar 내부용 짧은 안전 이름
    size: e.size,
    lastModified: e.lastModified,
    type: e.type,
  }));

  const metaJson = JSON.stringify(metadata);
  const metaBytes = strToU8(metaJson);
  const metaLen = new Uint32Array([metaBytes.length]);
  const metaLenBytes = new Uint8Array(metaLen.buffer);

  // tar에는 짧은 안전 이름(f0, f1, ...)으로 저장 → 한글/긴 이름 깨짐 방지
  const tarEntries: FileEntry[] = entries.map((e, i) => ({
    ...e,
    name: `f${i}`,
  }));
  const tar = createTar(tarEntries);
  const compressed = gzipSync(tar, { level: 6 });

  const result = new Uint8Array(4 + metaBytes.length + compressed.length);
  result.set(metaLenBytes, 0);
  result.set(metaBytes, 4);
  result.set(compressed, 4 + metaBytes.length);

  return result;
}

/**
 * 직렬화된 엔트리 복원 (meta + tar.gz → FileEntry[])
 */
export function deserializeEntries(data: Uint8Array): FileEntry[] {
  const metaLen = new Uint32Array(data.slice(0, 4).buffer)[0];
  const metaBytes = data.slice(4, 4 + metaLen);
  const metadata = JSON.parse(strFromU8(metaBytes));

  const compressedData = data.slice(4 + metaLen);
  const tar = gunzipSync(compressedData);
  const files = extractTar(tar);

  // 메타데이터로 원본 파일명/타입/시간 복원
  // tar의 파일명(f0, f1...)은 버리고 metadata의 원본 이름 사용
  return files.map((file, i) => ({
    ...file,
    name: metadata[i]?.name ?? file.name,      // 원본 파일명 (한글 보존)
    lastModified: metadata[i]?.lastModified ?? file.lastModified,
    type: metadata[i]?.type ?? file.type,
  }));
}

/**
 * 파일 확장자로 MIME 타입 추정
 */
function guessType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  const types: Record<string, string> = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    txt: 'text/plain',
    csv: 'text/csv',
    json: 'application/json',
    xml: 'application/xml',
    html: 'text/html',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    zip: 'application/zip',
    tar: 'application/x-tar',
    gz: 'application/gzip',
    mp4: 'video/mp4',
    mp3: 'audio/mpeg',
  };
  return types[ext ?? ''] ?? 'application/octet-stream';
}
