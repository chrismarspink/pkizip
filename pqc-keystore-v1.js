/**
 * pqc-keystore.js — PQC 키 저장소
 *
 * PQCShield 키 쌍을 패스워드 보호하여 IndexedDB에 저장/복원.
 * PBKDF2(SHA-256, 600,000회) → AES-256-GCM 개인키 암호화.
 */

const DB_NAME = 'pkizip-pqc-keys';
const DB_VERSION = 1;
const STORE = 'keys';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(record) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(record);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function dbGet(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => { db.close(); resolve(req.result); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

async function deriveKey(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 600_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function concatKeys(keys) {
  // kemSecret(3168) + dsaSecret(4896) = 8064 bytes for ML-KEM-1024 + ML-DSA-87
  const total = keys.kemSecretKey.length + keys.dsaSecretKey.length;
  const buf = new Uint8Array(total);
  buf.set(keys.kemSecretKey, 0);
  buf.set(keys.dsaSecretKey, keys.kemSecretKey.length);
  return buf;
}

function splitKeys(buf, kemSecLen, dsaSecLen) {
  return {
    kemSecretKey: buf.slice(0, kemSecLen),
    dsaSecretKey: buf.slice(kemSecLen, kemSecLen + dsaSecLen),
  };
}

export class PQCKeystore {

  static async save(pqcShield, password, keyId = 'default') {
    const keys = pqcShield.exportKeys();
    const plaintext = concatKeys(keys);

    const salt = crypto.getRandomValues(new Uint8Array(32));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const aesKey = await deriveKey(password, salt);
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, aesKey, plaintext);

    const record = {
      id: keyId,
      version: 1,
      pbkdf2Salt: Array.from(salt),
      pbkdf2Iter: 600_000,
      pbkdf2Hash: 'SHA-256',
      encAlg: 'AES-256-GCM',
      iv: Array.from(iv),
      ciphertext: Array.from(new Uint8Array(ciphertext)),
      kemPublicKey: Array.from(keys.kemPublicKey),
      dsaPublicKey: Array.from(keys.dsaPublicKey),
      kemSecretKeyLen: keys.kemSecretKey.length,
      dsaSecretKeyLen: keys.dsaSecretKey.length,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await dbPut(record);
  }

  static async load(password, keyId = 'default', opts = {}) {
    const { PQCShieldClass } = opts;
    if (!PQCShieldClass) throw new Error('PQCShieldClass 필요');

    const record = await dbGet(keyId);
    if (!record) throw new Error(`PQC 키를 찾을 수 없습니다: ${keyId}`);

    const salt = new Uint8Array(record.pbkdf2Salt);
    const iv = new Uint8Array(record.iv);
    const ct = new Uint8Array(record.ciphertext);
    const aesKey = await deriveKey(password, salt);

    let plaintext;
    try {
      plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, tagLength: 128 }, aesKey, ct));
    } catch {
      throw new Error('PQC 키 비밀번호가 틀렸습니다');
    }

    const { kemSecretKey, dsaSecretKey } = splitKeys(plaintext, record.kemSecretKeyLen, record.dsaSecretKeyLen);

    return new PQCShieldClass(
      { publicKey: new Uint8Array(record.kemPublicKey), secretKey: kemSecretKey },
      { publicKey: new Uint8Array(record.dsaPublicKey), secretKey: dsaSecretKey }
    );
  }

  static async getPublicInfo(keyId = 'default') {
    const record = await dbGet(keyId);
    if (!record) return null;
    return {
      id: record.id,
      kemPublicKey: new Uint8Array(record.kemPublicKey),
      dsaPublicKey: new Uint8Array(record.dsaPublicKey),
      createdAt: record.createdAt,
    };
  }

  static async exportJSON(keyId = 'default') {
    const record = await dbGet(keyId);
    if (!record) throw new Error(`키 없음: ${keyId}`);
    return JSON.stringify(record, null, 2);
  }

  static async importJSON(jsonStr) {
    const record = JSON.parse(jsonStr);
    if (!record.id) throw new Error('유효하지 않은 PQC 키 백업');
    record.updatedAt = new Date().toISOString();
    await dbPut(record);
  }
}
