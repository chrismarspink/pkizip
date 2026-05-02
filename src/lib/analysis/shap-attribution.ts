/**
 * 토큰 기여도 분석 — Occlusion-based attribution.
 *
 * HE-TEST 의 SHAP 통합과 동등한 사용자 가치를 제공하되, 브라우저 환경에서
 * 가벼운 알고리즘으로 구현. SHAP PartitionExplainer 가 제대로 도는 데
 * 5-30초 걸리는 반면, occlusion 은 정규식 기반이라 ~수백 ms.
 *
 * 알고리즘:
 *   1) 텍스트를 토큰(공백 단위 또는 키워드 단위)으로 분리
 *   2) 각 토큰을 마스킹(공백) 후 재분류
 *   3) base_score - masked_score = 토큰 기여도
 *   4) 양수면 등급 상승 기여, 음수면 하락 기여
 *
 * 신경망 NER 통합도 가능하지만 토큰당 ~50ms 추론이라 느림 → 별도 옵션.
 */
import { classify } from './classifier';
import { detect } from './pii-detector';
import type { Classification, Grade } from './types';

export interface TokenAttribution {
  token: string;
  start: number;
  end: number;
  /** base_score - masked_score (양수 = 등급 상승 기여, 음수 = 하락 기여) */
  scoreDelta: number;
  /** -1..1, scoreDelta 를 maxAbs 로 정규화 */
  fraction: number;
  /** 마스킹 시 등급이 바뀌는지 */
  flipsGrade?: Grade;
}

export interface AttributionResult {
  tokens: TokenAttribution[];
  baseScore: number;
  baseGrade: Grade;
  maxAbsDelta: number;
  totalTokens: number;
  evaluated: number;
  elapsedMs: number;
  /** 알고리즘 설명 (UI 표시용) */
  method: 'occlusion-rule-v1';
  version: string;
}

const VERSION = 'attribution-v1';

interface TokenSpan { text: string; start: number; end: number }

/**
 * 텍스트를 의미 있는 토큰으로 분리.
 * 1) 키워드 매칭 (정확한 시작-끝 위치 보존)
 * 2) PII 매칭 위치
 * 3) 그 외 공백 단위 단어 (긴 본문은 2-3 단어 묶음으로 청크)
 */
function tokenize(text: string, maxTokens: number): TokenSpan[] {
  // 단순 시작 — 공백 + 일부 구두점으로 분리
  const re = /\S+/g;
  const out: TokenSpan[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }
  // 너무 많으면 균등 샘플링
  if (out.length <= maxTokens) return out;
  const step = out.length / maxTokens;
  const sampled: TokenSpan[] = [];
  for (let i = 0; i < maxTokens; i++) {
    sampled.push(out[Math.floor(i * step)]!);
  }
  return sampled;
}

/**
 * 토큰별 기여도 계산.
 * @param text 본문
 * @param baseClassification 마스킹 전 분류 결과
 * @param opts.maxTokens 분석할 최대 토큰 수 (기본 200)
 * @param opts.minDelta 이 미만 기여도는 무시 (기본 0.05)
 */
export function computeAttributions(
  text: string,
  baseClassification: Classification,
  opts: { maxTokens?: number; minDelta?: number } = {},
): AttributionResult {
  const t0 = performance.now();
  const maxTokens = opts.maxTokens ?? 200;
  const minDelta = opts.minDelta ?? 0.05;

  const tokens = tokenize(text, maxTokens);
  const baseScore = baseClassification.score;
  const baseGrade = baseClassification.grade;
  const thresholds = baseClassification.thresholds;

  const attributions: TokenAttribution[] = [];

  for (const tok of tokens) {
    // 토큰을 같은 길이 공백으로 마스킹 → 본문 위치 유지
    const filler = ' '.repeat(tok.end - tok.start);
    const masked = text.slice(0, tok.start) + filler + text.slice(tok.end);
    const findings = detect(masked, { minScore: 0.3 });
    const c = classify(findings, masked);

    const delta = baseScore - c.score;
    if (Math.abs(delta) < minDelta) continue;

    let flipsGrade: Grade | undefined;
    if (c.grade !== baseGrade) flipsGrade = c.grade;

    attributions.push({
      token: tok.text,
      start: tok.start,
      end: tok.end,
      scoreDelta: Math.round(delta * 100) / 100,
      fraction: 0,    // 아래에서 채움
      flipsGrade,
    });
  }

  const maxAbs = Math.max(...attributions.map(a => Math.abs(a.scoreDelta)), 0.01);
  for (const a of attributions) {
    a.fraction = Math.round((a.scoreDelta / maxAbs) * 1000) / 1000;
  }

  attributions.sort((a, b) => b.scoreDelta - a.scoreDelta);
  void thresholds;   // reserved for future per-grade attribution

  return {
    tokens: attributions,
    baseScore,
    baseGrade,
    maxAbsDelta: Math.round(maxAbs * 100) / 100,
    totalTokens: tokens.length,
    evaluated: tokens.length,
    elapsedMs: Math.round(performance.now() - t0),
    method: 'occlusion-rule-v1',
    version: VERSION,
  };
}

/**
 * 본문 + attribution → HTML (mark 태그). 토큰별 색상 강도 = |fraction|.
 * 양수 (등급 상승 기여) = 빨강 / 음수 (하락 기여) = 초록.
 */
export function buildAttributionHtml(text: string, result: AttributionResult, maxChars = 4000): string {
  if (!text) return '';
  const truncated = text.length > maxChars;
  const sliced = truncated ? text.slice(0, maxChars) : text;

  // 위치 기반 정렬 + 겹침 제거
  const sorted = [...result.tokens].sort((a, b) => a.start - b.start);
  const placed: TokenAttribution[] = [];
  let lastEnd = -1;
  for (const t of sorted) {
    if (t.start < lastEnd) continue;
    if (t.start >= sliced.length) continue;
    placed.push(t);
    lastEnd = t.end;
  }

  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
     .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  let out = '', cur = 0;
  for (const t of placed) {
    out += escape(sliced.slice(cur, t.start));
    const intensity = Math.min(1, Math.abs(t.fraction));
    const alpha = Math.max(0.1, intensity * 0.6);
    const isPos = t.scoreDelta > 0;
    const bg = isPos ? `rgba(239,68,68,${alpha})` : `rgba(16,185,129,${alpha})`;
    const fg = isPos ? '#7f1d1d' : '#064e3b';
    const border = isPos ? '#fecaca' : '#a7f3d0';
    const sign = t.scoreDelta > 0 ? '+' : '';
    const title = `${t.token}: ${sign}${t.scoreDelta.toFixed(2)}점 ${
      isPos ? '↑ 등급 상승 기여' : '↓ 등급 하락 기여'
    }${t.flipsGrade ? ` · 마스킹 시 ${t.flipsGrade} 로 변경` : ''}`;
    out += `<mark style="background:${bg};color:${fg};border:1px solid ${border};padding:1px 3px;border-radius:3px;font-weight:600" title="${escape(title)}">${escape(sliced.slice(t.start, t.end))}</mark>`;
    cur = t.end;
  }
  out += escape(sliced.slice(cur));
  if (truncated) out += '<span style="color:#9ca3af">…(잘림)</span>';
  return out;
}
