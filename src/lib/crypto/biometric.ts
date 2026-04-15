/**
 * Biometric Authentication using WebAuthn PRF Extension
 *
 * 생체 인증(Touch ID, Face ID, Windows Hello, Android 지문)으로
 * 개인키 시드를 직접 암호화/복호화한다.
 *
 * 핵심 아이디어:
 *   - WebAuthn PRF extension으로 생체 인증과 결합된 32바이트 시크릿 생성
 *   - 이 시크릿으로 시드를 AES-GCM 암호화하여 저장
 *   - 사용 시 같은 PRF 시크릿을 다시 생성하여 시드 복호화
 *
 * 호환성:
 *   - PRF 지원: Chrome 116+, Safari 17+, Android Chrome
 *   - 미지원: 기존 비밀번호 fallback
 */
import { openDB, type IDBPDatabase } from 'idb';

const buf = (data: Uint8Array): BufferSource => data as unknown as BufferSource;

const DB_NAME = 'pkizip-biometric';
const DB_VERSION = 1;
const STORE = 'bindings';

export interface BiometricBinding {
  identityId: string;          // PK
  credentialId: ArrayBuffer;   // WebAuthn credential ID
  prfSalt: Uint8Array;         // PRF salt (32 bytes)
  wrappedSeed: ArrayBuffer;    // PRF로 암호화된 시드
  iv: Uint8Array;              // AES-GCM IV
  createdAt: number;
}

async function getDB(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'identityId' });
      }
    },
  });
}

// === 지원 여부 확인 ===

export function isWebAuthnSupported(): boolean {
  return typeof window !== 'undefined' && !!window.PublicKeyCredential;
}

export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
  if (!isWebAuthnSupported()) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

// === 등록 ===

/**
 * 생체 인증 등록 — 시드를 PRF로 암호화하여 저장
 */
export async function registerBiometric(
  identityId: string,
  identityName: string,
  seed: Uint8Array
): Promise<void> {
  if (!isWebAuthnSupported()) throw new Error('이 브라우저는 WebAuthn을 지원하지 않습니다.');

  const userId = new TextEncoder().encode(identityId);
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const prfSalt = crypto.getRandomValues(new Uint8Array(32));

  // 1. WebAuthn credential 생성 (PRF extension)
  // 중요: 크로스-디바이스(폰 스캔), 플랫폼 싱크 패스키 차단
  //       로컬 기기의 platform authenticator(Touch ID, Windows Hello 등)만 허용
  const createOptions: PublicKeyCredentialCreationOptions = {
    rp: { name: 'PKIZIP', id: window.location.hostname },
    user: {
      id: userId as unknown as BufferSource,
      name: identityName,
      displayName: identityName,
    },
    challenge: buf(challenge),
    pubKeyCredParams: [
      { type: 'public-key', alg: -7 },   // ES256
      { type: 'public-key', alg: -257 }, // RS256
    ],
    authenticatorSelection: {
      authenticatorAttachment: 'platform',  // 로컬 기기 내장 authenticator만
      userVerification: 'required',
      residentKey: 'discouraged',            // 디스커버러블 X → 키체인 동기화 차단
      requireResidentKey: false,
    },
    attestation: 'none',                     // 제조사 인증서 전송 금지
    timeout: 60000,
    extensions: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prf: { eval: { first: prfSalt } } as any,
    },
  };

  // hints: 하이브리드(QR/폰), 크로스-디바이스 차단 (TypeScript 타입에 아직 없음)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (createOptions as any).hints = ['client-device'];

  const credential = await navigator.credentials.create({
    publicKey: createOptions,
  }) as PublicKeyCredential | null;

  if (!credential) throw new Error('생체 인증 등록이 취소되었습니다.');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const extResults = (credential as any).getClientExtensionResults?.();
  const prfResult = extResults?.prf?.results?.first;

  let prfSecret: ArrayBuffer;
  if (prfResult) {
    // 등록 시 바로 PRF 시크릿 획득 (Chrome 등)
    prfSecret = prfResult;
  } else {
    // 일부 인증자는 등록 시 PRF 결과를 안 줌 → 즉시 인증을 한번 더 호출
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: buf(crypto.getRandomValues(new Uint8Array(32))),
        rpId: window.location.hostname,
        allowCredentials: [{ type: 'public-key', id: credential.rawId }],
        userVerification: 'required',
        timeout: 60000,
        extensions: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          prf: { eval: { first: prfSalt } } as any,
        },
      },
    }) as PublicKeyCredential | null;

    if (!assertion) throw new Error('PRF 시크릿 획득 실패.');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ext = (assertion as any).getClientExtensionResults?.();
    if (!ext?.prf?.results?.first) {
      throw new Error('이 인증자는 PRF extension을 지원하지 않습니다. 비밀번호를 사용하세요.');
    }
    prfSecret = ext.prf.results.first;
  }

  // 2. PRF 시크릿으로 AES 키 도출
  const aesKey = await crypto.subtle.importKey(
    'raw', prfSecret, { name: 'AES-GCM' }, false, ['encrypt']
  );

  // 3. 시드 암호화
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrappedSeed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: buf(iv) }, aesKey, buf(seed)
  );

  // 4. IndexedDB 저장
  const binding: BiometricBinding = {
    identityId,
    credentialId: credential.rawId,
    prfSalt,
    wrappedSeed,
    iv,
    createdAt: Date.now(),
  };

  const db = await getDB();
  await db.put(STORE, binding);
}

// === 인증 (시드 복호화) ===

/**
 * 생체 인증으로 시드 복호화
 */
export async function unlockWithBiometric(identityId: string): Promise<Uint8Array> {
  const db = await getDB();
  const binding: BiometricBinding | undefined = await db.get(STORE, identityId);
  if (!binding) throw new Error('생체 인증이 등록되지 않았습니다.');

  // 1. WebAuthn 인증 (PRF eval) — 로컬 기기 authenticator만
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const getOptions: PublicKeyCredentialRequestOptions = {
    challenge: buf(challenge),
    rpId: window.location.hostname,
    allowCredentials: [{
      type: 'public-key',
      id: binding.credentialId,
      transports: ['internal'],   // 내장 authenticator만 (폰 하이브리드 차단)
    }],
    userVerification: 'required',
    timeout: 60000,
    extensions: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prf: { eval: { first: binding.prfSalt } } as any,
    },
  };

  // hints: 하이브리드 차단
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (getOptions as any).hints = ['client-device'];

  const assertion = await navigator.credentials.get({
    publicKey: getOptions,
  }) as PublicKeyCredential | null;

  if (!assertion) throw new Error('생체 인증이 취소되었습니다.');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ext = (assertion as any).getClientExtensionResults?.();
  const prfSecret = ext?.prf?.results?.first;
  if (!prfSecret) throw new Error('PRF 시크릿 획득 실패.');

  // 2. PRF 시크릿으로 AES 키 도출
  const aesKey = await crypto.subtle.importKey(
    'raw', prfSecret, { name: 'AES-GCM' }, false, ['decrypt']
  );

  // 3. 시드 복호화
  const seedBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: buf(binding.iv) }, aesKey, binding.wrappedSeed
  );

  return new Uint8Array(seedBuf);
}

// === 관리 ===

export async function hasBiometric(identityId: string): Promise<boolean> {
  const db = await getDB();
  const b = await db.get(STORE, identityId);
  return !!b;
}

export async function removeBiometric(identityId: string): Promise<void> {
  const db = await getDB();
  await db.delete(STORE, identityId);
}

export async function getAllBiometricBindings(): Promise<BiometricBinding[]> {
  const db = await getDB();
  return db.getAll(STORE);
}
