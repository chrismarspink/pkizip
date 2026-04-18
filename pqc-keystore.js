/**
 * pqc-keystore.js v2 — KEM + DSA 통합 키 저장소
 * PBKDF2-SHA256 (600,000회) + AES-256-GCM
 */

const DB_NAME = 'pkizip-pqc-keys-v2';
const DB_VERSION = 1;
const STORE = 'keys';

function toHex(u8) { return Array.from(u8).map(b => b.toString(16).padStart(2, '0')).join(''); }
function fromHex(h) { const u = new Uint8Array(h.length / 2); for (let i = 0; i < u.length; i++) u[i] = parseInt(h.slice(i*2, i*2+2), 16); return u; }

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
  const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 600_000, hash: 'SHA-256' },
    km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}

export class PQCKeystore {

  static async save(keys, password, keyId = 'default') {
    const { kemShield, dsaSigner } = keys;
    const kemKeys = kemShield.exportKeys();
    const dsaKeys = dsaSigner.exportKeys();

    const secretJson = JSON.stringify({ kemSecretKey: kemKeys.kemSecretKey, dsaSecretKey: dsaKeys.dsaSecretKey });
    const plaintext = new TextEncoder().encode(secretJson);
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const aesKey = await deriveKey(password, salt);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, aesKey, plaintext);

    const record = {
      id: keyId,
      version: 2,
      pbkdf2: { salt: toHex(salt), iterations: 600_000, hash: 'SHA-256' },
      enc: { algorithm: 'AES-256-GCM', iv: toHex(iv), ciphertext: toHex(new Uint8Array(ct)) },
      publicKeys: { kemPublicKey: kemKeys.kemPublicKey, dsaPublicKey: dsaKeys.dsaPublicKey },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await dbPut(record);
    return record;
  }

  static async load(password, keyId = 'default', opts = {}) {
    const { PQCShieldClass, PQCSignerClass } = opts;
    if (!PQCShieldClass || !PQCSignerClass) throw new Error('PQCShieldClass + PQCSignerClass 필요');

    const record = await dbGet(keyId);
    if (!record) throw new Error(`PQC 키 없음: ${keyId}`);

    const salt = fromHex(record.pbkdf2.salt);
    const iv = fromHex(record.enc.iv);
    const ct = fromHex(record.enc.ciphertext);
    const aesKey = await deriveKey(password, salt);

    let plain;
    try {
      plain = new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, tagLength: 128 }, aesKey, ct));
    } catch { throw new Error('PQC 키 비밀번호가 틀렸습니다'); }

    const { kemSecretKey, dsaSecretKey } = JSON.parse(plain);
    const kemShield = await PQCShieldClass.fromKeystore({ kemPublicKey: record.publicKeys.kemPublicKey, kemSecretKey });
    const dsaSigner = await PQCSignerClass.fromKeystore({ dsaPublicKey: record.publicKeys.dsaPublicKey, dsaSecretKey });
    return { kemShield, dsaSigner };
  }

  static async getPublicInfo(keyId = 'default') {
    const r = await dbGet(keyId);
    if (!r) return null;
    return { kemPublicKey: r.publicKeys.kemPublicKey, dsaPublicKey: r.publicKeys.dsaPublicKey, createdAt: r.createdAt, updatedAt: r.updatedAt };
  }

  static async exportJSON(keyId = 'default') {
    const r = await dbGet(keyId);
    if (!r) throw new Error(`키 없음: ${keyId}`);
    return JSON.stringify(r, null, 2);
  }

  static async importJSON(jsonStr) {
    const r = JSON.parse(jsonStr);
    if (!r.id) throw new Error('유효하지 않은 PQC 키 백업');
    r.updatedAt = new Date().toISOString();
    await dbPut(r);
  }
}
