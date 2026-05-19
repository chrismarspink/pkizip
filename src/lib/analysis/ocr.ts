/**
 * OCR — Tesseract.js 래퍼 (브라우저 WASM, 100% 클라이언트).
 *
 * 이미지·스캔 PDF 같은 비-텍스트 파일에서 텍스트 추출 → PII 분석 파이프라인 진입.
 * "이미지로 만들면 PII 탐지 안 됨" 우회 차단의 1차 방어.
 *
 * 모델은 첫 호출 시 lazy 다운로드 (~30MB per language, CDN unpkg).
 */
import type { OcrResult } from './types';

type CreateWorkerFn = (typeof import('tesseract.js'))['createWorker'];
type Worker = Awaited<ReturnType<NonNullable<CreateWorkerFn>>>;

let _worker: Worker | null = null;
let _languages: string[] = [];
let _logger: ((m: TesseractLog) => void) | null = null;

let createWorker: CreateWorkerFn | null = null;

export interface TesseractLog {
  status: string;
  progress?: number;
  jobId?: string;
}

async function ensureLoaded(): Promise<CreateWorkerFn> {
  if (createWorker) return createWorker;
  // 동적 import — 초기 번들 크기 절감
  const mod = await import('tesseract.js');
  createWorker = mod.createWorker;
  return createWorker;
}

/**
 * 앱 i18n 언어 → Tesseract traineddata 언어 배열.
 * 항상 영어 fallback 포함.
 */
export function tesseractLanguagesFor(appLang: string | undefined): string[] {
  const lang = (appLang || 'en').toLowerCase();
  if (lang.startsWith('ko')) return ['kor', 'eng'];
  if (lang.startsWith('ja')) return ['jpn', 'eng'];
  if (lang.startsWith('zh')) return ['chi_sim', 'eng'];
  return ['eng'];
}

/**
 * Tesseract worker 적재. 한 번만 호출되면 캐시.
 */
async function getWorker(languages: string[] = ['kor', 'eng']) {
  const create = await ensureLoaded();
  // 같은 언어 + logger 미사용이면 재사용 (logger는 매 호출마다 다를 수 있음 → 갱신은 별도 콜백 변수로)
  if (_worker && _languages.join(',') === languages.join(',')) return _worker;
  if (_worker) {
    try { await _worker.terminate(); } catch { /* ignore */ }
  }
  // tesseract.js v5+: createWorker(langs, oem, options)
  _worker = await create(languages, undefined, {
    logger: (m: TesseractLog) => { _logger?.(m); },
  } as any);
  _languages = languages;
  return _worker;
}

/**
 * 이미지 파일 (Blob/File/Uint8Array) → 텍스트.
 * onProgress(0..1, status) — UI 진행률 표시 용.
 */
export async function ocrImage(
  image: Blob | File | Uint8Array | string,
  languages: string[] = ['kor', 'eng'],
  onProgress?: (progress: number, status: string) => void,
): Promise<OcrResult> {
  _logger = onProgress
    ? (m) => { if (typeof m.progress === 'number') onProgress(m.progress, m.status); }
    : null;
  try {
    const w = await getWorker(languages);
    const src = image instanceof Uint8Array
      ? new Blob([image as BlobPart])
      : image;
    const { data } = await w.recognize(src);
    return {
      text: data.text || '',
      applied: true,
      engine: 'tesseract.js',
      languages,
      confidence: (data.confidence || 0) / 100,
      pages: 1,
    };
  } finally {
    _logger = null;
  }
}

/**
 * 파일이 OCR 대상인지 — 확장자/MIME 기반.
 */
export function shouldOcr(file: { name?: string; type?: string }): boolean {
  const name = (file.name || '').toLowerCase();
  const type = (file.type || '').toLowerCase();
  if (type.startsWith('image/')) return true;
  if (/\.(jpe?g|png|gif|bmp|tiff?|webp)$/i.test(name)) return true;
  // 스캔 PDF 는 별도 분기 (텍스트 추출 시도 → 비어있으면 OCR)
  return false;
}

/**
 * 메모리 정리 — 페이지 닫힐 때 호출 권장.
 */
export async function disposeOcr(): Promise<void> {
  if (_worker) {
    try { await _worker.terminate(); } catch { /* ignore */ }
    _worker = null;
    _languages = [];
  }
}
