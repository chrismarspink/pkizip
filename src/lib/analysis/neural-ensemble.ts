/**
 * Neural Ensemble — Rule + Neural NER 결과 통합 + 확신도 보정.
 *
 * HE-TEST `neural.py` 의 KoELECTRA + mDeBERTa concat + linear head 동등 가치 제공.
 * 두 트랜스포머 모델 동시 로딩은 브라우저 메모리 부담 ↑ (~600MB) → 본 구현은
 * **앙상블 점수 계산 로직** 만 제공. 모델 로딩은 ko-ner.ts + neural-ner.ts 가 담당.
 *
 * 앙상블 방식 (HE-TEST 패턴):
 *   - rule 점수 → rule_grade (C/S/O)
 *   - ko-ner finding count → neural_signal (간이 등급 계산)
 *   - α · rule_score + (1-α) · neural_score = ensemble_score
 *   - α 는 사용자 설정 (default 0.6 — rule 신뢰 우위)
 *
 * Platt calibration 통합 — calibrate() 적용해 보정 확률 반환.
 */
import type { Classification, Finding, Grade } from './types';
import { classify } from './classifier';
import { calibrate, loadParams } from './platt-calibrator';
import type { PlattParams } from './platt-calibrator';

export interface EnsembleResult {
  /** rule 결과 */
  ruleClassification: Classification;
  /** 신경망 NER findings — koner/mbert 통합 */
  neuralFindings: Finding[];
  /** 앙상블 등급 (alpha 가중 결합 후) */
  finalGrade: Grade;
  /** 앙상블 raw score */
  ensembleScore: number;
  /** Platt 보정 확률 (0-1) — null 면 학습 데이터 부족 */
  calibratedProbability: number | null;
  /** 사용된 α — rule 가중치 */
  alpha: number;
  /** 신경망 signal score — finding 수 + 가중치 */
  neuralScore: number;
  /** rule 단독 raw score */
  ruleScore: number;
  /** 등급 일치 여부 — rule vs neural 동의도 */
  agreement: boolean;
}

export interface EnsembleOptions {
  /** rule 가중치 (1.0 = rule 만 / 0.0 = neural 만). default 0.6 */
  alpha?: number;
  /** Platt 보정 적용 — false 면 raw confidence */
  applyCalibration?: boolean;
  /** Platt 파라미터 명시 — 없으면 loadParams() */
  plattParams?: PlattParams;
}

/**
 * 신경망 findings 만으로 추정 등급 산출.
 * HE-TEST `neural.py` prototype zero-shot 대신 단순 entity-density 기반.
 */
function neuralSignalScore(neuralFindings: Finding[]): { score: number; grade: Grade } {
  if (neuralFindings.length === 0) return { score: 0, grade: 'O' };
  // 신경망이 잡는 entity: PERSON / LOCATION / ORGANIZATION → 단순 가중치
  const weights: Record<string, number> = {
    PERSON: 1.0,
    LOCATION: 0.5,
    ORGANIZATION: 0.5,
    DATE_TIME: 0.2,
  };
  let s = 0;
  for (const f of neuralFindings) {
    s += (weights[f.entityType] ?? 0.3) * f.score;
  }
  const grade: Grade = s >= 5 ? 'C' : s >= 3 ? 'S' : 'O';
  return { score: Math.round(s * 100) / 100, grade };
}

/**
 * Rule + Neural 앙상블.
 *
 * @param text 본문
 * @param ruleFindings 정규식·deny-list findings
 * @param neuralFindings transformers.js NER findings (ko-ner / neural-ner)
 */
export function ensembleClassify(
  text: string,
  ruleFindings: Finding[],
  neuralFindings: Finding[],
  opts: EnsembleOptions = {}
): EnsembleResult {
  const { alpha = 0.6, applyCalibration = true, plattParams } = opts;

  // 1) rule 결과 — 정규식 + 신경망 결합 (분류기 입력)
  // HE-TEST 패턴: 신경망 결과도 rule 분류기 입력으로 합쳐서 entity score 가산
  const merged = [...ruleFindings, ...neuralFindings];
  const ruleClassification = classify(merged, text);

  // 2) 신경망 signal — 별도 산출 (앙상블 가중치용)
  const neural = neuralSignalScore(neuralFindings);

  // 3) ensemble score
  const ensembleScore =
    Math.round((alpha * ruleClassification.score + (1 - alpha) * neural.score) * 100) / 100;

  // 4) 최종 등급 — rule 등급 우위, 단 둘 다 C 또는 둘 다 S 면 그대로 / 차이 시 보수적
  const ruleGrade = ruleClassification.grade;
  const neuralGrade = neural.grade;
  let finalGrade: Grade;
  if (ruleGrade === neuralGrade) {
    finalGrade = ruleGrade;
  } else {
    // 더 높은 (보수적) 등급 우선 — C > S > O
    const rank = { C: 2, S: 1, O: 0 } as const;
    finalGrade = rank[ruleGrade] >= rank[neuralGrade] ? ruleGrade : neuralGrade;
  }

  // 5) Platt 보정 확률
  let calibratedProbability: number | null = null;
  if (applyCalibration) {
    const params = plattParams ?? loadParams();
    if (params.n >= 50) {
      calibratedProbability = Math.round(calibrate(ensembleScore, params) * 1000) / 1000;
    }
  }

  return {
    ruleClassification,
    neuralFindings,
    finalGrade,
    ensembleScore,
    calibratedProbability,
    alpha,
    neuralScore: neural.score,
    ruleScore: ruleClassification.score,
    agreement: ruleGrade === neuralGrade,
  };
}

/**
 * 단위 테스트용 — 모델 로딩 우회.
 */
export function _testEnsemble(
  text: string,
  ruleFindings: Finding[],
  neuralFindings: Finding[],
  alpha = 0.6
): EnsembleResult {
  return ensembleClassify(text, ruleFindings, neuralFindings, {
    alpha, applyCalibration: false,
  });
}
