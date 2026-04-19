/**
 * Key Manager - 다중 아이덴티티 지원 키 저장/조회/관리
 *
 * IndexedDB에 암호화된 형태로 키를 저장하고,
 * 주소록(공개키)과 인증서를 관리한다.
 */
import { openDB, type IDBPDatabase } from 'idb';
import { sha256 } from '@noble/hashes/sha2.js';

const buf = (data: Uint8Array): BufferSource => data as unknown as BufferSource;

const DB_NAME = 'pkizip-keys';
const DB_VERSION = 3;
const STORE_KEYRING = 'keyring';
const STORE_IDENTITY = 'identity';
const STORE_SETTINGS = 'settings';
const STORE_CERTIFICATES = 'certificates';

export interface PublicKeyEntry {
  fingerprint: string;
  label: string;
  signingKeyJWK: JsonWebKey;
  encryptionKeyJWK: JsonWebKey;
  createdAt: number;
  type: 'local' | 'imported';
}

export interface EncryptedIdentity {
  id: string;                    // UUID (기존 'primary' → 마이그레이션)
  name: string;                  // 사용자 지정 이름 (예: "개인 키", "회사 키")
  encryptedSeed: ArrayBuffer;
  iv: Uint8Array;
  salt: Uint8Array;
  masterFingerprint: string;
  signingFingerprint: string;
  encryptionFingerprint: string;
  commonName: string;
  email: string;
  createdAt: number;
}

export interface StoredCertificate {
  fingerprint: string;
  commonName: string;
  email: string;
  serialNumber: string;
  notBefore: number;
  notAfter: number;
  pemCertificate: string;
  createdAt: number;
  logotype?: string;  // data URL (PNG) — 카드 로고
  /** PQC 인증서 (공개 정보, 키 생성 시 항상 함께 생성) */
  pqcCertificates?: {
    kem?: string;   // ML-KEM-1024 PEM
    dsa?: string;   // ML-DSA-87 PEM
  };
  pqcKeyId?: string;
}

async function getDB(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion, _newVersion, tx) {
      // 스토어 생성
      if (!db.objectStoreNames.contains(STORE_KEYRING)) {
        db.createObjectStore(STORE_KEYRING, { keyPath: 'fingerprint' });
      }
      if (!db.objectStoreNames.contains(STORE_IDENTITY)) {
        db.createObjectStore(STORE_IDENTITY, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
        db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_CERTIFICATES)) {
        db.createObjectStore(STORE_CERTIFICATES, { keyPath: 'fingerprint' });
      }

      // v2→v3 마이그레이션: 기존 'primary' 아이덴티티에 name 필드 추가
      if (oldVersion < 3) {
        const identityStore = tx.objectStore(STORE_IDENTITY);
        identityStore.getAll().then(async (identities) => {
          for (const identity of identities) {
            if (identity.id === 'primary') {
              const newId = crypto.randomUUID();
              identity.name = identity.name || '기본 키';
              // 새 ID로 저장하고 기존 삭제
              const updated = { ...identity, id: newId };
              await identityStore.put(updated);
              await identityStore.delete('primary');
              // 활성 아이덴티티 설정
              const settingsStore = tx.objectStore(STORE_SETTINGS);
              await settingsStore.put({ key: 'activeIdentityId', value: newId });
            } else if (!identity.name) {
              identity.name = '키 ' + identity.id.slice(0, 4);
              await identityStore.put(identity);
            }
          }
        });
      }
    },
  });
}

// === 래핑 키 파생 ===

async function deriveWrappingKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: buf(salt), iterations: 600000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// === 아이덴티티 CRUD (다중 지원) ===

/**
 * 새 아이덴티티 저장 (다중 지원)
 * @returns 생성된 아이덴티티 ID
 */
export async function saveIdentity(
  seed: Uint8Array,
  password: string,
  name: string,
  fingerprints: { master: string; signing: string; encryption: string },
  profile: { commonName: string; email: string }
): Promise<string> {
  const id = crypto.randomUUID();
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrappingKey = await deriveWrappingKey(password, salt);

  const encryptedSeed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: buf(iv) },
    wrappingKey,
    buf(seed)
  );

  const identity: EncryptedIdentity = {
    id,
    name,
    encryptedSeed,
    iv,
    salt,
    masterFingerprint: fingerprints.master,
    signingFingerprint: fingerprints.signing,
    encryptionFingerprint: fingerprints.encryption,
    commonName: profile.commonName,
    email: profile.email,
    createdAt: Date.now(),
  };

  const db = await getDB();
  await db.put(STORE_IDENTITY, identity);
  return id;
}

/**
 * 비밀번호로 시드 복호화
 */
export async function loadIdentitySeed(id: string, password: string): Promise<Uint8Array> {
  const db = await getDB();
  const identity: EncryptedIdentity | undefined = await db.get(STORE_IDENTITY, id);

  if (!identity) {
    throw new Error('해당 아이덴티티가 없습니다.');
  }

  const wrappingKey = await deriveWrappingKey(password, identity.salt);

  try {
    const decryptedSeed = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: buf(identity.iv) },
      wrappingKey,
      identity.encryptedSeed
    );
    return new Uint8Array(decryptedSeed);
  } catch {
    throw new Error('비밀번호가 올바르지 않습니다.');
  }
}

/**
 * 모든 아이덴티티 메타데이터 조회
 */
export async function getAllIdentityMetas(): Promise<EncryptedIdentity[]> {
  const db = await getDB();
  return db.getAll(STORE_IDENTITY);
}

/**
 * 단일 아이덴티티 메타데이터 조회
 */
export async function getIdentityMeta(id: string): Promise<EncryptedIdentity | null> {
  const db = await getDB();
  const identity: EncryptedIdentity | undefined = await db.get(STORE_IDENTITY, id);
  return identity ?? null;
}

/**
 * 아이덴티티 삭제
 */
export async function deleteIdentity(id: string): Promise<void> {
  const db = await getDB();
  const identity = await db.get(STORE_IDENTITY, id);
  if (identity) {
    await db.delete(STORE_IDENTITY, id);
    // 연관 인증서 삭제
    const fp = (identity as EncryptedIdentity).signingFingerprint;
    if (fp) {
      await db.delete(STORE_CERTIFICATES, fp).catch(() => {});
    }
    // 키 링에서 local 항목 삭제
    const entries: PublicKeyEntry[] = await db.getAll(STORE_KEYRING);
    for (const e of entries) {
      if (e.type === 'local' && e.fingerprint === fp) {
        await db.delete(STORE_KEYRING, e.fingerprint);
      }
    }
    // 활성 아이덴티티였으면 해제
    const activeId = await getActiveIdentityId();
    if (activeId === id) {
      await setActiveIdentityId(null);
    }
  }
}

/**
 * 활성 아이덴티티 ID 조회
 */
export async function getActiveIdentityId(): Promise<string | null> {
  const db = await getDB();
  const setting = await db.get(STORE_SETTINGS, 'activeIdentityId');
  return setting?.value ?? null;
}

/**
 * 활성 아이덴티티 ID 설정
 */
export async function setActiveIdentityId(id: string | null): Promise<void> {
  const db = await getDB();
  await db.put(STORE_SETTINGS, { key: 'activeIdentityId', value: id });
}

/**
 * 저장된 아이덴티티 존재 여부
 */
export async function hasStoredIdentity(): Promise<boolean> {
  const db = await getDB();
  const all = await db.getAll(STORE_IDENTITY);
  return all.length > 0;
}

// === 주소록 (공개키) 관리 ===

export async function addToKeyRing(entry: PublicKeyEntry): Promise<void> {
  const db = await getDB();
  await db.put(STORE_KEYRING, entry);
}

export async function getFromKeyRing(fingerprint: string): Promise<PublicKeyEntry | null> {
  const db = await getDB();
  const entry: PublicKeyEntry | undefined = await db.get(STORE_KEYRING, fingerprint);
  return entry ?? null;
}

export async function getAllKeyRingEntries(): Promise<PublicKeyEntry[]> {
  const db = await getDB();
  return db.getAll(STORE_KEYRING);
}

export async function removeFromKeyRing(fingerprint: string): Promise<void> {
  const db = await getDB();
  await db.delete(STORE_KEYRING, fingerprint);
}

export function computeJWKFingerprint(jwk: JsonWebKey): string {
  const canonical = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y });
  const hash = sha256(new TextEncoder().encode(canonical));
  return Array.from(hash.slice(0, 4)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// === 인증서 관리 ===

export async function saveCertificate(cert: StoredCertificate): Promise<void> {
  const db = await getDB();
  await db.put(STORE_CERTIFICATES, cert);
}

export async function getCertificate(fingerprint: string): Promise<StoredCertificate | null> {
  const db = await getDB();
  const cert: StoredCertificate | undefined = await db.get(STORE_CERTIFICATES, fingerprint);
  return cert ?? null;
}

export async function getAllCertificates(): Promise<StoredCertificate[]> {
  const db = await getDB();
  return db.getAll(STORE_CERTIFICATES);
}

export async function deleteCertificate(fingerprint: string): Promise<void> {
  const db = await getDB();
  await db.delete(STORE_CERTIFICATES, fingerprint);
}
