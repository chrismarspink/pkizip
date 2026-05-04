/**
 * HeaderStatus — 상단 바 좌측 상태 클러스터.
 *
 * 4개 영역:
 *   1) 활성 인증서 (드롭다운으로 빠른 전환)
 *   2) 시스템 상태 (온라인/오프라인 + 버전 + 업데이트 + 저장소)
 *   3) PQC 모드 배지
 *   4) TSA 연결 상태
 *
 * 모바일 (<640px) 에선 인증서만 표시 (공간 부족).
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Shield, ChevronDown, Star, Lock, Wifi, WifiOff, Package, Download,
  HardDrive, Cpu, Clock, Check, AlertCircle, Loader2,
} from 'lucide-react';
import { useAppStore } from '@/lib/store/app-store';
import { useIsMobile } from '@/hooks/useMediaQuery';

declare const __APP_VERSION__: string;
declare const __APP_BUILD__: string;

export function HeaderStatus() {
  const isMobile = useIsMobile();
  return (
    <div className="flex items-center gap-2 min-w-0 flex-1">
      <ActiveIdentityBadge />
      {!isMobile && (
        <>
          <div className="w-px h-6 bg-zinc-200 flex-shrink-0" />
          <SystemStatus />
          <div className="w-px h-6 bg-zinc-200 flex-shrink-0" />
          <PqcModeBadge />
          <div className="w-px h-6 bg-zinc-200 flex-shrink-0" />
          <TsaStatusBadge />
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// 1. 활성 인증서 + 빠른 전환
// ─────────────────────────────────────────────

function ActiveIdentityBadge() {
  const { identities, activeIdentityId, isKeyLoaded } = useAppStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const active = identities.find(i => i.id === activeIdentityId);
  const locked = !isKeyLoaded;

  return (
    <div ref={ref} className="relative flex-shrink min-w-0">
      <button
        onClick={() => setOpen(s => !s)}
        className={`flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs transition min-w-0 max-w-[260px] ${
          !active ? 'border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-500'
          : locked ? 'border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-800'
          : 'border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-800'
        }`}
      >
        {!active ? (
          <>
            <Shield className="w-3.5 h-3.5 flex-shrink-0" />
            <span>인증서 없음</span>
          </>
        ) : locked ? (
          <>
            <Lock className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="truncate">{active.name}</span>
            <span className="text-[10px] opacity-80 flex-shrink-0">잠김</span>
          </>
        ) : (
          <>
            <Shield className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="truncate font-semibold">{active.name}</span>
            {active.isDefault && <Star className="w-3 h-3 fill-amber-500 text-amber-500 flex-shrink-0" />}
          </>
        )}
        <ChevronDown className="w-3 h-3 flex-shrink-0 opacity-60" />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 w-72 bg-white border border-zinc-200 rounded-lg shadow-xl z-50 overflow-hidden">
          <div className="px-3 py-2 border-b text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
            활성 인증서
          </div>
          {identities.length === 0 ? (
            <div className="px-3 py-4 text-xs text-zinc-500">
              등록된 인증서가 없습니다.
              <Link to="/certs" onClick={() => setOpen(false)}
                className="block mt-1 text-blue-600 hover:underline">
                인증서 페이지로 이동 →
              </Link>
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto">
              {identities.map(id => {
                const isActive = id.id === activeIdentityId;
                return (
                  <Link key={id.id} to="/certs"
                    onClick={() => setOpen(false)}
                    className={`block px-3 py-2 hover:bg-zinc-50 border-b border-zinc-100 last:border-b-0 ${
                      isActive ? 'bg-emerald-50' : ''
                    }`}>
                    <div className="flex items-center gap-1.5">
                      {isActive && isKeyLoaded && <Check className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />}
                      {isActive && !isKeyLoaded && <Lock className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />}
                      <span className="font-semibold text-sm truncate">{id.name}</span>
                      {id.isDefault && <Star className="w-3 h-3 fill-amber-500 text-amber-500 flex-shrink-0" />}
                    </div>
                    <div className="text-[10px] text-zinc-500 mt-0.5 font-mono truncate">
                      {id.commonName} {id.email && `· ${id.email}`}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
          <Link to="/certs" onClick={() => setOpen(false)}
            className="block px-3 py-2 text-center text-xs text-blue-600 hover:bg-blue-50 border-t border-zinc-200">
            인증서 관리 →
          </Link>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// 2. 시스템 상태 클러스터
// ─────────────────────────────────────────────

function SystemStatus() {
  const [online, setOnline] = useState(navigator.onLine);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [storageMB, setStorageMB] = useState<number | null>(null);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    const refresh = () => setUpdateAvailable(true);
    document.addEventListener('pkizip:sw-need-refresh', refresh);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      document.removeEventListener('pkizip:sw-need-refresh', refresh);
    };
  }, []);

  useEffect(() => {
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      navigator.storage.estimate().then(e => {
        if (e.usage) setStorageMB(Math.round(e.usage / 1024 / 1024));
      }).catch(() => {});
    }
  }, []);

  const version = (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '?');
  const build = (typeof __APP_BUILD__ !== 'undefined' ? __APP_BUILD__ : '?');

  return (
    <div className="flex items-center gap-1 flex-shrink-0">
      <span title={online ? '온라인' : '오프라인 (PWA 캐시로 동작)'}>
        {online
          ? <Wifi className="w-3.5 h-3.5 text-emerald-600" />
          : <WifiOff className="w-3.5 h-3.5 text-amber-600" />}
      </span>
      <span title={`PKIZIP v${version} · build ${build}`}
        className="inline-flex items-center gap-1 text-[10px] text-zinc-500 font-mono">
        <Package className="w-3 h-3" /> v{version}
      </span>
      {updateAvailable && (
        <button
          onClick={() => window.pkizipUpdate?.(true)}
          title="새 버전 사용 가능 — 클릭하여 업데이트"
          className="inline-flex items-center gap-0.5 text-[10px] text-blue-600 hover:bg-blue-50 px-1 py-0.5 rounded animate-pulse">
          <Download className="w-3 h-3" />
          <span>업데이트</span>
        </button>
      )}
      {storageMB !== null && (
        <Link to="/settings" title={`IndexedDB + 캐시: ${storageMB}MB · 클릭 시 설정`}
          className="inline-flex items-center gap-0.5 text-[10px] text-zinc-500 hover:bg-zinc-100 px-1 py-0.5 rounded">
          <HardDrive className="w-3 h-3" /> {storageMB}MB
        </Link>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// 3. PQC 모드 배지
// ─────────────────────────────────────────────

function PqcModeBadge() {
  const { pqcConfig } = useAppStore();
  const enabled = pqcConfig.kemEnabled || pqcConfig.dsaEnabled;
  const mode = pqcConfig.kemMode || pqcConfig.dsaMode || 'classic';

  const label = enabled
    ? mode === 'pqc-only' ? 'PQC Only'
    : mode === 'hybrid' ? 'PQC 하이브리드'
    : `PQC ${mode}`
    : '단순 (Classic)';

  return (
    <Link to="/settings" title={`현재 암호 모드: ${label} · 클릭 시 설정 변경`}
      className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border flex-shrink-0 transition ${
        enabled
          ? 'bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-100'
          : 'bg-zinc-100 text-zinc-600 border-zinc-200 hover:bg-zinc-200'
      }`}>
      <Cpu className="w-3 h-3" />
      <span>{label}</span>
    </Link>
  );
}

// ─────────────────────────────────────────────
// 4. TSA 연결 상태
// ─────────────────────────────────────────────

type TsaStatus = 'checking' | 'ok' | 'fail' | 'idle';

function TsaStatusBadge() {
  const [status, setStatus] = useState<TsaStatus>('idle');
  const [lastCheck, setLastCheck] = useState<number | null>(null);

  useEffect(() => {
    void checkTsa();
    // 5분 주기 재확인
    const t = setInterval(() => void checkTsa(), 5 * 60 * 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function checkTsa() {
    setStatus('checking');
    try {
      // FreeTSA 의 status 엔드포인트는 GET 가능. CORS 미허용 가능 — 그러면 fail.
      // 가벼운 ping 형태로 시도.
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch('https://freetsa.org/', {
        method: 'HEAD',
        mode: 'no-cors',
        signal: ctrl.signal,
        cache: 'no-store',
      });
      clearTimeout(timer);
      // no-cors 모드는 실제 status 못 봄 — 단지 네트워크 reachable 인지 확인
      void res;
      setStatus('ok');
      setLastCheck(Date.now());
    } catch (e) {
      console.warn('[TSA] 상태 확인 실패', e);
      setStatus('fail');
      setLastCheck(Date.now());
    }
  }

  const cfg = {
    checking: { Icon: Loader2, color: 'text-zinc-500 bg-zinc-100 border-zinc-200', label: 'TSA …', spin: true },
    ok:       { Icon: Check,      color: 'text-emerald-700 bg-emerald-50 border-emerald-200', label: 'TSA' },
    fail:     { Icon: AlertCircle, color: 'text-amber-700 bg-amber-50 border-amber-200',   label: 'TSA ✗' },
    idle:     { Icon: Clock,      color: 'text-zinc-500 bg-zinc-100 border-zinc-200', label: 'TSA' },
  } as const;
  const { Icon, color, label, spin } = cfg[status];

  const titleText =
    status === 'ok'   ? `TSA 도달 가능 (FreeTSA) · 마지막 확인 ${lastCheck ? new Date(lastCheck).toLocaleTimeString() : '-'}\n클릭 시 재확인`
    : status === 'fail' ? `TSA 응답 없음 — 서명 시 signingTime 폴백 사용\n클릭 시 재확인`
    : status === 'checking' ? '확인 중…'
    : '대기';

  return (
    <button onClick={() => void checkTsa()} title={titleText}
      className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border flex-shrink-0 transition hover:opacity-80 ${color}`}>
      <Icon className={`w-3 h-3 ${spin ? 'animate-spin' : ''}`} />
      <span>{label}</span>
    </button>
  );
}
