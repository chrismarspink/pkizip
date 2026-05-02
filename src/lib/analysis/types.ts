/**
 * 분석 파이프라인 공통 타입.
 *
 * 각 단계 출력이 누적되어 최종적으로 PkiHeader.classification /
 * pseudonymization / language / ocr 필드에 매핑된다.
 */

export type Grade = 'C' | 'S' | 'O';

/**
 * PII 탐지 결과 한 건 — Presidio finding 과 동등한 형태.
 */
export interface Finding {
  entityType: string;        // 'KR_RRN' | 'KR_BIZ_NO' | 'PERSON' | ...
  start: number;
  end: number;
  score: number;             // 0..1
  text: string;
  recognizer?: string;        // 인식기 출처
  source?: 'regex' | 'denylist' | 'koner' | 'mbert' | 'spacy';
}

/**
 * 분류기 출력 — rule-v1 (정규식+키워드) + (옵션) 신경망 앙상블.
 */
export interface Classification {
  grade: Grade;
  gradeLabel: string;            // '위험 (Critical)' 등
  score: number;                 // 누적 점수
  confidence: number;            // 0..1
  thresholds: { C: number; S: number };
  reasons: ClassificationReason[];
  version: string;               // 'rule-v1.2' 등
  ensemble?: {
    ruleGrade: Grade;
    neuralGrade?: Grade;
    finalGrade: Grade;
    alpha: number;
  };
}

export interface ClassificationReason {
  kind: 'entity' | 'keyword' | 'language';
  label: string;
  weight: number;
  count: number;
  contribution: number;
  counted?: number;              // keyword cap 적용 후
}

/**
 * 익명화 결과 — anonymization 모듈 출력.
 */
export interface AnonymizationResult {
  anonymizedText: string;
  replacements: Replacement[];
  mapping: Record<string, string>;     // 'PERSON|김철수' → '[PERSON_1]'
  stats: Record<string, number>;       // entity_type → count
  policyVersion: string;
  isReversible: boolean;               // 가명(true) / 익명(false)
}

export interface Replacement {
  startOrig: number;
  endOrig: number;
  original: string;
  replacement: string;
  entityType: string;
  method: AnonymizationMethod;
  isReversible: boolean;
}

export type AnonymizationMethod =
  | 'mask'                       // **** (가명/익명 — pattern/preserve_last에 따라)
  | 'remove'                     // 완전 제거 (익명)
  | 'replace'                    // [PERSON_1] (consistent=true → 가명, false → 익명)
  | 'generalize'                 // 끝 토큰 제거 (익명)
  | 'shift'                      // 날짜 시프트 (익명)
  | 'round';                     // 숫자 반올림 (익명)

/**
 * OCR 결과.
 */
export interface OcrResult {
  text: string;
  applied: boolean;
  engine: 'tesseract.js' | 'easyocr';
  languages: string[];
  confidence: number;
  pages?: number;
  warnings?: string[];
}

/**
 * 언어 감지 결과.
 */
export interface LanguageDetection {
  detected: string;              // ISO 639-1
  confidence: number;
  multilingual: boolean;
  detectorVersion: string;
}

/**
 * 강등 사이클 한 라운드 (apply → analyze → re-classify).
 */
export interface DowngradeIteration {
  iter: number;
  kind: 'initial' | 'after_anonymize';
  grade: Grade;
  score: number;
  nFindings: number;
  nChars: number;
  nReplacements?: number;
}

/**
 * 분석 파이프라인 전체 결과 — Stage A 출력.
 */
export interface AnalysisResult {
  text: string;                  // 추출된(또는 OCR된) 본문
  ocr?: OcrResult;
  language: LanguageDetection;
  findings: Finding[];
  classification: Classification;
  /** 가명/익명화 결과 — 사용자 결정 후 채워짐 */
  anonymization?: {
    result: AnonymizationResult;
    iterations: DowngradeIteration[];
    achieved: boolean;             // target 등급 도달 여부
    finalGrade: Grade;
    finalScore: number;
  };
  /** SHAP 등 설명 */
  explanation?: {
    summary: string;
    narrative: string;
    bullets: string[];
    version: string;
  };
}
