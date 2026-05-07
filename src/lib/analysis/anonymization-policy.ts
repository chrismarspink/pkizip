/**
 * 가명/익명화 정책 — entity_type 별 처리 방법.
 *
 * 사용자는 정책 페이지에서 entity 별로 method 를 바꿀 수 있고,
 * localStorage 에 영속.
 */
import type { AnonymizationMethod, Grade } from './types';

export interface EntityPolicy {
  method: AnonymizationMethod;
  pattern?: string;            // mask
  preserve_last?: number;      // mask
  format?: string;             // replace
  consistent?: boolean;        // replace — true=가명, false=익명
  level?: number;              // generalize
  max_days?: number;           // shift
  precision?: '1억' | '1만';   // round
}

export interface AnonymizationPolicy {
  version: string;
  targetGrade: Grade;
  maxIterations: number;
  /** 매핑 테이블 봉투 동봉 정책 */
  includeMapping: boolean;
  entities: Record<string, EntityPolicy>;
}

export const DEFAULT_POLICY: AnonymizationPolicy = {
  version: 'anon-policy-v1',
  targetGrade: 'O',                  // 사용자가 명시한 "O 등급으로 만들지" 기본값
  maxIterations: 3,
  includeMapping: true,
  entities: {
    // 직접식별자 — 강한 마스킹/제거
    KR_RRN:          { method: 'mask',     pattern: '******-*******' },
    KR_PASSPORT:     { method: 'mask',     pattern: '*********' },
    KR_BIZ_NO:       { method: 'mask',     pattern: '***-**-*****' },
    KR_ARC:          { method: 'mask',     pattern: '******-*******' },
    KR_DRIVERS_LICENSE: { method: 'mask',  pattern: '**-**-******-**' },
    KR_HEALTH_INSURANCE: { method: 'mask', pattern: '*-**********' },
    KR_CORP_REG_NUMBER:  { method: 'mask', pattern: '******-*******' },
    CREDIT_CARD:     { method: 'mask',     preserve_last: 4 },
    AWS_ACCESS_KEY:  { method: 'remove' },
    GENERIC_API_KEY: { method: 'remove' },

    // 약한 식별자
    KR_PHONE:        { method: 'mask',     preserve_last: 4 },
    KR_LANDLINE:     { method: 'mask',     preserve_last: 4 },
    PHONE_NUMBER:    { method: 'mask',     preserve_last: 4 },
    EMAIL_ADDRESS:   { method: 'replace',  format: '[EMAIL_%d]',  consistent: true },

    // NER — 일관성 있는 placeholder (가명)
    PERSON:          { method: 'replace',  format: '[PERSON_%d]', consistent: true },
    LOCATION:        { method: 'replace',  format: '[LOC_%d]',    consistent: true },
    ORGANIZATION:    { method: 'replace',  format: '[ORG_%d]',    consistent: true },
    VIP_NAMES:       { method: 'replace',  format: '[VIP_%d]',    consistent: true },
    INTERNAL_PROJECTS: { method: 'replace', format: '[PROJECT_%d]', consistent: true },

    // 주소/날짜 — 일반화/시프트
    KR_ADDRESS:      { method: 'generalize', level: 1 },
    KR_CAR_PLATE:    { method: 'mask',      preserve_last: 0 },
    DATE_TIME:       { method: 'shift',     max_days: 30 },

    // 기타
    URL:             { method: 'replace',   format: '[URL]' },
    IP_ADDRESS:      { method: 'mask',      pattern: '***.***.***.***' },
  },
};

const KEY = 'pkizip.prefs.anonymization-policy';

export function loadPolicy(): AnonymizationPolicy {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_POLICY, entities: { ...DEFAULT_POLICY.entities } };
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_POLICY,
      ...parsed,
      entities: { ...DEFAULT_POLICY.entities, ...(parsed.entities || {}) },
    };
  } catch {
    return { ...DEFAULT_POLICY, entities: { ...DEFAULT_POLICY.entities } };
  }
}

export function savePolicy(policy: AnonymizationPolicy): void {
  try { localStorage.setItem(KEY, JSON.stringify(policy)); } catch { /* ignore */ }
}

export function resetPolicy(): AnonymizationPolicy {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  return { ...DEFAULT_POLICY, entities: { ...DEFAULT_POLICY.entities } };
}
