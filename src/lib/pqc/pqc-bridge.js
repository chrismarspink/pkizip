/**
 * pqc-bridge.js v3 — pki.js 투명 연동 레이어
 */

import { PQCShield } from './pqc-shield.js';
import { PQCSigner } from './pqc-signer.js';
import { PQCBundle } from './pqc-bundle.js';
import { PQCKeystore } from './pqc-keystore.js';
import { printEncryptBanner, printDecryptBanner, buildPqcHeader } from './pqc-banner.js';
import pqcConfigDefault from './pqc-config.json' with { type: 'json' };

export class PQCBridge {
  constructor(bundle, shield, signer, config) {
    this._bundle = bundle;
    this._kem = shield;
    this._dsa = signer;
    this._config = config?.pqc || pqcConfigDefault.pqc;
  }

  static async init(opts = {}) {
    const { password, bundleId = 'default', config, mnemonic, subject, mode = 'full', loadExisting = true } = opts;
    let bundle;

    if (loadExisting && password) {
      try { bundle = await PQCKeystore.load(password, bundleId, { PQCBundleClass: PQCBundle }); } catch { /* 없으면 생성 */ }
    }

    if (!bundle && mnemonic && password) {
      bundle = await PQCBundle.create({ mnemonic, password, subject: subject || { name: 'User', email: 'user@pkizip' }, mode });
      await PQCKeystore.save(bundle, password, bundleId);
    }

    if (!bundle) throw new Error('번들 없음 — mnemonic 또는 기존 저장소 필요');

    const shield = PQCShield.fromBundle(bundle.getKEMKeyPair());
    const signer = PQCSigner.fromBundle(bundle.getDSAKeyPair());
    return new PQCBridge(bundle, shield, signer, config || pqcConfigDefault);
  }

  // ── 설정 해석 ──
  resolveKemConfig(certId) {
    const def = this._config.default?.kem || { enabled: true, mode: 'hybrid', algorithm: 'ML-KEM-1024', applyTo: ['enveloped', 'encrypted'] };
    if (certId) { const c = this._config.certificates?.find(x => x.id === certId); if (c?.kem?.mode) return { ...def, mode: c.kem.mode }; }
    return def;
  }
  resolveDsaConfig(certId) {
    const def = this._config.default?.dsa || { enabled: true, mode: 'hybrid', algorithm: 'ML-DSA-87', applyTo: ['signed', 'detached'] };
    if (certId) { const c = this._config.certificates?.find(x => x.id === certId); if (c?.dsa?.mode) return { ...def, mode: c.dsa.mode }; }
    return def;
  }

  // ── EnvelopedData ──
  async wrapEnveloped(ed, certId) {
    const mode = this.resolveKemConfig(certId).mode;
    if (mode === 'classical') { printEncryptBanner({ mode: 'classical', certId }); return ed; }
    const cek = ed._cek || ed.cek;
    if (!cek) throw new Error('CEK 없음');
    const ri = await this._kem.encapsulateCEK(new Uint8Array(cek));
    const r = { ...ed, pqcKemRecipientInfo: ri, pqcHeader: buildPqcHeader({ mode, kemKeyId: this._kem.pqcKeyId, certId }) };
    if (mode === 'pqc-only') r.recipientInfos = [];
    printEncryptBanner({ mode, certId });
    return r;
  }

  async unwrapEnveloped(ed) {
    if (ed.pqcKemRecipientInfo) {
      try {
        if (this._kem.isMyRecipientInfo(ed.pqcKemRecipientInfo)) {
          const cek = await this._kem.decapsulateCEK(ed.pqcKemRecipientInfo);
          printDecryptBanner({ path: 'pqc', kemKeyId: this._kem.pqcKeyId, dsaVerify: 'N/A' });
          return { cek, path: 'pqc' };
        }
      } catch (err) { console.warn('[PQC] Kyber 실패:', err.message); }
    }
    if (ed.recipientInfos?.length > 0) {
      printDecryptBanner({ fallback: true });
      return { cek: null, path: 'rsa-fallback', message: 'RSA 경로 (pki.js)' };
    }
    throw new Error('복호화 불가');
  }

  // ── EncryptedData ──
  async encryptData(data, certId) {
    const cfg = this.resolveKemConfig(certId);
    if (cfg.mode === 'classical') { printEncryptBanner({ mode: 'classical', certId }); return { pqcHeader: buildPqcHeader({ mode: 'classical', certId }), plainData: data }; }
    const p = await this._kem.encryptPayload(data);
    printEncryptBanner({ mode: cfg.mode, certId });
    return p;
  }
  async decryptData(p) {
    if (!p.pqcHeader?.pqcProtected) return { plainData: p.plainData };
    const r = await this._kem.decryptPayload(p);
    printDecryptBanner({ path: 'pqc', kemKeyId: this._kem.pqcKeyId });
    return r;
  }

  // ── SignedData ──
  async wrapSigned(sd, certId) { return await this._dsa.wrapSigned(sd, certId, this.resolveDsaConfig(certId)); }
  async verifySigned(sd) { return await this._dsa.verifySigned(sd); }

  // ── Detached ──
  async signFile(fb) { return await this._dsa.signDetached(fb); }
  async verifyFile(fb, sig) { return await this._dsa.verifyDetached(fb, sig); }

  // ── 번들 접근 ──
  getBundle() { return this._bundle; }
  async exportBundle() { return await PQCKeystore.exportJSON(); }
  async importBundle(json, pw) { await PQCKeystore.importJSON(json, pw); }
  async restoreFromMnemonic(mnemonic, password, subject) {
    const b = await PQCBundle.restore(mnemonic, password, { subject });
    await PQCKeystore.save(b, password);
    return b;
  }

  get shield() { return this._kem; }
  get signer() { return this._dsa; }
  get config() { return this._config; }
}
