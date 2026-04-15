/**
 * BIP32 HD Key Derivation for pkizip
 *
 * Key Path Convention:
 *   서명용 키: m/44'/60'/0'/0/{index}  — ECDSA P-256
 *   암호화용 키: m/44'/60'/0'/1/{index} — ECDH P-256
 *
 * BIP32는 secp256k1 기반이므로, 파생된 32바이트 엔트로피를
 * @noble/curves의 P-256 곡선 연산으로 변환하여
 * Web Crypto API 호환 키쌍을 생성한다.
 */
import { HDKey } from '@scure/bip32';
import { sha256 } from '@noble/hashes/sha2.js';
import { p256 } from '@noble/curves/nist.js';

export interface DerivedKeyPair {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicKeyRaw: Uint8Array;   // uncompressed public key bytes (65 bytes)
  fingerprint: string;         // SHA-256 hex of public key (first 8 chars)
  path: string;
  index: number;
}

export interface KeyIdentity {
  signingKey: DerivedKeyPair;
  encryptionKey: DerivedKeyPair;
  masterFingerprint: string;
}

const SIGNING_BASE_PATH = "m/44'/60'/0'/0";
const ENCRYPTION_BASE_PATH = "m/44'/60'/0'/1";

// P-256 곡선의 order (n)
const P256_ORDER = BigInt('0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551');

/**
 * BIP32 파생 엔트로피 → P-256 유효 개인키 스칼라
 *
 * 1. BIP32 파생 32바이트를 SHA-256 해싱 (secp256k1 → P-256 도메인 분리)
 * 2. 결과를 P-256 order로 모듈러 리덕션 (1 ≤ d < n 보장)
 */
function deriveP256Scalar(entropy: Uint8Array): Uint8Array {
  const hashed = sha256(entropy);
  let scalar = bytesToBigInt(hashed);

  // P-256 order 범위로 축소 (0은 무효이므로 1 ~ n-1)
  scalar = (scalar % (P256_ORDER - 1n)) + 1n;

  return bigIntToBytes(scalar, 32);
}

/**
 * BIP32 파생 → P-256 키쌍 (Web Crypto API 호환)
 *
 * 핵심 흐름:
 *   BIP32 derive → 32-byte entropy
 *   → SHA-256 → mod P256_ORDER → private scalar (d)
 *   → @noble/curves p256.getPublicKey(d) → public point (x, y)
 *   → JWK { d, x, y } → Web Crypto importKey
 */
async function deriveP256KeyPair(
  hdKey: HDKey,
  path: string,
  usage: 'sign' | 'deriveKey'
): Promise<DerivedKeyPair> {
  const derived = hdKey.derive(path);
  if (!derived.privateKey) {
    throw new Error(`키 파생 실패: ${path}`);
  }

  // 1. P-256 유효 스칼라 생성
  const privateScalar = deriveP256Scalar(derived.privateKey);

  // 2. @noble/curves로 공개키 좌표 계산
  const publicKeyUncompressed = p256.getPublicKey(privateScalar, false); // 65 bytes (04 || x || y)

  // 3. x, y 좌표 추출 (첫 바이트 0x04 제외)
  const x = publicKeyUncompressed.slice(1, 33);  // 32 bytes
  const y = publicKeyUncompressed.slice(33, 65);  // 32 bytes

  // 4. JWK 구성
  const jwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    d: uint8ArrayToBase64Url(privateScalar),
    x: uint8ArrayToBase64Url(x),
    y: uint8ArrayToBase64Url(y),
  };

  const algorithm = usage === 'sign'
    ? { name: 'ECDSA', namedCurve: 'P-256' }
    : { name: 'ECDH', namedCurve: 'P-256' };

  // 5. Web Crypto API로 임포트
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    algorithm,
    true,
    usage === 'sign' ? ['sign'] : ['deriveKey', 'deriveBits']
  );

  const publicJwk: JsonWebKey = { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
  const publicKey = await crypto.subtle.importKey(
    'jwk',
    publicJwk,
    algorithm,
    true,
    usage === 'sign' ? ['verify'] : []
  );

  const publicKeyRaw = new Uint8Array(publicKeyUncompressed);
  const fingerprint = computeFingerprint(publicKeyRaw);

  const pathParts = path.split('/');
  const index = parseInt(pathParts[pathParts.length - 1], 10);

  return {
    privateKey,
    publicKey,
    publicKeyRaw,
    fingerprint,
    path,
    index,
  };
}

/**
 * 시드에서 완전한 키 아이덴티티 파생
 */
export async function deriveKeyIdentity(
  seed: Uint8Array,
  signingIndex: number = 0,
  encryptionIndex: number = 0
): Promise<KeyIdentity> {
  const master = HDKey.fromMasterSeed(seed);

  const signingPath = `${SIGNING_BASE_PATH}/${signingIndex}`;
  const encryptionPath = `${ENCRYPTION_BASE_PATH}/${encryptionIndex}`;

  const [signingKey, encryptionKey] = await Promise.all([
    deriveP256KeyPair(master, signingPath, 'sign'),
    deriveP256KeyPair(master, encryptionPath, 'deriveKey'),
  ]);

  const masterFingerprint = computeFingerprint(
    new Uint8Array([...signingKey.publicKeyRaw, ...encryptionKey.publicKeyRaw])
  );

  return { signingKey, encryptionKey, masterFingerprint };
}

// === 유틸리티 함수 ===

function computeFingerprint(publicKeyBytes: Uint8Array): string {
  const hash = sha256(publicKeyBytes);
  return Array.from(hash.slice(0, 4))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function uint8ArrayToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  const base64 = btoa(binary);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlToUint8Array(base64url: string): Uint8Array {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let result = 0n;
  for (const b of bytes) {
    result = (result << 8n) | BigInt(b);
  }
  return result;
}

function bigIntToBytes(value: bigint, length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  let v = value;
  for (let i = length - 1; i >= 0; i--) {
    bytes[i] = Number(v & 0xFFn);
    v >>= 8n;
  }
  return bytes;
}

/**
 * 공개키를 JWK 포맷으로 내보내기 (공유용)
 */
export async function exportPublicKeyJWK(key: CryptoKey): Promise<JsonWebKey> {
  const jwk = await crypto.subtle.exportKey('jwk', key);
  delete jwk.d;
  return jwk;
}

/**
 * JWK에서 공개키 임포트
 */
export async function importPublicKeyFromJWK(
  jwk: JsonWebKey,
  usage: 'verify' | 'encrypt'
): Promise<CryptoKey> {
  const algorithm = usage === 'verify'
    ? { name: 'ECDSA', namedCurve: 'P-256' }
    : { name: 'ECDH', namedCurve: 'P-256' };

  return await crypto.subtle.importKey(
    'jwk',
    { ...jwk, d: undefined },
    algorithm,
    true,
    usage === 'verify' ? ['verify'] : []
  );
}
