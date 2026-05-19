/**
 * 한국어 NER 보강 — HE-TEST `ko_ner.py` 의 클라이언트 포팅.
 *
 * 기존 neural-ner.ts 는 다국어 BERT 만 사용 — 한국어 정확도 한계.
 * 본 모듈은 다음을 추가:
 *   1) 한국어 전용 NER 모델 우선 시도 (Xenova 변환 KoELECTRA 가용 시)
 *   2) HE-TEST `_map_label()` 동등 — 한국어 NER 라벨 스킴 (PS/LC/OG/B-PER/I-PER 등) 표준화
 *   3) 다국어 모델 fallback (현재 neural-ner.ts 동일 모델)
 *
 * 본 모듈은 옵트인 — settings 토글로 활성화. 비활성 시 neural-ner.ts 만 사용.
 *
 * 향후 KoELECTRA-small-v3-modu-ner (50MB, Korean-only) 의 ONNX 변환 후
 * Xenova 호스팅 또는 self-host 시 MODEL_CANDIDATES 선두에 추가.
 */
import type { Finding } from './types';

type NerPipeline = (text: string) => Promise<Array<{
  entity?: string;
  entity_group?: string;
  score: number;
  word: string;
  start?: number;
  end?: number;
}>>;

// 후보 모델 — 한국어 우선 → 다국어 fallback
// Xenova HF Hub 에 미리 ONNX 변환된 모델만 즉시 사용 가능.
// KoELECTRA 변환본 (50MB) 호스팅 시 첫줄에 추가:
//   'Xenova/koelectra-small-v3-modu-ner',  // ← 향후 호스팅 후 활성
const MODEL_CANDIDATES = [
  'Xenova/bert-base-multilingual-cased-ner-hrl',  // 한국어 포함 다국어 (~280MB)
];

export const KO_NER_VERSION = 'ko-ner-v1';

const PRESIDIO = {
  PERSON: 'PERSON',
  LOCATION: 'LOCATION',
  ORG: 'ORGANIZATION',
  DATETIME: 'DATE_TIME',
};

/**
 * 한국어 NER 모델 라벨 → Presidio entity_type.
 *
 * 다양한 한국어 NER 모델이 사용하는 라벨 스킴:
 *  - 모두의말뭉치 (KoBERT 계열): PS / LC / OG / DT / TI / QT
 *  - HuggingFace 표준: PER / LOC / ORG / DATE
 *  - BIO 스킴: B-PER / I-PER / B-LOC ...
 *  - hrl (multilingual): PER / LOC / ORG / MISC
 */
export function mapKoLabel(raw: string | undefined): string | null {
  if (!raw) return null;
  // BIO 접두 제거 (B-PER → PER, I-LOC → LOC, E-ORG → ORG)
  const stripped = raw.replace(/^[BIES]-/i, '').toUpperCase();
  if (stripped.startsWith('PS') || stripped.startsWith('PER') ||
      stripped === 'NAM' || stripped === 'NAME') {
    return PRESIDIO.PERSON;
  }
  if (stripped.startsWith('LC') || stripped.startsWith('LOC') ||
      stripped === 'PLA' || stripped === 'PLACE') {
    return PRESIDIO.LOCATION;
  }
  if (stripped.startsWith('OG') || stripped.startsWith('ORG')) {
    return PRESIDIO.ORG;
  }
  if (stripped.startsWith('DT') || stripped.startsWith('DAT') ||
      stripped === 'TI' || stripped === 'TIME') {
    return PRESIDIO.DATETIME;
  }
  // MISC, QT (quantity) 등은 처리 안 함
  return null;
}

interface KoNerState {
  loading: boolean;
  loaded: boolean;
  modelId: string | null;
  pipeline: NerPipeline | null;
  device: 'wasm' | 'webgpu' | null;
  tried: Array<{ model: string; ok: boolean; error?: string }>;
  loadError: string | null;
}

const _state: KoNerState = {
  loading: false,
  loaded: false,
  modelId: null,
  pipeline: null,
  device: null,
  tried: [],
  loadError: null,
};

let _loadPromise: Promise<void> | null = null;

export function status() {
  return {
    loaded: _state.loaded,
    loading: _state.loading,
    modelId: _state.modelId,
    device: _state.device,
    candidates: [...MODEL_CANDIDATES],
    tried: [..._state.tried],
    version: KO_NER_VERSION,
    loadError: _state.loadError,
  };
}

export function isLoaded(): boolean {
  return _state.loaded;
}

/**
 * 모델 lazy load. 한국어 텍스트 처리 직전 호출.
 */
export async function load(): Promise<void> {
  if (_state.loaded) return;
  if (_loadPromise) return _loadPromise;

  _loadPromise = (async () => {
    _state.loading = true;
    _state.loadError = null;
    _state.tried = [];

    try {
      // transformers.js 동적 import — 첫 호출 시에만
      const tfjs: any = await import('@xenova/transformers');
      const { pipeline, env } = tfjs;

      // 브라우저 cache 활용
      env.useBrowserCache = true;
      env.allowLocalModels = false;

      let lastErr: unknown = null;
      for (const modelId of MODEL_CANDIDATES) {
        try {
          const p: NerPipeline = await pipeline('token-classification', modelId, {
            quantized: true,
          });
          _state.pipeline = p;
          _state.modelId = modelId;
          _state.loaded = true;
          _state.device = 'wasm';
          _state.tried.push({ model: modelId, ok: true });
          return;
        } catch (e) {
          lastErr = e;
          _state.tried.push({
            model: modelId, ok: false,
            error: String((e as Error)?.message || e).slice(0, 200),
          });
        }
      }

      _state.loadError =
        `모든 한국어 NER 모델 로드 실패. 마지막 에러: ${lastErr}`;
      throw new Error(_state.loadError);
    } finally {
      _state.loading = false;
    }
  })();

  return _loadPromise;
}

/**
 * 텍스트에서 한국어 PERSON / LOCATION / ORGANIZATION / DATE_TIME 추출.
 *
 * @param text 분석 대상
 * @param opts.scoreThreshold 최소 confidence (default 0.5)
 */
export async function extract(
  text: string,
  opts: { scoreThreshold?: number } = {}
): Promise<Finding[]> {
  if (!_state.loaded || !_state.pipeline || !text) return [];
  const { scoreThreshold = 0.5 } = opts;

  let raw: Array<{ entity?: string; entity_group?: string; score: number; word: string; start?: number; end?: number; }>;
  try {
    raw = await _state.pipeline(text);
  } catch (e) {
    console.warn('[ko-ner] inference failed:', e);
    return [];
  }

  const findings: Finding[] = [];
  for (const r of raw || []) {
    const labelRaw = r.entity_group || r.entity || '';
    const et = mapKoLabel(labelRaw);
    if (!et) continue;
    if (r.score < scoreThreshold) continue;
    if (r.start === undefined || r.end === undefined) continue;
    const snippet = text.slice(r.start, r.end);
    findings.push({
      entityType: et,
      start: r.start,
      end: r.end,
      score: Math.round(r.score * 1000) / 1000,
      text: snippet,
      recognizer: `ko-ner (${_state.modelId})`,
      source: 'koner',
    });
  }
  return findings;
}
