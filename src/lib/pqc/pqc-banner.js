/**
 * pqc-banner.js v3 — 콘솔/헤더 표기 공용 모듈
 */

export function printBundleCreateBanner({ mode, paths, timestamp = new Date().toISOString() }) {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║  🔐  pkizip 양자 암호 키 번들 생성                          ║
╠════════════════════════════════════════════════════════════╣
║  모드    : ${mode}  (secp256k1 + ML-KEM-1024 + ML-DSA-87)
║  KEM     : ML-KEM-1024   NIST FIPS 203   RFC 9935
║  DSA     : ML-DSA-87     NIST FIPS 204   RFC 9881
║  인증서  : 3개 생성 완료
║  경로    : ${paths?.ecc || ''} | ${paths?.kem || ''} | ${paths?.dsa || ''}
║  생성 일시: ${timestamp}
╚════════════════════════════════════════════════════════════╝`);
}

export function printEncryptBanner({ mode, certId = 'default', kemAlg = 'ML-KEM-1024', dsaAlg = 'ML-DSA-87' }) {
  if (mode === 'classical') {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║  ⚠️   고전 암호만 사용 — PQC 미적용                         ║
║  CERT : ${certId}
╚════════════════════════════════════════════════════════════╝`);
    return;
  }
  const md = mode === 'pqc-only' ? 'Kyber 전용 — 최고 강도' : 'RSA + Kyber 병행 (수신자 호환)';
  console.log(`
╔════════════════════════════════════════════════════════════╗
║  🔐  양자 암호 보호 적용 (Post-Quantum Protected)           ║
╠════════════════════════════════════════════════════════════╣
║  KEM  : ${kemAlg}   NIST FIPS 203  [암호화]
║  DSA  : ${dsaAlg}     NIST FIPS 204  [무결성 서명]
║  MODE : ${mode}        ${md}
║  CERT : ${certId}
╚════════════════════════════════════════════════════════════╝`);
}

export function printSignBanner({ mode, dsaAlg = 'ML-DSA-87', certId = 'default' }) {
  if (mode === 'classical') return;
  const md = mode === 'pqc-only' ? 'ML-DSA 전용' : '기존 서명 + ML-DSA 병행';
  console.log(`
╔════════════════════════════════════════════════════════════╗
║  🔏  양자 내성 전자서명 생성 (PQC Digital Signature)        ║
╠════════════════════════════════════════════════════════════╣
║  DSA  : ${dsaAlg}     NIST FIPS 204   RFC 9882
║  HASH : SHA3-512
║  MODE : ${mode}        ${md}
║  CERT : ${certId}
╚════════════════════════════════════════════════════════════╝`);
}

export function printDecryptBanner({ path, kemKeyId, dsaVerify, fallback = false }) {
  if (fallback) {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║  ✅  복호화 성공 (RSA fallback)                             ║
╠════════════════════════════════════════════════════════════╣
║  복호화 경로  : RSA-OAEP fallback (PQC 키 없음)             ║
║  경고          : 양자 컴퓨터에 취약한 경로 사용               ║
╚════════════════════════════════════════════════════════════╝`);
    return;
  }
  console.log(`
╔════════════════════════════════════════════════════════════╗
║  ✅  PQC 복호화 성공                                        ║
╠════════════════════════════════════════════════════════════╣
║  복호화 경로  : ML-KEM-1024 RecipientInfo
║  KEM pqcKeyId : ${kemKeyId || 'N/A'}
║  DSA 서명     : ${dsaVerify || 'N/A'}
╚════════════════════════════════════════════════════════════╝`);
}

export function printVerifyBanner(result) {
  if (result.valid) {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║  ✅  PQC 서명 검증 성공                                      ║
╠════════════════════════════════════════════════════════════╣
║  DSA      : ${result.algorithm || 'ML-DSA-87'}   NIST FIPS 204
║  검증 결과 : PASS
║  서명 시각 : ${result.signedAt || 'N/A'}
╚════════════════════════════════════════════════════════════╝`);
  } else {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║  ❌  경고: PQC 서명 검증 실패 — 처리 중단                   ║
╠════════════════════════════════════════════════════════════╣
║  DSA      : ${result.algorithm || 'ML-DSA-87'}
║  결과     : FAIL
║  원인     : ${result.reason || '알 수 없음'}
║  조치     : 데이터 변조 또는 키 불일치 — 관리자 문의        ║
╚════════════════════════════════════════════════════════════╝`);
  }
}

export function buildPqcHeader({ mode, bundleMode = 'full', kemAlg = null, dsaAlg = null, kemKeyId = null, certId = 'default' }) {
  return {
    pqcProtected: mode !== 'classical',
    version: 3,
    mode,
    bundleMode,
    algorithms: {
      kem: mode !== 'classical' ? (kemAlg || 'ML-KEM-1024') : null,
      dsa: mode !== 'classical' ? (dsaAlg || 'ML-DSA-87') : null,
      kdf: 'HKDF-SHA3-512',
      sym: 'AES-256-GCM',
    },
    nistStandards: mode !== 'classical' ? ['FIPS-203', 'FIPS-204'] : [],
    rfcReferences: mode !== 'classical' ? ['RFC-9935', 'RFC-9881', 'RFC-9882'] : [],
    kemKeyId,
    certId,
    createdAt: new Date().toISOString(),
    notice: mode !== 'classical'
      ? 'Post-Quantum Cryptography protected. ML-KEM-1024 + ML-DSA-87.'
      : 'Classical cryptography only.',
  };
}
