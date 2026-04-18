/**
 * pqc-signer.js v3 — ML-DSA-87 전자서명 엔진
 */

import { ml_dsa87 } from '@noble/post-quantum/ml-dsa.js';
import { sha3_512 } from '@noble/hashes/sha3.js';
import { printSignBanner, printVerifyBanner, buildPqcHeader } from './pqc-banner.js';

export class PQCSigner {
  constructor(pub, sec) { this._pub = pub; this._sec = sec; }

  static fromBundle(dsaKeyPair) { return new PQCSigner(dsaKeyPair.publicKey, dsaKeyPair.secretKey); }

  async sign(data) {
    const d = new Uint8Array(data instanceof ArrayBuffer ? data : data);
    const digest = sha3_512(d);
    // ml_dsa87.sign(message, secretKey)
    const signature = ml_dsa87.sign(digest, this._sec);
    return {
      type: 'ML-DSA-87', nistStandard: 'FIPS-204', rfcReference: 'RFC-9881',
      algorithm: 'ML-DSA-87', digest: new Uint8Array(digest),
      signature: new Uint8Array(signature), dsaPublicKey: new Uint8Array(this._pub),
      signedAt: new Date().toISOString(),
    };
  }

  async verify(data, pqcSig) {
    try {
      const d = new Uint8Array(data instanceof ArrayBuffer ? data : data);
      const digest = sha3_512(d);
      // ml_dsa87.verify(signature, message, publicKey)
      const valid = ml_dsa87.verify(pqcSig.signature, digest, pqcSig.dsaPublicKey);
      const r = { valid, algorithm: 'ML-DSA-87', signedAt: pqcSig.signedAt, reason: valid ? '' : 'Signature mismatch' };
      printVerifyBanner(r);
      return r;
    } catch (err) {
      const r = { valid: false, algorithm: 'ML-DSA-87', signedAt: pqcSig.signedAt, reason: err.message };
      printVerifyBanner(r);
      return r;
    }
  }

  async wrapSigned(signedData, certId, dsaConfig) {
    const mode = dsaConfig?.mode || 'hybrid';
    if (mode === 'classical') return signedData;
    const content = signedData._content || signedData.content || new Uint8Array(0);
    const pqcSig = await this.sign(content);
    printSignBanner({ mode, dsaAlg: 'ML-DSA-87', certId });
    const result = { ...signedData };
    result.pqcSignerInfo = {
      signatureAlgorithm: 'ML-DSA-87', nistStandard: 'FIPS-204', rfcReference: 'RFC-9882',
      digestAlgorithm: 'SHA3-512', signature: pqcSig.signature,
      dsaPublicKey: pqcSig.dsaPublicKey, signedAt: pqcSig.signedAt,
    };
    result.pqcHeader = buildPqcHeader({ mode, dsaAlg: 'ML-DSA-87', certId });
    if (mode === 'pqc-only') result.signerInfos = [];
    return result;
  }

  async verifySigned(signedData) {
    if (!signedData.pqcSignerInfo) return { valid: true, algorithm: 'N/A', reason: 'No PQC signature' };
    const content = signedData._content || signedData.content || new Uint8Array(0);
    return await this.verify(content, { signature: signedData.pqcSignerInfo.signature, dsaPublicKey: signedData.pqcSignerInfo.dsaPublicKey, signedAt: signedData.pqcSignerInfo.signedAt });
  }

  async signDetached(fileBytes) { return await this.sign(fileBytes); }
  async verifyDetached(fileBytes, pqcSig) { return await this.verify(fileBytes, pqcSig); }
}
