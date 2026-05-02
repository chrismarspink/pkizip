/**
 * PII 탐지 — 정규식 + 키워드 기반 (rule-v1 클라이언트 포팅).
 *
 * HE-TEST 의 custom_patterns.yaml + KR_PII_TEMPLATES 를 TypeScript 로 옮김.
 * 한국형 PII 8종 + 일반 PII 5종 + deny-list (VIP, 내부 프로젝트) 포함.
 *
 * KoELECTRA-NER 통합은 transformers.js + ONNX 변환 필요 — 차후 phase.
 */
import type { Finding } from './types';

interface Pattern {
  entityType: string;
  regex: RegExp;
  score: number;
  /** Luhn 검증 등 후처리 */
  validate?: (text: string) => boolean;
}

interface DenyList {
  entityType: string;
  terms: string[];
  score: number;
}

// ─────────────────────────────────────────────
// 한국형 PII 정규식 (HE-TEST 의 KR_PII_TEMPLATES 그대로)
// ─────────────────────────────────────────────
const KR_PATTERNS: Pattern[] = [
  { entityType: 'KR_RRN',          regex: /\b(\d{6})-?([1-4]\d{6})\b/g, score: 0.95,
    validate: validateKrRrn },
  { entityType: 'KR_PASSPORT',     regex: /\b[MOSGRD]\d{8}\b/g, score: 0.9 },
  { entityType: 'KR_BIZ_NO',       regex: /\b\d{3}-\d{2}-\d{5}\b/g, score: 0.95,
    validate: validateKrBizNo },
  { entityType: 'KR_PHONE',        regex: /\b01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}\b/g, score: 0.85 },
  { entityType: 'KR_ARC',          regex: /\b\d{6}-?[5-8]\d{6}\b/g, score: 0.95 },
  { entityType: 'KR_DRIVERS_LICENSE', regex: /\b\d{2}-\d{2}-\d{6}-\d{2}\b/g, score: 0.9 },
  { entityType: 'KR_HEALTH_INSURANCE', regex: /\b[1-9]-\d{10}\b/g, score: 0.85 },
  { entityType: 'KR_CAR_PLATE',    regex: /\b\d{2,3}\s*[가-힣]\s*\d{4}\b/g, score: 0.85 },
  { entityType: 'KR_CORP_REG_NUMBER', regex: /\b\d{6}-\d{7}\b/g, score: 0.85 },
];

const COMMON_PATTERNS: Pattern[] = [
  { entityType: 'CREDIT_CARD',     regex: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, score: 0.95,
    validate: validateLuhn },
  { entityType: 'EMAIL_ADDRESS',   regex: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, score: 0.9 },
  { entityType: 'AWS_ACCESS_KEY',  regex: /\b(?:AKIA|ASIA|AROA)[0-9A-Z]{16}\b/g, score: 0.95 },
  // GENERIC_API_KEY — prefix 가 명확한 것만. 임의 32자 영숫자 매칭 제거 (너무 광범위 → false positive)
  { entityType: 'GENERIC_API_KEY',
    regex: /\b(?:sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{30,}|gho_[A-Za-z0-9]{30,}|xoxb-[\d]{10,}-[\d]{10,}-[A-Za-z0-9]{20,}|glpat-[A-Za-z0-9_-]{20,})\b/g,
    score: 0.85 },
  { entityType: 'PHONE_NUMBER',    regex: /\b\+?\d{1,3}[-.\s]?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{4}\b/g, score: 0.7 },
  // IP_ADDRESS — 옥텟 0-255 범위 + 버전 번호 패턴 (1.0.0.0 등) 차단
  { entityType: 'IP_ADDRESS',
    regex: /\b(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\b/g,
    score: 0.85,
    validate: (text: string) => {
      const parts = text.split('.').map(Number);
      // 버전 번호 패턴 (모든 옥텟 < 5) 차단 — 1.0.0.0, 0.0.0.0 등
      if (parts.every(p => p < 5)) return false;
      // 0.x.x.x 차단 (예약)
      if (parts[0] === 0) return false;
      return true;
    } },
  { entityType: 'URL',             regex: /\bhttps?:\/\/[^\s<>"']+/g, score: 0.9 },
];

// ─────────────────────────────────────────────
// Deny-list (사용자/조직 정의 — localStorage 에서 추가 가능)
// ─────────────────────────────────────────────
const BUILTIN_DENY: DenyList[] = [
  { entityType: 'INTERNAL_PROJECTS', terms: ['ProjectAlpha', '프로젝트사일런스', '오로라'], score: 0.95 },
  { entityType: 'VIP_NAMES',         terms: ['김대표', '이부사장', '박전무'], score: 0.9 },
];

// ─────────────────────────────────────────────
// Validators
// ─────────────────────────────────────────────

function validateKrRrn(text: string): boolean {
  // 13자리 weighted sum mod 11
  const digits = text.replace(/\D/g, '');
  if (digits.length !== 13) return false;
  const weights = [2, 3, 4, 5, 6, 7, 8, 9, 2, 3, 4, 5];
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += parseInt(digits[i]!, 10) * weights[i]!;
  const check = (11 - (sum % 11)) % 10;
  return check === parseInt(digits[12]!, 10);
}

function validateKrBizNo(text: string): boolean {
  // 10자리 weighted sum
  const digits = text.replace(/\D/g, '');
  if (digits.length !== 10) return false;
  const weights = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(digits[i]!, 10) * weights[i]!;
  sum += Math.floor((parseInt(digits[8]!, 10) * 5) / 10);
  const check = (10 - (sum % 10)) % 10;
  return check === parseInt(digits[9]!, 10);
}

function validateLuhn(text: string): boolean {
  const digits = text.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0, alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i]!, 10);
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return sum % 10 === 0;
}

// ─────────────────────────────────────────────
// Detection
// ─────────────────────────────────────────────

export interface DetectOptions {
  includeKr?: boolean;
  includeCommon?: boolean;
  includeDenyList?: boolean;
  customPatterns?: Pattern[];
  customDenyList?: DenyList[];
  minScore?: number;
}

/**
 * 텍스트에서 PII findings 추출. 정규식 + Luhn/RRN 검증 + deny-list.
 */
export function detect(text: string, opts: DetectOptions = {}): Finding[] {
  const {
    includeKr = true,
    includeCommon = true,
    includeDenyList = true,
    customPatterns = [],
    customDenyList = [],
    minScore = 0.3,
  } = opts;

  const findings: Finding[] = [];
  const patterns = [
    ...(includeKr ? KR_PATTERNS : []),
    ...(includeCommon ? COMMON_PATTERNS : []),
    ...customPatterns,
  ];

  for (const p of patterns) {
    const r = new RegExp(p.regex.source, p.regex.flags);
    let m: RegExpExecArray | null;
    while ((m = r.exec(text)) !== null) {
      const matchText = m[0];
      let score = p.score;
      // 검증 실패 시 점수 하락
      if (p.validate && !p.validate(matchText)) {
        score = Math.max(0, score - 0.4);
        if (score < minScore) continue;
      }
      findings.push({
        entityType: p.entityType,
        start: m.index,
        end: m.index + matchText.length,
        score: Math.round(score * 1000) / 1000,
        text: matchText,
        recognizer: 'PkizipRegex',
        source: 'regex',
      });
      if (!r.global) break;
    }
  }

  if (includeDenyList) {
    const lists = [...BUILTIN_DENY, ...customDenyList];
    for (const dl of lists) {
      for (const term of dl.terms) {
        let pos = 0;
        const lower = text.toLowerCase();
        const tlow = term.toLowerCase();
        while ((pos = lower.indexOf(tlow, pos)) !== -1) {
          findings.push({
            entityType: dl.entityType,
            start: pos,
            end: pos + term.length,
            score: dl.score,
            text: text.substring(pos, pos + term.length),
            recognizer: 'DenyList',
            source: 'denylist',
          });
          pos += term.length;
        }
      }
    }
  }

  // 중복 제거: 같은 (start, end, entityType) 중 최고 점수만
  const dedup = new Map<string, Finding>();
  for (const f of findings) {
    const k = `${f.start}|${f.end}|${f.entityType}`;
    const prev = dedup.get(k);
    if (!prev || prev.score < f.score) dedup.set(k, f);
  }
  return Array.from(dedup.values()).sort((a, b) => a.start - b.start);
}

/**
 * Findings 요약 — entity_type → count (PkiHeader.classification.findingsSummary).
 */
export function summarize(findings: Finding[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of findings) out[f.entityType] = (out[f.entityType] || 0) + 1;
  return out;
}
