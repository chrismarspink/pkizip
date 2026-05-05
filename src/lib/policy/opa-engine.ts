/**
 * OPA 정책 평가 엔진 — 클라이언트 WASM 우선, TypeScript fallback.
 *
 * 운영 시:
 *   1) `opa build -t wasm -o policy.wasm rules.rego` → public/policy.wasm
 *   2) opa-wasm 라이브러리로 fetch + 평가
 *   3) 같은 입력 스키마로 결정 반환
 *
 * 빌드 인프라 갖춰지기 전까지는 TypeScript 직접 구현 (rules.rego 와 동일 로직).
 * 두 경로 모두 같은 PolicyDecision 반환 — UI 가 알아채지 못함.
 */
import type { Grade } from '../analysis/types';
import type { CryptoKind, Purpose } from '../store/preferences';
import { evalCustomRules, listCustomRules, listDisabledBuiltinReasons, type CustomRule } from './custom-rules';

export interface PolicyInput {
  intent: {
    purpose: Purpose;
    crypto_kind: CryptoKind;
  };
  classification: {
    grade: Grade;
    score: number;
    confidence: number;
  };
  pseudonymization: {
    applied: boolean;
    is_reversible: boolean;
    final_grade?: Grade;
  };
  language: {
    detected: string;
  };
  ocr: {
    applied: boolean;
  };
  /** DPV 메타 — 봉투 헤더에 자동 부착된 IRI. 정책 룰이 의미 단위로 판단 가능. */
  dpv?: {
    data_categories?: string[];
    processing_activities?: string[];
    applied_measures?: string[];
  };
}

export interface PolicyDecision {
  allow: boolean;
  requireWatermark: boolean;
  requireAnonymization: boolean;
  requirePqc: boolean;
  denyReasons: string[];
  recommendedActions: string[];
  /** 평가에 사용된 엔진 — 디버그/감사용 */
  engine: 'wasm' | 'ts-fallback';
  evaluatedAt: string;
}

// ─────────────────────────────────────────────
// WASM 시도 (옵션)
// ─────────────────────────────────────────────
let _wasmInstance: any = null;
let _wasmDisabled = false;

async function tryLoadWasm(): Promise<any | null> {
  if (_wasmInstance) return _wasmInstance;
  if (_wasmDisabled) return null;
  try {
    // public/policy.wasm 이 있을 때만 동작
    const url = `${import.meta.env.BASE_URL}policy.wasm`;
    const head = await fetch(url, { method: 'HEAD' });
    if (!head.ok) {
      _wasmDisabled = true;
      return null;
    }
    const { loadPolicy } = await import('@open-policy-agent/opa-wasm');
    const buf = await (await fetch(url)).arrayBuffer();
    _wasmInstance = await loadPolicy(buf);
    return _wasmInstance;
  } catch (e) {
    console.warn('[opa] WASM 로드 실패, TS fallback 사용:', e);
    _wasmDisabled = true;
    return null;
  }
}

async function evalWasm(input: PolicyInput): Promise<PolicyDecision | null> {
  const policy = await tryLoadWasm();
  if (!policy) return null;
  try {
    const result = policy.evaluate(input);
    // OPA WASM 결과 형태 → PolicyDecision 변환
    const r = result?.[0]?.result || {};
    return {
      allow: !!r.allow,
      requireWatermark: !!r.require_watermark,
      requireAnonymization: !!r.require_anonymization,
      requirePqc: !!r.require_pqc,
      denyReasons: Array.from(r.deny_reasons || []) as string[],
      recommendedActions: Array.from(r.recommended_actions || []) as string[],
      engine: 'wasm',
      evaluatedAt: new Date().toISOString(),
    };
  } catch (e) {
    console.warn('[opa] WASM 평가 실패, TS fallback:', e);
    return null;
  }
}

// ─────────────────────────────────────────────
// TS fallback — rules.rego 와 동일 로직
// ─────────────────────────────────────────────
// DPV 고위험 데이터 카테고리 — 외부 전송 시 가명/익명화 필수
const DPV_HIGH_RISK_CATEGORIES = new Set([
  'dpv:NationalIdentifier',
  'dpv:Passport',
  'dpv:DriversLicense',
  'dpv:HealthCareInsurance',
  'dpv:CreditCardNumber',
]);

function evalTs(input: PolicyInput): PolicyDecision {
  const denyReasons: string[] = [];
  const recommended: string[] = [];

  const isExternal = input.intent.purpose === 'external';
  const grade = input.classification.grade;
  const cryptoKind = input.intent.crypto_kind;
  const lang = input.language.detected;
  const ocr = input.ocr.applied;
  const anon = input.pseudonymization.applied;
  const dpvCats = input.dpv?.data_categories ?? [];
  const hasCredential = dpvCats.includes('dpv:Authenticating');
  const hasHighRiskPii = dpvCats.some(c => DPV_HIGH_RISK_CATEGORIES.has(c));

  // 거부 사유 — C/S 등급 외부 전송: PQC 암호화 또는 가명/익명화 둘 중 하나 필수
  if (grade !== 'O' && isExternal && cryptoKind === 'classic' && !anon) {
    denyReasons.push('SENSITIVE_REQUIRES_PQC_OR_ANON_FOR_EXTERNAL');
  }
  if (lang !== 'ko' && lang !== 'und' && grade === 'O' && isExternal && !anon) {
    denyReasons.push('LANGUAGE_DOWNGRADE_BLOCKED');
  }
  if (ocr && grade === 'C' && !anon) {
    denyReasons.push('OCR_C_GRADE_REQUIRES_REVIEW');
  }
  // DPV 기반 룰
  if (hasCredential && isExternal) {
    denyReasons.push('DPV_CREDENTIAL_EXTERNAL_BLOCKED');
  }
  if (hasHighRiskPii && isExternal && !anon) {
    denyReasons.push('DPV_HIGH_RISK_PII_REQUIRES_ANON_EXTERNAL');
  }

  // 강제 액션
  const requireWatermark = isExternal && (grade === 'S' || grade === 'C');
  const requireAnonymization = grade === 'C' && !anon;
  const requirePqc = isExternal && grade !== 'O';

  // 권고
  if (grade === 'C' && !anon) recommended.push('ANONYMIZE_BEFORE_SEND');
  if (grade === 'C' && cryptoKind !== 'pqc-only' && cryptoKind !== 'pqc-he') {
    recommended.push('USE_PQC_FOR_C_GRADE');
  }
  if (grade === 'S' && isExternal && !anon) recommended.push('CONSIDER_PSEUDONYMIZATION');
  if (ocr) recommended.push('OCR_APPLIED_VERIFY_ACCURACY');
  // 고위험 PII 가 있는데 등급이 O 인 경우 — 분류 오류 의심
  if (hasHighRiskPii && grade === 'O') recommended.push('DPV_REVIEW_GRADE_HIGH_RISK_PII');
  // 고위험 PII 가 있고 익명화 미적용 시 권고 (외부 전송 아니어도)
  if (hasHighRiskPii && !anon) recommended.push('DPV_HIGH_RISK_PII_DETECTED');

  return {
    allow: denyReasons.length === 0,
    requireWatermark,
    requireAnonymization,
    requirePqc,
    denyReasons,
    recommendedActions: recommended,
    engine: 'ts-fallback',
    evaluatedAt: new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

export async function evaluate(input: PolicyInput): Promise<PolicyDecision> {
  const wasm = await evalWasm(input);
  const base = wasm ?? evalTs(input);
  const filtered = filterDisabledBuiltins(base);
  return mergeCustomRules(filtered, input);
}

/** 사용자가 GUI 에서 비활성화한 빌트인 룰의 reason 을 base 결정에서 제거 */
let _cachedDisabled: Set<string> | null = null;
let _disabledLoading: Promise<void> | null = null;

function loadDisabledAsync(): Promise<void> {
  if (_disabledLoading) return _disabledLoading;
  _disabledLoading = (async () => {
    try {
      const arr = await listDisabledBuiltinReasons();
      _cachedDisabled = new Set(arr);
    } catch {
      _cachedDisabled = new Set();
    }
  })();
  return _disabledLoading;
}

export async function invalidateDisabledBuiltinsCache(): Promise<void> {
  _cachedDisabled = null;
  _disabledLoading = null;
  await loadDisabledAsync();
}

function filterDisabledBuiltins(base: PolicyDecision): PolicyDecision {
  if (_cachedDisabled === null) {
    void loadDisabledAsync();
    return base;
  }
  if (_cachedDisabled.size === 0) return base;
  const denyReasons = base.denyReasons.filter(r => !_cachedDisabled!.has(r));
  return {
    ...base,
    denyReasons,
    // 모든 거부 사유가 비활성화로 사라졌으면 allow=true 로 (단 다른 곳에서 추가될 수 있음)
    allow: denyReasons.length === 0,
  };
}

/**
 * 사용자 정의 룰 (실험 기능) 결과를 base 결정에 병합.
 * 캐시: PoliciesPage 가 마운트 시 또는 룰 변경 시 invalidate. evaluate() 첫
 * 호출 시 비동기 로드 (그 호출은 base 만 반환 → 다음 호출부터 custom 적용).
 */
let _cachedCustomRules: CustomRule[] | null = null;
let _customRulesLoading: Promise<void> | null = null;

function loadCustomRulesAsync(): Promise<void> {
  if (_customRulesLoading) return _customRulesLoading;
  _customRulesLoading = (async () => {
    try {
      _cachedCustomRules = await listCustomRules();
    } catch {
      _cachedCustomRules = [];
    }
  })();
  return _customRulesLoading;
}

/** 사용자가 룰 추가/수정/삭제 시 호출 — 캐시 무효화 + 즉시 재로드 */
export async function invalidateCustomRulesCache(): Promise<void> {
  _cachedCustomRules = null;
  _customRulesLoading = null;
  await loadCustomRulesAsync();
}

function mergeCustomRules(base: PolicyDecision, input: PolicyInput): PolicyDecision {
  if (_cachedCustomRules === null) {
    void loadCustomRulesAsync();
    return base;
  }
  if (_cachedCustomRules.length === 0) return base;
  const custom = evalCustomRules(input, _cachedCustomRules);
  return {
    ...base,
    denyReasons: [...base.denyReasons, ...custom.denyReasons.map(r => r.reason)],
    recommendedActions: [...base.recommendedActions, ...custom.recommended.map(r => r.reason)],
    allow: base.allow && custom.denyReasons.length === 0,
  };
}

/** 거부 사유 → 사용자 친화적 한국어 메시지 */
export const REASON_MESSAGES: Record<string, string> = {
  SENSITIVE_REQUIRES_PQC_OR_ANON_FOR_EXTERNAL:
    'C/S(위험·민감) 등급 문서는 외부 전송 시 PQC(양자내성) 암호화 또는 가명/익명화 처리 둘 중 하나가 필요합니다.',
  LANGUAGE_DOWNGRADE_BLOCKED:
    '비한국어 문서를 O(공개) 등급으로 외부 전송 시도 — 언어 변환 우회 의심으로 차단됩니다.',
  OCR_C_GRADE_REQUIRES_REVIEW:
    'OCR이 적용된 C(위험) 등급 문서는 수동 검토가 필요합니다.',
  DPV_CREDENTIAL_EXTERNAL_BLOCKED:
    '자격증명(API 키·인증 토큰 등) 이 포함된 봉투의 외부 전송은 차단됩니다 — 즉시 키를 회전(rotate)하세요.',
  DPV_HIGH_RISK_PII_REQUIRES_ANON_EXTERNAL:
    '고위험 PII (주민번호·여권·신용카드·건강보험·운전면허) 가 포함된 봉투의 외부 전송은 가명/익명화가 필수입니다.',
};

export const ACTION_MESSAGES: Record<string, string> = {
  ANONYMIZE_BEFORE_SEND: '송신 전 가명/익명화를 적용해 등급을 낮추세요.',
  USE_PQC_FOR_C_GRADE: 'C 등급은 PQC(양자내성) 암호화 사용을 권장합니다.',
  CONSIDER_PSEUDONYMIZATION: '가명처리를 고려하세요 — 외부 전송 시 부분 식별자 노출 차단.',
  OCR_APPLIED_VERIFY_ACCURACY: 'OCR 결과의 정확도를 사용자가 확인 후 송신해주세요.',
  DPV_REVIEW_GRADE_HIGH_RISK_PII:
    '고위험 PII 가 검출됐는데 등급이 O(공개) 입니다 — 분류 오류 가능성. 등급 재검토하세요.',
  DPV_HIGH_RISK_PII_DETECTED:
    '고위험 PII (주민번호·여권 등) 가 검출됐습니다 — 가명/익명화를 고려하세요.',
};
