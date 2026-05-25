/**
 * 분석 결과 본문 하이라이트 — PII findings 와 등급 키워드를 <mark> 로 강조.
 *
 * AnalysisDialog 에서 dangerouslySetInnerHTML 로 사용. 순수 함수.
 */
export interface HighlightFinding {
  start: number;
  end: number;
  entityType: string;
}

export interface HighlightKeyword {
  start: number;
  end: number;
  keyword: string;
  label: string;
  weight: number;
}

/**
 * 텍스트 + finding/keyword → HTML.
 * - PII findings: 빨강 mark, title=entityType
 * - 등급 키워드: 노랑 mark, title=label (가중치)
 * - maxChars 초과 시 자른 후 "(잘림)" 표시
 */
export function buildHighlight(
  text: string,
  findings: HighlightFinding[],
  keywords: HighlightKeyword[],
  maxChars = 4000,
): string {
  if (!text) return '<span class="text-zinc-400">본문 없음</span>';
  const truncated = text.length > maxChars;
  const sliced = truncated ? text.slice(0, maxChars) : text;

  type Marker = { start: number; end: number; kind: 'pii' | 'kw'; title: string };
  const markers: Marker[] = [];
  for (const f of findings) {
    if (f.start >= sliced.length) continue;
    markers.push({
      start: f.start,
      end: Math.min(f.end, sliced.length),
      kind: 'pii',
      title: f.entityType,
    });
  }
  for (const k of keywords) {
    if (k.start >= sliced.length) continue;
    markers.push({
      start: k.start,
      end: Math.min(k.end, sliced.length),
      kind: 'kw',
      title: `등급 키워드: ${k.label} (+${k.weight})`,
    });
  }
  markers.sort((a, b) => a.start - b.start || b.end - a.end);
  const placed: Marker[] = [];
  let lastEnd = -1;
  for (const m of markers) {
    if (m.start < lastEnd) continue;
    placed.push(m);
    lastEnd = m.end;
  }

  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
     .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  let out = '', cur = 0;
  for (const m of placed) {
    out += escape(sliced.slice(cur, m.start));
    const cls = m.kind === 'pii'
      ? 'background:#fee2e2;color:#991b1b;border:1px solid #fecaca;padding:0 2px;border-radius:3px;font-weight:600'
      : 'background:#fef3c7;color:#92400e;border:1px solid #fde68a;padding:0 2px;border-radius:3px;font-weight:600';
    out += `<mark style="${cls}" title="${escape(m.title)}">${escape(sliced.slice(m.start, m.end))}</mark>`;
    cur = m.end;
  }
  out += escape(sliced.slice(cur));
  if (truncated) out += '<span style="color:#9ca3af">…(잘림)</span>';
  return out;
}
