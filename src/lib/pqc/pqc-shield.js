/**
 * pqc-shield.js v3 — ML-KEM-1024 CEK 캡슐화 엔진
 */

import { ml_kem1024 } from '@noble/post-quantum/ml-kem.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha3_512 } from '@noble/hashes/sha3.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { buildPqcHeader } from './pqc-banner.js';

const INFO = new TextEncoder().encode('pqczip-kem-v3');
const toHex = u8 => Array.from(u8).map(b => b.toString(16).padStart(2, '0')).join('');
const rnd = n => crypto.getRandomValues(new Uint8Array(n));

function deriveWrap(ss, salt) { return hkdf(sha3_512, ss, salt, INFO, 32); }

async function aesEnc(key, data, iv) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'AES-GCM' }, false, ['encrypt']);
  return new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, k, data));
}
async function aesDec(key, ct, iv) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'AES-GCM' }, false, ['decrypt']);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, tagLength: 128 }, k, ct));
}

export class PQCShield {
  constructor(pub, sec) { this._pub = pub; this._sec = sec; this._keyId = toHex(sha256(pub)); }

  static fromBundle(kemKeyPair) { return new PQCShield(kemKeyPair.publicKey, kemKeyPair.secretKey); }

  get pqcKeyId() { return this._keyId; }

  async encapsulateCEK(cek, linkedCertSerial = null) {
    const { cipherText, sharedSecret } = ml_kem1024.encapsulate(this._pub);
    const salt = rnd(32), iv = rnd(12);
    const wk = deriveWrap(sharedSecret, salt);
    const encryptedKey = await aesEnc(wk, cek, iv);

    return {
      type: 'ML-KEM-1024', nistStandard: 'FIPS-203', rfcReference: 'RFC-9935',
      rid: { pqcKeyId: this._keyId, linkedCertSerial },
      kemCiphertext: new Uint8Array(cipherText),
      encryptedKey, iv, salt,
      kemPublicKey: new Uint8Array(this._pub),
    };
  }

  async decapsulateCEK(ri) {
    const ss = ml_kem1024.decapsulate(ri.kemCiphertext, this._sec);
    const wk = deriveWrap(ss, ri.salt);
    return await aesDec(wk, ri.encryptedKey, ri.iv);
  }

  isMyRecipientInfo(ri) { return ri?.rid?.pqcKeyId === this._keyId; }

  async encryptPayload(data) {
    const d = new Uint8Array(data instanceof ArrayBuffer ? data : data);
    const cek = rnd(32);
    const kemInfo = await this.encapsulateCEK(cek);
    const iv = rnd(12);
    const ct = await aesEnc(cek, d, iv);
    return { pqcHeader: buildPqcHeader({ mode: 'hybrid', kemKeyId: this._keyId }), kemInfo, iv, ciphertext: ct };
  }

  async decryptPayload(p) {
    const cek = await this.decapsulateCEK(p.kemInfo);
    return await aesDec(cek, p.ciphertext, p.iv);
  }
}
