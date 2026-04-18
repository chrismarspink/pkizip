/**
 * CMS RFC 3274 준거 압축 모듈 — 공유 타입 정의
 *
 * 표준 참조:
 *   RFC 3274  — Compressed Data Content Type for CMS
 *   RFC 1950  — ZLIB Compressed Data Format
 *   PKWARE APPNOTE 6.3.10 — ZIP File Format
 *   ISO/IEC 21320-1:2015 — Document Container File (ZIP 기반)
 */

// ─────────────────────────────────────────────────────────
// CMS OID
// ─────────────────────────────────────────────────────────

/** RFC 3274 id-alg-zlibCompress OID: 1.2.840.113549.1.9.16.3.8 */
export const CMS_ZLIB_OID = '1.2.840.113549.1.9.16.3.8' as const;

// ─────────────────────────────────────────────────────────
// 입력/출력 타입
// ─────────────────────────────────────────────────────────

/**
 * 압축 대상 파일 디스크립터
 */
export interface InputFile {
  /** 원본 파일명 (UTF-8, 경로 포함 가능: "dir/sub/file.txt") */
  name: string;
  /** 파일 데이터 */
  data: Uint8Array;
  /** 최종 수정 시각 (ms timestamp, 없으면 현재 시각) */
  lastModified?: number;
  /** MIME 타입 (선택) */
  mimeType?: string;
}

/**
 * compress() 반환 타입
 */
export interface CompressResult {
  /**
   * 압축된 데이터.
   * - 단일 파일: ZLIB 스트림 (RFC 1950 헤더 + DEFLATE + Adler-32)
   * - 다중 파일/폴더: ZIP 아카이브 (PKWARE APPNOTE)
   */
  data: Uint8Array;

  /** 압축 방식 */
  method: 'zlib' | 'zip';

  /** CMS 알고리즘 식별자 OID (RFC 3274) */
  algorithmOID: typeof CMS_ZLIB_OID;

  /** 원본 파일 수 */
  fileCount: number;

  /** 원본 총 크기 (bytes) */
  originalSize: number;

  /** 압축 후 크기 (bytes) */
  compressedSize: number;

  /** 파일 목록 (미리보기용) */
  entries: Array<{ name: string; size: number; mimeType?: string }>;
}

/**
 * decompress() 반환 타입
 */
export interface DecompressResult {
  files: InputFile[];
  method: 'zlib' | 'zip' | 'legacy';
}

// ─────────────────────────────────────────────────────────
// 레거시 역호환 타입
// ─────────────────────────────────────────────────────────

/**
 * 기존 FileEntry — 앱 전체에서 사용 중 (backward compat)
 *
 * InputFile과의 차이점:
 *   - size: 명시적 원본 크기 필드
 *   - lastModified: 필수 (number)
 *   - type: MIME 타입 (필수)
 */
export interface FileEntry {
  name: string;
  data: Uint8Array;
  size: number;
  lastModified: number;
  type: string;
}

/** 레거시 v1 포맷 메타데이터 (tar+gzip) */
export interface LegacyV1Meta {
  name: string;
  tarName: string;
  size: number;
  lastModified: number;
  type: string;
  stored?: boolean;
}

/** 레거시 v2 포맷 파일 메타데이터 (per-file deflate) */
export interface LegacyV2FileMeta {
  name: string;
  size: number;
  storedSize: number;
  lastModified: number;
  type: string;
  method: 'deflate' | 'store';
}

/** 레거시 v2 포맷 아카이브 메타데이터 */
export interface LegacyV2Meta {
  version: 2;
  files: LegacyV2FileMeta[];
}

// ─────────────────────────────────────────────────────────
// 변환 유틸리티
// ─────────────────────────────────────────────────────────

/** InputFile[] → FileEntry[] 변환 */
export function toFileEntries(files: InputFile[]): FileEntry[] {
  return files.map(f => ({
    name: f.name,
    data: f.data,
    size: f.data.byteLength,
    lastModified: f.lastModified ?? Date.now(),
    type: f.mimeType ?? guessType(f.name),
  }));
}

/** FileEntry[] → InputFile[] 변환 */
export function toInputFiles(entries: FileEntry[]): InputFile[] {
  return entries.map(e => ({
    name: e.name,
    data: e.data,
    lastModified: e.lastModified,
    mimeType: e.type,
  }));
}

/** 파일 확장자로 MIME 타입 추정 */
export function guessType(filename: string): string {
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
    htm: 'text/html',
    css: 'text/css',
    js: 'application/javascript',
    ts: 'text/typescript',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    ico: 'image/x-icon',
    zip: 'application/zip',
    tar: 'application/x-tar',
    gz: 'application/gzip',
    '7z': 'application/x-7z-compressed',
    rar: 'application/vnd.rar',
    mp4: 'video/mp4',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    webm: 'video/webm',
    mkv: 'video/x-matroska',
    avi: 'video/x-msvideo',
    mov: 'video/quicktime',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    otf: 'font/otf',
    wasm: 'application/wasm',
  };
  return types[ext ?? ''] ?? 'application/octet-stream';
}

/** 바이트 크기를 사람이 읽기 쉬운 문자열로 변환 */
export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)}MB`;
  return `${(bytes / 1073741824).toFixed(1)}GB`;
}
