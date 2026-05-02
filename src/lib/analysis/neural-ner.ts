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
 * 텍스트 → 신경망 NER findings.
 * 모델 미로드 상태면 빈 배열 반환 (silent — 호출 측 영향 없음).
 */
export async function detectNer(
  text: string,
  opts: { minScore?: number; maxLength?: number } = {},
): Promise<Finding[]> {
  if (!_state.loaded || !_state.pipeline) return [];
  const minScore = opts.minScore ?? 0.7;
  const maxLength = opts.maxLength ?? 4000;

  const sample = text.length > maxLength ? text.slice(0, maxLength) : text;
  let raw: any;
  try {
    raw = await _state.pipeline(sample);
  } catch (e) {
    console.warn('[neural-ner] inference failed:', e);
    return [];
  }

  if (!Array.isArray(raw)) return [];

  // BIO 토큰 그룹 합치기 (B-PER + I-PER → 하나의 PERSON entity)
  const findings: Finding[] = [];
  let cur: { entityType: string; start: number; end: number; tokens: string[]; scores: number[] } | null = null;
  for (const item of raw) {
    const labelRaw = item.entity || item.entity_group || '';
    const label = mapLabel(labelRaw);
    if (!label) {
      if (cur) { flush(cur, findings); cur = null; }
      continue;
    }
    if (item.score < minScore) {
      if (cur) { flush(cur, findings); cur = null; }
      continue;
    }
    const isBegin = /^B-/i.test(labelRaw) || !cur;
    const sameType = cur && cur.entityType === label;
    if (isBegin || !sameType) {
      if (cur) flush(cur, findings);
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
  if (cur) flush(cur, findings);
  return findings;

  function flush(c: NonNullable<typeof cur>, out: Finding[]) {
    const avgScore = c.scores.reduce((s, x) => s + x, 0) / c.scores.length;
    const matchText = sample.slice(c.start, c.end) || c.tokens.join('');
    if (matchText.trim().length < 2) return;
    out.push({
      entityType: c.entityType,
      start: c.start,
      end: c.end,
      score: Math.round(avgScore * 1000) / 1000,
      text: matchText,
      recognizer: `neural-ner (${_state.modelId})`,
      source: 'koner',
    });
  }
}

/** 디버그용 — 메모리 정리 */
export function dispose(): void {
  _state.pipeline = null;
  _state.loaded = false;
  _state.modelId = null;
}
