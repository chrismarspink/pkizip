/**
 * 온디바이스 대용량 문서 윈도우 스캔 (Part 2 분류기 코어)
 *
 * mDeBERTa 등 트랜스포머는 ~512 토큰이 한계라 대용량 파일을 통째로 넣을 수 없다.
 * UECM classifier-svc(neural.py)의 슬라이딩 윈도우 + DLP worst-case 집계를 그대로 이식해
 * 제품군 등급 일치성을 확보한다. 상수도 동일하게 맞춘다.
 *
 * 차이점(개선): UECM/ai-guard는 신경망을 서버에서 돌리므로 진행바가 "시간 추정" 가짜 바다.
 * pkizip은 온디바이스라 실제 청크 i/total을 알 수 있으므로 진짜 진행률을 방출한다.
 * (추론 함수는 주입식 — 이 코어는 ONNX/모델과 무관하게 테스트된다.)
 */

// UECM neural.py:34-40 과 동일한 상수 (등급 일치성)
export const CHUNK_TOKENS = 384;   // NLI hypothesis 여유를 두고 512 미만 유지
export const CHUNK_OVERLAP = 64;   // 경계에서 잘린 엔티티를 온전히 보기 위한 stride carry-over
export const MAX_CHUNKS = 64;      // 비용 캡 — 초과분은 로깅(무음 truncation 금지)
export const CHAR_CHUNK = 2000;    // tokenizer 없는 경로(embed/사전추론)용 char 윈도우
export const CHAR_OVERLAP = 200;
export const ESCALATE_FLOOR = 0.5; // 윈도우가 문서 심각도를 올리기 위한 최소 등급 확신도

export type Grade = 'OPEN' | 'SENSITIVE' | 'CONFIDENTIAL';
export const GRADE_RANK: Record<Grade, number> = { OPEN: 0, SENSITIVE: 1, CONFIDENTIAL: 2 };
const SEVERITY_DESC: Grade[] = ['CONFIDENTIAL', 'SENSITIVE', 'OPEN'];

export interface GradeScores {
  OPEN: number;
  SENSITIVE: number;
  CONFIDENTIAL: number;
}

export interface WindowResult {
  windows: string[];  // 실제 스캔할 윈도우(최대 MAX_CHUNKS개)
  total: number;      // 필요한 전체 윈도우 수 (캡 초과 시 windows.length < total)
  capped: boolean;    // total > windows.length
}

/**
 * 슬라이딩 윈도우 (UECM _token_chunks / _char_chunks 공통 계약).
 * items 는 문자 배열(문자열) 또는 토큰 id 배열. slice/length 만 사용.
 */
function slide<T extends { length: number; slice(a: number, b: number): T }>(
  items: T, size: number, overlap: number, max: number,
): { ranges: T[]; total: number } {
  if (items.length <= size) return { ranges: [items], total: 1 };
  const step = Math.max(1, size - overlap);
  const ranges: T[] = [];
  let total = 0;
  for (let start = 0; start < items.length; start += step) {
    total += 1;
    if (ranges.length < max) ranges.push(items.slice(start, start + size));
    if (start + size >= items.length) break;
  }
  return { ranges, total };
}

/** char 기반 윈도우 (tokenizer 불필요 경로) */
export function charWindows(
  text: string, size = CHAR_CHUNK, overlap = CHAR_OVERLAP, max = MAX_CHUNKS,
): WindowResult {
  const { ranges, total } = slide(text, size, overlap, max);
  return { windows: ranges, total, capped: total > ranges.length };
}

/** 토큰 기반 윈도우 (모델 tokenizer 주입 — UECM _token_chunks 이식) */
export function tokenWindows(
  text: string,
  encode: (t: string) => number[],
  decode: (ids: number[]) => string,
  size = CHUNK_TOKENS, overlap = CHUNK_OVERLAP, max = MAX_CHUNKS,
): WindowResult {
  const ids = encode(text);
  const { ranges, total } = slide(ids, size, overlap, max);
  return { windows: ranges.map(decode), total, capped: total > ranges.length };
}

/**
 * DLP worst-case 집계 (UECM _infer_zeroshot 이식):
 * 등급별로 모든 윈도우의 최댓값을 취한 뒤, ESCALATE_FLOOR 이상인 가장 심각한 등급이 승리.
 * 어떤 윈도우도 floor를 못 넘으면 rank-broken argmax로 폴백.
 * "가장 민감한 윈도우가 문서 등급을 정한다."
 */
export function aggregateWindowGrades(
  perWindow: GradeScores[], floor = ESCALATE_FLOOR,
): { grade: Grade; confidence: number; perGrade: GradeScores } {
  const per: GradeScores = { OPEN: 0, SENSITIVE: 0, CONFIDENTIAL: 0 };
  for (const w of perWindow) {
    per.OPEN = Math.max(per.OPEN, w.OPEN);
    per.SENSITIVE = Math.max(per.SENSITIVE, w.SENSITIVE);
    per.CONFIDENTIAL = Math.max(per.CONFIDENTIAL, w.CONFIDENTIAL);
  }
  let grade = SEVERITY_DESC.find(g => per[g] >= floor);
  if (!grade) {
    grade = (['OPEN', 'SENSITIVE', 'CONFIDENTIAL'] as Grade[]).reduce((best, g) => {
      if (per[g] > per[best]) return g;
      if (per[g] === per[best] && GRADE_RANK[g] > GRADE_RANK[best]) return g;
      return best;
    }, 'OPEN' as Grade);
  }
  return { grade, confidence: per[grade], perGrade: per };
}

export interface ClassifyProgress {
  stage: 'neural' | 'aggregate';
  current: number;   // 완료한 윈도우 수
  total: number;     // 스캔할 윈도우 수 (캡 적용 후)
  pct: number;       // 0..1 (진짜 진행률 — 시간 추정 아님)
}

export interface WindowedResult {
  grade: Grade;
  confidence: number;
  chunksScanned: number;
  chunksTotal: number;   // 캡 초과 시 chunksScanned < chunksTotal
  capped: boolean;
}

export type ChunkInfer = (window: string, index: number) => Promise<GradeScores>;

/**
 * 윈도우 스캔 오케스트레이터.
 * 각 청크 추론 후 실제 current/total 진행률을 방출한다 (온디바이스라 가능한 진짜 진행바).
 * inferChunk 는 주입 — ONNX/모델 무관하게 이 로직을 테스트할 수 있다.
 */
export async function classifyWindowed(
  text: string,
  inferChunk: ChunkInfer,
  opts: {
    tokenizer?: { encode: (t: string) => number[]; decode: (ids: number[]) => string };
    onProgress?: (p: ClassifyProgress) => void;
  } = {},
): Promise<WindowedResult> {
  const { windows, total, capped } = opts.tokenizer
    ? tokenWindows(text, opts.tokenizer.encode, opts.tokenizer.decode)
    : charWindows(text);

  const scanned = windows.length;
  const scores: GradeScores[] = [];
  for (let i = 0; i < windows.length; i++) {
    scores.push(await inferChunk(windows[i], i));
    opts.onProgress?.({ stage: 'neural', current: i + 1, total: scanned, pct: (i + 1) / scanned });
  }

  opts.onProgress?.({ stage: 'aggregate', current: scanned, total: scanned, pct: 1 });
  const { grade, confidence } = aggregateWindowGrades(scores);
  return { grade, confidence, chunksScanned: scanned, chunksTotal: total, capped };
}
