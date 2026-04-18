/**
 * pqc-bridge.js v2 — pki.js 투명 연동 레이어
 * ML-KEM (암호화) + ML-DSA (전자서명) 통합
 */

import { PQCShield } from './pqc-shield.js';
import { PQCSigner } from './pqc-signer.js';
import { PQCKeystore } from './pqc-keystore.js';
import { printEncryptBanner, printDecryptBanner, buildPqcHeader } from './pqc-banner.js';
import pqcConfigDefault from './pqc-config.json' with { type: 'json' };

export class PQCBridge {
  constructor(kemShield, dsaSigner, config) {
    this._kem = kemShield;
    this._dsa = dsaSigner;
    this._config = config?.pqc || pqcConfigDefault.pqc;
  }

  static async init(opts = {}) {
    const { password, keyId = 'default', config, loadExisting = true } = opts;
    let kemShield, dsaSigner;

    if (loadExisting && password) {
      try {
        const loaded = await PQCKeystore.load(password, keyId, { PQCShieldClass: PQCShield, PQCSignerClass: PQCSigner });
        kemShield = loaded.kemShield;
        dsaSigner = loaded.dsaSigner;
      } catch { /* 없으면 아래서 생성 */ }
    }

    if (!kemShield) kemShield = await PQCShield.init();
    if (!dsaSigner) dsaSigner = await PQCSigner.init();

    if (password) {
      await PQCKeystore.save({ kemShield, dsaSigner }, password, keyId);
    }

    return new PQCBridge(kemShield, dsaSigner, config || pqcConfigDefault);
  }

  // ── 설정 해석 ──

  resolveKemConfig(certId) {
    const def = this._config.default?.kem || { enabled: true, mode: 'hybrid', algorithm: 'ML-KEM-1024', applyTo: ['enveloped', 'encrypted'] };
    if (certId) {
      const cert = this._config.certificates?.find(c => c.id === certId);
      if (cert?.kem?.mode) return { ...def, mode: cert.kem.mode };
    }
    return def;
  }

  resolveDsaConfig(certId) {
    const def = this._config.default?.dsa || { enabled: true, mode: 'hybrid', algorithm: 'ML-DSA-87', applyTo: ['signed', 'detached'] };
    if (certId) {
      const cert = this._config.certificates?.find(c => c.id === certId);
      if (cert?.dsa?.mode) return { ...def, mode: cert.dsa.mode };
    }
    return def;
  }

  // ── EnvelopedData ──

  async wrapEnveloped(envelopedData, certId) {
    const kemCfg = this.resolveKemConfig(certId);
    const dsaCfg = this.resolveDsaConfig(certId);
    const mode = kemCfg.mode;

    if (mode === 'classical') {
      printEncryptBanner({ mode: 'classical', certId });
      return envelopedData;
    }

    const cek = envelopedData._cek || envelopedData.cek;
    if (!cek) throw new Error('CEK를 찾을 수 없음 — encryptData() 사용 필요');

    const pqcKemRI = await this._kem.encapsulateCEK(new Uint8Array(cek));
    const result = { ...envelopedData, pqcKemRecipientInfo: pqcKemRI };
    result.pqcHeader = buildPqcHeader({ mode, kemAlg: 'ML-KEM-1024', dsaAlg: dsaCfg.mode !== 'classical' ? 'ML-DSA-87' : null, certId });

    if (mode === 'pqc-only') result.recipientInfos = [];

    printEncryptBanner({ mode, certId });
    return result;
  }

  async unwrapEnveloped(envelopedData, certId) {
    if (envelopedData.pqcKemRecipientInfo) {
      try {
        const cek = await this._kem.decapsulateCEK(envelopedData.pqcKemRecipientInfo);
        printDecryptBanner({ path: 'pqc', kemVerify: 'PASS', dsaVerify: 'N/A' });
        return { cek, path: 'pqc' };
      } catch (err) {
        console.warn('[PQC] Kyber 실패, RSA fallback:', err.message);
      }
    }

    if (envelopedData.recipientInfos?.length > 0) {
      printDecryptBanner({ path: 'rsa', fallback: true });
      return { cek: null, path: 'rsa-fallback', message: 'RSA 경로로 복호화 (pki.js 사용)' };
    }

    throw new Error('복호화 가능한 RecipientInfo 없음');
  }

  // ── EncryptedData ──

  async encryptData(data, certId) {
    const kemCfg = this.resolveKemConfig(certId);
    if (kemCfg.mode === 'classical' || !kemCfg.applyTo?.includes('encrypted')) {
      printEncryptBanner({ mode: 'classical', certId });
      return { pqcHeader: buildPqcHeader({ mode: 'classical', certId }), plainData: data };
    }

    const payload = await this._kem.encryptPayload(data);
    printEncryptBanner({ mode: kemCfg.mode, certId });
    return payload;
  }

  async decryptData(payload, certId) {
    if (!payload.pqcHeader?.pqcProtected) return { plainData: payload.plainData };
    const result = await this._kem.decryptPayload(payload);
    printDecryptBanner({ path: 'pqc', kemVerify: 'PASS' });
    return result;
  }

  // ── SignedData ──

  async wrapSigned(signedData, certId) {
    const dsaCfg = this.resolveDsaConfig(certId);
    return await this._dsa.wrapSigned(signedData, certId, dsaCfg);
  }

  async verifySigned(signedData) {
    return await this._dsa.verifySigned(signedData);
  }

  // ── Detached ──

  async signFile(fileBytes, certId) {
    const dsaCfg = this.resolveDsaConfig(certId);
    return await this._dsa.signDetached(fileBytes, certId, dsaCfg);
  }

  async verifyFile(fileBytes, pqcSig) {
    return await this._dsa.verifyDetached(fileBytes, pqcSig);
  }

  // ── 키 백업 ──

  async exportBackup() { return await PQCKeystore.exportJSON(); }
  async importBackup(jsonStr) { await PQCKeystore.importJSON(jsonStr); }

  get shield() { return this._kem; }
  get signer() { return this._dsa; }
  get config() { return this._config; }
}
