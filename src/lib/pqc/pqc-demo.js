/**
 * pqc-demo.js v3 — 10 시나리오 통합 테스트
 * 실행: node src/lib/pqc/pqc-demo.js
 */

import { PQCDerive } from './pqc-derive.js';
import { PQCBundle } from './pqc-bundle.js';
import { PQCShield } from './pqc-shield.js';
import { PQCSigner } from './pqc-signer.js';
import { PQCBridge } from './pqc-bridge.js';
import pqcConfig from './pqc-config.json' with { type: 'json' };
import { generateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

let passed = 0, failed = 0;
function ok(c, m) { if (c) { console.log(`  ✅ ${m}`); passed++; } else { console.error(`  ❌ ${m}`); failed++; } }
function eq(a, b) { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; }

const MN = generateMnemonic(wordlist, 128);  // 12단어
const PW = 'testpassword123!';
const SUBJ = { name: 'TestUser', email: 'test@pkizip.io' };

async function s1() {
  console.log('\n═══ SCENARIO 1: 니모닉 → 2벌 PQC 키 결정론적 도출 ═══');
  const k1 = await PQCDerive.deriveAll(MN, PW);
  const k2 = await PQCDerive.deriveAll(MN, PW);
  ok(eq(k1.kem.secretKey, k2.kem.secretKey), '1-a. kem 결정론적 일치');
  ok(eq(k1.dsa.secretKey, k2.dsa.secretKey), '1-a. dsa 결정론적 일치');

  const k3 = await PQCDerive.deriveAll(MN, 'differentPW');
  ok(!eq(k1.kem.secretKey, k3.kem.secretKey), '1-b. 다른 PW → 다른 키');

  ok(k1.kem.secretKey.length === 3168, `1-c. kem secKey: ${k1.kem.secretKey.length}B`);
  ok(k1.dsa.secretKey.length === 4896, `1-c. dsa secKey: ${k1.dsa.secretKey.length}B`);
  ok(k1.kem._d.length === 32 && k1.kem._z.length === 32, '1-d. ML-KEM d(32)+z(32) 분할');
}

async function s2() {
  console.log('\n═══ SCENARIO 2: 번들 생성 및 로드 ═══');
  const bundle = await PQCBundle.create({ mnemonic: MN, password: PW, subject: SUBJ, mode: 'full' });
  ok(bundle.data.magic === 'PKIZIP-BUNDLE', '2-a. 번들 생성');
  ok(bundle.data.certificates.kem.includes('keyEncipherment'), '2-b. kem keyUsage');
  ok(bundle.data.certificates.dsa.includes('nonRepudiation'), '2-b. dsa keyUsage');
  ok(bundle.data.pqcHeader.pqcProtected === true, '2-c. pqcHeader');
  ok(!!bundle.getPqcKeyId(), `2-c. kemKeyId: ${bundle.getPqcKeyId()?.slice(0, 16)}...`);

  const json = bundle.serialize();
  const loaded = await PQCBundle.load(json, PW);
  ok(eq(loaded.getKEMKeyPair().secretKey, bundle.getKEMKeyPair().secretKey), '2-e. load 복호화');
}

async function s3() {
  console.log('\n═══ SCENARIO 3: 번들 복원 (니모닉 재생성) ═══');
  const orig = await PQCBundle.create({ mnemonic: MN, password: PW, subject: SUBJ });
  const rest = await PQCBundle.restore(MN, PW, { subject: SUBJ });
  ok(eq(rest.getKEMKeyPair().publicKey, orig.getKEMKeyPair().publicKey), '3-b. kem 공개키 일치');
  ok(eq(rest.getDSAKeyPair().publicKey, orig.getDSAKeyPair().publicKey), '3-b. dsa 공개키 일치');
}

async function s4() {
  console.log('\n═══ SCENARIO 4: config 계층 해석 ═══');
  const bundle = await PQCBundle.create({ mnemonic: MN, password: PW, subject: SUBJ });
  const bridge = new PQCBridge(bundle, PQCShield.fromBundle(bundle.getKEMKeyPair()), PQCSigner.fromBundle(bundle.getDSAKeyPair()), pqcConfig);
  ok(bridge.resolveKemConfig('unknown').mode === 'hybrid', '4-a. unknown → hybrid');
  ok(bridge.resolveKemConfig('cert-legacy-vendor').mode === 'classical', '4-b. legacy → classical');
  ok(bridge.resolveKemConfig('cert-internal-hsm').mode === 'pqc-only', '4-c. internal → pqc-only');
  const k4 = bridge.resolveKemConfig('cert-partner-kem-only');
  const d4 = bridge.resolveDsaConfig('cert-partner-kem-only');
  ok(k4.mode === 'hybrid' && d4.mode === 'classical', '4-d. partner kem=hybrid dsa=classical');
}

async function s5() {
  console.log('\n═══ SCENARIO 5: ML-KEM CEK 캡슐화/역캡슐화 ═══');
  const bundle = await PQCBundle.create({ mnemonic: MN, password: PW, subject: SUBJ });
  const shield = PQCShield.fromBundle(bundle.getKEMKeyPair());
  const cek = crypto.getRandomValues(new Uint8Array(32));
  const ri = await shield.encapsulateCEK(cek);
  ok(ri.type === 'ML-KEM-1024', `5-a. type: ${ri.type}`);
  ok(!!ri.rid.pqcKeyId, `5-b. pqcKeyId: ${ri.rid.pqcKeyId.slice(0, 16)}...`);
  ok(shield.isMyRecipientInfo(ri), '5-c. isMyRecipientInfo');
  const restored = await shield.decapsulateCEK(ri);
  ok(eq(restored, cek), '5-d. CEK 일치');
}

async function s6() {
  console.log('\n═══ SCENARIO 6: EnvelopedData 하이브리드 ═══');
  const bundle = await PQCBundle.create({ mnemonic: MN, password: PW, subject: SUBJ });
  const bridge = new PQCBridge(bundle, PQCShield.fromBundle(bundle.getKEMKeyPair()), PQCSigner.fromBundle(bundle.getDSAKeyPair()), pqcConfig);
  const cek = crypto.getRandomValues(new Uint8Array(32));
  const mock = { _cek: cek, recipientInfos: [{ type: 'RSA-OAEP' }] };
  const w = await bridge.wrapEnveloped(mock, 'x');
  ok(!!w.pqcKemRecipientInfo, '6-a. PQC RI 존재');
  ok(w.recipientInfos.length > 0, '6-a. RSA RI 유지');
  const u = await bridge.unwrapEnveloped(w);
  ok(u.path === 'pqc', `6-b. 경로: ${u.path}`);
  ok(eq(u.cek, cek), '6-b. CEK 일치');
}

async function s7() {
  console.log('\n═══ SCENARIO 7: EncryptedData 직접 암호화 ═══');
  const bundle = await PQCBundle.create({ mnemonic: MN, password: PW, subject: SUBJ });
  const bridge = new PQCBridge(bundle, PQCShield.fromBundle(bundle.getKEMKeyPair()), PQCSigner.fromBundle(bundle.getDSAKeyPair()), pqcConfig);
  const orig = crypto.getRandomValues(new Uint8Array(65536));
  const t0 = performance.now();
  const enc = await bridge.encryptData(orig, 'x');
  const encMs = (performance.now() - t0).toFixed(1);
  ok(enc.pqcHeader?.pqcProtected === true, '7-b. pqcProtected');
  const t1 = performance.now();
  const dec = await bridge.decryptData(enc);
  const decMs = (performance.now() - t1).toFixed(1);
  ok(eq(dec, orig), `7-a. 원본 일치 (${orig.length}B)`);
  console.log(`  ⏱ 암호화: ${encMs}ms, 복호화: ${decMs}ms`);
}

async function s8() {
  console.log('\n═══ SCENARIO 8: ML-DSA-87 전자서명 ═══');
  const bundle = await PQCBundle.create({ mnemonic: MN, password: PW, subject: SUBJ });
  const signer = PQCSigner.fromBundle(bundle.getDSAKeyPair());
  const data = crypto.getRandomValues(new Uint8Array(512));
  const sig = await signer.sign(data);
  ok(sig.signature.length === 4627, `8-a. sig: ${sig.signature.length}B`);
  const vr = await signer.verify(data, sig);
  ok(vr.valid, `8-b. verify: ${vr.valid}`);

  const bridge = new PQCBridge(bundle, PQCShield.fromBundle(bundle.getKEMKeyPair()), signer, pqcConfig);
  const content = new Uint8Array([1,2,3]);
  const sd = { _content: content, signerInfos: [{ algorithm: 'RSA-PSS' }] };
  const ws = await bridge.wrapSigned(sd, 'x');
  ok(!!ws.pqcSignerInfo, '8-c. PQCSignerInfo 존재');
  ok(ws.signerInfos.length > 0, '8-c. RSA 서명 유지');
  const vs = await bridge.verifySigned(ws);
  ok(vs.valid, `8-d. verifySigned: ${vs.valid}`);
}

async function s9() {
  console.log('\n═══ SCENARIO 9: 변조 감지 ═══');
  const bundle = await PQCBundle.create({ mnemonic: MN, password: PW, subject: SUBJ });
  const bridge = new PQCBridge(bundle, PQCShield.fromBundle(bundle.getKEMKeyPair()), PQCSigner.fromBundle(bundle.getDSAKeyPair()), pqcConfig);
  const enc = await bridge.encryptData(new Uint8Array([1,2,3]), 'x');
  const t = { ...enc, ciphertext: new Uint8Array(enc.ciphertext) };
  t.ciphertext[0] ^= 0xFF;
  try { await bridge.decryptData(t); ok(false, '9-a. 미감지'); } catch { ok(true, '9-a. 암호문 변조 감지'); }

  const signer = PQCSigner.fromBundle(bundle.getDSAKeyPair());
  const sig = await signer.sign(new Uint8Array([1,2,3]));
  const vr = await signer.verify(new Uint8Array([1,2,99]), sig);
  ok(!vr.valid, `9-b. 서명 변조 감지: valid=${vr.valid}`);
}

async function s10() {
  console.log('\n═══ SCENARIO 10: RSA Fallback ═══');
  const b1 = await PQCBundle.create({ mnemonic: generateMnemonic(wordlist, 128), password: PW, subject: SUBJ });
  const br1 = new PQCBridge(b1, PQCShield.fromBundle(b1.getKEMKeyPair()), PQCSigner.fromBundle(b1.getDSAKeyPair()), pqcConfig);
  const cek = crypto.getRandomValues(new Uint8Array(32));
  const w = await br1.wrapEnveloped({ _cek: cek, recipientInfos: [{ type: 'RSA-OAEP' }] }, 'x');

  const b2 = await PQCBundle.create({ mnemonic: generateMnemonic(wordlist, 128), password: PW, subject: SUBJ });
  const br2 = new PQCBridge(b2, PQCShield.fromBundle(b2.getKEMKeyPair()), PQCSigner.fromBundle(b2.getDSAKeyPair()), pqcConfig);
  const u = await br2.unwrapEnveloped(w);
  ok(u.path === 'rsa-fallback', `10-a. fallback: ${u.path}`);
}

async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  PKIZIP PQC v3 — 10 시나리오 통합 테스트          ║');
  console.log('║  ML-KEM-1024 + ML-DSA-87                           ║');
  console.log('╚══════════════════════════════════════════════════╝');
  const t = performance.now();
  await s1(); await s2(); await s3(); await s4(); await s5();
  await s6(); await s7(); await s8(); await s9(); await s10();
  const e = ((performance.now() - t) / 1000).toFixed(2);

  console.log(`\n══════════════════════════════════════`);
  console.log(`  결과: ${passed} passed, ${failed} failed  (${e}s)`);

  // 키 크기 요약
  const k = await PQCDerive.deriveAll(MN, PW);
  console.log(`\n  키 크기 요약:`);
  console.log(`    ML-KEM-1024 secKey: ${k.kem.secretKey.length}B / pubKey : ${k.kem.publicKey.length}B`);
  console.log(`    ML-DSA-87 secKey  : ${k.dsa.secretKey.length}B / pubKey : ${k.dsa.publicKey.length}B`);
  console.log(`══════════════════════════════════════\n`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
