/**
 * 분석 파이프라인 — Stage A 전체 흐름.
 *
 *  파일 → (OCR? → ) 텍스트 추출 → 언어 감지 → PII 탐지 → 분류 → 설명
 *  → (가명/익명화 → 재분석 → 강등 사이클)
 *
 * 사용자 명세 step (1)~(5) 를 코드로 구현.
 */
import { applyPolicy } from './anonymizer';
import { loadPolicy, type AnonymizationPolicy } from './anonymization-policy';
import { applyLanguageFloor, classify, GRADE_RANK } from './classifier';
import { explain } from './explainer';
import { detectLanguage } from './lang-detect';
import { filterNerFindings } from './ner-filter';
import * as neuralNer from './neural-ner';
import { detect, summarize } from './pii-detector';
import { prefs } from '../store/preferences';
import type {
  AnalysisResult, AnonymizationResult, DowngradeIteration, Finding, Grade,
} from './types';
import type { ClassifyProgress } from '../classify/windowing';

export interface AnalyzeOptions {
  /** OCR 적용 (이미 호출 측에서 적용했으면 ocr 메타만 전달) */
  ocrApplied?: boolean;
  ocrEngine?: 'tesseract.js' | 'easyocr';
  ocrLanguages?: string[];
  ocrConfidence?: number;
  /** 정책 — 미지정 시 localStorage 정책 또는 DEFAULT */
  policy?: AnonymizationPolicy;
  /** 비한국어 문서 등급 하한 적용 (기본 true) */
  applyLanguageFloor?: boolean;
  /** PII 탐지 minScore */
  minScore?: number;
  /** T3 mDeBERTa 대용량 청크 진행률 콜백 (구간 i/total) */
  onNeuralProgress?: (p: ClassifyProgress) => void;
}

/**
 * Stage A 단일 패스 — 동기 (NER 없이). 빠른 1차 분석.
 */
export function analyze(text: string, opts: AnalyzeOptions = {}): AnalysisResult {
  const language = detectLanguage(text);
  const findings = detect(text, { minScore: opts.minScore ?? 0.3 });
  let classification = classify(findings, text);

  if (opts.applyLanguageFloor !== false) {
    classification = applyLanguageFloor(classification, language.detected, {
      textLength: text.length,
      languageConfidence: language.confidence,
    });
  }

  const explanation = explain(classification, findings);

  const ocr = opts.ocrApplied ? {
    text: '',
    applied: true,
    engine: opts.ocrEngine ?? 'tesseract.js',
    languages: opts.ocrLanguages ?? ['kor', 'eng'],
    confidence: opts.ocrConfidence ?? 0.85,
  } : undefined;

  return {
    text,
    ocr,
    language,
    findings,
    classification,
    explanation,
  };
}

/**
 * Stage A async 패스 — 신경망 NER 포함. 모델 로드되어 있을 때만 NER 추가.
 *
 * 사용 흐름:
 *   1) settings.neural.nerEnabled === true 면 NER 시도
 *   2) nerAutoLoad === true 면 모델 자동 로드 (첫 호출은 다운로드 ~30-100MB)
 *   3) NER findings 를 정규식 findings 와 합쳐 재분류
 *   4) 같은 위치 dedup — 같은 PERSON 매치는 한 번만 카운트
 */
export async function analyzeAsync(
  text: string,
  opts: AnalyzeOptions = {},
): Promise<AnalysisResult> {
  const base = analyze(text, opts);

  const neuralPrefs = prefs.neuralNer?.get?.();
  if (!neuralPrefs) return base;

  const language = base.language;
  let findings = base.findings;
  let classification = base.classification;
  let changed = false;

  const reclassify = (fs: Finding[]) => {
    let c = classify(fs, text);
    if (opts.applyLanguageFloor !== false) {
      c = applyLanguageFloor(c, language.detected, {
        textLength: text.length, languageConfidence: language.confidence,
      });
    }
    return c;
  };

  // ── T2: 신경망 NER (opt-in) — findings 보강 후 규칙 분류기 재실행 ──
  if (neuralPrefs.nerEnabled) {
    try {
      let loaded = neuralNer.isLoaded();
      if (!loaded && neuralPrefs.nerAutoLoad) {
        await neuralNer.loadModel();
        loaded = true;
      }
      if (loaded) {
        const nerFindings = await neuralNer.detectNer(text, { minScore: neuralPrefs.nerMinScore });
        if (nerFindings.length > 0) {
          const { kept, dropped } = filterNerFindings(nerFindings);
          if (dropped.length > 0) {
            console.debug('[pipeline] NER 휴리스틱 필터로 거부:',
              dropped.length, '건 →', dropped.map(d => `${d.text}(${d.filterReason})`).slice(0, 10));
          }
          findings = mergeFindings([...base.findings, ...kept]);
          classification = reclassify(findings);
          changed = true;
        }
      }
    } catch (e) {
      console.warn('[pipeline] neural NER failed, fallback:', e);
    }
  }

  // ── T3: 신경망 등급 판정 (mDeBERTa zero-shot, opt-in) — escalate: 규칙 등급을 올릴 수만 ──
  if (neuralPrefs.neuralGradeEnabled) {
    try {
      const [{ createZeroShotInfer }, { classifyWindowed }] = await Promise.all([
        import('../classify/neural'),
        import('../classify/windowing'),
      ]);
      const zsLocale = ({ ko: 'ko', ja: 'ja', en: 'en', 'zh-CN': 'zh-CN', zh: 'zh-CN' } as Record<string, string>)[language.detected] ?? 'ko';
      const zs = await classifyWindowed(text, createZeroShotInfer({ locale: zsLocale }), {
        onProgress: opts.onNeuralProgress,
      });
      const toOSC: Record<string, Grade> = { OPEN: 'O', SENSITIVE: 'S', CONFIDENTIAL: 'C' };
      const GLABEL: Record<Grade, string> = { C: '위험 (Critical)', S: '민감 (Sensitive)', O: '공개 (Open)' };
      const nGrade = toOSC[zs.grade];
      const ruleGrade = classification.grade;
      const raise = !!nGrade && zs.confidence >= 0.55 && GRADE_RANK[nGrade] > GRADE_RANK[ruleGrade];
      classification = {
        ...classification,
        grade: raise ? nGrade : ruleGrade,
        gradeLabel: raise ? `${GLABEL[nGrade]} · AI(mDeBERTa) 상향` : classification.gradeLabel,
        confidence: raise ? Math.max(classification.confidence, zs.confidence) : classification.confidence,
        ensemble: { ruleGrade, neuralGrade: nGrade, finalGrade: raise ? nGrade : ruleGrade, alpha: raise ? 0 : 1 },
      };
      changed = true;
    } catch (e) {
      console.warn('[pipeline] neural grade (mDeBERTa) failed:', e);
    }
  }

  if (!changed) return base;
  return {
    ...base,
    findings,
    classification,
    explanation: explain(classification, findings),
  };
}

function mergeFindings(findings: Finding[]): Finding[] {
  const dedup = new Map<string, Finding>();
  for (const f of findings) {
    const k = `${f.start}|${f.end}|${f.entityType}`;
    const prev = dedup.get(k);
    if (!prev || prev.score < f.score) dedup.set(k, f);
  }
  return Array.from(dedup.values()).sort((a, b) => a.start - b.start);
}

/**
 * 강등 사이클 — Step (4) "가명처리 통해 O 등급으로 만들지 확인" 구현.
 *
 * apply → analyze → if grade > target: again. max_iterations 까지.
 */
export interface DowngradeOptions {
  policy?: AnonymizationPolicy;
  applyLanguageFloor?: boolean;
}

export function downgradeToTarget(
  initial: AnalysisResult,
  opts: DowngradeOptions = {},
): AnalysisResult {
  const policy = opts.policy ?? loadPolicy();
  const targetRank = GRADE_RANK[policy.targetGrade];
  const maxIter = policy.maxIterations;
  const history: DowngradeIteration[] = [{
    iter: 0, kind: 'initial',
    grade: initial.classification.grade,
    score: initial.classification.score,
    nFindings: initial.findings.length,
    nChars: initial.text.length,
  }];

  if (GRADE_RANK[initial.classification.grade] <= targetRank) {
    return {
      ...initial,
      anonymization: {
        result: emptyResult(policy.version, true),
        iterations: history,
        achieved: true,
        finalGrade: initial.classification.grade,
        finalScore: initial.classification.score,
      },
    };
  }

  let curText = initial.text;
  let curFindings: Finding[] = initial.findings;
  let lastResult: AnonymizationResult | null = null;
  let lastClassification = initial.classification;

  for (let i = 1; i <= maxIter; i++) {
    lastResult = applyPolicy(curText, curFindings, policy);
    curText = lastResult.anonymizedText;
    curFindings = detect(curText);
    lastClassification = classify(curFindings, curText);
    if (opts.applyLanguageFloor !== false) {
      lastClassification = applyLanguageFloor(lastClassification, initial.language.detected, {
        textLength: curText.length,
        languageConfidence: initial.language.confidence,
      });
    }

    history.push({
      iter: i, kind: 'after_anonymize',
      grade: lastClassification.grade,
      score: lastClassification.score,
      nFindings: curFindings.length,
      nChars: curText.length,
      nReplacements: lastResult.replacements.length,
    });

    if (GRADE_RANK[lastClassification.grade] <= targetRank) break;
  }

  const achieved = GRADE_RANK[lastClassification.grade] <= targetRank;

  return {
    text: curText,
    ocr: initial.ocr,
    language: initial.language,
    findings: curFindings,
    classification: lastClassification,
    explanation: explain(lastClassification, curFindings),
    anonymization: {
      result: lastResult ?? emptyResult(policy.version, true),
      iterations: history,
      achieved,
      finalGrade: lastClassification.grade,
      finalScore: lastClassification.score,
    },
  };
}

/**
 * 1회 익명화 (강등 사이클 없이) — Step (3) "가명처리 여부".
 */
export function anonymizeOnce(
  result: AnalysisResult,
  opts: DowngradeOptions = {},
): AnalysisResult {
  const policy = opts.policy ?? loadPolicy();
  const anon = applyPolicy(result.text, result.findings, policy);
  const newFindings = detect(anon.anonymizedText);
  let newClass = classify(newFindings, anon.anonymizedText);
  if (opts.applyLanguageFloor !== false) {
    newClass = applyLanguageFloor(newClass, result.language.detected, {
      textLength: anon.anonymizedText.length,
      languageConfidence: result.language.confidence,
    });
  }
  return {
    ...result,
    text: anon.anonymizedText,
    findings: newFindings,
    classification: newClass,
    explanation: explain(newClass, newFindings),
    anonymization: {
      result: anon,
      iterations: [
        { iter: 0, kind: 'initial', grade: result.classification.grade,
          score: result.classification.score, nFindings: result.findings.length, nChars: result.text.length },
        { iter: 1, kind: 'after_anonymize', grade: newClass.grade,
          score: newClass.score, nFindings: newFindings.length, nChars: anon.anonymizedText.length,
          nReplacements: anon.replacements.length },
      ],
      achieved: GRADE_RANK[newClass.grade] <= GRADE_RANK[policy.targetGrade],
      finalGrade: newClass.grade,
      finalScore: newClass.score,
    },
  };
}

function emptyResult(version: string, isReversible: boolean): AnonymizationResult {
  return {
    anonymizedText: '',
    replacements: [],
    mapping: {},
    stats: {},
    policyVersion: version,
    isReversible,
  };
}

// 재export — UI에서 편의
export { summarize };
export type { AnalysisResult, Grade };
