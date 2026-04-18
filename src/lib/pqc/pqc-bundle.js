/**
 * pqc-bundle.js — 3벌 키+인증서 번들 관리 (.pkizip)
 */

import { PQCDerive, PQC_PATHS } from './pqc-derive.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { printBundleCreateBanner } from './pqc-banner.js';

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

// 간이 자체서명 인증서 (PEM mock — 실제 X.509는 pkijs로 대체 가능)
function buildCertPEM(alg, oid, publicKey, keyUsage, subject) {
  return `-----PKIZIP-CERT-${alg}-----\nAlgorithm: ${alg}\nOID: ${oid}\nSubject: ${subject.name} <${subject.email}>\nKeyUsage: ${keyUsage.join(', ')}\nPublicKey: ${toHex(publicKey).slice(0, 64)}...(${publicKey.length}B)\n-----END PKIZIP-CERT-----`;
}

export class PQCBundle {
  constructor(data) { this._data = data; }

  static async create(opts) {
    const { mnemonic, password, subject, mode = 'full', validity = 1095 } = opts;
    const keys = await PQCDerive.deriveAll(mnemonic, password);

    // 인증서 생성
    const certs = {
      ecc: buildCertPEM('secp256k1', '1.3.132.0.10', keys.ecc.publicKey, ['digitalSignature'], subject),
      kem: buildCertPEM('ML-KEM-1024', '2.16.840.1.101.3.4.4.3', keys.kem.publicKey, ['keyEncipherment'], subject),
      dsa: buildCertPEM('ML-DSA-87', '2.16.840.1.101.3.4.3.19', keys.dsa.publicKey, ['digitalSignature', 'nonRepudiation'], subject),
    };

    // 각 개인키 독립 암호화
    const rnd = n => crypto.getRandomValues(new Uint8Array(n));
    const s_ecc = rnd(32), s_kem = rnd(32), s_dsa = rnd(32);
    const i_ecc = rnd(12), i_kem = rnd(12), i_dsa = rnd(12);
    const c_ecc = await encryptKey(keys.ecc.privateKey, password, s_ecc, i_ecc);
    const c_kem = await encryptKey(keys.kem.secretKey, password, s_kem, i_kem);
    const c_dsa = await encryptKey(keys.dsa.secretKey, password, s_dsa, i_dsa);

    const kemKeyId = toHex(sha256(keys.kem.publicKey));

    const data = {
      magic: 'PKIZIP-BUNDLE', version: 3, mode, created: new Date().toISOString(),
      subject, derivation: { paths: { ...PQC_PATHS } },
      certificates: certs,
      publicKeys: { ecc: toHex(keys.ecc.publicKey), kem: toHex(keys.kem.publicKey), dsa: toHex(keys.dsa.publicKey) },
      encryptedKeys: {
        algorithm: 'AES-256-GCM', kdf: 'PBKDF2-SHA256', iterations: 600000,
        salt_ecc: toHex(s_ecc), salt_kem: toHex(s_kem), salt_dsa: toHex(s_dsa),
        iv_ecc: toHex(i_ecc), iv_kem: toHex(i_kem), iv_dsa: toHex(i_dsa),
        cipher_ecc: toHex(c_ecc), cipher_kem: toHex(c_kem), cipher_dsa: toHex(c_dsa),
      },
      pqcHeader: {
        pqcProtected: true, kemAlgorithm: 'ML-KEM-1024', dsaAlgorithm: 'ML-DSA-87',
        nistStandards: ['FIPS-203', 'FIPS-204'], rfcReferences: ['RFC-9935', 'RFC-9881', 'RFC-9882'],
        kemKeyId,
      },
    };

    printBundleCreateBanner({ mode, paths: PQC_PATHS });

    const bundle = new PQCBundle(data);
    bundle._keys = keys; // 메모리에 보관 (serialize 시 제외)
    return bundle;
  }

  static async load(bundleJSON, password) {
    const data = typeof bundleJSON === 'string' ? JSON.parse(bundleJSON) : bundleJSON;
    if (data.magic !== 'PKIZIP-BUNDLE') throw new Error('유효하지 않은 번들');

    const ek = data.encryptedKeys;
    const eccPriv = await decryptKey(fromHex(ek.cipher_ecc), password, fromHex(ek.salt_ecc), fromHex(ek.iv_ecc));
    const kemSec = await decryptKey(fromHex(ek.cipher_kem), password, fromHex(ek.salt_kem), fromHex(ek.iv_kem));
    const dsaSec = await decryptKey(fromHex(ek.cipher_dsa), password, fromHex(ek.salt_dsa), fromHex(ek.iv_dsa));

    const bundle = new PQCBundle(data);
    bundle._keys = {
      ecc: { privateKey: eccPriv, publicKey: fromHex(data.publicKeys.ecc), path: data.derivation.paths.ecc },
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
  getECCKeyPair() { return this._keys?.ecc || null; }
  getKEMKeyPair() { return this._keys?.kem || null; }
  getDSAKeyPair() { return this._keys?.dsa || null; }
  getPqcKeyId() { return this._data.pqcHeader?.kemKeyId || null; }
  get data() { return this._data; }
}
