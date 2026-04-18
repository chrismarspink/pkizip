/**
 * pqc-demo.js v2 — PQC 통합 테스트 (8 시나리오)
 * 실행: node pqc-demo.js
 */

import { PQCShield } from './pqc-shield.js';
import { PQCSigner } from './pqc-signer.js';
import { PQCBridge } from './pqc-bridge.js';
import pqcConfig from './pqc-config.json' with { type: 'json' };

let passed = 0, failed = 0;

function assert(c, m) { if (c) { console.log(`  ✅ ${m}`); passed++; } else { console.error(`  ❌ ${m}`); failed++; } }
function arrEq(a, b) { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; }

// ══ SCENARIO 1: config 계층 해석 ══

async function s1() {
  console.log('\n═══ SCENARIO 1: config 계층 해석 ═══');
  const kem = await PQCShield.init();
  const dsa = await PQCSigner.init();
  const bridge = new PQCBridge(kem, dsa, pqcConfig);

  // 1-a default
  const k1 = bridge.resolveKemConfig('unknown');
  assert(k1.mode === 'hybrid', `1-a. default kem → hybrid: ${k1.mode}`);
  // 1-b classical override
  const k2 = bridge.resolveKemConfig('cert-legacy-vendor');
  assert(k2.mode === 'classical', `1-b. legacy kem → classical: ${k2.mode}`);
  // 1-c pqc-only
  const k3 = bridge.resolveKemConfig('cert-internal-hsm');
  assert(k3.mode === 'pqc-only', `1-c. internal kem → pqc-only: ${k3.mode}`);
  // 1-d KEM/DSA 독립
  const k4 = bridge.resolveKemConfig('cert-partner-kem-only');
  const d4 = bridge.resolveDsaConfig('cert-partner-kem-only');
  assert(k4.mode === 'hybrid' && d4.mode === 'classical', `1-d. partner kem=hybrid, dsa=classical`);
}

// ══ SCENARIO 2: ML-KEM CEK 캡슐화 ══

async function s2() {
  console.log('\n═══ SCENARIO 2: ML-KEM-1024 CEK 캡슐화/역캡슐화 ═══');
  const shield = await PQCShield.init();
  assert(!!shield, '2-a. PQCShield.init() 성공');

  const cek = crypto.getRandomValues(new Uint8Array(32));
  assert(cek.length === 32, `2-b. CEK 생성 (${cek.length}B)`);

  const ri = await shield.encapsulateCEK(cek);
  assert(ri.type === 'ML-KEM-1024', `2-c. encapsulate type: ${ri.type}`);
  assert(ri.kemCiphertext.length === 1568, `2-c. kemCiphertext: ${ri.kemCiphertext.length}B`);

  const restored = await shield.decapsulateCEK(ri);
  assert(arrEq(restored, cek), '2-e. CEK 원본 일치');
}

// ══ SCENARIO 3: EnvelopedData 하이브리드 ══

async function s3() {
  console.log('\n═══ SCENARIO 3: EnvelopedData 하이브리드 ═══');
  const kem = await PQCShield.init();
  const dsa = await PQCSigner.init();
  const bridge = new PQCBridge(kem, dsa, pqcConfig);

  const cek = crypto.getRandomValues(new Uint8Array(32));
  const mock = { _cek: cek, recipientInfos: [{ type: 'RSA-OAEP', data: new Uint8Array(256) }] };

  const wrapped = await bridge.wrapEnveloped(mock, 'cert-default');
  assert(!!wrapped.pqcKemRecipientInfo, '3-c. PQCKemRecipientInfo 존재');
  assert(wrapped.recipientInfos.length > 0, `3-c. RSA RI 유지: ${wrapped.recipientInfos.length}개`);
  assert(wrapped.pqcHeader?.mode === 'hybrid', `3-d. pqcHeader mode: ${wrapped.pqcHeader?.mode}`);

  const result = await bridge.unwrapEnveloped(wrapped, 'cert-default');
  assert(result.path === 'pqc', `3-e. 복호화 경로: ${result.path}`);
  assert(arrEq(result.cek, cek), '3-e. CEK 원본 일치');
}

// ══ SCENARIO 4: EncryptedData 직접 암호화 ══

async function s4() {
  console.log('\n═══ SCENARIO 4: EncryptedData 직접 암호화 ═══');
  const kem = await PQCShield.init();
  const dsa = await PQCSigner.init();
  const bridge = new PQCBridge(kem, dsa, pqcConfig);

  const original = crypto.getRandomValues(new Uint8Array(65536));
  console.log(`  원본: ${original.length}B`);

  const t0 = performance.now();
  const encrypted = await bridge.encryptData(original, 'cert-default');
  const encMs = (performance.now() - t0).toFixed(1);
  assert(encrypted.pqcHeader?.pqcProtected === true, '4-c. pqcProtected === true');

  const t1 = performance.now();
  const decrypted = await bridge.decryptData(encrypted, 'cert-default');
  const decMs = (performance.now() - t1).toFixed(1);
  assert(arrEq(decrypted, original), `4-d. 원본 일치 (${decrypted.length}B)`);
  console.log(`  ⏱ 암호화: ${encMs}ms, 복호화: ${decMs}ms`);
}

// ══ SCENARIO 5: ML-DSA-87 전자서명 ══

async function s5() {
  console.log('\n═══ SCENARIO 5: ML-DSA-87 전자서명 ═══');
  const signer = await PQCSigner.init();
  assert(!!signer, '5-a. PQCSigner.init() 성공');

  const data = crypto.getRandomValues(new Uint8Array(512));
  const sig = await signer.sign(data);
  assert(sig.type === 'ML-DSA-87', `5-b. type: ${sig.type}`);
  assert(sig.signature.length === 4627, `5-c. sig size: ${sig.signature.length}B`);

  const vr = await signer.verify(data, sig);
  assert(vr.valid === true, `5-d. verify: ${vr.valid}`);
}

// ══ SCENARIO 6: SignedData 하이브리드 ══

async function s6() {
  console.log('\n═══ SCENARIO 6: SignedData 하이브리드 서명 ═══');
  const kem = await PQCShield.init();
  const dsa = await PQCSigner.init();
  const bridge = new PQCBridge(kem, dsa, pqcConfig);

  const content = new Uint8Array([1,2,3,4,5,6,7,8]);
  const mock = { _content: content, signerInfos: [{ algorithm: 'RSA-PSS', sig: new Uint8Array(256) }] };

  const wrapped = await bridge.wrapSigned(mock, 'cert-default');
  assert(!!wrapped.pqcSignerInfo, '6-c. PQCSignerInfo 존재');
  assert(wrapped.signerInfos.length > 0, `6-c. RSA 서명 유지: ${wrapped.signerInfos.length}개`);

  const vr = await bridge.verifySigned(wrapped);
  assert(vr.valid === true, `6-d. verifySigned: ${vr.valid}`);
}

// ══ SCENARIO 7: 변조 감지 ══

async function s7() {
  console.log('\n═══ SCENARIO 7: 변조 감지 ═══');
  const kem = await PQCShield.init();
  const dsa = await PQCSigner.init();
  const bridge = new PQCBridge(kem, dsa, pqcConfig);

  // 7-a~c: EncryptedData 변조
  const data = new Uint8Array([10,20,30,40,50]);
  const enc = await bridge.encryptData(data, 'cert-default');
  const tampered = { ...enc, ciphertext: new Uint8Array(enc.ciphertext) };
  tampered.ciphertext[0] ^= 0xFF;
  try {
    await bridge.decryptData(tampered, 'cert-default');
    assert(false, '7-c. 변조 미감지 — 오류 발생해야 함');
  } catch (err) {
    assert(true, `7-c. 암호문 변조 감지: ${err.message.slice(0, 50)}`);
  }

  // 7-d~f: 서명 변조
  const signer = await PQCSigner.init();
  const sig = await signer.sign(data);
  const altered = new Uint8Array([10,20,30,40,99]);
  const vr = await signer.verify(altered, sig);
  assert(vr.valid === false, `7-e. 서명 변조 감지: valid=${vr.valid}`);
}

// ══ SCENARIO 8: RSA Fallback ══

async function s8() {
  console.log('\n═══ SCENARIO 8: RSA Fallback ═══');
  const senderKem = await PQCShield.init();
  const senderDsa = await PQCSigner.init();
  const senderBridge = new PQCBridge(senderKem, senderDsa, pqcConfig);

  const cek = crypto.getRandomValues(new Uint8Array(32));
  const mock = { _cek: cek, recipientInfos: [{ type: 'RSA-OAEP', data: new Uint8Array(256) }] };
  const wrapped = await senderBridge.wrapEnveloped(mock, 'cert-default');

  // 수신자는 다른 키
  const receiverKem = await PQCShield.init();
  const receiverDsa = await PQCSigner.init();
  const receiverBridge = new PQCBridge(receiverKem, receiverDsa, pqcConfig);

  const result = await receiverBridge.unwrapEnveloped(wrapped, 'cert-default');
  assert(result.path === 'rsa-fallback', `8-b. fallback 경로: ${result.path}`);
  assert(result.message?.includes('RSA'), `8-c. fallback 메시지: ${result.message}`);
}

// ══ MAIN ══

async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  PKIZIP PQC v2 통합 테스트 (8 시나리오)          ║');
  console.log('║  ML-KEM-1024 + ML-DSA-87                        ║');
  console.log('╚══════════════════════════════════════════════════╝');

  const t = performance.now();
  await s1(); await s2(); await s3(); await s4();
  await s5(); await s6(); await s7(); await s8();
  const elapsed = ((performance.now() - t) / 1000).toFixed(2);

  console.log(`\n══════════════════════════════════════`);
  console.log(`  결과: ${passed} passed, ${failed} failed  (${elapsed}s)`);
  console.log(`══════════════════════════════════════\n`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
