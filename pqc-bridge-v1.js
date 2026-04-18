/**
 * pqc-bridge.js — pki.js 투명 연동 레이어
 *
 * pki.js를 한 줄도 수정하지 않고 PQC를 pkizip 워크플로에 삽입하는 미들웨어.
 *
 * pkizip 앱
 *     │  pki.js API 그대로 호출
 *     ▼
 * PQCBridge  ← 이 파일
 *     │  EnvelopedData 생성/파싱 시 PQC RecipientInfo 자동 삽입/처리
 *     │  pqc-config.json 설정 읽어 mode 결정
 *     ├── pki.js        (기존 RSA 경로)
 *     └── pqc-shield.js (신규 Kyber 경로)
 */

import { PQCShield, printPQCBanner, createPQCHeader } from './pqc-shield.js';
import { PQCKeystore } from './pqc-keystore.js';
import pqcConfigDefault from './pqc-config.json' with { type: 'json' };

export class PQCBridge {

  constructor(pqcShield, config) {
    this._shield = pqcShield;
    this._config = config?.pqc || pqcConfigDefault.pqc;
  }

  // ─── 초기화 ───

  static async init(opts = {}) {
    const { password, keyId = 'default', config } = opts;

    let shield;
    try {
      // 기존 키 로드 시도
      shield = await PQCKeystore.load(password, keyId, { PQCShieldClass: PQCShield });
    } catch {
      // 없으면 새로 생성 + 저장
      shield = await PQCShield.init();
      if (password) {
        await PQCKeystore.save(shield, password, keyId);
      }
    }

    const cfg = config || pqcConfigDefault;
    return new PQCBridge(shield, cfg);
  }

  // ─── 설정 해석 ───

  resolveMode(certId) {
    // 인증서별 오버라이드 → 전역 default → fallback
    if (certId) {
      const certConfig = this._config.certificates?.find(c => c.id === certId);
      if (certConfig?.pqc?.mode) return certConfig.pqc.mode;
    }
    return this._config.default?.mode || 'classical';
  }

  // ─── EnvelopedData ───

  /**
   * pki.js가 생성한 EnvelopedData에 PQCRecipientInfo를 추가.
   *
   * envelopedData 객체에 pqcRecipientInfo 필드와 pqcHeader를 추가한다.
   * 기존 recipientInfos(RSA)는 mode에 따라 유지 또는 제거.
   */
  async wrapEnveloped(envelopedData, certId) {
    const mode = this.resolveMode(certId);

    if (mode === 'classical') {
      // PQC 미적용 — 그대로 반환
      printPQCBanner('encrypt', 'classical', certId);
      return envelopedData;
    }

    // CEK 추출 (envelopedData에 cek가 있다고 가정, 또는 mock)
    const cek = envelopedData._cek || envelopedData.cek;
    if (!cek) {
      throw new Error('EnvelopedData에서 CEK를 찾을 수 없습니다. pki.js가 CEK를 노출하지 않는 경우 protectData()를 사용하세요.');
    }

    // Kyber로 CEK 캡슐화
    const pqcRecipientInfo = await this._shield.encapsulateCEK(new Uint8Array(cek));

    // 결과 조립
    const result = { ...envelopedData };
    result.pqcRecipientInfo = pqcRecipientInfo;
    result.pqcHeader = createPQCHeader(mode);

    if (mode === 'pqc-only') {
      // RSA RecipientInfo 제거
      result.recipientInfos = [];
    }

    printPQCBanner('encrypt', mode, certId);
    return result;
  }

  /**
   * EnvelopedData 복호화. PQCRecipientInfo 우선, RSA fallback.
   */
  async unwrapEnveloped(envelopedData, certId) {
    const mode = this.resolveMode(certId);

    // PQCRecipientInfo가 있으면 Kyber로 복호화 시도
    if (envelopedData.pqcRecipientInfo) {
      try {
        const cek = await this._shield.decapsulateCEK(envelopedData.pqcRecipientInfo);
        printPQCBanner('decrypt-ok');
        return { cek, path: 'pqc' };
      } catch (err) {
        console.warn('[PQC] Kyber 복호화 실패, RSA fallback:', err.message);
      }
    }

    // RSA fallback (pki.js 기존 경로)
    if (envelopedData.recipientInfos?.length > 0) {
      return { cek: null, path: 'rsa-fallback', message: 'RSA 경로로 복호화하세요 (pki.js 사용)' };
    }

    throw new Error('복호화 가능한 RecipientInfo 없음');
  }

  // ─── EncryptedData ───

  /**
   * 데이터를 PQC 보호하여 EncryptedData 구조로 반환.
   */
  async encryptData(data, certId) {
    const mode = this.resolveMode(certId);

    if (mode === 'classical') {
      printPQCBanner('encrypt', 'classical', certId);
      return { pqcHeader: createPQCHeader('classical'), plainData: data, message: 'PQC 미적용 — 기존 암호화를 사용하세요' };
    }

    const applyTo = this._config.default?.applyTo || [];
    if (!applyTo.includes('encrypted')) {
      return { pqcHeader: createPQCHeader('classical'), plainData: data, message: 'encrypted 타입 PQC 미적용 (설정)' };
    }

    const result = await this._shield.protectData(data);
    printPQCBanner('encrypt', mode, certId);
    return result;
  }

  /**
   * PQC EncryptedData 복호화. 서명 검증 포함.
   */
  async decryptData(pqcEncryptedData, certId) {
    if (!pqcEncryptedData.pqcHeader?.protected) {
      return { plainData: pqcEncryptedData.plainData, message: 'PQC 미적용 데이터' };
    }

    const result = await this._shield.restoreData(pqcEncryptedData);
    return result;
  }

  // ─── 키 백업/복원 ───

  async exportBackup() {
    return await PQCKeystore.exportJSON();
  }

  async importBackup(jsonStr) {
    await PQCKeystore.importJSON(jsonStr);
  }

  // ─── 접근자 ───

  get shield() { return this._shield; }
  get config() { return this._config; }
}
