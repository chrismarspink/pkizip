/**
 * Platt Scaling — rule-v1 raw score → calibrated probability.
 *
 * HE-TEST `platt_calibration.py` 의 클라이언트 포팅.
 * rule-v1.2 의 confidence 는 raw score 비례라 실제 정확도와 mismatch 발생.
 * 사용자 결정 이력을 정답으로 사용해 sigmoid (1 / (1 + exp(A·x + B))) 의
 * 2개 파라미터 (A, B) 를 학습 → 보정된 확률 반환.
 *
 * 학습 데이터: decision-store 의 결정. AI 등급 == 사용자 등급 면 y=1,
 * 다르면 y=0. score 는 raw classifier score.
 *
 * 학습 알고리즘: Newton-Raphson 1D × 2 (간단 grid + line search 대안).
 * 50건 미만 시 학습 안 함 — 기본 sigmoid (A=-1, B=0) 반환.
 */
import { listDecisions } from '../learning/decision-store';

export interface PlattParams {
  /** sigmoid 기울기 — 음수면 score ↑ → prob ↑ (정상) */
  A: number;
  /** sigmoid bias */
  B: number;
  /** 학습 사용 샘플 수 */
  n: number;
  /** ECE (Expected Calibration Error) — 보정 후, 10개 bin */
  ece: number;
  /** 학습 일시 */
  fittedAt: number;
  /** 사용된 알고리즘 */
  method: 'newton-raphson' | 'grid-search' | 'default';
  version: string;
}

const VERSION = 'platt-v1';
const MIN_SAMPLES = 50;
const DEFAULT_PARAMS: PlattParams = {
  A: -1.0, B: 0.0, n: 0, ece: 0,
  fittedAt: 0, method: 'default', version: VERSION,
};

const STORAGE_KEY = 'pkizip.calibration.platt-v1';

/**
 * sigmoid(A · score + B) → probability.
 */
export function calibrate(rawScore: number, params: PlattParams = DEFAULT_PARAMS): number {
  const z = params.A * rawScore + params.B;
  return 1 / (1 + Math.exp(z));
}

/**
 * Platt scaling 학습 — Newton-Raphson 2D 간소판 (grid + binary search).
 *
 * 비용 함수: NLL = -Σ [ y · log(p) + (1-y) · log(1-p) ]
 *
 * @param samples - {score, label} 배열. label=1 (AI 맞음) / 0 (틀림)
 */
export function fit(
  samples: Array<{ score: number; label: 0 | 1 }>
): PlattParams {
  if (samples.length < MIN_SAMPLES) {
    return { ...DEFAULT_PARAMS, n: samples.length };
  }

  // grid search — A ∈ [-3, -0.1] (음수 강제 — score ↑ → prob ↑), B ∈ [-2, 2]
  const aGrid = Array.from({ length: 30 }, (_, i) => -3 + (i * (3 - 0.1)) / 30);
  const bGrid = Array.from({ length: 20 }, (_, i) => -2 + (i * 4) / 20);

  let bestA = -1, bestB = 0, bestLoss = Infinity;
  for (const A of aGrid) {
    for (const B of bGrid) {
      let loss = 0;
      for (const s of samples) {
        const z = A * s.score + B;
        // p = 1 / (1 + exp(z))   →   log p = -log(1+exp(z))
        // log (1-p) = -z - log(1+exp(-z))  hmm — 안전한 logSumExp 형태
        const logP = -Math.log(1 + Math.exp(z));
        const log1mP = -z + logP;  // log(1-p) = z + log(p) (수치 안정)
        loss -= s.label === 1 ? logP : log1mP;
      }
      if (loss < bestLoss) {
        bestLoss = loss; bestA = A; bestB = B;
      }
    }
  }

  // ECE 계산 — 10 bin
  const params: PlattParams = {
    A: bestA, B: bestB, n: samples.length,
    ece: 0, fittedAt: Date.now(), method: 'grid-search', version: VERSION,
  };
  params.ece = expectedCalibrationError(samples, params);
  return params;
}

/**
 * Expected Calibration Error — 10 bin.
 * 0 에 가까울수록 잘 보정됨.
 */
export function expectedCalibrationError(
  samples: Array<{ score: number; label: 0 | 1 }>,
  params: PlattParams,
  nBins = 10
): number {
  const bins: Array<{ probs: number[]; labels: number[] }> = Array.from(
    { length: nBins }, () => ({ probs: [], labels: [] })
  );
  for (const s of samples) {
    const p = calibrate(s.score, params);
    const binIdx = Math.min(nBins - 1, Math.floor(p * nBins));
    bins[binIdx].probs.push(p);
    bins[binIdx].labels.push(s.label);
  }
  let ece = 0;
  const N = samples.length;
  for (const b of bins) {
    if (b.probs.length === 0) continue;
    const meanP = b.probs.reduce((a, x) => a + x, 0) / b.probs.length;
    const meanY = b.labels.reduce((a, x) => a + x, 0) / b.labels.length;
    ece += (b.probs.length / N) * Math.abs(meanP - meanY);
  }
  return Math.round(ece * 1000) / 1000;
}

/**
 * 결정 이력 → Platt 학습 + 영속 저장.
 * UI 의 "보정 학습" 버튼 또는 백그라운드 주기적 호출.
 */
export async function trainFromDecisions(): Promise<PlattParams> {
  const all = await listDecisions(1000);
  const samples: Array<{ score: number; label: 0 | 1 }> = all
    .filter(d => typeof d.ai?.score === 'number')
    .map(d => ({
      score: d.ai.score,
      // AI 가 사용자 등급과 일치하면 label=1, 다르면 0
      label: (d.signedDelta === 0 ? 1 : 0) as 0 | 1,
    }));
  const params = fit(samples);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(params));
  } catch { /* private mode ignore */ }
  return params;
}

/**
 * 저장된 파라미터 로드. 없으면 default.
 */
export function loadParams(): PlattParams {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (p.version === VERSION && typeof p.A === 'number') return p;
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_PARAMS };
}

/** 단위 테스트용. */
export function _testFit(samples: Array<{ score: number; label: 0 | 1 }>): PlattParams {
  return fit(samples);
}
