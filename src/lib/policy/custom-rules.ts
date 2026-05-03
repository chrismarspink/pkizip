/**
 * 사용자 정의 정책 룰 저장소 — 실험 기능 (임시).
 *
 * IndexedDB 스토어명에 EXPERIMENTAL 표기 — 추후 GUI 제거 시 함께 cleanup 가능.
 * 데이터 모델은 단순 JSON DSL: AND 조건 + 거부/권장 액션.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { PolicyInput } from './opa-engine';

export type FieldPath =
  | 'classification.grade'
  | 'classification.score'
  | 'classification.confidence'
  | 'intent.purpose'
  | 'intent.crypto_kind'
  | 'pseudonymization.applied'
  | 'pseudonymization.is_reversible'
  | 'language.detected'
  | 'ocr.applied';

export type Op = 'eq' | 'neq' | 'gt' | 'lt';

export interface Condition {
  field: FieldPath;
  op: Op;
  /** 값 — 문자열·숫자·불리언 (필드 타입에 따름) */
  value: string | number | boolean;
}

export type ActionType = 'deny' | 'recommend';

export interface CustomRule {
  id: string;                 // ulid
  name: string;
  enabled: boolean;
  /** AND — 모두 충족 시 fire */
  conditions: Condition[];
  action: {
    type: ActionType;
    reason: string;           // 룰 코드 (예: 'CUSTOM_X')
    message: string;          // 사용자 메시지
  };
  createdAt: number;
}

interface CustomRulesDB extends DBSchema {
  'custom-rules-EXPERIMENTAL': {
    key: string;
    value: CustomRule;
  };
  'disabled-builtins-EXPERIMENTAL': {
    key: string;                        // 빌트인 룰 reason code
    value: { reason: string; disabledAt: number };
  };
}

const DB_NAME = 'pkizip-policy';
const DB_VERSION = 2;                   // 빌트인 비활성화 store 추가
const STORE = 'custom-rules-EXPERIMENTAL';
const DISABLED_STORE = 'disabled-builtins-EXPERIMENTAL';

let _db: Promise<IDBPDatabase<CustomRulesDB>> | null = null;
function db() {
  if (!_db) {
    _db = openDB<CustomRulesDB>(DB_NAME, DB_VERSION, {
      upgrade(d, oldVersion) {
        if (oldVersion < 1) d.createObjectStore(STORE, { keyPath: 'id' });
        if (oldVersion < 2) d.createObjectStore(DISABLED_STORE, { keyPath: 'reason' });
      },
    });
  }
  return _db;
}

export async function listCustomRules(): Promise<CustomRule[]> {
  const d = await db();
  const all = await d.getAll(STORE);
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveCustomRule(rule: CustomRule): Promise<void> {
  const d = await db();
  await d.put(STORE, rule);
}

export async function deleteCustomRule(id: string): Promise<void> {
  const d = await db();
  await d.delete(STORE, id);
}

export async function clearAllCustomRules(): Promise<void> {
  const d = await db();
  await d.clear(STORE);
}

// ─────────────────────────────────────────────
// 빌트인 룰 비활성화 set CRUD
// ─────────────────────────────────────────────

export async function listDisabledBuiltinReasons(): Promise<string[]> {
  const d = await db();
  const all = await d.getAll(DISABLED_STORE);
  return all.map(x => x.reason);
}

export async function setBuiltinDisabled(reason: string, disabled: boolean): Promise<void> {
  const d = await db();
  if (disabled) {
    await d.put(DISABLED_STORE, { reason, disabledAt: Date.now() });
  } else {
    await d.delete(DISABLED_STORE, reason);
  }
}

export async function clearAllDisabledBuiltins(): Promise<void> {
  const d = await db();
  await d.clear(DISABLED_STORE);
}

// ─────────────────────────────────────────────
// 빌트인 룰 — JSON DSL 미러 (rules.rego / opa-engine.ts evalTs 와 동기화)
// 편집 불가, 복제만 가능. 비활성화는 disabled set 에 reason 추가로.
// ─────────────────────────────────────────────

export const BUILTIN_RULES: Readonly<CustomRule[]> = Object.freeze([
  {
    id: 'BUILTIN_C_GRADE_REQUIRES_PQC_FOR_EXTERNAL',
    name: 'C 등급 외부전송 PQC 필수',
    enabled: true,
    conditions: [
      { field: 'classification.grade', op: 'eq', value: 'C' },
      { field: 'intent.purpose', op: 'eq', value: 'external' },
      { field: 'intent.crypto_kind', op: 'eq', value: 'classic' },
    ],
    action: {
      type: 'deny',
      reason: 'C_GRADE_REQUIRES_PQC_FOR_EXTERNAL',
      message: 'C(위험) 등급 문서는 외부 전송 시 PQC(양자내성) 암호화가 필요합니다. 단순 암호로는 전송 불가.',
    },
    createdAt: 0,
  },
  {
    id: 'BUILTIN_C_GRADE_REQUIRES_ANONYMIZATION_FOR_EXTERNAL',
    name: 'C 등급 외부전송 가명/익명화 필수',
    enabled: true,
    conditions: [
      { field: 'classification.grade', op: 'eq', value: 'C' },
      { field: 'intent.purpose', op: 'eq', value: 'external' },
      { field: 'pseudonymization.applied', op: 'eq', value: false },
    ],
    action: {
      type: 'deny',
      reason: 'C_GRADE_REQUIRES_ANONYMIZATION_FOR_EXTERNAL',
      message: 'C(위험) 등급 문서는 외부 전송 전 가명/익명화 처리가 필요합니다.',
    },
    createdAt: 0,
  },
  {
    id: 'BUILTIN_LANGUAGE_DOWNGRADE_BLOCKED',
    name: '비한국어 + O 등급 외부전송 차단 (언어 우회 의심)',
    enabled: true,
    conditions: [
      { field: 'language.detected', op: 'neq', value: 'ko' },
      { field: 'language.detected', op: 'neq', value: 'und' },
      { field: 'classification.grade', op: 'eq', value: 'O' },
      { field: 'intent.purpose', op: 'eq', value: 'external' },
      { field: 'pseudonymization.applied', op: 'eq', value: false },
    ],
    action: {
      type: 'deny',
      reason: 'LANGUAGE_DOWNGRADE_BLOCKED',
      message: '비한국어 문서를 O(공개) 등급으로 외부 전송 시도 — 언어 변환 우회 의심으로 차단됩니다.',
    },
    createdAt: 0,
  },
  {
    id: 'BUILTIN_OCR_C_GRADE_REQUIRES_REVIEW',
    name: 'OCR + C 등급 수동 검토 필수',
    enabled: true,
    conditions: [
      { field: 'ocr.applied', op: 'eq', value: true },
      { field: 'classification.grade', op: 'eq', value: 'C' },
      { field: 'pseudonymization.applied', op: 'eq', value: false },
    ],
    action: {
      type: 'deny',
      reason: 'OCR_C_GRADE_REQUIRES_REVIEW',
      message: 'OCR이 적용된 C(위험) 등급 문서는 수동 검토가 필요합니다.',
    },
    createdAt: 0,
  },
]);

/** 빌트인 + 비활성화 정보를 합쳐서 표시용 룰 배열 반환 */
export async function listEffectiveBuiltinRules(): Promise<CustomRule[]> {
  const disabled = new Set(await listDisabledBuiltinReasons());
  return BUILTIN_RULES.map(r => ({ ...r, enabled: !disabled.has(r.action.reason) }));
}

// ─────────────────────────────────────────────
// 평가
// ─────────────────────────────────────────────

function getField(input: PolicyInput, path: FieldPath): unknown {
  const parts = path.split('.');
  let cur: unknown = input;
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in cur) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return cur;
}

function matches(actual: unknown, op: Op, expected: string | number | boolean): boolean {
  switch (op) {
    case 'eq':  return actual === expected;
    case 'neq': return actual !== expected;
    case 'gt':  return typeof actual === 'number' && typeof expected === 'number' && actual > expected;
    case 'lt':  return typeof actual === 'number' && typeof expected === 'number' && actual < expected;
  }
}

export interface CustomEvalResult {
  denyReasons: { reason: string; message: string }[];
  recommended: { reason: string; message: string }[];
}

/** 활성화된 사용자 룰을 input 에 평가 */
export function evalCustomRules(input: PolicyInput, rules: CustomRule[]): CustomEvalResult {
  const out: CustomEvalResult = { denyReasons: [], recommended: [] };
  for (const r of rules) {
    if (!r.enabled) continue;
    const fired = r.conditions.every(c => matches(getField(input, c.field), c.op, c.value));
    if (!fired) continue;
    const item = { reason: r.action.reason, message: r.action.message };
    if (r.action.type === 'deny') out.denyReasons.push(item);
    else out.recommended.push(item);
  }
  return out;
}

/** ULID — 시간순 정렬 가능한 ID */
const ALPH = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function ulid(): string {
  const ts = Date.now();
  let tsPart = '';
  let n = ts;
  for (let i = 0; i < 10; i++) { tsPart = ALPH[n % 32] + tsPart; n = Math.floor(n / 32); }
  let rand = '';
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  for (const b of buf) rand += ALPH[b % 32];
  return tsPart + rand;
}

// 메타데이터 — UI 의 dropdown 옵션에 사용
export const FIELD_LABELS: Record<FieldPath, { label: string; type: 'string' | 'number' | 'boolean'; options?: string[] }> = {
  'classification.grade':           { label: '등급', type: 'string', options: ['C', 'S', 'O'] },
  'classification.score':           { label: '점수', type: 'number' },
  'classification.confidence':      { label: '신뢰도 (0~1)', type: 'number' },
  'intent.purpose':                 { label: '보관 위치', type: 'string', options: ['internal', 'external'] },
  'intent.crypto_kind':             { label: '암호 방식', type: 'string', options: ['classic', 'hybrid', 'pqc-only', 'pqc-he'] },
  'pseudonymization.applied':       { label: '가명/익명화 적용', type: 'boolean' },
  'pseudonymization.is_reversible': { label: '가역적 (가명) 여부', type: 'boolean' },
  'language.detected':              { label: '언어 (ISO 639-1)', type: 'string' },
  'ocr.applied':                    { label: 'OCR 적용', type: 'boolean' },
};

export const OP_LABELS: Record<Op, string> = {
  eq:  '같음 (==)',
  neq: '다름 (≠)',
  gt:  '큼 (>)',
  lt:  '작음 (<)',
};
