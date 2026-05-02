/**
 * 한국어 NER 휴리스틱 후처리 (HE-TEST `ner_filter.py` 포팅).
 *
 * 신경망 NER 가 한국어 회의록·기술문서에서 PERSON / LOCATION 을 마구 잡는 경향을
 * 길이·조사·어미·성씨 휴리스틱으로 보정.
 *
 * 적용 대상: `source === 'koner'` 또는 `recognizer.includes('neural-ner')` 인 매치만.
 * 정규식 / deny-list 출처는 신뢰도 충분해 그대로 통과.
 */
import type { Finding } from './types';

// 한국 성씨 상위 ~30종 (인구 80% 커버)
const KR_SURNAMES = new Set(
  '김이박최정강조윤장임한오서신권황안송류전홍고문양손배백허남심노하곽성차주우구민진지엄채원천방공'.split('')
);

// 진짜 인명/지명일 가능성 낮은 끝맺음
const PARTICLE_SUFFIXES = [
  '이','가','은','는','을','를','에','의','와','과','로','으로','에서','에게','한테',
  '도','만','까지','조차','마저','이나','이라','이며','이고',
  '다','요','면','서','지만','거나','어서','아서','는데','은데','겠다','었다','았다',
  '하기','되기','함','됨','임','으면서','면서','으면','려면','려고','으로서','로서',
];

// 진짜 PERSON 일 가능성 낮은 시작 (지시·대명·접속·일반명사)
const META_PREFIXES = [
  '여기','거기','저기','이것','그것','저것',
  '오늘','어제','내일','올해','작년','다음','이번','지난',
  '최종','기본','사업','산업','기술','정부','회사','고객',
  '준비','수정','확인','제출','발표','회의','행사','공무원',
  '매뉴얼','자료','회의록','성과','일정',
  '받을','넣을','쓸','할','갈','올',
  '안녕','감사','환영',
];

function isPureHangul(s: string): boolean {
  return s.length > 0 && /^[가-힯]+$/.test(s);
}

function startsWithAny(text: string, prefixes: string[]): boolean {
  return prefixes.some(p => text.startsWith(p));
}

function endsWithAny(text: string, suffixes: string[]): boolean {
  return suffixes.some(s => text.endsWith(s));
}

function isLikelyKrPerson(text: string): { ok: boolean; reason?: string } {
  const t = text.trim();
  if (t.length < 2)                          return { ok: false, reason: 'too_short' };
  if (t.length > 4)                          return { ok: false, reason: 'too_long_for_person' };
  if (!isPureHangul(t))                      return { ok: false, reason: 'non_hangul' };
  if (!KR_SURNAMES.has(t[0]))                return { ok: false, reason: 'uncommon_surname' };
  if (startsWithAny(t, META_PREFIXES))       return { ok: false, reason: 'meta_prefix' };
  if (endsWithAny(t, PARTICLE_SUFFIXES))     return { ok: false, reason: 'particle_ending' };
  return { ok: true };
}

function isLikelyKrLocation(text: string): { ok: boolean; reason?: string } {
  const t = text.trim();
  if (t.length < 2)                          return { ok: false, reason: 'too_short' };
  if (t.length > 8)                          return { ok: false, reason: 'too_long_for_location' };
  if (!isPureHangul(t))                      return { ok: false, reason: 'non_hangul' };
  if (startsWithAny(t, META_PREFIXES))       return { ok: false, reason: 'meta_prefix' };
  if (endsWithAny(t, PARTICLE_SUFFIXES))     return { ok: false, reason: 'particle_ending' };
  return { ok: true };
}

function isLikelyOrg(text: string): { ok: boolean; reason?: string } {
  const t = text.trim();
  if (t.length < 2)                          return { ok: false, reason: 'too_short' };
  if (t.length > 14)                         return { ok: false, reason: 'too_long_for_org' };
  // ORG 는 다국어 가능 (LG, Microsoft 등) — 한글 강제 X
  if (endsWithAny(t, PARTICLE_SUFFIXES))     return { ok: false, reason: 'particle_ending' };
  return { ok: true };
}

export interface FilterResult {
  kept: Finding[];
  dropped: Array<Finding & { filterReason: string }>;
}

/**
 * NER 출처 PERSON/LOCATION/ORGANIZATION 만 검사 → (통과, 거부 + 사유).
 * 정규식·deny-list 출처는 그대로 통과.
 */
export function filterNerFindings(findings: Finding[]): FilterResult {
  const kept: Finding[] = [];
  const dropped: Array<Finding & { filterReason: string }> = [];

  for (const f of findings) {
    const isNer = f.source === 'koner' || (f.recognizer || '').includes('neural-ner');
    const isFilterable = ['PERSON', 'LOCATION', 'ORGANIZATION'].includes(f.entityType);
    if (!isNer || !isFilterable) {
      kept.push(f);
      continue;
    }

    let result: { ok: boolean; reason?: string };
    if (f.entityType === 'PERSON')         result = isLikelyKrPerson(f.text);
    else if (f.entityType === 'LOCATION')  result = isLikelyKrLocation(f.text);
    else                                    result = isLikelyOrg(f.text);

    if (result.ok) kept.push(f);
    else dropped.push({ ...f, filterReason: result.reason || 'unknown' });
  }
  return { kept, dropped };
}

/** 디버그 — 거부 사유별 통계 */
export function dropStats(dropped: FilterResult['dropped']): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of dropped) out[d.filterReason] = (out[d.filterReason] || 0) + 1;
  return out;
}
