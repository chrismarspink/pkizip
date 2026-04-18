/**
 * pqc-demo.js — PQC 통합 테스트
 *
 * 실행: node pqc-demo.js
 *
 * 5개 테스트:
 *   1. config 계층 해석
 *   2. EnvelopedData 하이브리드
 *   3. EncryptedData 직접 암호화
 *   4. 변조 감지
 *   5. RSA fallback
 */

import { PQCShield, printPQCBanner, createPQCHeader } from './pqc-shield.js';
import { PQCBridge } from './pqc-bridge.js';
import pqcConfig from './pqc-config.json' with { type: 'json' };

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  ✅ ${msg}`);
    passed++;
  } else {
    console.error(`  ❌ ${msg}`);
    failed++;
  }
}

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// ══════════════════════════════════════

async function test1_configResolution() {
  console.log('\n═══ 테스트 1: config 계층 해석 ═══');

  const shield = await PQCShield.init();
  const bridge = new PQCBridge(shield, pqcConfig);

  // hybrid 기본값
  const mode1 = bridge.resolveMode('unknown-cert');
  assert(mode1 === 'hybrid', `알 수 없는 인증서 → default(hybrid): ${mode1}`);

  // classical 오버라이드
  const mode2 = bridge.resolveMode('cert-legacy-vendor');
  assert(mode2 === 'classical', `cert-legacy-vendor → classical: ${mode2}`);

  // pqc-only 오버라이드
  const mode3 = bridge.resolveMode('cert-internal-hsm');
  assert(mode3 === 'pqc-only', `cert-internal-hsm → pqc-only: ${mode3}`);

  // null certId → default
  const mode4 = bridge.resolveMode(null);
  assert(mode4 === 'hybrid', `null certId → default(hybrid): ${mode4}`);
}

// ══════════════════════════════════════

async function test2_envelopedHybrid() {
  console.log('\n═══ 테스트 2: EnvelopedData 하이브리드 ═══');

  const shield = await PQCShield.init();
  const bridge = new PQCBridge(shield, pqcConfig);

  // mock EnvelopedData (pki.js가 생성한 것 시뮬레이션)
  const cek = crypto.getRandomValues(new Uint8Array(32));
  const mockEnveloped = {
    _cek: cek,
    recipientInfos: [{ type: 'RSA-OAEP', data: new Uint8Array(256) }],
    encryptedContent: new Uint8Array(100),
  };

  // wrapEnveloped (hybrid 모드)
  const wrapped = await bridge.wrapEnveloped(mockEnveloped, 'some-cert');

  assert(!!wrapped.pqcRecipientInfo, 'PQCRecipientInfo 존재');
  assert(wrapped.pqcRecipientInfo.type === 'ML-KEM-1024', `KEM 타입: ${wrapped.pqcRecipientInfo.type}`);
  assert(wrapped.recipientInfos.length > 0, `RSA RecipientInfo 유지됨 (hybrid): ${wrapped.recipientInfos.length}개`);
  assert(!!wrapped.pqcHeader, 'pqcHeader 존재');
  assert(wrapped.pqcHeader.protected === true, `pqcHeader.protected: ${wrapped.pqcHeader.protected}`);

  // unwrapEnveloped — PQC 경로 복호화
  const unwrapped = await bridge.unwrapEnveloped(wrapped, 'some-cert');
  assert(unwrapped.path === 'pqc', `복호화 경로: ${unwrapped.path}`);
  assert(arraysEqual(unwrapped.cek, cek), 'CEK 원본 일치');
}

// ══════════════════════════════════════

async function test3_encryptedData() {
  console.log('\n═══ 테스트 3: EncryptedData 직접 암호화 ═══');

  const shield = await PQCShield.init();
  const bridge = new PQCBridge(shield, pqcConfig);

  // 64KB 랜덤 데이터 (getRandomValues 한도)
  const original = crypto.getRandomValues(new Uint8Array(65536));
  console.log(`  원본 데이터: ${original.length} bytes`);

  // 암호화
  const encrypted = await bridge.encryptData(original, 'some-cert');

  assert(encrypted.pqcHeader?.protected === true, 'pqcHeader.protected === true');
  assert(encrypted.pqcHeader?.mode === 'hybrid', `mode: ${encrypted.pqcHeader?.mode}`);
  assert(!!encrypted.ciphertext, `ciphertext 존재 (${encrypted.ciphertext?.length} bytes)`);
  assert(!!encrypted.signature, `서명 존재 (${encrypted.signature?.length} bytes)`);

  // 복호화
  const decrypted = await bridge.decryptData(encrypted, 'some-cert');
  assert(arraysEqual(decrypted, original), `복호화 데이터 원본 일치 (${decrypted.length} bytes)`);
}

// ══════════════════════════════════════

async function test4_tamperDetection() {
  console.log('\n═══ 테스트 4: 변조 감지 ═══');

  const shield = await PQCShield.init();
  const bridge = new PQCBridge(shield, pqcConfig);

  const original = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const encrypted = await bridge.encryptData(original, 'some-cert');

  // ciphertext 1바이트 변조
  const tampered = { ...encrypted, ciphertext: new Uint8Array(encrypted.ciphertext) };
  tampered.ciphertext[0] ^= 0xFF;

  try {
    await bridge.decryptData(tampered, 'some-cert');
    assert(false, '변조 감지 실패 — 예외가 발생해야 함');
  } catch (err) {
    assert(err.message.includes('서명 검증 실패') || err.message.includes('변조'), `변조 감지 성공: ${err.message}`);
  }
}

// ══════════════════════════════════════

async function test5_rsaFallback() {
  console.log('\n═══ 테스트 5: RSA fallback ═══');

  // 다른 키로 생성 → 원래 키로 복호화 시도 (Kyber 실패 → RSA fallback)
  const senderShield = await PQCShield.init();
  const senderBridge = new PQCBridge(senderShield, pqcConfig);

  const cek = crypto.getRandomValues(new Uint8Array(32));
  const mockEnveloped = {
    _cek: cek,
    recipientInfos: [{ type: 'RSA-OAEP', data: new Uint8Array(256) }],
  };

  const wrapped = await senderBridge.wrapEnveloped(mockEnveloped, 'some-cert');

  // 수신자는 다른 Kyber 키를 가짐
  const receiverShield = await PQCShield.init();
  const receiverBridge = new PQCBridge(receiverShield, pqcConfig);

  const result = await receiverBridge.unwrapEnveloped(wrapped, 'some-cert');
  assert(result.path === 'rsa-fallback', `복호화 경로: ${result.path} (Kyber 실패 → RSA fallback)`);
  assert(result.message?.includes('RSA'), `RSA fallback 메시지: ${result.message}`);
}

// ══════════════════════════════════════

async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  PKIZIP PQC (Post-Quantum Cryptography) 테스트  ║');
  console.log('╚══════════════════════════════════════════════════╝');

  const start = performance.now();

  await test1_configResolution();
  await test2_envelopedHybrid();
  await test3_encryptedData();
  await test4_tamperDetection();
  await test5_rsaFallback();

  const elapsed = ((performance.now() - start) / 1000).toFixed(2);

  console.log('\n══════════════════════════════════════');
  console.log(`  결과: ${passed} passed, ${failed} failed  (${elapsed}s)`);
  console.log('══════════════════════════════════════\n');

  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error('테스트 실패:', err); process.exit(1); });
