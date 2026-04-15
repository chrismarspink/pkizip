/**
 * PIN-based Quick Unlock
 *
 * 4~6자리 PIN으로 시드를 빠르게 풀기 위한 모듈.
 * 비밀번호 PBKDF2(600k)와 동일하게 안전하지만, 입력이 빨라 UX 우수.
 *
 * 보안:
 *   - PBKDF2-SHA256 600,000 반복으로 brute-force 방어
 *   - PIN 별도 salt
 *   - AES-256-GCM으로 시드 래핑
 *   - 모두 IndexedDB 로컬 저장 (외부 동기화 없음)
 *
 * 본 PIN은 비밀번호와 독립적인 두 번째 잠금 해제 경로:
 *   - 사용자가 비밀번호로 한번 인증 → 시드 풀기 → PIN으로 시드 다시 래핑하여 저장
 *   - 이후 PIN으로만 잠금 해제 가능
 *   - PIN 분실 시 비밀번호 또는 니모닉으로 복구 가능
 */
import { openDB, type IDBPDatabase } from 'idb';

const buf = (data: Uint8Array): BufferSource => data as unknown as BufferSource;

const DB_NAME = 'pkizip-pin';
const DB_VERSION = 1;
const STORE = 'bindings';

export interface PinBinding {
  identityId: string;          // PK
  salt: Uint8Array;            // PBKDF2 salt
  iv: Uint8Array;              // AES-GCM IV
  wrappedSeed: ArrayBuffer;    // PIN으로 암호화된 시드
  attempts: number;            // 실패 시도 횟수
  lockedUntil: number;         // 잠금 해제 가능 시각 (ms)
  createdAt: number;
}

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60 * 1000; // 5분

async function getDB(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'identityId' });
      }
    },
  });
}

async function deriveKey(pin: string, salt: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: buf(salt), iterations: 600000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * PIN 등록 (시드를 PIN으로 래핑하여 저장)
 */
export async function registerPin(identityId: string, seed: Uint8Array, pin: string): Promise<void> {
  if (!/^\d{4,6}$/.test(pin)) throw new Error('PIN은 4~6자리 숫자여야 합니다.');

  const salt = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pin, salt);
  const wrappedSeed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: buf(iv) }, key, buf(seed)
  );

  const binding: PinBinding = {
    identityId, salt, iv, wrappedSeed,
    attempts: 0, lockedUntil: 0,
    createdAt: Date.now(),
  };

  const db = await getDB();
  await db.put(STORE, binding);
}

/**
 * PIN 으로 시드 복호화
 */
export async function unlockWithPin(identityId: string, pin: string): Promise<Uint8Array> {
  const db = await getDB();
  const binding: PinBinding | undefined = await db.get(STORE, identityId);
  if (!binding) throw new Error('PIN이 등록되지 않았습니다.');

  // 잠금 상태 확인
  if (binding.lockedUntil > Date.now()) {
    const remainSec = Math.ceil((binding.lockedUntil - Date.now()) / 1000);
    throw new Error(`PIN이 잠겼습니다. ${remainSec}초 후 다시 시도하세요.`);
  }

  try {
    const key = await deriveKey(pin, binding.salt);
    const seedBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: buf(binding.iv) }, key, binding.wrappedSeed
    );

    // 성공 → 시도 횟수 리셋
    if (binding.attempts > 0) {
      await db.put(STORE, { ...binding, attempts: 0, lockedUntil: 0 });
    }
    return new Uint8Array(seedBuf);
  } catch {
    // 실패 → 시도 횟수 증가
    const next = { ...binding, attempts: binding.attempts + 1 };
    if (next.attempts >= MAX_ATTEMPTS) {
      next.lockedUntil = Date.now() + LOCKOUT_MS;
      next.attempts = 0;
      await db.put(STORE, next);
      throw new Error(`PIN ${MAX_ATTEMPTS}회 실패. 5분간 잠금됩니다.`);
    }
    await db.put(STORE, next);
    throw new Error(`PIN이 틀렸습니다. (${MAX_ATTEMPTS - next.attempts}회 남음)`);
  }
}

export async function hasPin(identityId: string): Promise<boolean> {
  const db = await getDB();
  return !!(await db.get(STORE, identityId));
}

export async function removePin(identityId: string): Promise<void> {
  const db = await getDB();
  await db.delete(STORE, identityId);
}

/**
 * PIN 잠금 상태 확인 (UI에서 잠금 시간 표시용)
 */
export async function getPinStatus(identityId: string): Promise<{ exists: boolean; lockedUntil: number; attempts: number } | null> {
  const db = await getDB();
  const b: PinBinding | undefined = await db.get(STORE, identityId);
  if (!b) return null;
  return { exists: true, lockedUntil: b.lockedUntil, attempts: b.attempts };
}
