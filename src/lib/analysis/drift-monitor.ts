/**
 * Drift Detection — 분류기 성능 저하 자동 감지.
 *
 * HE-TEST `drift_detection.py` 의 클라이언트 포팅.
 * IndexedDB 의 decision-store 에서 최근 결정 vs 과거 baseline 의 분포를
 * KL-divergence 로 비교 — 임계값 초과 시 "재학습 권장" 알림.
 *
 * 분포 축:
 *   1) signedDelta — AI 와 사용자 등급 차이 분포 (학습 신호)
 *   2) grade — AI 가 부여한 등급 분포 (등급별 비율 추이)
 *
 * 사용:
 *   const report = await detectDrift();
 *   if (report.drifted) showRetrainBanner(report);
 */
import { listDecisions } from '../learning/decision-store';
import type { Grade } from './types';

export interface DriftReport {
  /** 평가 일시 */
  evaluatedAt: number;
  /** baseline 샘플 수 (사용 가능한 최근 데이터에서 분할) */
  baselineN: number;
  /** recent 샘플 수 */
  recentN: number;
  /** signedDelta 분포 비교 — 학습 신호 변화 */
  deltaKL: number;
  /** grade 분포 비교 — 등급 비율 변화 */
  gradeKL: number;
  /** drift 발생 여부 (deltaKL 또는 gradeKL 이 threshold 초과) */
  drifted: boolean;
  /** 권장 조치 */
  recommendation: string;
  /** raw 분포 (UI 시각화용) */
  distributions: {
    baseline: {
      delta: Record<string, number>;
      grade: Record<Grade, number>;
    };
    recent: {
      delta: Record<string, number>;
      grade: Record<Grade, number>;
    };
  };
  /** 비교 불가 이유 (drifted=false 면) */
  reason?: 'insufficient_data' | 'no_disagreement' | 'within_threshold';
}

const DEFAULT_KL_THRESHOLD = 0.3;
const MIN_SAMPLES_PER_BUCKET = 20;
const RECENT_RATIO = 0.3;  // 최근 30% / baseline 70%

/**
 * 분포를 정규화하여 확률 분포로 변환 — Laplace smoothing (α=0.01) 적용.
 */
function normalize<K extends string>(
  counts: Record<K, number>,
  keys: K[]
): Record<K, number> {
  const alpha = 0.01;
  const total = keys.reduce((s, k) => s + (counts[k] || 0), 0);
  const denom = total + alpha * keys.length;
  const out = {} as Record<K, number>;
  for (const k of keys) {
    out[k] = ((counts[k] || 0) + alpha) / denom;
  }
  return out;
}

/**
 * Kullback-Leibler divergence — D(P||Q) = Σ p_i · log(p_i / q_i).
 * P=recent, Q=baseline 으로 계산 — 최근 분포가 과거 대비 얼마나 멀어졌는가.
 */
function kullbackLeibler<K extends string>(
  P: Record<K, number>,
  Q: Record<K, number>,
  keys: K[]
): number {
  let sum = 0;
  for (const k of keys) {
    const p = P[k];
    const q = Q[k];
    if (p > 0 && q > 0) sum += p * Math.log(p / q);
  }
  return Math.round(sum * 1000) / 1000;
}

/**
 * Decision 배열에서 signedDelta 분포 추출.
 */
function deltaDistribution(decisions: Array<{ signedDelta: number }>): Record<string, number> {
  const out: Record<string, number> = { '-2': 0, '-1': 0, '0': 0, '1': 0, '2': 0 };
  for (const d of decisions) {
    const k = String(d.signedDelta);
    if (k in out) out[k] = (out[k] || 0) + 1;
  }
  return out;
}

/**
 * Decision 배열에서 grade 분포 추출 (AI 가 부여한 등급 기준).
 */
function gradeDistribution(decisions: Array<{ ai: { grade: Grade } }>): Record<Grade, number> {
  const out: Record<Grade, number> = { C: 0, S: 0, O: 0 };
  for (const d of decisions) {
    out[d.ai.grade] = (out[d.ai.grade] || 0) + 1;
  }
  return out;
}

export interface DetectDriftOptions {
  /** KL threshold — 초과 시 drifted=true */
  klThreshold?: number;
  /** 평가 대상 최대 결정 수 — 너무 많으면 baseline 이 stale */
  maxDecisions?: number;
}

/**
 * 메인 진입점 — IndexedDB 의 최근 결정 이력으로 drift 평가.
 */
export async function detectDrift(opts: DetectDriftOptions = {}): Promise<DriftReport> {
  const { klThreshold = DEFAULT_KL_THRESHOLD, maxDecisions = 1000 } = opts;
  const all = await listDecisions(maxDecisions);
  // 시간 역순으로 와있음 — 최신 N개가 앞쪽
  const now = Date.now();

  if (all.length < MIN_SAMPLES_PER_BUCKET * 2) {
    return {
      evaluatedAt: now,
      baselineN: 0,
      recentN: 0,
      deltaKL: 0,
      gradeKL: 0,
      drifted: false,
      recommendation: `학습 데이터 부족 — 결정 ${all.length}건. ` +
        `최소 ${MIN_SAMPLES_PER_BUCKET * 2}건 필요.`,
      distributions: {
        baseline: { delta: {}, grade: { C: 0, S: 0, O: 0 } },
        recent: { delta: {}, grade: { C: 0, S: 0, O: 0 } },
      },
      reason: 'insufficient_data',
    };
  }

  // RECENT_RATIO 비율로 분할 (최근 30% vs 과거 70%)
  const cutoff = Math.floor(all.length * RECENT_RATIO);
  const recent = all.slice(0, cutoff);
  const baseline = all.slice(cutoff);

  const deltaKeys = ['-2', '-1', '0', '1', '2'];
  const gradeKeys: Grade[] = ['C', 'S', 'O'];

  const baselineDelta = deltaDistribution(baseline);
  const recentDelta   = deltaDistribution(recent);
  const baselineGrade = gradeDistribution(baseline);
  const recentGrade   = gradeDistribution(recent);

  const baselineDeltaP = normalize(baselineDelta, deltaKeys);
  const recentDeltaP   = normalize(recentDelta, deltaKeys);
  const baselineGradeP = normalize(baselineGrade, gradeKeys);
  const recentGradeP   = normalize(recentGrade, gradeKeys);

  const deltaKL = kullbackLeibler(recentDeltaP, baselineDeltaP, deltaKeys);
  const gradeKL = kullbackLeibler(recentGradeP, baselineGradeP, gradeKeys);

  const drifted = deltaKL > klThreshold || gradeKL > klThreshold;

  let recommendation: string;
  let reason: DriftReport['reason'] | undefined;
  if (!drifted) {
    recommendation = `현재 KL=Δ${deltaKL}/G${gradeKL} 모두 임계 ${klThreshold} 이내. 안정.`;
    reason = 'within_threshold';
  } else if (deltaKL > klThreshold && gradeKL > klThreshold) {
    recommendation = `사용자 결정 패턴과 등급 분포 둘 다 변화 — ` +
      `학습 데이터 도메인 시프트 의심. rule 가중치 재검토 + 재학습 권장.`;
  } else if (deltaKL > klThreshold) {
    recommendation = `사용자가 AI 등급에 동의하지 않는 패턴 증가 (Δ KL=${deltaKL}). ` +
      `최근 ${recent.length}건 검토 + 키워드/엔티티 가중치 보정 권장.`;
  } else {
    recommendation = `AI 등급 분포 자체가 변화 (G KL=${gradeKL}). ` +
      `입력 문서 분포 변화 가능성 — drift 시점 결정 샘플 검토.`;
  }

  return {
    evaluatedAt: now,
    baselineN: baseline.length,
    recentN: recent.length,
    deltaKL,
    gradeKL,
    drifted,
    recommendation,
    distributions: {
      baseline: { delta: baselineDelta, grade: baselineGrade },
      recent:   { delta: recentDelta,   grade: recentGrade },
    },
    reason,
  };
}

/**
 * 의사 데이터 — 단위 테스트 / smoke test 용.
 */
export function _testKL<K extends string>(
  P: Record<K, number>,
  Q: Record<K, number>,
  keys: K[]
): number {
  return kullbackLeibler(normalize(P, keys), normalize(Q, keys), keys);
}
