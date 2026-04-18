/**
 * pqc-signer.js — ML-DSA-87 전자서명 전용 모듈
 */

import { ml_dsa87 } from '@noble/post-quantum/ml-dsa.js';
import { sha3_512 } from '@noble/hashes/sha3.js';
import { printSignBanner, printVerifyBanner, buildPqcHeader } from './pqc-banner.js';

function toHex(u8) { return Array.from(u8).map(b => b.toString(16).padStart(2, '0')).join(''); }
function fromHex(h) { const u = new Uint8Array(h.length / 2); for (let i = 0; i < u.length; i++) u[i] = parseInt(h.slice(i*2, i*2+2), 16); return u; }

export class PQCSigner {
  constructor(dsaPublicKey, dsaSecretKey) {
    this._pub = dsaPublicKey;
    this._sec = dsaSecretKey;
  }

  static async init() {
    const { publicKey, secretKey } = ml_dsa87.keygen();
    return new PQCSigner(publicKey, secretKey);
  }

  static async fromKeystore(ks) {
    return new PQCSigner(fromHex(ks.dsaPublicKey), fromHex(ks.dsaSecretKey));
  }

  // ── 서명 ──

  async sign(data, meta = {}) {
    const d = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data);
    const digest = sha3_512(d);
    // ml_dsa87.sign(message, secretKey)
    const signature = ml_dsa87.sign(digest, this._sec);

    return {
      type: 'ML-DSA-87',
      nistStandard: 'FIPS-204',
      algorithm: 'ML-DSA-87',
      digest: new Uint8Array(digest),
      signature: new Uint8Array(signature),
      dsaPublicKey: new Uint8Array(this._pub),
      signedAt: new Date().toISOString(),
      meta,
    };
  }

  async verify(data, pqcSig) {
    try {
      const d = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data);
      const digest = sha3_512(d);
      // ml_dsa87.verify(signature, message, publicKey)
      const valid = ml_dsa87.verify(pqcSig.signature, digest, pqcSig.dsaPublicKey);
      const result = { valid, algorithm: 'ML-DSA-87', signedAt: pqcSig.signedAt, reason: valid ? '' : 'Signature mismatch' };
      printVerifyBanner(result);
      return result;
    } catch (err) {
      const result = { valid: false, algorithm: 'ML-DSA-87', signedAt: pqcSig.signedAt, reason: err.message };
      printVerifyBanner(result);
      return result;
    }
  }

  // ── SignedData 통합 ──

  async wrapSigned(signedData, certId, dsaConfig) {
    const mode = dsaConfig?.mode || 'hybrid';
    if (mode === 'classical') return signedData;

    // 원본 콘텐츠에서 서명 생성
    const content = signedData._content || signedData.content || new Uint8Array(0);
    const pqcSig = await this.sign(content);
    printSignBanner({ mode, dsaAlg: 'ML-DSA-87', certId });

    const result = { ...signedData };
    result.pqcSignerInfo = {
      signerAlgorithm: 'ML-DSA-87',
      nistStandard: 'FIPS-204',
      digestAlgorithm: 'SHA3-512',
      signature: pqcSig.signature,
      dsaPublicKey: pqcSig.dsaPublicKey,
      signedAt: pqcSig.signedAt,
    };
    result.pqcHeader = buildPqcHeader({ mode, dsaAlg: 'ML-DSA-87', certId });

    if (mode === 'pqc-only') {
      result.signerInfos = [];
    }
    return result;
  }

  async verifySigned(signedData) {
    if (!signedData.pqcSignerInfo) {
      return { valid: true, algorithm: 'N/A', reason: 'No PQC signature present — skipped' };
    }
    const content = signedData._content || signedData.content || new Uint8Array(0);
    return await this.verify(content, {
      signature: signedData.pqcSignerInfo.signature,
      dsaPublicKey: signedData.pqcSignerInfo.dsaPublicKey,
      signedAt: signedData.pqcSignerInfo.signedAt,
    });
  }

  // ── Detached 서명 ──

  async signDetached(fileBytes, certId, dsaConfig) {
    const mode = dsaConfig?.mode || 'hybrid';
    if (mode === 'classical') return null;
    printSignBanner({ mode, dsaAlg: 'ML-DSA-87', certId });
    return await this.sign(fileBytes);
  }

  async verifyDetached(fileBytes, pqcSig) {
    return await this.verify(fileBytes, pqcSig);
  }

  // ── 키 관리 ──

  exportKeys() {
    return { version: 2, dsaPublicKey: toHex(this._pub), dsaSecretKey: toHex(this._sec), exportedAt: new Date().toISOString() };
  }

  exportPublicKeys() {
    return { version: 2, dsaPublicKey: toHex(this._pub), exportedAt: new Date().toISOString() };
  }
}
