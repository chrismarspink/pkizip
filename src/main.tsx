import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import './i18n';
import './index.css';

// ─────────────────────────────────────────────
// SW 업데이트 감지 — 모바일 PWA에서도 안정적으로 새 버전 받기
//
// 1) 30분 주기 + 탭 활성화 시 즉시 update() 호출
//    (모바일 브라우저는 자체 SW 체크 주기가 길거나 비활성화 시 멈춤)
// 2) 새 SW 감지 시 'pkizip:sw-need-refresh' 이벤트 → React 배너 노출
// 3) window.pkizipForceRefresh() — 사용자 콘솔용 수동 캐시 청소
// ─────────────────────────────────────────────

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    document.dispatchEvent(new CustomEvent('pkizip:sw-need-refresh'));
  },
  onRegisteredSW(_swUrl, reg) {
    if (!reg) return;
    // 30분 주기 업데이트 체크
    setInterval(() => { reg.update().catch(() => {}); }, 30 * 60 * 1000);
    // 탭이 다시 활성화되면 즉시 체크 (백그라운드에서 한참 있다가 돌아온 케이스)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        reg.update().catch(() => {});
      }
    });
  },
});

// 앱 어디서든 호출 가능 (배너의 "업데이트" 버튼 + 콘솔 수동 호출)
type WindowExt = typeof window & {
  pkizipUpdate?: (force?: boolean) => void;
  pkizipForceRefresh?: () => Promise<void>;
};
const w = window as WindowExt;

w.pkizipUpdate = (force = true) => updateSW(force);

// 핵폭탄 옵션 — SW 등록 해제 + 모든 캐시 삭제 + sessionStorage 비우고 reload
// 모바일에서 끈질긴 캐시 문제 해결용
w.pkizipForceRefresh = async () => {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
    if ('caches' in window) {
      const names = await caches.keys();
      await Promise.all(names.map(n => caches.delete(n)));
    }
    sessionStorage.clear();
  } finally {
    window.location.reload();
  }
};

// PWA file_handlers — OS "PKIZIP 으로 열기" 로 진입 시 launchQueue 로 파일 수신
// → setPendingFile() 에 넣고 /files 로 라우팅 (FilesTempPage 가 takePendingFile() 로 자동 분석)
type LaunchParams = { files: { getFile: () => Promise<File> }[] };
const wq = window as typeof window & {
  launchQueue?: { setConsumer: (cb: (params: LaunchParams) => void) => void };
};
if (wq.launchQueue) {
  wq.launchQueue.setConsumer(async (params) => {
    if (!params.files || params.files.length === 0) return;
    try {
      const file = await params.files[0]!.getFile();
      const { setPendingFile } = await import('./lib/store/pending-file');
      setPendingFile(file);
      const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
      window.location.assign(`${base}/files`);
    } catch (e) {
      console.warn('[PKIZIP] launchQueue 파일 수신 실패:', e);
    }
  });
}

// 동적 청크 404 (옛 SW 가 옛 청크 참조하는 stale) → 자동 1회 새로고침
window.addEventListener('vite:preloadError', (event) => {
  console.warn('[PKIZIP] preload 실패 — SW 갱신 후 새로고침', event);
  if (!sessionStorage.getItem('pkizip:preload-reloaded')) {
    sessionStorage.setItem('pkizip:preload-reloaded', '1');
    window.location.reload();
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
