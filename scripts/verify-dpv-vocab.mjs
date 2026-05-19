#!/usr/bin/env node
/**
 * DPV 어휘 검증 — PKIZIP 의 매핑한 IRI 가 실제 W3C DPV v2 에 존재하는지 확인.
 *
 * 사용법:
 *   node scripts/verify-dpv-vocab.mjs
 *
 * 종료 코드:
 *   0: 모든 IRI 가 실제 DPV 어휘에 존재
 *   1: 누락된 IRI 발견 (출력에 명시)
 *   2: 어휘 다운로드 실패
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const DPV_JSONLD_URL = 'https://w3id.org/dpv/v2/dpv.jsonld';
const DPV_OWL_URL    = 'https://w3id.org/dpv/v2/dpv.ttl';
// 일부 IRI 는 DPV 코어가 아닌 확장 (DPV-PI, DPV-LEGAL 등) 에 있을 수 있음.
// 검증은 코어 + 다음 확장에서 검색.
const EXTENSIONS = [
  'https://w3id.org/dpv/pd/v2/pd.jsonld',  // Personal Data extension
];

// PKIZIP 매핑 파일에서 IRI 추출 (간단 정규식 — 형식 고정 가정)
function extractMappedIris() {
  const files = [
    'src/lib/policy/standards/dpv-data-category.ts',
    'src/lib/policy/standards/dpv-processing-activity.ts',
    'src/lib/policy/standards/dpv-applied-measure.ts',
    'src/lib/policy/standards/dpv-labels.ts',
  ];
  const iris = new Set();
  for (const f of files) {
    const content = readFileSync(join(ROOT, f), 'utf8');
    // 'dpv:Foo' 패턴
    const matches = content.matchAll(/'(dpv:[A-Z][A-Za-z]+)'/g);
    for (const m of matches) iris.add(m[1]);
  }
  return [...iris].sort();
}

async function fetchJsonld(url) {
  const res = await fetch(url, { headers: { Accept: 'application/ld+json,application/json' } });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return await res.json();
}

// JSON-LD 그래프에서 dpv: prefix 의 모든 정의된 클래스/속성 추출
function extractKnownIris(jsonld) {
  const out = new Set();
  const graph = jsonld['@graph'] || [];
  for (const node of graph) {
    const id = node['@id'];
    if (typeof id !== 'string') continue;
    // 'dpv:Foo' 또는 'https://w3id.org/dpv#Foo'
    if (id.startsWith('dpv:')) {
      out.add(id);
    } else if (id.includes('w3id.org/dpv') && id.includes('#')) {
      const localName = id.split('#').pop();
      if (localName) out.add(`dpv:${localName}`);
    }
  }
  return out;
}

async function main() {
  const mapped = extractMappedIris();
  console.log(`📋 PKIZIP 매핑된 IRI: ${mapped.length}개`);
  console.log(mapped.map(i => `  ${i}`).join('\n'));
  console.log();

  console.log(`📡 DPV 어휘 다운로드 (${DPV_JSONLD_URL})...`);
  let known = new Set();
  try {
    const core = await fetchJsonld(DPV_JSONLD_URL);
    known = extractKnownIris(core);
    console.log(`  코어 어휘: ${known.size}개 IRI 정의됨`);
  } catch (e) {
    console.error(`❌ 어휘 다운로드 실패: ${e.message}`);
    process.exit(2);
  }

  // 확장 시도 (실패해도 무시 — 코어만으로 충분한 경우 많음)
  for (const url of EXTENSIONS) {
    try {
      const ext = await fetchJsonld(url);
      const extIris = extractKnownIris(ext);
      console.log(`  확장 ${url.split('/').slice(-2)[0]}: ${extIris.size}개 추가`);
      for (const i of extIris) known.add(i);
    } catch (e) {
      console.warn(`  확장 다운로드 실패 (무시): ${url} → ${e.message}`);
    }
  }
  console.log();

  // 검증
  const missing = mapped.filter(iri => !known.has(iri));
  const present = mapped.filter(iri => known.has(iri));

  console.log(`✅ 일치: ${present.length}/${mapped.length}`);
  if (present.length > 0) {
    console.log(present.map(i => `  ✅ ${i}`).join('\n'));
  }

  if (missing.length > 0) {
    console.log();
    console.log(`⚠ 어휘에 없음: ${missing.length}개`);
    console.log(missing.map(i => `  ❌ ${i}`).join('\n'));
    console.log();
    console.log('가능한 원인:');
    console.log('  1) DPV 확장 (DPV-PI, DPV-LEGAL) 에 있는 IRI — 매핑 위치 재검토');
    console.log('  2) DPV 표준 미등재 IRI — 가장 가까운 표준 IRI 로 변경 필요');
    console.log('  3) DPV 어휘 파일 형식 변경 — 검증 스크립트 업데이트 필요');
    process.exit(1);
  }

  console.log();
  console.log('🎉 모든 매핑된 IRI 가 W3C DPV v2 어휘에 존재합니다.');
  process.exit(0);
}

main().catch(e => {
  console.error('❌ 예외:', e);
  process.exit(2);
});
