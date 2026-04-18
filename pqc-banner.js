/**
 * pqc-banner.js — 콘솔/헤더 표기 공용 모듈
 */

export function printEncryptBanner({ mode, kemAlg = 'ML-KEM-1024', dsaAlg = 'ML-DSA-87', certId = 'default', timestamp = new Date().toISOString() }) {
  if (mode === 'classical') {
    console.log(`
╔════════════════════════════════════════════════════════╗
║  ⚠️   고전 암호만 사용 — PQC 미적용                     ║
║  KEM  : RSA-OAEP      (양자 취약)                      ║
║  DSA  : RSA-PSS/ECDSA (양자 취약)                      ║
║  CERT : ${certId}
╚════════════════════════════════════════════════════════╝`);
    return;
  }
  const modeDesc = mode === 'pqc-only' ? 'Kyber/Dilithium 전용 — 최고 강도' : 'RSA + Kyber 병행 포함';
  console.log(`
╔════════════════════════════════════════════════════════╗
║  🔐  양자 암호 보호 적용 (Post-Quantum Protected)       ║
╠════════════════════════════════════════════════════════╣
║  KEM  : ${kemAlg}   NIST FIPS 203  [암호화]
║  DSA  : ${dsaAlg}     NIST FIPS 204  [전자서명]
║  MODE : ${mode}        ${modeDesc}
║  CERT : ${certId}
║  TIME : ${timestamp}
╚════════════════════════════════════════════════════════╝`);
}

export function printSignBanner({ mode, dsaAlg = 'ML-DSA-87', certId = 'default' }) {
  if (mode === 'classical') return;
  const modeDesc = mode === 'pqc-only' ? 'ML-DSA 전용' : '기존 서명 + ML-DSA 병행';
  console.log(`
╔════════════════════════════════════════════════════════╗
║  🔏  양자 내성 전자서명 생성 (PQC Digital Signature)    ║
╠════════════════════════════════════════════════════════╣
║  DSA  : ${dsaAlg}     NIST FIPS 204
║  HASH : SHA3-512      다이제스트 서명
║  MODE : ${mode}        ${modeDesc}
║  CERT : ${certId}
╚════════════════════════════════════════════════════════╝`);
}

export function printDecryptBanner({ path, kemVerify = 'PASS', dsaVerify = 'N/A', fallback = false }) {
  if (fallback) {
    console.log(`
╔════════════════════════════════════════════════════════╗
║  ✅  복호화 성공 (RSA fallback)                         ║
╠════════════════════════════════════════════════════════╣
║  복호화 경로 : RSA-OAEP fallback (PQC 키 없음)          ║
║  KEM 검증   : N/A (classical 경로)                     ║
╚════════════════════════════════════════════════════════╝`);
    return;
  }
  console.log(`
╔════════════════════════════════════════════════════════╗
║  ✅  PQC 복호화 성공                                    ║
╠════════════════════════════════════════════════════════╣
║  복호화 경로 : ML-KEM-1024 RecipientInfo                ║
║  KEM 검증   : ${kemVerify}
║  DSA 서명   : ${dsaVerify}
╚════════════════════════════════════════════════════════╝`);
}

export function printVerifyBanner(result) {
  if (result.valid) {
    console.log(`
╔════════════════════════════════════════════════════════╗
║  ✅  PQC 서명 검증 성공                                  ║
╠════════════════════════════════════════════════════════╣
║  DSA      : ${result.algorithm || 'ML-DSA-87'}   NIST FIPS 204
║  검증 결과 : PASS
║  서명 시각 : ${result.signedAt || 'N/A'}
╚════════════════════════════════════════════════════════╝`);
  } else {
    console.log(`
╔════════════════════════════════════════════════════════╗
║  ❌  경고: PQC 서명 검증 실패 — 처리 중단               ║
╠════════════════════════════════════════════════════════╣
║  DSA      : ${result.algorithm || 'ML-DSA-87'}
║  검증 결과 : FAIL
║  원인     : ${result.reason || '알 수 없음'}
║  조치     : 데이터 변조 또는 키 불일치 — 관리자 문의    ║
╚════════════════════════════════════════════════════════╝`);
  }
}

export function buildPqcHeader({ mode, kemAlg = null, dsaAlg = null, certId = 'default' }) {
  return {
    pqcProtected: mode !== 'classical',
    version: 2,
    mode,
    algorithms: {
      kem: mode !== 'classical' ? (kemAlg || 'ML-KEM-1024') : null,
      dsa: mode !== 'classical' ? (dsaAlg || 'ML-DSA-87') : null,
      kdf: 'HKDF-SHA3-512',
      sym: 'AES-256-GCM',
    },
    nistStandards: mode !== 'classical' ? ['FIPS-203', 'FIPS-204'] : [],
    certId,
    createdAt: new Date().toISOString(),
    notice: mode !== 'classical'
      ? 'Post-Quantum Cryptography protected. ML-KEM-1024 + ML-DSA-87 (NIST FIPS 203/204)'
      : 'Classical cryptography only.',
  };
}
