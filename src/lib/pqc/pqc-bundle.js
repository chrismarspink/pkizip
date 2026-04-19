/**
 * pqc-bundle.js — 2벌 PQC 키+인증서 번들 관리
 *
 * 인증서: 표준 X.509 DER/PEM (RFC 9935 ML-KEM, RFC 9881 ML-DSA)
 * 개인키: seed 형식 PKCS#8 (RFC 9935 §6, RFC 9881 §6)
 */

import { PQCDerive, PQC_PATHS } from './pqc-derive.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { printBundleCreateBanner } from './pqc-banner.js';
import { buildMlKemCertificate, buildMlDsaCertificate } from '../crypto/pqc-cert';

const toHex = u8 => Array.from(u8).map(b => b.toString(16).padStart(2, '0')).join('');
const fromHex = h => { const u = new Uint8Array(h.length / 2); for (let i = 0; i < u.length; i++) u[i] = parseInt(h.slice(i*2, i*2+2), 16); return u; };

async function pbkdf2Key(password, salt) {
  const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 600_000, hash: 'SHA-256' }, km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function encryptKey(keyBytes, password, salt, iv) {
  const aes = await pbkdf2Key(password, salt);
  return new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, aes, keyBytes));
}

async function decryptKey(cipher, password, salt, iv) {
  const aes = await pbkdf2Key(password, salt);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, tagLength: 128 }, aes, cipher));
}

export class PQCBundle {
  constructor(data) { this._data = data; }

  static async create(opts) {
    const { mnemonic, password, subject, mode = 'full', validity = 3650 } = opts;
    const keys = await PQCDerive.deriveAll(mnemonic, password);

    // 표준 X.509 인증서 생성 (RFC 9935 / RFC 9881)
    let kemCert, dsaCert;
    try {
      console.log('[PQC-bundle] ML-KEM 인증서 생성 시작 (pubKey:', keys.kem.publicKey.length, 'B, dsaSec:', keys.dsa.secretKey.length, 'B)');
      kemCert = await buildMlKemCertificate({
        kemPublicKey: keys.kem.publicKey,
        dsaSecretKey: keys.dsa.secretKey,
        subject: { commonName: subject.name, email: subject.email },
        validityDays: validity,
      });
      console.log('[PQC-bundle] ML-KEM 인증서 생성 완료:', kemCert?.length, 'chars');
    } catch (kemErr) {
      console.error('[PQC-bundle] ML-KEM 인증서 생성 실패:', kemErr);
    }

    try {
      console.log('[PQC-bundle] ML-DSA 인증서 생성 시작 (pubKey:', keys.dsa.publicKey.length, 'B, dsaSec:', keys.dsa.secretKey.length, 'B)');
      dsaCert = await buildMlDsaCertificate({
        dsaPublicKey: keys.dsa.publicKey,
        dsaSecretKey: keys.dsa.secretKey,
        subject: { commonName: subject.name, email: subject.email },
        validityDays: validity,
      });
      console.log('[PQC-bundle] ML-DSA 인증서 생성 완료:', dsaCert?.length, 'chars');
    } catch (dsaErr) {
      console.error('[PQC-bundle] ML-DSA 인증서 생성 실패:', dsaErr);
    }

    const certs = { kem: kemCert, dsa: dsaCert };

    // 각 개인키 독립 암호화 (PBKDF2 + AES-256-GCM)
    const rnd = n => crypto.getRandomValues(new Uint8Array(n));
    const s_kem = rnd(32), s_dsa = rnd(32);
    const i_kem = rnd(12), i_dsa = rnd(12);
    const c_kem = await encryptKey(keys.kem.secretKey, password, s_kem, i_kem);
    const c_dsa = await encryptKey(keys.dsa.secretKey, password, s_dsa, i_dsa);

    const kemKeyId = toHex(sha256(keys.kem.publicKey));

    const data = {
      magic: 'PKIZIP-BUNDLE', version: 3, mode, created: new Date().toISOString(),
      subject, derivation: { paths: { ...PQC_PATHS } },
      certificates: certs,
      publicKeys: { kem: toHex(keys.kem.publicKey), dsa: toHex(keys.dsa.publicKey) },
      encryptedKeys: {
        algorithm: 'AES-256-GCM', kdf: 'PBKDF2-SHA256', iterations: 600000,
        salt_kem: toHex(s_kem), salt_dsa: toHex(s_dsa),
        iv_kem: toHex(i_kem), iv_dsa: toHex(i_dsa),
        cipher_kem: toHex(c_kem), cipher_dsa: toHex(c_dsa),
      },
      pqcHeader: {
        pqcProtected: true, kemAlgorithm: 'ML-KEM-1024', dsaAlgorithm: 'ML-DSA-87',
        nistStandards: ['FIPS-203', 'FIPS-204'], rfcReferences: ['RFC-9935', 'RFC-9881', 'RFC-9882'],
        kemKeyId,
      },
    };

    printBundleCreateBanner({ mode, paths: PQC_PATHS });

    const bundle = new PQCBundle(data);
    bundle._keys = keys;
    return bundle;
  }

  static async load(bundleJSON, password) {
    const data = typeof bundleJSON === 'string' ? JSON.parse(bundleJSON) : bundleJSON;
    if (data.magic !== 'PKIZIP-BUNDLE') throw new Error('유효하지 않은 번들');

    const ek = data.encryptedKeys;
    const kemSec = await decryptKey(fromHex(ek.cipher_kem), password, fromHex(ek.salt_kem), fromHex(ek.iv_kem));
    const dsaSec = await decryptKey(fromHex(ek.cipher_dsa), password, fromHex(ek.salt_dsa), fromHex(ek.iv_dsa));

    const bundle = new PQCBundle(data);
    bundle._keys = {
      kem: { secretKey: kemSec, publicKey: fromHex(data.publicKeys.kem), path: data.derivation.paths.kem },
      dsa: { secretKey: dsaSec, publicKey: fromHex(data.publicKeys.dsa), path: data.derivation.paths.dsa },
    };
    return bundle;
  }

  static async restore(mnemonic, password, opts = {}) {
    return await PQCBundle.create({ mnemonic, password, ...opts });
  }

  serialize() { return JSON.stringify(this._data, null, 2); }
  getInfo() { return { ...this._data, encryptedKeys: '[ENCRYPTED]' }; }
  getKEMKeyPair() { return this._keys?.kem || null; }
  getDSAKeyPair() { return this._keys?.dsa || null; }
  getPqcKeyId() { return this._data.pqcHeader?.kemKeyId || null; }
  get data() { return this._data; }
}
