/**
 * useEmbedHost — PKIZIP 이 외부 페이지의 iframe 안에서 호스팅될 때
 * 부모 창과 postMessage 로 통신하는 훅.
 *
 * 사용 시나리오 (HE-TEST 등):
 *   부모 페이지가 PKIZIP 을 <iframe> 으로 임베드 → 사용자가 PKIZIP 에서
 *   파일 분석/봉투 생성 → PKIZIP 이 결과를 부모에게 자동 전송 → 부모가
 *   서버에 기록.
 *
 * 프로토콜:
 *   IN  pkizip:host-hello        부모 ↦ PKIZIP   handshake (origin 신뢰 등록)
 *   IN  pkizip:inject-text       부모 ↦ PKIZIP   분석 페이지에 텍스트 주입
 *   OUT pkizip:embed-ready       PKIZIP ↦ 부모  hook 활성화 알림
 *   OUT pkizip:classified        PKIZIP ↦ 부모  분석 완료 (등급/findings/DPV)
 *   OUT pkizip:sealed            PKIZIP ↦ 부모  봉투 생성 완료 (.pki bytes)
 */
import { useEffect, useRef } from 'react';

export type EmbedOutMessage =
  | { type: 'pkizip:embed-ready'; version: string }
  | { type: 'pkizip:classified'; requestId?: string; result: ClassifiedPayload }
  | { type: 'pkizip:sealed'; requestId?: string; envelope: { name: string; base64: string; mime: string }; meta: SealedMeta };

export interface ClassifiedPayload {
  grade: 'C' | 'S' | 'O' | string;
  score?: number;
  rationale?: string;
  findings: Array<{ entityType: string; original?: string; start?: number; end?: number; score?: number }>;
  dpv?: {
    dataCategories?: string[];
    processingActivities?: string[];
    appliedMeasures?: string[];
  };
  language?: string;
  ocrApplied?: boolean;
}

export interface SealedMeta {
  fileName: string;
  fileSize: number;
  grade?: string;
  algorithm?: string;
  pqcApplied?: boolean;
  signed?: boolean;
  encrypted?: boolean;
  enveloped?: boolean;
  createdAt: number;
}

const DEFAULT_ALLOWED_ORIGIN_PATTERNS: RegExp[] = [
  /^http:\/\/localhost(:\d+)?$/i,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/i,
  /^https:\/\/[\w-]+\.hf\.space$/i,
  /^https:\/\/huggingface\.co$/i,
];

let trustedOrigin: string | null = null;
let listenerInstalled = false;
const injectHandlers = new Set<(text: string, requestId?: string) => void>();

function isAllowedOrigin(origin: string): boolean {
  return DEFAULT_ALLOWED_ORIGIN_PATTERNS.some(p => p.test(origin));
}

/** 부모 창으로 메시지 전송. handshake 전에는 무시. */
export function emitToHost(msg: EmbedOutMessage): void {
  if (typeof window === 'undefined') return;
  if (window.parent === window) return; // 임베드 모드 아님
  if (!trustedOrigin) {
    // handshake 전 — 일시적 큐잉 없이 무시 (PoC). 운영 시 큐 + flush.
    console.debug('[pkizip:embed] no trusted parent yet, dropping', msg.type);
    return;
  }
  try {
    window.parent.postMessage(msg, trustedOrigin);
  } catch (e) {
    console.warn('[pkizip:embed] postMessage failed', e);
  }
}

/** 부모가 분석 텍스트를 주입한 경우 콜백을 받는다. CreatePage 등에서 사용. */
export function onEmbedTextInjected(cb: (text: string, requestId?: string) => void): () => void {
  injectHandlers.add(cb);
  return () => injectHandlers.delete(cb);
}

/**
 * 임베드 모드 (window.parent !== window) 일 때 postMessage 리스너를 설치하고
 * handshake / inject 메시지를 처리한다. App 루트에서 한 번 호출.
 */
export function useEmbedHost(): { embedded: boolean; trustedOriginRef: { current: string | null } } {
  const embedded = typeof window !== 'undefined' && window.parent !== window;
  const trustedOriginRef = useRef<string | null>(null);

  useEffect(() => {
    if (!embedded || listenerInstalled) return;
    listenerInstalled = true;

    const handler = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== 'object' || typeof data.type !== 'string') return;
      if (!data.type.startsWith('pkizip:')) return;
      if (!isAllowedOrigin(event.origin)) {
        console.warn('[pkizip:embed] dropping message from untrusted origin', event.origin);
        return;
      }
      if (data.type === 'pkizip:host-hello') {
        trustedOrigin = event.origin;
        trustedOriginRef.current = event.origin;
        emitToHost({
          type: 'pkizip:embed-ready',
          version: (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'),
        });
        return;
      }
      if (data.type === 'pkizip:inject-text' && typeof data.text === 'string') {
        if (trustedOrigin !== event.origin) {
          console.warn('[pkizip:embed] inject-text from non-handshake origin', event.origin);
          return;
        }
        for (const cb of injectHandlers) {
          try { cb(data.text, data.requestId); } catch (e) { console.error(e); }
        }
      }
    };
    window.addEventListener('message', handler);
    // 부모에게 사전 알림 — 부모가 늦게 hello 보내도 OK
    try {
      window.parent.postMessage(
        { type: 'pkizip:embed-ready', version: (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev') },
        '*' // 아직 trusted origin 모름 — pre-handshake 만 *
      );
    } catch { /* no-op */ }
    return () => {
      window.removeEventListener('message', handler);
      listenerInstalled = false;
    };
  }, [embedded]);

  return { embedded, trustedOriginRef };
}

// vite-injected version constant
declare const __APP_VERSION__: string;
