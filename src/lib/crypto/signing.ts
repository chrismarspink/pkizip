/**
 * Signing Module - ECDSA P-256 서명 및 다중 서명
 *
 * CMS SignedData 구조:
 *   - DigestAlgorithm: SHA-256
 *   - SignerInfo[]: 여러 서명자가 각자의 개인키로 서명
 *   - 각 서명은 콘텐츠 해시에 대한 ECDSA 서명
 */
import { sha256 } from '@noble/hashes/sha2.js';

const buf = (data: Uint8Array): BufferSource => data as unknown as BufferSource;

export interface SignerInfo {
  fingerprint: string;       // 서명자 공개키 핑거프린트
  signature: ArrayBuffer;    // ECDSA 서명값
  publicKey: ArrayBuffer;    // 서명자 공개키 (raw)
  timestamp: number;         // 서명 시각
  label?: string;            // 서명자 이름/이메일
}

export interface SignedPackage {
  contentHash: Uint8Array;   // SHA-256 해시
  signerInfos: SignerInfo[];
  digestAlgorithm: 'SHA-256';
}

export interface VerificationResult {
  fingerprint: string;
  label?: string;
  valid: boolean;
  timestamp: number;
  error?: string;
}

/**
 * 데이터에 대한 SHA-256 해시 계산
 */
export function computeHash(data: Uint8Array): Uint8Array {
  return sha256(data);
}

/**
 * 단일 서명 생성
 *
 * @param data - 서명할 데이터
 * @param privateKey - 서명자 ECDSA 개인키
 * @param publicKey - 서명자 공개키 (SignerInfo에 포함)
 * @param fingerprint - 서명자 핑거프린트
 * @param label - 서명자 라벨 (선택)
 */
export async function signData(
  data: Uint8Array,
  privateKey: CryptoKey,
  publicKey: CryptoKey,
  fingerprint: string,
  label?: string
): Promise<SignerInfo> {
  const contentHash = computeHash(data);

  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    buf(contentHash)
  );

  const publicKeyRaw = await crypto.subtle.exportKey('raw', publicKey);

  return {
    fingerprint,
    signature,
    publicKey: publicKeyRaw,
    timestamp: Date.now(),
    label,
  };
}

/**
 * 다중 서명 패키지 생성
 * 첫 번째 서명자로 시작
 */
export async function createSignedPackage(
  data: Uint8Array,
  privateKey: CryptoKey,
  publicKey: CryptoKey,
  fingerprint: string,
  label?: string
): Promise<SignedPackage> {
  const contentHash = computeHash(data);
  const signerInfo = await signData(data, privateKey, publicKey, fingerprint, label);

  return {
    contentHash,
    signerInfos: [signerInfo],
    digestAlgorithm: 'SHA-256',
  };
}

/**
 * 기존 서명 패키지에 서명 추가 (다중 서명)
 */
export async function addSignature(
  signedPackage: SignedPackage,
  data: Uint8Array,
  privateKey: CryptoKey,
  publicKey: CryptoKey,
  fingerprint: string,
  label?: string
): Promise<SignedPackage> {
  // 이미 이 키로 서명했는지 확인
  if (signedPackage.signerInfos.some(s => s.fingerprint === fingerprint)) {
    throw new Error('이미 이 키로 서명되어 있습니다.');
  }

  const signerInfo = await signData(data, privateKey, publicKey, fingerprint, label);

  return {
    ...signedPackage,
    signerInfos: [...signedPackage.signerInfos, signerInfo],
  };
}

/**
 * 단일 서명 검증
 */
export async function verifySignature(
  contentHash: Uint8Array,
  signerInfo: SignerInfo
): Promise<VerificationResult> {
  try {
    const publicKey = await crypto.subtle.importKey(
      'raw',
      signerInfo.publicKey,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    );

    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      signerInfo.signature,
      buf(contentHash)
    );

    return {
      fingerprint: signerInfo.fingerprint,
      label: signerInfo.label,
      valid,
      timestamp: signerInfo.timestamp,
    };
  } catch (err) {
    return {
      fingerprint: signerInfo.fingerprint,
      label: signerInfo.label,
      valid: false,
      timestamp: signerInfo.timestamp,
      error: err instanceof Error ? err.message : '검증 실패',
    };
  }
}

/**
 * 모든 서명 검증
 */
export async function verifyAllSignatures(
  data: Uint8Array,
  signedPackage: SignedPackage
): Promise<VerificationResult[]> {
  const contentHash = computeHash(data);

  // 해시 일치 확인
  if (!arraysEqual(contentHash, signedPackage.contentHash)) {
    return signedPackage.signerInfos.map(s => ({
      fingerprint: s.fingerprint,
      label: s.label,
      valid: false,
      timestamp: s.timestamp,
      error: '콘텐츠 해시 불일치 - 파일이 변조되었을 수 있습니다.',
    }));
  }

  return Promise.all(
    signedPackage.signerInfos.map(si => verifySignature(contentHash, si))
  );
}

/**
 * 서명 수 반환
 */
export function getSignatureCount(signedPackage: SignedPackage): number {
  return signedPackage.signerInfos.length;
}

/**
 * Uint8Array 동등 비교
 */
function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
