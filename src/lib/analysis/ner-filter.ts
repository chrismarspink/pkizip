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

// ─────────────────────────────────────────────
// 일본어 휴리스틱 (HE-TEST _is_japanese_text 포팅)
// 가나(히라가나·카타카나) OR (한자 + 한글 부재) → 일본어
// ─────────────────────────────────────────────
const JP_PARTICLE_SUFFIXES = [
  // 助詞
  'は','が','を','に','へ','で','と','の','も','や','か',
  'から','まで','より','など','ばかり','だけ','しか','こそ',
  // 用言活用
  'です','ます','した','する','ました','ません','だった',
  'ている','ています','なる','なって','ない','ある',
];

const JP_META_PREFIXES = [
  'これ','それ','あれ','ここ','そこ','あそこ','どこ',
  '今日','明日','昨日','今年','去年','来年',
  '会社','部署','営業','経理','総務','人事','企画',
  '確認','提出','発表','会議','議事録','資料','報告',
  '管理','運営','検査','検討','評価','実施','対応',
];

// 일본 행정구역 접미사 — LOCATION 긍정 신호
const JP_LOC_ADMIN_SUFFIX = ['県','府','都','道','市','区','町','村','郡','丁目','番地','号','駅','空港','港'];

function isJapaneseText(s: string): boolean {
  if (!s) return false;
  // 히라가나 U+3040-309F · 카타카나 U+30A0-30FF
  const hasKana = /[぀-ゟ゠-ヿ]/.test(s);
  if (hasKana) return true;
  // 한글 부재 + 한자 존재 → 일본어 (현대 한국어는 한자 단독 드묾)
  const hasHangul = /[가-힯]/.test(s);
  const hasKanji  = /[一-鿿]/.test(s);
  return hasKanji && !hasHangul;
}

function isLikelyJpPerson(text: string): { ok: boolean; reason?: string } {
  const t = text.trim();
  if (t.length < 2)                            return { ok: false, reason: 'too_short' };
  if (t.length > 8)                            return { ok: false, reason: 'too_long_for_person' };
  if (startsWithAny(t, JP_META_PREFIXES))      return { ok: false, reason: 'jp_meta_prefix' };
  if (endsWithAny(t, JP_PARTICLE_SUFFIXES))    return { ok: false, reason: 'jp_particle_ending' };
  // 모두 히라가나 = 어휘/조사 가능성 高
  if (/^[぀-ゟ\s]+$/.test(t))          return { ok: false, reason: 'jp_all_hiragana' };
  return { ok: true };
}

function isLikelyJpLocation(text: string): { ok: boolean; reason?: string } {
  const t = text.trim();
  if (t.length < 2)                            return { ok: false, reason: 'too_short' };
  if (t.length > 16)                           return { ok: false, reason: 'too_long_for_location' };
  if (endsWithAny(t, JP_PARTICLE_SUFFIXES))    return { ok: false, reason: 'jp_particle_ending' };
  // 행정구역 접미사 → 강한 통과
  if (JP_LOC_ADMIN_SUFFIX.some(suf => t.endsWith(suf))) return { ok: true };
  // 한자 2-4자 단독 (예: 渋谷, 東京) — 일반 지명 통과
  if (t.length >= 2 && t.length <= 4 && /^[一-鿿]+$/.test(t)) return { ok: true };
  return { ok: false, reason: 'jp_no_admin_suffix' };
}

function isLikelyJpOrg(text: string): { ok: boolean; reason?: string } {
  const t = text.trim();
  if (t.length < 2)                            return { ok: false, reason: 'too_short' };
  if (t.length > 20)                           return { ok: false, reason: 'too_long_for_org' };
  if (endsWithAny(t, JP_PARTICLE_SUFFIXES))    return { ok: false, reason: 'jp_particle_ending' };
  // 株式会社/合同会社 등 명시 → 강한 통과
  if (/(株式会社|合同会社|有限会社|社団法人|財団法人|Inc|Corp|Ltd)/.test(t)) return { ok: true };
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

    // 일본어 텍스트면 일본어 룰, 아니면 한국어 룰 (기본)
    const isJp = isJapaneseText(f.text);
    let result: { ok: boolean; reason?: string };
    if (f.entityType === 'PERSON') {
      result = isJp ? isLikelyJpPerson(f.text) : isLikelyKrPerson(f.text);
    } else if (f.entityType === 'LOCATION') {
      result = isJp ? isLikelyJpLocation(f.text) : isLikelyKrLocation(f.text);
    } else {
      result = isJp ? isLikelyJpOrg(f.text) : isLikelyOrg(f.text);
    }

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
