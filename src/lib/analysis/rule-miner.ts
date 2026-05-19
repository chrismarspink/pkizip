/**
 * Rule Mining — 사용자 결정 이력에서 가중치 보정 후보 자동 추출.
 *
 * HE-TEST `rule_mining.py` 의 클라이언트 포팅.
 * IndexedDB 의 decision-store 에서 signedDelta != 0 인 결정만 분석 (사용자가
 * AI 와 다른 등급 채택한 케이스) → 자주 등장한 entity/keyword 추출 → 가중치
 * 보정 후보 제시.
 *
 * 출력은 권장사항만 — 자동 반영은 X. 관리자가 검토 후 classifier.ts 의
 * ENTITY_WEIGHTS / GRADE_KEYWORDS 에 반영하는 워크플로.
 */
import { listDecisions } from '../learning/decision-store';
import type { Decision } from '../learning/decision-store';

export interface MiningCandidate {
  /** 'entity:KR_RRN' | 'keyword:대외비' */
  signal: string;
  kind: 'entity' | 'keyword' | 'unknown';
  /** entity name 또는 keyword text */
  label: string;
  /** 이 신호가 등장한 결정 수 */
  count: number;
  /** signedDelta 평균 — 양수면 AI 가 너무 낮게 평가 (가중치 ↑ 권장) */
  avgDelta: number;
  /** 가중치 보정 방향 — 사용자 결정이 일관되게 한쪽으로 치우치는지 */
  direction: 'increase' | 'decrease' | 'mixed';
  /** 현재 weight (classifier.ts ENTITY_WEIGHTS / GRADE_KEYWORDS 에서 lookup) */
  currentWeight?: number;
  /** 권장 보정량 — direction · |avgDelta| · 0.5 */
  suggestedDelta: number;
  /** 신뢰도 (count 와 일관성 기반) */
  confidence: number;
}

export interface MiningReport {
  evaluatedAt: number;
  totalDecisions: number;
  disagreements: number;
  candidates: MiningCandidate[];
  /** 처리 노트 — UI 에서 사용자에게 보여줄 한 줄 요약 */
  summary: string;
}

export interface MiningOptions {
  /** 최소 등장 빈도 — 이보다 적게 등장한 신호는 무시 */
  minCount?: number;
  /** signedDelta 평균 절대값 최소치 — 이보다 작으면 양방향 mixed 로 본다 */
  minAvgDelta?: number;
  /** 평가 대상 최대 결정 수 */
  maxDecisions?: number;
}

/**
 * 결정 이력에서 가중치 후보 추출.
 */
export async function mineCandidates(opts: MiningOptions = {}): Promise<MiningReport> {
  const {
    minCount = 3,
    minAvgDelta = 0.5,
    maxDecisions = 1000,
  } = opts;
  const all = await listDecisions(maxDecisions);
  const disagreements = all.filter(d => d.signedDelta !== 0);

  if (disagreements.length === 0) {
    return {
      evaluatedAt: Date.now(),
      totalDecisions: all.length,
      disagreements: 0,
      candidates: [],
      summary: '사용자 결정 vs AI 등급 모두 일치 — 보정 불필요.',
    };
  }

  // signal → { deltas[], count }
  const signals = new Map<string, { kind: 'entity' | 'keyword' | 'unknown'; label: string; deltas: number[] }>();

  for (const d of disagreements) {
    // entity signals
    for (const f of d.findings || []) {
      const key = `entity:${f.entityType}`;
      const cur = signals.get(key);
      if (cur) cur.deltas.push(d.signedDelta);
      else signals.set(key, { kind: 'entity', label: f.entityType, deltas: [d.signedDelta] });
    }
    // keyword signals — reasons 의 keyword kind
    for (const r of d.ai?.reasons || []) {
      if (r.kind !== 'keyword') continue;
      const key = `keyword:${r.label}`;
      const cur = signals.get(key);
      if (cur) cur.deltas.push(d.signedDelta);
      else signals.set(key, { kind: 'keyword', label: r.label, deltas: [d.signedDelta] });
    }
  }

  const candidates: MiningCandidate[] = [];
  for (const [signal, { kind, label, deltas }] of signals) {
    if (deltas.length < minCount) continue;

    const avgDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    const stdDev = Math.sqrt(
      deltas.reduce((s, x) => s + (x - avgDelta) ** 2, 0) / deltas.length
    );

    let direction: MiningCandidate['direction'];
    if (Math.abs(avgDelta) < minAvgDelta) direction = 'mixed';
    else if (avgDelta > 0) direction = 'increase';
    else direction = 'decrease';

    // 신뢰도 — count 가 많고 stdDev 가 낮으면 ↑
    const countScore = Math.min(1, deltas.length / 20);
    const consistency = Math.max(0, 1 - stdDev / 2);
    const confidence = Math.round(countScore * consistency * 1000) / 1000;

    candidates.push({
      signal,
      kind,
      label,
      count: deltas.length,
      avgDelta: Math.round(avgDelta * 1000) / 1000,
      direction,
      suggestedDelta: Math.round(avgDelta * 0.5 * 100) / 100,
      confidence,
    });
  }

  // 정렬 — confidence 내림차순
  candidates.sort((a, b) => b.confidence - a.confidence);

  const increase = candidates.filter(c => c.direction === 'increase').length;
  const decrease = candidates.filter(c => c.direction === 'decrease').length;
  const mixed = candidates.filter(c => c.direction === 'mixed').length;

  return {
    evaluatedAt: Date.now(),
    totalDecisions: all.length,
    disagreements: disagreements.length,
    candidates,
    summary:
      `${all.length}건 중 ${disagreements.length}건 불일치 — ` +
      `보정 후보 ${candidates.length}개 ` +
      `(가중치 ↑ ${increase} · 가중치 ↓ ${decrease} · 양방향 ${mixed}).`,
  };
}

/**
 * 단위 테스트용 — 가상 Decision 배열로 mining 시뮬.
 */
export function _testMineFromDecisions(decisions: Decision[]): MiningReport {
  const disagreements = decisions.filter(d => d.signedDelta !== 0);
  const signals = new Map<string, { kind: 'entity' | 'keyword' | 'unknown'; label: string; deltas: number[] }>();

  for (const d of disagreements) {
    for (const f of d.findings || []) {
      const key = `entity:${f.entityType}`;
      const cur = signals.get(key);
      if (cur) cur.deltas.push(d.signedDelta);
      else signals.set(key, { kind: 'entity', label: f.entityType, deltas: [d.signedDelta] });
    }
  }

  const candidates: MiningCandidate[] = [];
  for (const [signal, { kind, label, deltas }] of signals) {
    if (deltas.length < 2) continue;
    const avgDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    let direction: MiningCandidate['direction'] = 'mixed';
    if (avgDelta > 0.5) direction = 'increase';
    else if (avgDelta < -0.5) direction = 'decrease';
    candidates.push({
      signal, kind, label,
      count: deltas.length,
      avgDelta: Math.round(avgDelta * 1000) / 1000,
      direction,
      suggestedDelta: Math.round(avgDelta * 0.5 * 100) / 100,
      confidence: Math.min(1, deltas.length / 10),
    });
  }
  candidates.sort((a, b) => b.confidence - a.confidence);

  return {
    evaluatedAt: Date.now(),
    totalDecisions: decisions.length,
    disagreements: disagreements.length,
    candidates,
    summary: `${decisions.length}건 중 ${disagreements.length}건 불일치 — 보정 후보 ${candidates.length}개.`,
  };
}
