/**
 * PKI Operations - 고수준 통합 API
 *
 * 압축 + 암호화 + 서명을 통합하여 .pki 컨테이너를 생성/열기
 * WinZip-style 워크플로우를 지원하는 메인 엔트리 포인트
 */
import type { FileEntry } from '../compression/compressor';
import { serializeEntries, deserializeEntries } from '../compression/compressor';
import {
  encryptForRecipients,
  decryptAsRecipient,
  type RecipientInfo,
  type EncryptedPackage,
} from '../crypto/encryption';
import {
  signData,
  verifyAllSignatures,
  computeHash,
  type SignerInfo,
  type SignedPackage,
  type VerificationResult,
} from '../crypto/signing';
import {
  writePkiContainer,
  readPkiContainer,
  isPkiFile,
  type PkiContainer,
  type PkiHeader,
  type PkiFileInfo,
  FLAG_COMPRESSED,
  FLAG_ENCRYPTED,
  FLAG_SIGNED,
  FLAG_MULTI_FILE,
  setFlag,
  hasFlag,
  arrayBufferToBase64,
  base64ToArrayBuffer,
  serializeSignerInfos,
  deserializeSignerInfos,
  serializeRecipients,
  deserializeRecipients,
} from './pki-format';

export interface SealOptions {
  files: FileEntry[];
  compress?: boolean;          // 기본 true
  encrypt?: {
    recipients: RecipientInfo[];
  };
  sign?: {
    privateKey: CryptoKey;
    publicKey: CryptoKey;
    fingerprint: string;
    label?: string;
  };
}

export interface SealResult {
  pkiData: Uint8Array;         // 최종 .pki 바이너리
  header: PkiHeader;
  stats: {
    originalSize: number;
    compressedSize: number;
    fileCount: number;
    isEncrypted: boolean;
    isSigned: boolean;
    signatureCount: number;
    recipientCount: number;
  };
}

export interface OpenResult {
  files: FileEntry[];
  header: PkiHeader;
  verification: VerificationResult[];
  isEncrypted: boolean;
  isSigned: boolean;
}

/**
 * 봉인 (Seal) - 파일들을 압축 + 암호화 + 서명하여 .pki 생성
 *
 * 워크플로우:
 *   1. 파일 직렬화 (다중 파일 → 단일 바이너리)
 *   2. 압축 (Deflate)
 *   3. 암호화 (AES-256-GCM, 다중 수신자 ECDH)
 *   4. 서명 (ECDSA P-256)
 *   5. .pki 컨테이너 패킹
 */
export async function seal(options: SealOptions): Promise<SealResult> {
  const { files, compress = true, encrypt, sign } = options;

  if (files.length === 0) {
    throw new Error('최소 1개의 파일이 필요합니다.');
  }

  let flags = 0;
  if (files.length > 1) flags = setFlag(flags, FLAG_MULTI_FILE);

  // 1. 파일 직렬화 (메타데이터 + ZIP 압축)
  let payload: Uint8Array;
  const originalSize = files.reduce((sum, f) => sum + f.size, 0);

  if (compress) {
    payload = serializeEntries(files);
    flags = setFlag(flags, FLAG_COMPRESSED);
  } else {
    payload = serializeEntries(files);
  }

  // 2. 파일 정보 헤더 구성
  const fileInfos: PkiFileInfo[] = files.map(f => ({
    name: f.name,
    originalSize: f.size,
    compressedSize: 0, // 나중에 업데이트
    hash: uint8ArrayToHex(computeHash(f.data)),
    type: f.type,
    lastModified: f.lastModified,
  }));

  // 헤더 초기화
  const header: PkiHeader = {
    version: 1,
    flags,
    createdAt: Date.now(),
    files: fileInfos,
  };

  // 3. 암호화
  let encryptedPkg: EncryptedPackage | null = null;
  if (encrypt && encrypt.recipients.length > 0) {
    encryptedPkg = await encryptForRecipients(payload, encrypt.recipients);
    payload = new Uint8Array(encryptedPkg.ciphertext);
    flags = setFlag(flags, FLAG_ENCRYPTED);

    header.encryption = {
      algorithm: 'AES-256-GCM',
      iv: arrayBufferToBase64(encryptedPkg.iv),
      recipients: serializeRecipients(encryptedPkg.recipients),
    };
  }

  // 4. 서명
  const signerInfos: SignerInfo[] = [];
  if (sign) {
    const signerInfo = await signData(
      payload,
      sign.privateKey,
      sign.publicKey,
      sign.fingerprint,
      sign.label
    );
    signerInfos.push(signerInfo);
    flags = setFlag(flags, FLAG_SIGNED);

    header.signatures = serializeSignerInfos(signerInfos);
    header.creatorFingerprint = sign.fingerprint;
  }

  header.flags = flags;

  // 5. .pki 컨테이너 패킹
  const container: PkiContainer = { header, payload };
  const pkiData = writePkiContainer(container);

  // 파일별 압축 크기 업데이트
  const avgRatio = payload.length / originalSize;
  header.files.forEach(f => {
    f.compressedSize = Math.round(f.originalSize * avgRatio);
  });

  return {
    pkiData,
    header,
    stats: {
      originalSize,
      compressedSize: pkiData.length,
      fileCount: files.length,
      isEncrypted: hasFlag(flags, FLAG_ENCRYPTED),
      isSigned: hasFlag(flags, FLAG_SIGNED),
      signatureCount: signerInfos.length,
      recipientCount: encrypt?.recipients.length ?? 0,
    },
  };
}

/**
 * 열기 (Open) - .pki 파일을 읽고 검증 + 복호화 + 압축 해제
 *
 * @param pkiData - .pki 바이너리 데이터
 * @param decryptionKey - 내 ECDH 개인키 (암호화된 파일인 경우)
 * @param myFingerprint - 내 키 핑거프린트
 */
export async function open(
  pkiData: Uint8Array,
  decryptionKey?: CryptoKey,
  myFingerprint?: string
): Promise<OpenResult> {
  if (!isPkiFile(pkiData)) {
    throw new Error('유효한 .pki 파일이 아닙니다.');
  }

  const container = readPkiContainer(pkiData);
  const { header } = container;
  let { payload } = container;

  const isEncrypted = hasFlag(header.flags, FLAG_ENCRYPTED);
  const isSigned = hasFlag(header.flags, FLAG_SIGNED);

  // 1. 서명 검증
  let verification: VerificationResult[] = [];
  if (isSigned && header.signatures) {
    const signerInfos = deserializeSignerInfos(header.signatures);
    const signedPackage: SignedPackage = {
      contentHash: computeHash(payload),
      signerInfos,
      digestAlgorithm: 'SHA-256',
    };
    verification = await verifyAllSignatures(payload, signedPackage);
  }

  // 2. 복호화
  if (isEncrypted && header.encryption) {
    if (!decryptionKey || !myFingerprint) {
      // 복호화 키 없으면 헤더 정보만 반환
      return {
        files: header.files.map(f => ({
          name: f.name,
          data: new Uint8Array(0), // 빈 데이터
          size: f.originalSize,
          lastModified: f.lastModified,
          type: f.type,
        })),
        header,
        verification,
        isEncrypted: true,
        isSigned,
      };
    }

    const payloadCopy = new ArrayBuffer(payload.byteLength);
    new Uint8Array(payloadCopy).set(payload);
    const encryptedPkg: EncryptedPackage = {
      ciphertext: payloadCopy,
      iv: new Uint8Array(base64ToArrayBuffer(header.encryption.iv)),
      tag: new Uint8Array(0),
      recipients: deserializeRecipients(header.encryption.recipients),
      algorithm: 'AES-256-GCM',
    };

    const decrypted = await decryptAsRecipient(
      encryptedPkg,
      decryptionKey,
      myFingerprint
    );
    payload = decrypted.plaintext;
  }

  // 3. 압축 해제 + 파일 복원
  const files = deserializeEntries(payload);

  return {
    files,
    header,
    verification,
    isEncrypted,
    isSigned,
  };
}

/**
 * .pki 파일에 서명 추가 (다중 서명)
 */
export async function addSignatureToContainer(
  pkiData: Uint8Array,
  privateKey: CryptoKey,
  publicKey: CryptoKey,
  fingerprint: string,
  label?: string
): Promise<Uint8Array> {
  const container = readPkiContainer(pkiData);
  const { header, payload } = container;

  // 새 서명 생성
  const signerInfo = await signData(
    payload,
    privateKey,
    publicKey,
    fingerprint,
    label
  );

  // 기존 서명에 추가
  const existingSignatures = header.signatures ?? [];
  if (existingSignatures.some(s => s.fingerprint === fingerprint)) {
    throw new Error('이미 이 키로 서명되어 있습니다.');
  }

  const newSigs = serializeSignerInfos([signerInfo]) ?? [];
  header.signatures = [
    ...existingSignatures,
    ...newSigs,
  ];
  header.flags = setFlag(header.flags, FLAG_SIGNED);

  return writePkiContainer({ header, payload });
}

/**
 * .pki 파일의 메타데이터만 읽기 (빠른 미리보기)
 */
export function peekHeader(pkiData: Uint8Array): PkiHeader {
  if (!isPkiFile(pkiData)) {
    throw new Error('유효한 .pki 파일이 아닙니다.');
  }
  const container = readPkiContainer(pkiData);
  return container.header;
}

/**
 * 파일들을 압축만 하여 .pki 생성 (암호화/서명 없음)
 */
export async function compressOnly(files: FileEntry[]): Promise<SealResult> {
  return seal({ files, compress: true });
}

/**
 * Uint8Array → hex string
 */
function uint8ArrayToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
