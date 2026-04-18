/**
 * pqc-keystore.js v3 — 번들 IndexedDB 저장소
 */

const DB_NAME = 'pkizip-pqc-v3';
const DB_VERSION = 1;
const STORE = 'bundles';

const toHex = u8 => Array.from(u8).map(b => b.toString(16).padStart(2, '0')).join('');
const fromHex = h => { const u = new Uint8Array(h.length / 2); for (let i = 0; i < u.length; i++) u[i] = parseInt(h.slice(i*2, i*2+2), 16); return u; };

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(r) { const db = await openDB(); return new Promise((res, rej) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(r); tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => { db.close(); rej(tx.error); }; }); }
async function dbGet(id) { const db = await openDB(); return new Promise((res, rej) => { const tx = db.transaction(STORE, 'readonly'); const r = tx.objectStore(STORE).get(id); r.onsuccess = () => { db.close(); res(r.result); }; r.onerror = () => { db.close(); rej(r.error); }; }); }

async function pbkdf2Enc(password, plaintext) {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const k = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 600_000, hash: 'SHA-256' }, km, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, k, new TextEncoder().encode(plaintext));
  return { salt: toHex(salt), iv: toHex(iv), ciphertext: toHex(new Uint8Array(ct)) };
}

async function pbkdf2Dec(password, enc) {
  const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const k = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: fromHex(enc.salt), iterations: 600_000, hash: 'SHA-256' }, km, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromHex(enc.iv), tagLength: 128 }, k, fromHex(enc.ciphertext));
  return new TextDecoder().decode(pt);
}

export class PQCKeystore {
  static async save(bundle, password, bundleId = 'default') {
    const enc = await pbkdf2Enc(password, bundle.serialize());
    const record = {
      id: bundleId, version: 3,
      pbkdf2: { salt: enc.salt, iterations: 600_000, hash: 'SHA-256' },
      enc: { algorithm: 'AES-256-GCM', iv: enc.iv, ciphertext: enc.ciphertext },
      metaPlain: {
        mode: bundle.data.mode, subject: bundle.data.subject,
        created: bundle.data.created, kemKeyId: bundle.getPqcKeyId(),
        certificates: bundle.data.certificates || {},  // 인증서는 공개 정보 → 평문
      },
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    await dbPut(record);
  }

  static async load(password, bundleId = 'default', opts = {}) {
    const { PQCBundleClass } = opts;
    if (!PQCBundleClass) throw new Error('PQCBundleClass 필요');
    const r = await dbGet(bundleId);
    if (!r) throw new Error(`번들 없음: ${bundleId}`);
    const json = await pbkdf2Dec(password, { salt: r.pbkdf2.salt, iv: r.enc.iv, ciphertext: r.enc.ciphertext });
    return await PQCBundleClass.load(json, password);
  }

  static async getInfo(bundleId = 'default') {
    try {
      const r = await dbGet(bundleId);
      return r?.metaPlain ?? null;
    } catch {
      return null;  // DB 미존재 또는 스토어 없음
    }
  }

  static async exportJSON(bundleId = 'default') {
    const r = await dbGet(bundleId);
    if (!r) throw new Error(`번들 없음: ${bundleId}`);
    return JSON.stringify(r, null, 2);
  }

  static async importJSON(jsonStr, password) {
    const r = JSON.parse(jsonStr);
    r.updatedAt = new Date().toISOString();
    await dbPut(r);
  }

  static async changePassword(oldPw, newPw, bundleId = 'default', opts = {}) {
    const { PQCBundleClass } = opts;
    const bundle = await PQCKeystore.load(oldPw, bundleId, { PQCBundleClass });
    await PQCKeystore.save(bundle, newPw, bundleId);
  }
}
