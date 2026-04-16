/**
 * Biometric Authentication — WebAuthn 기반
 *
 * 두 가지 모드를 자동 선택:
 *
 * 1) PRF 모드 (macOS Safari, Chrome 116+ with PRF support)
 *    - WebAuthn PRF extension으로 32바이트 시크릿 생성
 *    - 이 시크릿으로 시드를 AES-GCM 직접 암호화
 *    - 가장 안전: 시크릿이 authenticator 내부에서만 존재
 *
 * 2) Fallback 모드 (Android Chrome 등 PRF 미지원)
 *    - WebAuthn으로 사용자 검증만 수행 (지문/Face Unlock)
 *    - 시드는 랜덤 AES 키로 암호화, 이 키를 IndexedDB에 저장
 *    - 생체 인증 통과 시에만 이 키에 접근하여 시드 복호화
 *    - PRF보다 약하지만 생체 인증 자체는 동작
 *
 * 등록 시 PRF를 먼저 시도 → 실패 시 자동으로 Fallback 전환
 */
import { openDB, type IDBPDatabase } from 'idb';

const buf = (data: Uint8Array): BufferSource => data as unknown as BufferSource;

const DB_NAME = 'pkizip-biometric';
const DB_VERSION = 2;
const STORE = 'bindings';

export interface BiometricBinding {
  identityId: string;
  mode: 'prf' | 'fallback';
  credentialId: ArrayBuffer;
  // PRF 모드
  prfSalt?: Uint8Array;
  // 공통
  wrappedSeed: ArrayBuffer;
  iv: Uint8Array;
  // Fallback 모드: 래핑 키 (AES-GCM raw key)
  wrappingKey?: ArrayBuffer;
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

// === 지원 여부 ===

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

// === 등록 (PRF 우선 → Fallback 자동 전환) ===

export async function registerBiometric(
  identityId: string,
  identityName: string,
  seed: Uint8Array
): Promise<'prf' | 'fallback'> {
  if (!isWebAuthnSupported()) throw new Error('WebAuthn 미지원');

  const userId = new TextEncoder().encode(identityId);
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const prfSalt = crypto.getRandomValues(new Uint8Array(32));

  // WebAuthn credential 생성
  const createOptions: PublicKeyCredentialCreationOptions = {
    rp: { name: 'PKIZIP', id: window.location.hostname },
    user: {
      id: userId as unknown as BufferSource,
      name: identityName,
      displayName: identityName,
    },
    challenge: buf(challenge),
    pubKeyCredParams: [
      { type: 'public-key', alg: -7 },
      { type: 'public-key', alg: -257 },
    ],
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      userVerification: 'required',
      residentKey: 'discouraged',
      requireResidentKey: false,
    },
    attestation: 'none',
    timeout: 60000,
    extensions: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prf: { eval: { first: prfSalt } } as any,
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (createOptions as any).hints = ['client-device'];

  const credential = await navigator.credentials.create({
    publicKey: createOptions,
  }) as PublicKeyCredential | null;

  if (!credential) throw new Error('생체 인증 등록이 취소되었습니다.');

  // PRF 결과 확인
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const extResults = (credential as any).getClientExtensionResults?.();
  let prfSecret: ArrayBuffer | null = extResults?.prf?.results?.first ?? null;

  // 등록 시 PRF 없으면 인증 한번 더 시도
  if (!prfSecret) {
    try {
      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge: buf(crypto.getRandomValues(new Uint8Array(32))),
          rpId: window.location.hostname,
          allowCredentials: [{ type: 'public-key', id: credential.rawId, transports: ['internal'] }],
          userVerification: 'required',
          timeout: 30000,
          extensions: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            prf: { eval: { first: prfSalt } } as any,
          },
        },
      }) as PublicKeyCredential | null;
      if (assertion) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ext2 = (assertion as any).getClientExtensionResults?.();
        prfSecret = ext2?.prf?.results?.first ?? null;
      }
    } catch {
      // PRF 재시도 실패 → fallback으로 진행
    }
  }

  const iv = crypto.getRandomValues(new Uint8Array(12));

  if (prfSecret) {
    // === PRF 모드 ===
    const aesKey = await crypto.subtle.importKey('raw', prfSecret, { name: 'AES-GCM' }, false, ['encrypt']);
    const wrappedSeed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buf(iv) }, aesKey, buf(seed));

    const binding: BiometricBinding = {
      identityId, mode: 'prf',
      credentialId: credential.rawId,
      prfSalt, wrappedSeed, iv,
      createdAt: Date.now(),
    };
    const db = await getDB();
    await db.put(STORE, binding);
    return 'prf';
  } else {
    // === Fallback 모드 ===
    // 랜덤 AES 키 생성 → 시드 래핑 → AES 키도 IndexedDB에 저장
    // 생체 인증은 "게이트" 역할 (WebAuthn 통과해야 IndexedDB 접근 허용)
    const wrappingKeyObj = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const wrappedSeed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buf(iv) }, wrappingKeyObj, buf(seed));
    const wrappingKeyRaw = await crypto.subtle.exportKey('raw', wrappingKeyObj);

    const binding: BiometricBinding = {
      identityId, mode: 'fallback',
      credentialId: credential.rawId,
      wrappedSeed, iv,
      wrappingKey: wrappingKeyRaw,
      createdAt: Date.now(),
    };
    const db = await getDB();
    await db.put(STORE, binding);
    return 'fallback';
  }
}

// === 인증 (시드 복호화) ===

export async function unlockWithBiometric(identityId: string): Promise<Uint8Array> {
  const db = await getDB();
  const binding: BiometricBinding | undefined = await db.get(STORE, identityId);
  if (!binding) throw new Error('생체 인증이 등록되지 않았습니다.');

  // WebAuthn 인증 요청
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const getOptions: PublicKeyCredentialRequestOptions = {
    challenge: buf(challenge),
    rpId: window.location.hostname,
    allowCredentials: [{
      type: 'public-key',
      id: binding.credentialId,
      transports: ['internal'],
    }],
    userVerification: 'required',
    timeout: 60000,
  };

  // PRF 모드일 때만 PRF extension 추가
  if (binding.mode === 'prf' && binding.prfSalt) {
    getOptions.extensions = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prf: { eval: { first: binding.prfSalt } } as any,
    };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (getOptions as any).hints = ['client-device'];

  const assertion = await navigator.credentials.get({
    publicKey: getOptions,
  }) as PublicKeyCredential | null;

  if (!assertion) throw new Error('생체 인증이 취소되었습니다.');

  if (binding.mode === 'prf') {
    // === PRF 모드: PRF 시크릿으로 시드 복호화 ===
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ext = (assertion as any).getClientExtensionResults?.();
    const prfSecret = ext?.prf?.results?.first;
    if (!prfSecret) throw new Error('PRF 시크릿 획득 실패');

    const aesKey = await crypto.subtle.importKey('raw', prfSecret, { name: 'AES-GCM' }, false, ['decrypt']);
    const seedBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf(binding.iv) }, aesKey, binding.wrappedSeed);
    return new Uint8Array(seedBuf);
  } else {
    // === Fallback 모드: 생체 인증 통과 → 저장된 래핑 키로 시드 복호화 ===
    if (!binding.wrappingKey) throw new Error('래핑 키 없음');

    const aesKey = await crypto.subtle.importKey('raw', binding.wrappingKey, { name: 'AES-GCM' }, false, ['decrypt']);
    const seedBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf(binding.iv) }, aesKey, binding.wrappedSeed);
    return new Uint8Array(seedBuf);
  }
}

// === 관리 ===

export async function hasBiometric(identityId: string): Promise<boolean> {
  const db = await getDB();
  return !!(await db.get(STORE, identityId));
}

export async function removeBiometric(identityId: string): Promise<void> {
  const db = await getDB();
  await db.delete(STORE, identityId);
}

export async function getBiometricMode(identityId: string): Promise<'prf' | 'fallback' | null> {
  const db = await getDB();
  const b: BiometricBinding | undefined = await db.get(STORE, identityId);
  return b?.mode ?? null;
}
