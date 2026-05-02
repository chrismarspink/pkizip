/**
 * rule-v1 분류기 — HE-TEST classifier.py 클라이언트 포팅.
 *
 * findings(+text) → C/S/O 등급. 점수 = Σ(entity 가중치) + Σ(키워드 가산점).
 * 임계값으로 등급 결정, tanh(margin/2) 로 신뢰도.
 *
 * 신경망 (KoELECTRA + mDeBERTa) 통합은 transformers.js + ONNX 변환 필요 — Phase 1.5.
 */
import type { Classification, ClassificationReason, Finding, Grade } from './types';

// ─────────────────────────────────────────────
// 가중치 (HE-TEST 와 동기화)
// ─────────────────────────────────────────────
const ENTITY_WEIGHTS: Record<string, number> = {
  KR_RRN: 5.0, KR_PASSPORT: 4.5, CREDIT_CARD: 4.5, US_SSN: 4.5, IBAN_CODE: 3.0,
  AWS_ACCESS_KEY: 3.5, GENERIC_API_KEY: 3.0,
  KR_BIZ_NO: 2.5, VIP_NAMES: 2.0, INTERNAL_PROJECTS: 2.0, KR_ADDRESS: 1.5,
  IP_ADDRESS: 0.4, KR_PHONE: 0.5, PHONE_NUMBER: 0.5, EMAIL_ADDRESS: 0.4,
  PERSON: 0.3, LOCATION: 0.2, ORGANIZATION: 0.2,
  URL: 0.1, DATE_TIME: 0.05,
  // KR_PII_TEMPLATES 추가분
  KR_ARC: 5.0, KR_DRIVERS_LICENSE: 2.0, KR_HEALTH_INSURANCE: 1.5,
  KR_CAR_PLATE: 1.0, KR_CORP_REG_NUMBER: 2.5,
};
const DEFAULT_ENTITY_WEIGHT = 0.3;

// 등급 키워드 (kw lowercase, weight, label)
// export 됨 — anonymizer 가 동일 리스트로 키워드 마스킹 시 사용
export const GRADE_KEYWORDS: Array<[string, number, string]> = [
  ['극비', 4.0, '극비'],
  ['top secret', 4.0, 'Top Secret'],
  ['보안1등급', 4.0, '보안1등급'],
  ['대외비', 3.0, '대외비'],
  ['기밀', 3.0, '기밀'],
  ['confidential', 3.0, 'Confidential'],
  ['외부유출금지', 3.0, '외부유출금지'],
  ['secret', 2.5, 'Secret'],
  ['do not distribute', 2.5, 'Do Not Distribute'],
  ['company confidential', 2.5, 'Company Confidential'],
  ['보안2등급', 2.0, '보안2등급'],
  ['n.d.a', 2.0, 'NDA'],
  ['non-disclosure', 2.0, 'Non-Disclosure'],
  ['내부용', 1.5, '내부용'],
  ['사내한정', 1.5, '사내한정'],
  ['internal use', 1.5, 'Internal Use'],
  ['restricted', 1.5, 'Restricted'],
  ['개인정보보호법', 1.5, '개인정보보호법'],
  ['정보통신망법', 1.5, '정보통신망법'],
  ['신용정보법', 1.5, '신용정보법'],
  ['보안3등급', 1.0, '보안3등급'],
  // 'private' / '개인정보' 단독 키워드 제거 — 일반어 / 메타 문서 false positive 의 주범.
  // 명시적 라벨로만 매칭하려면 컨텍스트가 필요함 (B/C 패치에서 처리).
  // 필요 시 사용자가 룰 페이지에서 추가 가능.
];

const KW_COUNT_CAP = 3;
export const C_THRESHOLD = 5.0;
// S 임계값 2.0 → 3.0: 일반 사무 문서가 약한 키워드 1-2건만으로 S 분류되던 케이스 차단
export const S_THRESHOLD = 3.0;
export const CLASSIFIER_VERSION = 'rule-v1.2';

/** 문서 길이 정규화 — 긴 문서에서 키워드 1회는 약한 신호 */
const LEN_NORM_BASE = 2000;
/** 키워드만으로 등급 결정 시 가산점 감쇠 — entity 가 0 이면 keyword 점수 ×0.5 */
const KW_ONLY_DAMPENING = 0.5;

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

export function classify(findings: Finding[], text: string): Classification {
  const reasons: ClassificationReason[] = [];

  // 1) entity 점수 (변경 없음 — entity 매칭은 정규식이 검증된 결과라 강한 신호)
  const counts = new Map<string, number>();
  for (const f of findings) {
    counts.set(f.entityType, (counts.get(f.entityType) || 0) + 1);
  }
  for (const [et, cnt] of counts) {
    const w = ENTITY_WEIGHTS[et] ?? DEFAULT_ENTITY_WEIGHT;
    reasons.push({
      kind: 'entity',
      label: et,
      weight: w,
      count: cnt,
      contribution: round(w * cnt, 2),
    });
  }
  const entityScore = reasons
    .filter(r => r.kind === 'entity')
    .reduce((s, r) => s + r.contribution, 0);

  // 2) 키워드 점수 — 컨텍스트별 가중치 + 길이 정규화 + 키워드만 있을 때 감쇠
  let keywordScoreRaw = 0;
  if (text) {
    // 길이 정규화: 짧은 문서는 1.0, 긴 문서는 점진적으로 줄어듦
    // 2KB → 1.0, 10KB → 0.2, 50KB → 0.04
    const lengthNorm = Math.min(1, LEN_NORM_BASE / Math.max(text.length, LEN_NORM_BASE));

    // 모든 키워드 출현 위치 + 컨텍스트 가중치 적용
    const occurrences = findKeywordOccurrences(text);
    const byKeyword = new Map<string, { kw: string; weight: number; label: string;
                                          rawCount: number; effectiveCount: number }>();
    for (const occ of occurrences) {
      const ctx = contextWeight(text, occ.start, occ.end);
      let v = byKeyword.get(occ.label);
      if (!v) {
        v = { kw: occ.keyword, weight: occ.weight, label: occ.label,
              rawCount: 0, effectiveCount: 0 };
        byKeyword.set(occ.label, v);
      }
      v.rawCount++;
      v.effectiveCount += ctx;
    }

    for (const [, v] of byKeyword) {
      if (v.effectiveCount === 0) continue;   // 모든 매칭이 zero-context (메타 / 부정문)
      // log decay — 같은 키워드 여러 번 등장해도 점수가 폭증하지 않음
      // count=1 → 1, count=2 → 1.69, count=3 → 2.10, count=10 → 3.30
      const decayedCount = Math.min(
        Math.min(v.effectiveCount, KW_COUNT_CAP),
        1 + Math.log(Math.max(1, v.effectiveCount)),
      );
      const contribution = round(v.weight * decayedCount * lengthNorm, 2);
      keywordScoreRaw += contribution;
      reasons.push({
        kind: 'keyword',
        label: v.label,
        weight: v.weight,
        count: v.rawCount,
        counted: round(decayedCount, 2),
        contribution,
      });
    }
  }

  // 3) 엔티티가 0건이면 키워드 단독 점수를 감쇠
  // 메타 / 제안서 / 키워드 사전 같은 PII 없는 문서가 등급 키워드만으로 S/C 되는 것 차단
  const keywordScore = entityScore > 0
    ? keywordScoreRaw
    : keywordScoreRaw * KW_ONLY_DAMPENING;

  // reasons 의 keyword contribution 도 감쇠 반영 (UI 일치)
  if (entityScore === 0 && keywordScoreRaw > 0) {
    for (const r of reasons) {
      if (r.kind === 'keyword') {
        r.contribution = round(r.contribution * KW_ONLY_DAMPENING, 2);
      }
    }
  }

  reasons.sort((a, b) => b.contribution - a.contribution);
  const score = round(entityScore + keywordScore, 2);

  // 3) 등급 + margin
  let grade: Grade, gradeLabel: string, margin: number;
  if (score >= C_THRESHOLD) {
    grade = 'C'; gradeLabel = '위험 (Critical)'; margin = score - C_THRESHOLD;
  } else if (score >= S_THRESHOLD) {
    grade = 'S'; gradeLabel = '민감 (Sensitive)';
    margin = Math.min(score - S_THRESHOLD, C_THRESHOLD - score);
  } else {
    grade = 'O'; gradeLabel = '공개 (Open)'; margin = S_THRESHOLD - score;
  }

  // 4) 신뢰도 — tanh(margin/2) 정규화
  const confidence = round(0.55 + 0.4 * Math.tanh(Math.max(0, margin) / 2), 3);

  return {
    grade,
    gradeLabel,
    score,
    confidence,
    thresholds: { C: C_THRESHOLD, S: S_THRESHOLD },
    reasons: reasons.slice(0, 20),
    version: CLASSIFIER_VERSION,
  };
}

/**
 * 비한국어 문서 등급 하한 적용 — langdetect 결과로 호출.
 * 영문 등 다국어 문서는 PII 탐지 정확도가 떨어지므로 S 하한.
 */
export function applyLanguageFloor(c: Classification, language: string): Classification {
  if (language === 'ko' || c.grade !== 'O') return c;
  return {
    ...c,
    grade: 'S',
    gradeLabel: '민감 (Sensitive · 비한국어 하한)',
    reasons: [
      ...c.reasons,
      {
        kind: 'language',
        label: `non-Korean (${language})`,
        weight: S_THRESHOLD,
        count: 1,
        contribution: S_THRESHOLD,
      },
    ],
    score: Math.max(c.score, S_THRESHOLD),
  };
}

/** 등급 → rank 매핑 (gap 계산용) */
export const GRADE_RANK: Record<Grade, number> = { O: 0, S: 1, C: 2 };

export function gap(ai: Grade, user: Grade): number {
  return Math.abs(GRADE_RANK[ai] - GRADE_RANK[user]);
}

function round(n: number, p: number): number {
  const m = Math.pow(10, p);
  return Math.round(n * m) / m;
}

/**
 * 본문에서 등급 키워드 매칭 위치를 모두 반환 — UI 하이라이트용.
 * Finding 형태로 만들어 PII findings 와 같이 시각화 가능.
 */
export interface KeywordOccurrence {
  start: number;
  end: number;
  keyword: string;
  label: string;
  weight: number;
}

/**
 * 키워드 출현 위치의 컨텍스트 가중치 (0..1).
 * 본문에서 같은 단어가 어떻게 쓰였는지로 신호 강도 보정 — 메타 문서 false positive 차단.
 *
 * 0.0 = 무시 (부정문, 표 헤더, 라벨 정의 등)
 * 0.3 = 약함 (코드/인용 안)
 * 1.0 = 정상 (본문 평서문)
 */
export function contextWeight(text: string, kwStart: number, kwEnd: number): number {
  const before = text.slice(Math.max(0, kwStart - 60), kwStart);
  const after  = text.slice(kwEnd, Math.min(text.length, kwEnd + 60));

  // (1) 부정 컨텍스트 — "X 가 아닙니다" / "no X" / "X 없음"
  if (/(?:아닙니다|아닌|않습니다|않은|없습니다|없는|미포함)\s*[.,]?\s*$/.test(before)) return 0;
  if (/^\s*(?:아닙니다|아닌|않습니다|않음|없음)/.test(after)) return 0;
  if (/\b(?:not|no|never|without)\s+(?:\w+\s+)?$/i.test(before)) return 0;

  // (2) 표 헤더 / 마크다운 표 셀 — `| 키워드 | 가중치 |` 형태
  // 양쪽에 | 또는 │ 가 있고 짧은 셀이면 메타로 간주
  const beforeHasBar = /[|│┃]\s*$/.test(before);
  const afterHasBar  = /^\s*[|│┃]/.test(after);
  if (beforeHasBar && afterHasBar) return 0;

  // (3) 코드 블록 / 백틱 / 따옴표 안 — 일반 인용 / 코드 예시
  const beforeHasQuote = /[`"']\s*$/.test(before);
  const afterHasQuote  = /^\s*[`"']/.test(after);
  if (beforeHasQuote && afterHasQuote) return 0.3;

  // (4) 라벨 정의 / 예시 패턴 — "키워드:", "예: X", "label = X", "예시", "표 N"
  if (/(?:라벨|키워드|예시|예\s*:|example|label|tag|term)[\s가-힣]{0,4}[:=\s]+$/i.test(before)) return 0.2;

  // (5) 분류 가중치 표 / 점수 설명 패턴 — "X (가중치 N)" "X +N점"
  if (/^[\s가-힣A-Za-z]{0,8}[\(（]?\s*[\d.]+\s*점?[\)）]?/.test(after)) return 0.3;

  // (6) 사전/리스트 항목 — "• X", "- X", "* X" 시작 + 짧은 줄
  if (/(?:^|\n)\s*[•\-\*·]\s*$/.test(before) && /^\s*[,，:：]/.test(after)) return 0.4;

  // (7) MIP/규격/표준 인용 — "...sensitivity label = Confidential" 같은 명세 텍스트
  if (/(?:sensitivity|label|labelname|grade)\s*[:=]\s*['"`]?\s*$/i.test(before)) return 0.2;

  return 1.0;
}

export function findKeywordOccurrences(text: string): KeywordOccurrence[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  const sorted = [...GRADE_KEYWORDS].sort((a, b) => b[0].length - a[0].length);
  const out: KeywordOccurrence[] = [];
  const taken: Array<[number, number]> = [];   // 겹침 방지

  for (const [kw, w, label] of sorted) {
    let idx = 0;
    while ((idx = lower.indexOf(kw, idx)) !== -1) {
      const end = idx + kw.length;
      // 이미 더 긴 키워드가 차지한 영역이면 스킵
      const overlaps = taken.some(([s, e]) => idx < e && end > s);
      if (!overlaps) {
        out.push({ start: idx, end, keyword: kw, label, weight: w });
        taken.push([idx, end]);
      }
      idx = end;
    }
  }
  return out.sort((a, b) => a.start - b.start);
}
