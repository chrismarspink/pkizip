/**
 * 가명/익명 처리 — HE-TEST anonymization.py 클라이언트 포팅.
 *
 * 6 method 분류 (GDPR Art.4(5) / 개인정보보호법 정합):
 *   - mask(pattern/preserve_last)           — 가명 (매핑 보유 시 복원)
 *   - replace(consistent=true)              — 가명 (일관성 매핑)
 *   - replace(consistent=false)             — 익명 (매번 새 placeholder)
 *   - remove                                — 익명
 *   - generalize                            — 익명
 *   - shift                                 — 익명 (deterministic 이지만 max_days 정보 없으면 복원 불가)
 *   - round                                 — 익명
 *
 * 정책은 anonymization-policy.ts 에서 관리.
 */
import type { AnonymizationMethod, AnonymizationResult, Finding, Replacement } from './types';
import type { AnonymizationPolicy } from './anonymization-policy';
import { DEFAULT_POLICY } from './anonymization-policy';
import { GRADE_KEYWORDS } from './classifier';

/** 메서드별 가역성 — 가명 vs 익명 분류용 */
function isMethodReversible(method: AnonymizationMethod, cfg: { consistent?: boolean; preserve_last?: number }): boolean {
  switch (method) {
    case 'mask':       return (cfg.preserve_last ?? 0) > 0;     // 일부 보존 시 부분 복원 가능
    case 'replace':    return cfg.consistent === true;          // consistent=true → 매핑 보유 시 복원
    case 'remove':
    case 'generalize':
    case 'shift':
    case 'round':      return false;
    default:           return false;
  }
}

/**
 * findings + 정책 → 익명화 텍스트 + 변경 내역 + 매핑.
 */
export function applyPolicy(
  text: string,
  findings: Finding[],
  policy: AnonymizationPolicy = DEFAULT_POLICY,
): AnonymizationResult {
  const ent = policy.entities;

  // 같은 위치/엔티티 dedup + 시작순 정렬
  const dedup = new Map<string, Finding>();
  for (const f of findings) {
    const k = `${f.start}|${f.end}|${f.entityType}`;
    const prev = dedup.get(k);
    if (!prev || prev.score < f.score) dedup.set(k, f);
  }
  const sorted = Array.from(dedup.values()).sort((a, b) => a.start - b.start);

  const counters = new Map<string, number>();
  const consistentMap = new Map<string, string>();
  const replacements: Replacement[] = [];
  const stats: Record<string, number> = {};
  const out: string[] = [];
  let cursor = 0;
  let anyReversible = false;
  let anyIrreversible = false;

  for (const f of sorted) {
    if (f.start < cursor) continue;
    const cfg = ent[f.entityType];
    if (!cfg) continue;
    const original = text.substring(f.start, f.end);
    const ph = computePlaceholder(cfg.method, cfg, f.entityType, original, counters, consistentMap);

    out.push(text.substring(cursor, f.start));
    out.push(ph);
    cursor = f.end;

    const reversible = isMethodReversible(cfg.method, cfg);
    if (reversible) anyReversible = true; else anyIrreversible = true;

    replacements.push({
      startOrig: f.start,
      endOrig: f.end,
      original,
      replacement: ph,
      entityType: f.entityType,
      method: cfg.method,
      isReversible: reversible,
    });
    stats[f.entityType] = (stats[f.entityType] || 0) + 1;
  }
  out.push(text.substring(cursor));

  // ─────────────────────────────────────────────
  // 2단계: 등급 키워드 마스킹.
  // classifier 가 'Secret', '대외비' 같은 키워드만으로 C 등급을 매기는 경우,
  // entity findings 가 없어도 키워드 자체를 제거해야 등급이 내려간다.
  // 이 단계 없으면 「가명/익명화 클릭해도 등급 변동 없음」 deadlock.
  // ─────────────────────────────────────────────
  let textAfterEntities = out.join('');
  const kwReplacements = applyKeywordMasking(textAfterEntities, replacements, stats);
  textAfterEntities = kwReplacements.text;
  if (kwReplacements.count > 0) anyIrreversible = true;   // 키워드 제거는 비가역

  // 전체 가역성: 비가역 method가 하나라도 섞이면 false (보수적)
  const isReversible = anyReversible && !anyIrreversible;

  // mapping 직렬화
  const mapping: Record<string, string> = {};
  for (const [k, v] of consistentMap) mapping[k] = v;

  return {
    anonymizedText: textAfterEntities,
    replacements,
    mapping,
    stats,
    policyVersion: policy.version,
    isReversible,
  };
}

/**
 * 등급 키워드 마스킹 — 본문에서 GRADE_KEYWORDS 매칭을 [REDACTED] 로 치환.
 * classifier 가 키워드 가산점으로 등급을 결정하는 경우 이걸 안 지우면 강등 불가능.
 */
function applyKeywordMasking(
  text: string,
  replacementsOut: Replacement[],
  statsOut: Record<string, number>,
): { text: string; count: number } {
  let out = text;
  let count = 0;
  // 긴 키워드부터 매칭 (top secret 이 secret 보다 먼저)
  const sorted = [...GRADE_KEYWORDS].sort((a, b) => b[0].length - a[0].length);
  for (const [kw, , label] of sorted) {
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(escaped, 'gi');
    const replaced = out.replace(re, (match, offset: number) => {
      replacementsOut.push({
        startOrig: offset,
        endOrig: offset + match.length,
        original: match,
        replacement: '[REDACTED]',
        entityType: `KW_${label}`,
        method: 'replace',
        isReversible: false,
      });
      statsOut[`KW_${label}`] = (statsOut[`KW_${label}`] || 0) + 1;
      count++;
      return '[REDACTED]';
    });
    out = replaced;
  }
  return { text: out, count };
}

function computePlaceholder(
  method: AnonymizationMethod,
  cfg: { pattern?: string; preserve_last?: number; format?: string; consistent?: boolean;
         level?: number; max_days?: number; precision?: string },
  entityType: string,
  original: string,
  counters: Map<string, number>,
  consistentMap: Map<string, string>,
): string {
  switch (method) {
    case 'mask':
      if (cfg.pattern) return cfg.pattern;
      if (cfg.preserve_last && cfg.preserve_last > 0 && original.length > cfg.preserve_last) {
        return '*'.repeat(original.length - cfg.preserve_last) + original.substring(original.length - cfg.preserve_last);
      }
      return '*'.repeat(Math.max(1, original.length));

    case 'remove':
      return '';

    case 'replace': {
      const fmt = cfg.format || `[${entityType}_%d]`;
      if (cfg.consistent) {
        const key = `${entityType}|${original}`;
        const existing = consistentMap.get(key);
        if (existing) return existing;
        const n = (counters.get(entityType) || 0) + 1;
        counters.set(entityType, n);
        const ph = fmt.includes('%d') ? fmt.replace('%d', String(n)) : fmt;
        consistentMap.set(key, ph);
        return ph;
      } else {
        const n = (counters.get(entityType) || 0) + 1;
        counters.set(entityType, n);
        return fmt.includes('%d') ? fmt.replace('%d', String(n)) : fmt;
      }
    }

    case 'generalize':
      return generalize(original, cfg.level ?? 1);

    case 'shift':
      return shiftDate(original, cfg.max_days ?? 30);

    case 'round':
      return roundMoney(original, cfg.precision ?? '1만');

    default:
      return '[REDACTED]';
  }
}

function generalize(text: string, level: number): string {
  const parts = text.split(/\s+/);
  if (parts.length === 0) return text;
  const keep = Math.max(1, parts.length - Math.max(0, level));
  return parts.slice(0, keep).join(' ');
}

const DATE_RE = /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/;

function shiftDate(text: string, maxDays: number): string {
  const m = DATE_RE.exec(text);
  if (!m) return text;
  // deterministic — text hash 기반 ±maxDays
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  const days = (Math.abs(hash) % (2 * maxDays + 1)) - maxDays;
  try {
    const d = new Date(parseInt(m[1]!, 10), parseInt(m[2]!, 10) - 1, parseInt(m[3]!, 10));
    d.setDate(d.getDate() + days);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return text.substring(0, m.index) + iso + text.substring(m.index + m[0].length);
  } catch {
    return text;
  }
}

const NUM_RE = /[\d,]+/;

function roundMoney(text: string, precision: string): string {
  const m = NUM_RE.exec(text);
  if (!m) return text;
  const v = parseInt(m[0].replace(/,/g, ''), 10);
  if (isNaN(v)) return text;
  if (precision === '1억') {
    const r = Math.round(v / 1e8) * 1e8;
    return text.substring(0, m.index) + `${Math.floor(r / 1e8)}억` + text.substring(m.index + m[0].length);
  }
  if (precision === '1만') {
    const r = Math.round(v / 1e4) * 1e4;
    return text.substring(0, m.index) + `${Math.floor(r / 1e4).toLocaleString()}만` + text.substring(m.index + m[0].length);
  }
  return text;
}
