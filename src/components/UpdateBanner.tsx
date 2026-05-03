/**
 * SW 업데이트 감지 배너 — 모바일 PWA 의 stale cache 문제 해결.
 *
 * main.tsx 의 registerSW({ onNeedRefresh }) 가 'pkizip:sw-need-refresh'
 * CustomEvent 를 dispatch → 이 배너가 표시 → 사용자 클릭 시 window.pkizipUpdate(true)
 * 호출로 새 SW 활성화 + reload.
 *
 * "강제 새로고침" 은 핵폭탄 옵션 — SW 등록 해제 + 모든 캐시 + sessionStorage
 * 청산 후 reload. 모바일에서 끈질긴 캐시 문제 발생 시 사용.
 */
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw, X, Trash2 } from 'lucide-react';

declare global {
  interface Window {
    pkizipUpdate?: (force?: boolean) => void;
    pkizipForceRefresh?: () => Promise<void>;
  }
}

export function UpdateBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const fn = () => setShow(true);
    document.addEventListener('pkizip:sw-need-refresh', fn);
    return () => document.removeEventListener('pkizip:sw-need-refresh', fn);
  }, []);

  if (!show) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 80, opacity: 0 }}
        className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] bg-blue-600 text-white rounded-xl shadow-2xl px-4 py-3 flex items-center gap-3 max-w-md"
      >
        <RefreshCw className="w-5 h-5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold">새 버전 사용 가능</div>
          <div className="text-[11px] text-blue-100">업데이트하면 페이지가 새로고침됩니다</div>
        </div>
        <button
          onClick={() => window.pkizipUpdate?.(true)}
          className="px-3 py-1.5 bg-white text-blue-700 rounded-lg text-sm font-semibold hover:bg-blue-50"
        >
          업데이트
        </button>
        <button
          onClick={() => setShow(false)}
          className="p-1 hover:bg-blue-700 rounded text-white/80"
          title="나중에"
        >
          <X className="w-4 h-4" />
        </button>
      </motion.div>
    </AnimatePresence>
  );
}

/**
 * 설정 페이지 등에서 사용할 수 있는 "강제 새로고침" 버튼 — 캐시 핵폭탄.
 */
export function ForceRefreshButton({ className = '' }: { className?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      onClick={async () => {
        if (!confirm('서비스 워커 + 모든 캐시 + 세션 데이터를 삭제하고 새로고침합니다. 진행할까요?')) return;
        setBusy(true);
        await window.pkizipForceRefresh?.();
      }}
      disabled={busy}
      className={`text-xs px-3 py-1.5 border border-red-300 text-red-700 rounded hover:bg-red-50 disabled:opacity-50 inline-flex items-center gap-1.5 ${className}`}
      title="모바일에서 옛 버전이 계속 보일 때 사용"
    >
      <Trash2 className="w-3 h-3" />
      {busy ? '청소 중…' : '캐시 강제 청소 + 새로고침'}
    </button>
  );
}

/**
 * 빌드 정보 표시 — 사용자가 어떤 버전을 보고 있는지 확인용.
 * 사이드바 / 푸터 / 설정 어디든.
 */
export function VersionBadge({ className = '' }: { className?: string }) {
  // vite.config 의 define 으로 주입된 상수
  const version = (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '?');
  const build = (typeof __APP_BUILD__ !== 'undefined' ? __APP_BUILD__ : '?');
  return (
    <div className={`text-[10px] text-zinc-400 font-mono ${className}`} title={`build ${build}`}>
      v{version} · {build}
    </div>
  );
}

declare const __APP_VERSION__: string;
declare const __APP_BUILD__: string;
