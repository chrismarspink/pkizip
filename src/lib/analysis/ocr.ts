/**
 * OCR — Tesseract.js 래퍼 (브라우저 WASM, 100% 클라이언트).
 *
 * 이미지·스캔 PDF 같은 비-텍스트 파일에서 텍스트 추출 → PII 분석 파이프라인 진입.
 * "이미지로 만들면 PII 탐지 안 됨" 우회 차단의 1차 방어.
 *
 * 모델은 첫 호출 시 lazy 다운로드 (~30MB per language, CDN unpkg).
 */
import type { OcrResult } from './types';

let _worker: Awaited<ReturnType<typeof createWorker>> | null = null;
let _languages: string[] = [];

type CreateWorkerFn = (typeof import('tesseract.js'))['createWorker'];
let createWorker: CreateWorkerFn | null = null;

async function ensureLoaded(): Promise<CreateWorkerFn> {
  if (createWorker) return createWorker;
  // 동적 import — 초기 번들 크기 절감
  const mod = await import('tesseract.js');
  createWorker = mod.createWorker;
  return createWorker;
}

/**
 * Tesseract worker 적재. 한 번만 호출되면 캐시.
 */
async function getWorker(languages: string[] = ['kor', 'eng']) {
  const create = await ensureLoaded();
  // 이미 같은 언어로 로드돼 있으면 재사용
  if (_worker && _languages.join(',') === languages.join(',')) return _worker;
  if (_worker) {
    try { await _worker.terminate(); } catch { /* ignore */ }
  }
  _worker = await create(languages);
  _languages = languages;
  return _worker;
}

/**
 * 이미지 파일 (Blob/File/Uint8Array) → 텍스트.
 */
export async function ocrImage(
  image: Blob | File | Uint8Array | string,
  languages: string[] = ['kor', 'eng'],
): Promise<OcrResult> {
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
