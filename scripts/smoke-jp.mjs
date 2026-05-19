#!/usr/bin/env node
/**
 * 일본어 분류 smoke test — ko/ja/en/mixed 4개 sample 통과 검증.
 * Node 직접 실행 — tsx 로 .ts 로딩.
 */
import { readFileSync } from 'node:fs';
import { detect } from '../src/lib/analysis/pii-detector.ts';
import { classify } from '../src/lib/analysis/classifier.ts';
import { evaluateJpCompliance, buildJpBreachDraft } from '../src/lib/analysis/compliance-jp.ts';
import { filterNerFindings } from '../src/lib/analysis/ner-filter.ts';
import { mapKoLabel } from '../src/lib/analysis/ko-ner.ts';
import { _testKL } from '../src/lib/analysis/drift-monitor.ts';
import { _testMineFromDecisions } from '../src/lib/analysis/rule-miner.ts';
import { _testFit, calibrate, expectedCalibrationError } from '../src/lib/analysis/platt-calibrator.ts';
import { _testStats } from '../src/lib/analysis/perf-tracker.ts';
import { evaluate, evaluateAll, buildBreachDraft, JURISDICTIONS } from '../src/lib/analysis/compliance.ts';
import { _testPartitionTokens } from '../src/lib/analysis/shap-partition.ts';
import { _testEnsemble } from '../src/lib/analysis/neural-ensemble.ts';

const SAMPLES = [
  { label: '🇰🇷 ko', path: 'test-data/samples/ko/sample_01.txt' },
  { label: '🇯🇵 ja', path: 'test-data/samples/ja/sample_02.txt' },  // 機密 + マイナンバー 포함
  { label: '🇺🇸 en', path: 'test-data/samples/en/sample_01.txt' },
  { label: '🌐 mixed', path: 'test-data/samples/mixed/sample_01.txt' },
];

for (const s of SAMPLES) {
  console.log(`\n${'='.repeat(72)}\n${s.label}  ${s.path}\n${'='.repeat(72)}`);
  const text = readFileSync(s.path, 'utf-8');
  console.log(`chars: ${text.length}`);

  const findings = detect(text);
  console.log(`\n[1] PII findings: ${findings.length}`);
  const byType = {};
  for (const f of findings) byType[f.entityType] = (byType[f.entityType] || 0) + 1;
  for (const [et, n] of Object.entries(byType).sort((a,b) => b[1]-a[1])) {
    console.log(`    ${et}: ${n}`);
  }

  const { kept } = filterNerFindings(findings);
  console.log(`\n[2] NER filter: ${findings.length} → ${kept.length}`);

  const cls = classify(kept, text);
  console.log(`\n[3] Classification:`);
  console.log(`    grade: ${cls.grade} (${cls.gradeLabel})`);
  console.log(`    score: ${cls.score} · confidence: ${cls.confidence}`);
  const top = cls.reasons
    .filter(r => r.contribution > 0)
    .sort((a,b) => b.contribution - a.contribution)
    .slice(0, 3);
  console.log(`    top signals:`);
  for (const r of top) console.log(`      · ${r.label} +${r.contribution} (${r.kind})`);

  // 일본어 sample 이면 APPI 매핑 + 漏洩等報告 초안
  if (s.label.includes('ja') || s.label.includes('mixed')) {
    const compliance = evaluateJpCompliance(kept);
    console.log(`\n[4] APPI Compliance:`);
    console.log(`    verdict: ${compliance.verdict}`);
    console.log(`    has マイナンバー: ${compliance.hasMyNumber}`);
    console.log(`    rationale: ${compliance.rationale}`);
    const used = Object.entries(compliance.buckets)
      .filter(([,v]) => v.length > 0)
      .map(([k, v]) => `${k}=${[...new Set(v)].join('/')}`)
      .join('  ');
    console.log(`    buckets: ${used}`);

    if (compliance.hasMyNumber) {
      const draft = buildJpBreachDraft(s.path, kept, cls);
      console.log(`\n[5] PPC 漏洩等報告 draft:`);
      console.log(`    severity: ${draft.severity}`);
      console.log(`    summary: ${draft.summary}`);
      console.log(`    secondary risk: ${draft.secondaryRisk.slice(0, 80)}`);
    }
  }
}

// ─────────────────────────────────────────────
// ko-ner mapKoLabel unit checks
// ─────────────────────────────────────────────
console.log(`\n${'='.repeat(72)}\nko-ner.mapKoLabel — 라벨 매핑\n${'='.repeat(72)}`);
const labelCases = [
  // 모두의말뭉치 스킴
  ['PS', 'PERSON'], ['LC', 'LOCATION'], ['OG', 'ORGANIZATION'], ['DT', 'DATE_TIME'],
  // HuggingFace 표준
  ['PER', 'PERSON'], ['LOC', 'LOCATION'], ['ORG', 'ORGANIZATION'],
  // BIO 접두
  ['B-PER', 'PERSON'], ['I-LOC', 'LOCATION'], ['E-ORG', 'ORGANIZATION'],
  // 미지 라벨
  ['MISC', null], ['', null], [undefined, null],
];
let pass = 0, fail = 0;
for (const [input, expected] of labelCases) {
  const got = mapKoLabel(input);
  const ok = got === expected;
  const inputStr = JSON.stringify(input) || 'undefined';
  console.log(`  ${ok ? '✓' : '✗'}  ${inputStr.padEnd(10)} → ${got}  ${ok ? '' : `(expected ${expected})`}`);
  if (ok) pass++; else fail++;
}
console.log(`  Result: ${pass}/${pass + fail} pass`);

// ─────────────────────────────────────────────
// drift-monitor KL divergence test
// ─────────────────────────────────────────────
console.log(`\n${'='.repeat(72)}\ndrift-monitor — KL divergence\n${'='.repeat(72)}`);
// 동일 분포 → KL ≈ 0
const same = _testKL({a:10,b:20,c:30}, {a:10,b:20,c:30}, ['a','b','c']);
// 다른 분포 → KL > 0
const diff = _testKL({a:30,b:10,c:10}, {a:10,b:20,c:30}, ['a','b','c']);
// 매우 다른 분포 → KL ≫ 0
const veryDiff = _testKL({a:50,b:0,c:0}, {a:0,b:0,c:50}, ['a','b','c']);
console.log(`  동일 분포   KL = ${same}  (≈0 기대)`);
console.log(`  다른 분포   KL = ${diff}  (>0.1 기대)`);
console.log(`  매우 다름   KL = ${veryDiff}  (>1.0 기대)`);
console.log(`  drift 임계 0.3 ${diff > 0.3 ? '초과' : '이내'} / ${veryDiff > 0.3 ? '초과' : '이내'}`);

// ─────────────────────────────────────────────
// Rule Miner — 가상 결정 이력에서 후보 추출
// ─────────────────────────────────────────────
console.log(`\n${'='.repeat(72)}\nrule-miner — Active Learning 후보 추출\n${'='.repeat(72)}`);
// 가상 결정: 사용자가 KR_RRN 있는 문서를 일관되게 더 높은 등급으로 올림
const mockDecisions = [
  { id: 'a', ts: 1, textHash: 'h1', textLength: 100, signedDelta: 1,
    ai: { grade: 'S', score: 4, confidence: 0.7, version: 'rule-v1', reasons: [] },
    user: { grade: 'C', gap: 1 },
    findings: [{ entityType: 'KR_RRN', text: '...', score: 0.95 }] },
  { id: 'b', ts: 2, textHash: 'h2', textLength: 100, signedDelta: 1,
    ai: { grade: 'S', score: 4.5, confidence: 0.7, version: 'rule-v1', reasons: [] },
    user: { grade: 'C', gap: 1 },
    findings: [{ entityType: 'KR_RRN', text: '...', score: 0.95 }] },
  { id: 'c', ts: 3, textHash: 'h3', textLength: 100, signedDelta: 1,
    ai: { grade: 'S', score: 4, confidence: 0.7, version: 'rule-v1', reasons: [] },
    user: { grade: 'C', gap: 1 },
    findings: [{ entityType: 'KR_RRN', text: '...', score: 0.95 }] },
  // EMAIL — 사용자가 일관되게 등급 내림
  { id: 'd', ts: 4, textHash: 'h4', textLength: 100, signedDelta: -1,
    ai: { grade: 'S', score: 3, confidence: 0.7, version: 'rule-v1', reasons: [] },
    user: { grade: 'O', gap: 1 },
    findings: [{ entityType: 'EMAIL_ADDRESS', text: '...', score: 0.9 }] },
  { id: 'e', ts: 5, textHash: 'h5', textLength: 100, signedDelta: -1,
    ai: { grade: 'S', score: 3, confidence: 0.7, version: 'rule-v1', reasons: [] },
    user: { grade: 'O', gap: 1 },
    findings: [{ entityType: 'EMAIL_ADDRESS', text: '...', score: 0.9 }] },
];
const miningReport = _testMineFromDecisions(mockDecisions);
console.log(`  ${miningReport.summary}`);
for (const c of miningReport.candidates) {
  console.log(`  · ${c.signal.padEnd(28)} count=${c.count} avgΔ=${c.avgDelta} → ${c.direction} (conf=${c.confidence})`);
}

// ─────────────────────────────────────────────
// Platt Calibration — fit + ECE
// ─────────────────────────────────────────────
console.log(`\n${'='.repeat(72)}\nplatt-calibrator — sigmoid fit\n${'='.repeat(72)}`);
// 가상 학습 데이터: score 가 높을수록 label=1 비율 ↑
const plattSamples = [];
for (let i = 0; i < 100; i++) {
  const score = Math.random() * 10;
  // score 가 5 이상이면 80% 확률로 label=1
  const label = (score > 5 ? (Math.random() < 0.8 ? 1 : 0) : (Math.random() < 0.2 ? 1 : 0));
  plattSamples.push({ score, label });
}
const params = _testFit(plattSamples);
console.log(`  fit result: A=${params.A.toFixed(3)} B=${params.B.toFixed(3)} n=${params.n} ECE=${params.ece}`);
// 보정 확인: score 8 → high prob, score 2 → low prob
const p8 = calibrate(8, params);
const p2 = calibrate(2, params);
console.log(`  calibrate(score=8) = ${p8.toFixed(3)}  (높음 기대)`);
console.log(`  calibrate(score=2) = ${p2.toFixed(3)}  (낮음 기대)`);
console.log(`  방향성 정상: ${p8 > p2 ? '✓ score↑ → prob↑' : '✗ 방향 반대!'}`);

// ─────────────────────────────────────────────
// Perf Tracker — stage 통계
// ─────────────────────────────────────────────
console.log(`\n${'='.repeat(72)}\nperf-tracker — stage 통계\n${'='.repeat(72)}`);
const mockEvents = [
  { id: '1', ts: 1, stage: 'pii-detect',   durationMs: 12 },
  { id: '2', ts: 2, stage: 'pii-detect',   durationMs: 15 },
  { id: '3', ts: 3, stage: 'pii-detect',   durationMs: 8  },
  { id: '4', ts: 4, stage: 'ai-classify',  durationMs: 240 },
  { id: '5', ts: 5, stage: 'ai-classify',  durationMs: 180 },
  { id: '6', ts: 6, stage: 'ai-classify',  durationMs: 320 },
  { id: '7', ts: 7, stage: 'anonymize',    durationMs: 5 },
  { id: '8', ts: 8, stage: 'anonymize',    durationMs: 4 },
];
const stats = _testStats(mockEvents);
for (const s of stats) {
  console.log(`  · ${s.stage.padEnd(15)} n=${s.n}  mean=${s.meanMs}ms  p50=${s.p50Ms}ms  p95=${s.p95Ms}ms  max=${s.maxMs}ms`);
}

// ─────────────────────────────────────────────
// M5 — 4관할 컴플라이언스
// ─────────────────────────────────────────────
console.log(`\n${'='.repeat(72)}\nM5 — 4관할 컴플라이언스 (compliance.ts)\n${'='.repeat(72)}`);
{
  const text = readFileSync('test-data/samples/mixed/sample_01.txt', 'utf-8');
  const findings = detect(text);
  const cls = classify(findings, text);

  console.log(`\nJURISDICTIONS 등록: ${JURISDICTIONS.map(j => j.flag + j.code).join(' · ')}`);
  console.log(`\n4관할 동시 평가 (mixed sample, ${findings.length}건):`);
  const all = evaluateAll(findings, { affectedSubjects: 1500 });
  for (const j of ['kr','us','jp','eu']) {
    const r = all[j];
    console.log(`  ${j.toUpperCase()}  verdict=${r.verdict.padEnd(13)}  ${r.rationale.slice(0, 60)}`);
  }

  // 각 관할 breach draft 헤더만
  console.log(`\n관할별 유출신고 양식 헤더:`);
  for (const j of ['kr','us','jp','eu']) {
    const draft = buildBreachDraft(j, 'mixed-sample.txt', findings, {
      classification: cls,
      affectedSubjects: 1500,
      affectedIndividuals: 1500,
    });
    const reportType = draft.reportType || draft['보고서종류'];
    const severity = draft.severity;
    console.log(`  ${j.toUpperCase()}  severity=${String(severity).padEnd(20)}  ${String(reportType).slice(0, 50)}`);
  }
}

// ─────────────────────────────────────────────
// M6 — SHAP partition tree
// ─────────────────────────────────────────────
console.log(`\n${'='.repeat(72)}\nM6 — SHAP partition tree (shap-partition.ts)\n${'='.repeat(72)}`);
{
  const text = '주민번호 850506-1234567 과 AKIAIOSFODNN7EXAMPLE 자격증명이 노출됨.';
  const findings = detect(text);
  const cls = classify(findings, text);
  console.log(`base: grade=${cls.grade} score=${cls.score} findings=${findings.length}`);
  const result = _testPartitionTokens(text, cls, 16);
  console.log(`partition tree — totalTokens=${result.totalTokens} evaluated=${result.evaluated} maxAbs=${result.maxAbsDelta} (${result.elapsedMs}ms)`);
  const top = [...result.tokens].sort((a,b) => Math.abs(b.scoreDelta) - Math.abs(a.scoreDelta)).slice(0, 5);
  console.log(`top 5 토큰 (단독 + group bonus):`);
  for (const t of top) {
    console.log(`  · "${t.token.padEnd(24)}" δ=${t.scoreDelta.toString().padStart(7)}  group=${t.groupBonus}`);
  }
}

// ─────────────────────────────────────────────
// M7 — Neural Ensemble
// ─────────────────────────────────────────────
console.log(`\n${'='.repeat(72)}\nM7 — Neural Ensemble (neural-ensemble.ts)\n${'='.repeat(72)}`);
{
  const text = '김철수 부장 (010-1234-5678) — 한화에어로스페이스 회의.';
  const ruleFindings = detect(text);
  // 신경망이 추가로 잡았다고 가정한 PERSON/ORG findings
  const neuralFindings = [
    { entityType: 'PERSON', start: 0, end: 3, score: 0.91, text: '김철수', source: 'koner', recognizer: 'ko-ner' },
    { entityType: 'ORGANIZATION', start: 21, end: 31, score: 0.88, text: '한화에어로스페이스', source: 'koner', recognizer: 'ko-ner' },
  ];
  const ens = _testEnsemble(text, ruleFindings, neuralFindings, 0.6);
  console.log(`rule score=${ens.ruleScore}  neural score=${ens.neuralScore}  ensemble=${ens.ensembleScore}`);
  console.log(`rule grade=${ens.ruleClassification.grade}  → final=${ens.finalGrade}  agreement=${ens.agreement}`);
  console.log(`α=${ens.alpha} (rule 가중치)  neural findings=${ens.neuralFindings.length}`);
}

console.log(`\n${'='.repeat(72)}\n✅ smoke complete (M2-M7 전체)\n`);
