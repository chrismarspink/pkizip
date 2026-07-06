/**
 * 신경망 NER — transformers.js 기반 (브라우저 ONNX 추론).
 *
 * Phase D — 정규식 + 키워드만으로는 잡지 못하는 인명/지명/기관명을 탐지.
 * 클라이언트 100% 동작 — 텍스트는 서버로 전송되지 않음.
 *
 * 동작 원칙:
 *   - **opt-in** — settings.neural_ner_enabled 가 true 일 때만 로드
 *   - **lazy load** — 첫 호출 시에만 모델 다운로드 (~30-100MB)
 *   - HuggingFace Hub 의 사전 변환된 ONNX 모델 사용
 *   - 후보 모델 우선순위로 시도 (첫 성공한 것 사용)
 *
 * 출력: pii-detector 의 Finding[] 와 동일 형태 → pipeline 이 그대로 합침
 */
import type { Finding } from './types';
import { CHAR_CHUNK, CHAR_OVERLAP, MAX_CHUNKS } from '../classify/windowing';

// transformers.js 의 token-classification 파이프라인 동적 import
type Pipeline = (text: string) => Promise<Array<{
  entity: string;
  entity_group?: string;
  score: number;
  word: string;
  start?: number;
  end?: number;
}>>;

// 후보 모델 — 첫 성공한 것 사용
const MODEL_CANDIDATES = [
  // 다국어 NER (한국어 포함, ~280MB ONNX) — 검증된 Xenova 변환본
  'Xenova/bert-base-multilingual-cased-ner-hrl',
  // 영문 NER fallback
  'Xenova/bert-base-NER',
];

const NER_VERSION = 'neural-ner-v1';

interface NerState {
  loading: boolean;
  loaded: boolean;
  modelId: string | null;
  pipeline: Pipeline | null;
  loadError: string | null;
  device: 'wasm' | 'webgpu' | null;
  tried: Array<{ model: string; ok: boolean; error?: string }>;
}

const _state: NerState = {
  loading: false,
  loaded: false,
  modelId: null,
  pipeline: null,
  loadError: null,
  device: null,
  tried: [],
};

let _loadPromise: Promise<void> | null = null;

export function status() {
  return {
    loading: _state.loading,
    loaded: _state.loaded,
    modelId: _state.modelId,
    loadError: _state.loadError,
    device: _state.device,
    tried: [..._state.tried],
    version: NER_VERSION,
    candidates: MODEL_CANDIDATES,
  };
}

export function isLoaded(): boolean {
  return _state.loaded;
}

/**
 * 모델 로드 — 첫 호출만 실제 다운로드. 이후는 캐시.
 * 사용자 명시 호출 (UI 의 「로드」 버튼) 또는 첫 분석 자동 호출.
 */
export async function loadModel(): Promise<void> {
  if (_state.loaded) return;
  if (_loadPromise) return _loadPromise;

  _loadPromise = (async () => {
    _state.loading = true;
    _state.loadError = null;
    _state.tried = [];
    try {
      // transformers.js 의 pipeline 동적 import — 초기 번들 영향 0
      const { pipeline, env } = await import('@xenova/transformers');

      // 모델 캐시 디렉터리 — IndexedDB 기반, 한 번 다운로드되면 재사용
      env.allowLocalModels = false;
      env.useBrowserCache = true;

      // WebGPU 가용 시 우선 사용 (Chrome 113+)
      const device: 'wasm' | 'webgpu' =
        typeof navigator !== 'undefined' && (navigator as any).gpu ? 'webgpu' : 'wasm';
      _state.device = device;

      // 후보 모델 순서대로 시도
      let lastErr: any = null;
      for (const cand of MODEL_CANDIDATES) {
        try {
          const pipe = await pipeline('token-classification', cand, {
            quantized: true,           // INT8 양자화로 다운로드 크기 / 메모리 절감
            device,
          } as any);
          _state.pipeline = pipe as unknown as Pipeline;
          _state.modelId = cand;
          _state.loaded = true;
          _state.tried.push({ model: cand, ok: true });
          return;
        } catch (e: any) {
          lastErr = e;
          _state.tried.push({ model: cand, ok: false, error: String(e.message || e).slice(0, 200) });
          continue;
        }
      }
      throw lastErr || new Error('No NER model could be loaded');
    } catch (e: any) {
      _state.loadError = String(e?.message || e);
      throw e;
    } finally {
      _state.loading = false;
    }
  })();

  return _loadPromise.finally(() => { _loadPromise = null; });
}

// transformers.js 의 NER 라벨 → Presidio entity_type 으로 매핑
const NER_LABEL_MAP: Record<string, string> = {
  PER: 'PERSON', PERSON: 'PERSON',
  LOC: 'LOCATION', LOCATION: 'LOCATION',
  ORG: 'ORGANIZATION', ORGANIZATION: 'ORGANIZATION',
  MISC: 'MISC',
};

function mapLabel(rawLabel: string): string | null {
  if (!rawLabel) return null;
  // B-PER, I-PER 같은 BIO 접두사 제거
  const stripped = rawLabel.replace(/^[BI]-/i, '').toUpperCase();
  return NER_LABEL_MAP[stripped] || null;
}

/**
 * 오프셋 추적 char 윈도우 분할 (순수 함수 — 테스트 가능).
 * 경계에서 잘린 엔티티 보존을 위해 overlap 만큼 겹치고, maxWindows 로 비용 캡.
 * @returns windows: 각 {스캔 텍스트, 원문 내 절대 시작 오프셋}, total: 캡 없을 때의 전체 윈도우 수
 */
export function splitWindows(
  text: string, size: number, overlap: number, maxWindows: number,
): { windows: Array<{ text: string; offset: number }>; total: number } {
  if (text.length <= size) return { windows: [{ text, offset: 0 }], total: 1 };
  const step = Math.max(1, size - overlap);
  const windows: Array<{ text: string; offset: number }> = [];
  let total = 0;
  for (let start = 0; start < text.length; start += step) {
    total += 1;
    if (windows.length < maxWindows) windows.push({ text: text.slice(start, start + size), offset: start });
    if (start + size >= text.length) break;
  }
  return { windows, total };
}

/**
 * 텍스트 → 신경망 NER findings.
 * 모델 미로드 상태면 빈 배열 반환 (silent — 호출 측 영향 없음).
 *
 * 대용량 대응: 이전엔 앞 4000자만 보고 나머지를 버렸으나(silent truncation),
 * 이제 문서 전체를 오프셋 추적 char 윈도우로 나눠 각 윈도우에서 추론하고
 * 절대 오프셋으로 합친다. 경계에서 잘린 엔티티는 overlap 으로 보존하고,
 * 겹치는 구간의 중복 엔티티는 (type,start,end) 로 제거한다.
 * windowing.ts 의 T3 경로와 동일한 상수(CHAR_CHUNK/CHAR_OVERLAP/MAX_CHUNKS)를 재사용.
 */
export async function detectNer(
  text: string,
  opts: { minScore?: number; windowSize?: number; maxWindows?: number } = {},
): Promise<Finding[]> {
  // 로컬 캡처 — await 중 dispose() 가 _state.pipeline 을 null 로 만들어도 안전
  const pipeline = _state.pipeline;
  if (!_state.loaded || !pipeline) return [];
  const minScore = opts.minScore ?? 0.7;
  const size = opts.windowSize ?? CHAR_CHUNK;
  const overlap = CHAR_OVERLAP;
  const maxWindows = opts.maxWindows ?? MAX_CHUNKS;

  // 오프셋 추적 char 윈도우 — 짧으면 단일 윈도우(offset 0)로 기존과 동일 동작
  const { windows, total } = splitWindows(text, size, overlap, maxWindows);
  if (total > windows.length) {
    // 비용 캡 초과 — 무음 truncation 금지, 로깅
    const covered = Math.round((windows[windows.length - 1].offset + size) / 1000);
    console.warn(`[neural-ner] 문서가 커서 앞 ${windows.length}/${total} 윈도우만 스캔 (약 ${covered}k자). 나머지는 미스캔.`);
  }

  const all: Finding[] = [];
  for (const win of windows) {
    let raw: any;
    try {
      raw = await pipeline(win.text);
    } catch (e) {
      console.warn('[neural-ner] inference failed (window skipped):', e);
      continue; // 한 윈도우가 실패해도 나머지는 진행
    }
    if (Array.isArray(raw)) groupBio(raw, win.text, win.offset, minScore, all);
  }

  // 오버랩 경계에서 중복 검출된 엔티티 제거
  return dedupeFindings(all);
}

/** BIO 토큰 그룹 합치기 (B-PER + I-PER → 하나의 PERSON entity). 윈도우-상대 오프셋 → 절대 오프셋. */
function groupBio(
  raw: any[], windowText: string, offset: number, minScore: number, out: Finding[],
): void {
  let cur: { entityType: string; start: number; end: number; tokens: string[]; scores: number[] } | null = null;
  const flush = (c: NonNullable<typeof cur>) => {
    const avgScore = c.scores.reduce((s, x) => s + x, 0) / c.scores.length;
    const matchText = windowText.slice(c.start, c.end) || c.tokens.join('');
    if (matchText.trim().length < 2) return;
    out.push({
      entityType: c.entityType,
      start: c.start + offset,
      end: c.end + offset,
      score: Math.round(avgScore * 1000) / 1000,
      text: matchText,
      recognizer: `neural-ner (${_state.modelId})`,
      source: 'koner',
    });
  };
  for (const item of raw) {
    const labelRaw = item.entity || item.entity_group || '';
    const label = mapLabel(labelRaw);
    if (!label || item.score < minScore) {
      if (cur) { flush(cur); cur = null; }
      continue;
    }
    const isBegin = /^B-/i.test(labelRaw) || !cur;
    const sameType = cur && cur.entityType === label;
    if (isBegin || !sameType) {
      if (cur) flush(cur);
      cur = {
        entityType: label,
        start: item.start ?? 0,
        end: item.end ?? 0,
        tokens: [item.word.replace(/^##/, '')],
        scores: [item.score],
      };
    } else if (cur) {
      cur.end = item.end ?? cur.end;
      cur.tokens.push(item.word.replace(/^##/, ''));
      cur.scores.push(item.score);
    }
  }
  if (cur) flush(cur);
}

/** 오버랩 구간에서 중복 검출된 동일 엔티티 제거 (type|start|end 기준, 첫 항목 유지) */
function dedupeFindings(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  const out: Finding[] = [];
  for (const f of findings) {
    const key = `${f.entityType}|${f.start}|${f.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

/** 디버그용 — 메모리 정리 */
export function dispose(): void {
  _state.pipeline = null;
  _state.loaded = false;
  _state.modelId = null;
}
