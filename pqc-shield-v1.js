/**
 * pqc-shield.js — PQC 핵심 암호화 엔진
 *
 * ML-KEM-1024 (Kyber)  — 키 캡슐화 (NIST FIPS 203)
 * ML-DSA-87 (Dilithium) — 디지털 서명 (NIST FIPS 204)
 * HKDF-SHA3-512         — 키 파생
 * AES-256-GCM           — 대칭 암호화
 *
 * pki.js 수정 없이, EnvelopedData/EncryptedData에 PQC 보호를 추가한다.
 */

import { ml_kem1024 } from '@noble/post-quantum/ml-kem.js';
import { ml_dsa87 } from '@noble/post-quantum/ml-dsa.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha3_512 } from '@noble/hashes/sha3.js';

// === 유틸리티 ===

function getRandomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

async function aesGcmEncrypt(key, data, iv) {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'AES-GCM' }, false, ['encrypt']);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, cryptoKey, data);
  return new Uint8Array(ct);
}

async function aesGcmDecrypt(key, ciphertext, iv) {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'AES-GCM' }, false, ['decrypt']);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, tagLength: 128 }, cryptoKey, ciphertext);
  return new Uint8Array(pt);
}

function deriveAesKey(sharedSecret, salt) {
  // HKDF-SHA3-512 → 32바이트 AES-256 키
  const info = new TextEncoder().encode('PKIZIP-PQC-v1');
  return hkdf(sha3_512, sharedSecret, salt, info, 32);
}

// === PQC 배너 출력 ===

function printPQCBanner(action, mode, certId) {
  const modeDesc = {
    hybrid: '[RSA + Kyber 동시 포함]',
    'pqc-only': '[Kyber 전용 — 고강도 보호]',
    classical: '[고전 암호만 사용 — PQC 미적용]',
  };

  if (action === 'encrypt') {
    console.log(`
╔══════════════════════════════════════════════════╗
║  🔐 양자 암호 보호 적용됨 (Post-Quantum Protected) ║
║  KEM : ML-KEM-1024  (NIST FIPS 203)              ║
║  SIG : ML-DSA-87    (NIST FIPS 204)              ║
║  MODE: ${mode}  ${modeDesc[mode] || ''}
║  CERT: ${certId || 'default'}
╚══════════════════════════════════════════════════╝`);
  } else if (action === 'decrypt-ok') {
    console.log(`
╔══════════════════════════════════════════════════╗
║  ✅ 양자 암호 보호 파일 복호화 성공               ║
║  KEM : ML-KEM-1024  서명 검증: PASS              ║
║  복호화 경로: Kyber RecipientInfo 사용            ║
╚══════════════════════════════════════════════════╝`);
  } else if (action === 'decrypt-fail') {
    console.log(`
╔══════════════════════════════════════════════════╗
║  ❌ 경고: 서명 검증 실패 — 데이터 변조 의심       ║
║  복호화를 중단합니다.                             ║
╚══════════════════════════════════════════════════╝`);
  }
}

// === pqcHeader 생성 ===

function createPQCHeader(mode) {
  return {
    protected: mode !== 'classical',
    mode,
    algorithms: {
      kem: 'ML-KEM-1024',
      sig: 'ML-DSA-87',
      kdf: 'HKDF-SHA3-512',
      sym: 'AES-256-GCM',
    },
    nistStandards: ['FIPS-203', 'FIPS-204'],
    createdAt: new Date().toISOString(),
    warning: 'This data is protected with post-quantum cryptography.',
  };
}

// === PQCShield 클래스 ===

export class PQCShield {
  constructor(kemKeys, dsaKeys) {
    this._kemPublicKey = kemKeys.publicKey;
    this._kemSecretKey = kemKeys.secretKey;
    this._dsaPublicKey = dsaKeys.publicKey;
    this._dsaSecretKey = dsaKeys.secretKey;
  }

  // 새 키 쌍 생성
  static async init(opts = {}) {
    const kemKeys = ml_kem1024.keygen();
    const dsaKeys = ml_dsa87.keygen();
    return new PQCShield(
      { publicKey: kemKeys.publicKey, secretKey: kemKeys.secretKey },
      { publicKey: dsaKeys.publicKey, secretKey: dsaKeys.secretKey }
    );
  }

  // 키스토어에서 복원
  static async fromKeystore(keystore, opts = {}) {
    const { password, keyId = 'default', PQCKeystoreClass } = opts;
    if (!PQCKeystoreClass) throw new Error('PQCKeystoreClass 필요');
    return await PQCKeystoreClass.load(password, keyId, { PQCShieldClass: PQCShield });
  }

  // ─── EnvelopedData 용: CEK 캡슐화 ───

  async encapsulateCEK(cek) {
    // 1. Kyber 캡슐화 → sharedSecret + ciphertext
    const { cipherText: kemCiphertext, sharedSecret } = ml_kem1024.encapsulate(this._kemPublicKey);

    // 2. HKDF 키 파생
    const salt = getRandomBytes(32);
    const aesKey = deriveAesKey(sharedSecret, salt);

    // 3. CEK를 AES-GCM으로 래핑
    const iv = getRandomBytes(12);
    const encryptedKey = await aesGcmEncrypt(aesKey, cek, iv);

    return {
      type: 'ML-KEM-1024',
      kemCiphertext: new Uint8Array(kemCiphertext),
      encryptedKey,
      iv,
      salt,
      kemPublicKey: new Uint8Array(this._kemPublicKey),
    };
  }

  async decapsulateCEK(pqcRecipientInfo) {
    // 1. Kyber 역캡슐화 → sharedSecret
    const sharedSecret = ml_kem1024.decapsulate(pqcRecipientInfo.kemCiphertext, this._kemSecretKey);

    // 2. HKDF 키 파생 (동일 salt)
    const aesKey = deriveAesKey(sharedSecret, pqcRecipientInfo.salt);

    // 3. CEK 언래핑
    const cek = await aesGcmDecrypt(aesKey, pqcRecipientInfo.encryptedKey, pqcRecipientInfo.iv);

    return cek;
  }

  // ─── EncryptedData 용: 데이터 직접 암호화 ───

  async protectData(data) {
    const dataBytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data);

    // 1. 랜덤 CEK 생성
    const cek = getRandomBytes(32);

    // 2. Kyber로 CEK 캡슐화
    const { cipherText: kemCiphertext, sharedSecret } = ml_kem1024.encapsulate(this._kemPublicKey);
    const salt = getRandomBytes(32);
    const wrappingKey = deriveAesKey(sharedSecret, salt);
    const iv_cek = getRandomBytes(12);
    const encCek = await aesGcmEncrypt(wrappingKey, cek, iv_cek);

    // 3. 데이터를 CEK로 암호화
    const iv_data = getRandomBytes(12);
    const ciphertext = await aesGcmEncrypt(cek, dataBytes, iv_data);

    // 4. 전체 ciphertext에 ML-DSA-87 서명
    const signature = ml_dsa87.sign(ciphertext, this._dsaSecretKey);

    return {
      pqcHeader: createPQCHeader('hybrid'),
      header: {
        kemCiphertext: new Uint8Array(kemCiphertext),
        salt,
        iv_cek,
        encCek,
        iv_data,
        algorithm: 'AES-256-GCM',
      },
      ciphertext,
      signature: new Uint8Array(signature),
      dsaPublicKey: new Uint8Array(this._dsaPublicKey),
    };
  }

  async restoreData(pqcEncryptedData) {
    const { header, ciphertext, signature, dsaPublicKey } = pqcEncryptedData;

    // 1. 서명 검증
    const sigValid = ml_dsa87.verify(signature, ciphertext, dsaPublicKey);
    if (!sigValid) {
      printPQCBanner('decrypt-fail');
      throw new Error('PQC 서명 검증 실패 — 데이터 변조 의심');
    }

    // 2. Kyber 역캡슐화 → sharedSecret
    const sharedSecret = ml_kem1024.decapsulate(header.kemCiphertext, this._kemSecretKey);

    // 3. HKDF → CEK 언래핑
    const wrappingKey = deriveAesKey(sharedSecret, header.salt);
    const cek = await aesGcmDecrypt(wrappingKey, header.encCek, header.iv_cek);

    // 4. 데이터 복호화
    const plaintext = await aesGcmDecrypt(cek, ciphertext, header.iv_data);

    printPQCBanner('decrypt-ok');
    return plaintext;
  }

  // ─── 키 내보내기 ───

  exportKeys() {
    return {
      kemPublicKey: new Uint8Array(this._kemPublicKey),
      kemSecretKey: new Uint8Array(this._kemSecretKey),
      dsaPublicKey: new Uint8Array(this._dsaPublicKey),
      dsaSecretKey: new Uint8Array(this._dsaSecretKey),
    };
  }

  exportPublicKeys() {
    return {
      kemPublicKey: new Uint8Array(this._kemPublicKey),
      dsaPublicKey: new Uint8Array(this._dsaPublicKey),
    };
  }
}

// 내보내기
export { printPQCBanner, createPQCHeader };
