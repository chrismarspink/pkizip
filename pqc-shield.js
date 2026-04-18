/**
 * pqc-shield.js v2 — ML-KEM-1024 핵심 엔진
 *
 * CEK 캡슐화/역캡슐화 + EncryptedData 직접 암호화 전용.
 * ML-DSA 서명은 pqc-signer.js에서 별도 처리.
 */

import { ml_kem1024 } from '@noble/post-quantum/ml-kem.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha3_512 } from '@noble/hashes/sha3.js';
import { buildPqcHeader } from './pqc-banner.js';

const INFO = new TextEncoder().encode('pqczip-kem-v2');

function getRandomBytes(n) { return crypto.getRandomValues(new Uint8Array(n)); }

function deriveWrapKey(sharedSecret, salt) {
  return hkdf(sha3_512, sharedSecret, salt, INFO, 32);
}

async function aesGcmEnc(key, data, iv) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'AES-GCM' }, false, ['encrypt']);
  return new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, k, data));
}

async function aesGcmDec(key, ct, iv) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'AES-GCM' }, false, ['decrypt']);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, tagLength: 128 }, k, ct));
}

function toHex(u8) { return Array.from(u8).map(b => b.toString(16).padStart(2, '0')).join(''); }
function fromHex(h) { const u = new Uint8Array(h.length / 2); for (let i = 0; i < u.length; i++) u[i] = parseInt(h.slice(i*2, i*2+2), 16); return u; }

export class PQCShield {
  constructor(kemPublicKey, kemSecretKey) {
    this._pub = kemPublicKey;
    this._sec = kemSecretKey;
  }

  static async init() {
    const { publicKey, secretKey } = ml_kem1024.keygen();
    return new PQCShield(publicKey, secretKey);
  }

  static async fromKeystore(ks) {
    return new PQCShield(fromHex(ks.kemPublicKey), fromHex(ks.kemSecretKey));
  }

  // ── EnvelopedData CEK 캡슐화 ──

  async encapsulateCEK(cek) {
    const { cipherText, sharedSecret } = ml_kem1024.encapsulate(this._pub);
    const salt = getRandomBytes(32);
    const wrapKey = deriveWrapKey(sharedSecret, salt);
    const iv = getRandomBytes(12);
    const encryptedKey = await aesGcmEnc(wrapKey, cek, iv);

    return {
      type: 'ML-KEM-1024',
      nistStandard: 'FIPS-203',
      kemCiphertext: new Uint8Array(cipherText),
      encryptedKey,
      iv,
      salt,
      kemPublicKey: new Uint8Array(this._pub),
    };
  }

  async decapsulateCEK(ri) {
    const sharedSecret = ml_kem1024.decapsulate(ri.kemCiphertext, this._sec);
    const wrapKey = deriveWrapKey(sharedSecret, ri.salt);
    return await aesGcmDec(wrapKey, ri.encryptedKey, ri.iv);
  }

  // ── EncryptedData 직접 암호화 ──

  async encryptPayload(data) {
    const d = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data);
    const cek = getRandomBytes(32);

    const kemInfo = await this.encapsulateCEK(cek);
    const iv = getRandomBytes(12);
    const ciphertext = await aesGcmEnc(cek, d, iv);

    return {
      pqcHeader: buildPqcHeader({ mode: 'hybrid', kemAlg: 'ML-KEM-1024' }),
      kemInfo,
      iv,
      ciphertext,
    };
  }

  async decryptPayload(payload) {
    const cek = await this.decapsulateCEK(payload.kemInfo);
    return await aesGcmDec(cek, payload.ciphertext, payload.iv);
  }

  // ── 키 관리 ──

  exportKeys() {
    return { version: 2, kemPublicKey: toHex(this._pub), kemSecretKey: toHex(this._sec), exportedAt: new Date().toISOString() };
  }

  exportPublicKeys() {
    return { version: 2, kemPublicKey: toHex(this._pub), exportedAt: new Date().toISOString() };
  }
}
