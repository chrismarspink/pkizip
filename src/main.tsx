import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './i18n';
import './index.css';

// 동적 청크 404 발생 시 (SW가 옛 청크 참조하는 stale 상태) 자동 1회 새로고침
window.addEventListener('vite:preloadError', (event) => {
  console.warn('[PKIZIP] preload 실패 — SW 갱신 후 새로고침', event);
  if (!sessionStorage.getItem('pkizip:preload-reloaded')) {
    sessionStorage.setItem('pkizip:preload-reloaded', '1');
    // SW 캐시는 자동 갱신되므로 단순 reload만으로 새 청크 로드됨
    window.location.reload();
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
