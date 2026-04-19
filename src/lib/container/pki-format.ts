/**
 * .pki Container Format - 바이너리 포맷 Reader/Writer
 *
 * 구조:
 *   [Magic: "PKI!" 4B][Version: 2B][Flags: 2B]
 *   [Header Length: 4B][Header JSON]
 *   [Payload Length: 4B][Payload (compressed+encrypted data)]
 *   [Signature Data Length: 4B][Signature Data JSON]
 *   [EOF Magic: "PKI!" 4B]
 */
import type { WrappedRecipient } from '../crypto/encryption';
import type { SignerInfo } from '../crypto/signing';

// Magic Number: "PKI!" = 0x504B4921
const MAGIC = new Uint8Array([0x50, 0x4B, 0x49, 0x21]);
const VERSION = 1;

// Flags bitmask
export const FLAG_COMPRESSED  = 0x01;
export const FLAG_ENCRYPTED   = 0x02;
export const FLAG_SIGNED      = 0x04;
export const FLAG_MULTI_FILE  = 0x08;

export interface PkiFileInfo {
  name: string;
  originalSize: number;
  compressedSize: number;
  hash: string;             // SHA-256 hex
  type: string;
  lastModified: number;
}

export interface PkiHeader {
  version: number;
  flags: number;
  createdAt: number;
  creatorFingerprint?: string;
  files: PkiFileInfo[];
  /** 압축 메타 (v3+, RFC 3274 호환) */
  compression?: {
    /** 압축 방법: zlib (단일파일, RFC 3274) | zip (다중파일, PKWARE APPNOTE) */
    method: 'zlib' | 'zip';
    /** CMS AlgorithmIdentifier OID (RFC 3274 id-alg-zlibCompress) */
    oid: string;
    /** 파일 수 */
    entries: number;
    /** 원본 총 바이트 */
    originalSize: number;
  };
  encryption?: {
    algorithm: 'AES-256-GCM';
    iv: string;               // Base64
    recipients: Array<{
      fingerprint: string;
      wrappedKey: string;     // Base64
      ephemeralPublicKey: string; // Base64
      label?: string;
    }>;
  };
  signatures?: Array<{
    fingerprint: string;
    signature: string;        // Base64
    publicKey: string;        // Base64
    timestamp: number;
    label?: string;
  }>;
  /** ML-KEM-1024 하이브리드 수신자 (RFC 9936) */
  pqcKemRecipientInfo?: {
    type: string;                 // 'ML-KEM-1024'
    pqcKeyId: string;             // SHA-256(kemPublicKey) hex
    kemCiphertext: string;        // Base64
    encryptedKey: string;         // Base64 — AES-GCM wrapped CEK
    iv: string;                   // Base64
    salt: string;                 // Base64
    kemPublicKey: string;         // Base64
  };
  /** ML-DSA-87 하이브리드 서명 (RFC 9882) */
  pqcSignerInfo?: {
    algorithm: string;            // 'ML-DSA-87'
    signature: string;            // Base64
    dsaPublicKey: string;         // Base64
    signedAt: string;             // ISO timestamp
  };
  /** PQC 모드 메타 */
  pqcHeader?: {
    pqcProtected: boolean;
    mode: string;                 // 'hybrid' | 'pqc-only'
    kemAlgorithm?: string;
    dsaAlgorithm?: string;
    kemKeyId?: string;
  };
  merkleProof?: {
    merkleRoot: string;
    proofPath: string[];
    txId: string;
    timestamp: number;
  };
}

export interface PkiContainer {
  header: PkiHeader;
  payload: Uint8Array;        // 실제 데이터 (압축/암호화된 상태)
}

/**
 * .pki 컨테이너 생성 (직렬화)
 */
export function writePkiContainer(container: PkiContainer): Uint8Array {
  const headerJson = JSON.stringify(container.header);
  const headerBytes = new TextEncoder().encode(headerJson);

  // 전체 크기 계산
  const totalSize =
    4 +  // Magic
    2 +  // Version
    2 +  // Flags
    4 +  // Header Length
    headerBytes.length +
    4 +  // Payload Length
    container.payload.length +
    4;   // EOF Magic

  const buffer = new Uint8Array(totalSize);
  const view = new DataView(buffer.buffer);
  let offset = 0;

  // Magic Number
  buffer.set(MAGIC, offset);
  offset += 4;

  // Version
  view.setUint16(offset, VERSION, false); // Big-Endian
  offset += 2;

  // Flags
  view.setUint16(offset, container.header.flags, false);
  offset += 2;

  // Header Length + Header
  view.setUint32(offset, headerBytes.length, false);
  offset += 4;
  buffer.set(headerBytes, offset);
  offset += headerBytes.length;

  // Payload Length + Payload
  view.setUint32(offset, container.payload.length, false);
  offset += 4;
  buffer.set(container.payload, offset);
  offset += container.payload.length;

  // EOF Magic
  buffer.set(MAGIC, offset);

  return buffer;
}

/**
 * .pki 컨테이너 읽기 (역직렬화)
 */
export function readPkiContainer(data: Uint8Array): PkiContainer {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;

  // Magic Number 확인
  if (!checkMagic(data, offset)) {
    throw new Error('유효한 .pki 파일이 아닙니다.');
  }
  offset += 4;

  // Version
  const version = view.getUint16(offset, false);
  if (version > VERSION) {
    throw new Error(`지원하지 않는 버전입니다: v${version}`);
  }
  offset += 2;

  // Flags
  const flags = view.getUint16(offset, false);
  offset += 2;

  // Header
  const headerLength = view.getUint32(offset, false);
  offset += 4;
  const headerBytes = data.slice(offset, offset + headerLength);
  const header: PkiHeader = JSON.parse(new TextDecoder().decode(headerBytes));
  header.flags = flags;
  header.version = version;
  offset += headerLength;

  // Payload
  const payloadLength = view.getUint32(offset, false);
  offset += 4;
  const payload = data.slice(offset, offset + payloadLength);
  offset += payloadLength;

  // EOF Magic 확인
  if (!checkMagic(data, offset)) {
    throw new Error('.pki 파일이 손상되었습니다. (EOF 마커 불일치)');
  }

  return { header, payload };
}

/**
 * Magic Number 확인
 */
function checkMagic(data: Uint8Array, offset: number): boolean {
  return (
    data[offset] === MAGIC[0] &&
    data[offset + 1] === MAGIC[1] &&
    data[offset + 2] === MAGIC[2] &&
    data[offset + 3] === MAGIC[3]
  );
}

/**
 * .pki 파일 여부 확인
 */
export function isPkiFile(data: Uint8Array): boolean {
  if (data.length < 12) return false;
  return checkMagic(data, 0);
}

/**
 * ArrayBuffer/Uint8Array → Base64 인코딩
 */
export function arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Base64 → ArrayBuffer 디코딩
 */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * SignerInfo 배열을 직렬화 가능한 형태로 변환
 */
export function serializeSignerInfos(
  signerInfos: SignerInfo[]
): PkiHeader['signatures'] {
  return signerInfos.map(si => ({
    fingerprint: si.fingerprint,
    signature: arrayBufferToBase64(si.signature),
    publicKey: arrayBufferToBase64(si.publicKey),
    timestamp: si.timestamp,
    label: si.label,
  }));
}

/**
 * 직렬화된 서명 정보를 SignerInfo로 복원
 */
export function deserializeSignerInfos(
  serialized: NonNullable<PkiHeader['signatures']>
): SignerInfo[] {
  return serialized.map(s => ({
    fingerprint: s.fingerprint,
    signature: base64ToArrayBuffer(s.signature),
    publicKey: base64ToArrayBuffer(s.publicKey),
    timestamp: s.timestamp,
    label: s.label,
  }));
}

/**
 * WrappedRecipient 배열을 직렬화 가능한 형태로 변환
 */
export function serializeRecipients(
  recipients: WrappedRecipient[]
): NonNullable<PkiHeader['encryption']>['recipients'] {
  return recipients.map(r => ({
    fingerprint: r.fingerprint,
    wrappedKey: arrayBufferToBase64(r.wrappedKey),
    ephemeralPublicKey: arrayBufferToBase64(r.ephemeralPublicKey),
    label: r.label,
  }));
}

/**
 * 직렬화된 수신자 정보를 WrappedRecipient로 복원
 */
export function deserializeRecipients(
  serialized: NonNullable<PkiHeader['encryption']>['recipients']
): WrappedRecipient[] {
  return serialized.map(r => ({
    fingerprint: r.fingerprint,
    wrappedKey: base64ToArrayBuffer(r.wrappedKey),
    ephemeralPublicKey: base64ToArrayBuffer(r.ephemeralPublicKey),
    label: r.label,
  }));
}

/**
 * 플래그 헬퍼 함수
 */
export function hasFlag(flags: number, flag: number): boolean {
  return (flags & flag) !== 0;
}

export function setFlag(flags: number, flag: number): number {
  return flags | flag;
}
