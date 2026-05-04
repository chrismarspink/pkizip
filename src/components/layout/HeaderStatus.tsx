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
  HardDrive, Cpu, Check, AlertCircle, Loader2, RefreshCw, X,
} from 'lucide-react';
import { useAppStore } from '@/lib/store/app-store';
import { useIsMobile } from '@/hooks/useMediaQuery';
import {
  checkAllTsaHealth, getTsaSettings,
  type TsaServer, type TsaHealthCache,
} from '@/lib/tsa-health';

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

function TsaStatusBadge() {
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [results, setResults] = useState<TsaHealthCache[]>([]);
  const [servers] = useState<TsaServer[]>(() => getTsaSettings().servers);
  const [lastCheck, setLastCheck] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void runCheck();
    // 5분 주기
    const t = setInterval(() => void runCheck(), 5 * 60 * 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  async function runCheck() {
    setChecking(true);
    try {
      const r = await checkAllTsaHealth(servers);
      setResults(r);
      setLastCheck(Date.now());
    } finally {
      setChecking(false);
    }
  }

  // 요약 — 응답 가능한 서버 수
  const reachable = results.filter(r => r.responseMs > 0 && !isBlacklisted(r));
  const allFailed = results.length > 0 && reachable.length === 0;
  const status: 'ok' | 'partial' | 'fail' | 'checking' =
    checking ? 'checking'
    : allFailed ? 'fail'
    : reachable.length === results.length ? 'ok'
    : 'partial';

  const cfg = {
    checking: { Icon: Loader2, color: 'text-zinc-500 bg-zinc-100 border-zinc-200', label: 'TSA …', spin: true },
    ok:       { Icon: Check,      color: 'text-emerald-700 bg-emerald-50 border-emerald-200', label: `TSA ${reachable.length}/${results.length}` },
    partial:  { Icon: AlertCircle, color: 'text-amber-700 bg-amber-50 border-amber-200',   label: `TSA ${reachable.length}/${results.length}` },
    fail:     { Icon: AlertCircle, color: 'text-red-700 bg-red-50 border-red-200',   label: `TSA ✗ ${reachable.length}/${results.length}` },
  } as const;
  const { Icon, color, label, spin } = cfg[status];

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button onClick={() => setOpen(s => !s)}
        title={`TSA 서버 도달 ${reachable.length}/${results.length} · 클릭 시 상세`}
        className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border transition hover:opacity-80 ${color}`}>
        <Icon className={`w-3 h-3 ${spin ? 'animate-spin' : ''}`} />
        <span>{label}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-[420px] bg-white border border-zinc-200 rounded-lg shadow-xl z-50 overflow-hidden">
          <div className="px-3 py-2 border-b flex items-center justify-between bg-zinc-50">
            <div>
              <div className="text-xs font-semibold text-zinc-700">TSA 서버 상태 (RFC 3161)</div>
              <div className="text-[10px] text-zinc-500 mt-0.5">
                서명 시 우선순위순 시도 — 첫 응답 사용. 모두 실패 시 signingTime 폴백.
              </div>
            </div>
            <button onClick={() => setOpen(false)} className="p-0.5 hover:bg-zinc-200 rounded">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="max-h-72 overflow-y-auto">
            {servers.map(srv => {
              const r = results.find(x => x.serverId === srv.id);
              const blacklisted = r ? isBlacklisted(r) : false;
              const ok = r && r.responseMs > 0 && !blacklisted;
              return (
                <div key={srv.id} className="px-3 py-2 border-b border-zinc-100 last:border-b-0">
                  <div className="flex items-start gap-2">
                    <div className={`w-2 h-2 mt-1 rounded-full flex-shrink-0 ${
                      ok ? 'bg-emerald-500' : blacklisted ? 'bg-zinc-400' : 'bg-red-500'
                    }`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-xs">{srv.name}</span>
                        <span className="text-[10px] text-zinc-400">우선 {srv.priority}</span>
                        {!srv.enabled && <span className="text-[10px] text-zinc-400">· 비활성</span>}
                        {blacklisted && <span className="text-[10px] text-amber-600">· 일시 차단</span>}
                      </div>
                      <div className="text-[10px] text-zinc-500 font-mono break-all mt-0.5">
                        {srv.url}
                      </div>
                      <div className="text-[10px] mt-0.5">
                        {!r ? (
                          <span className="text-zinc-400">미확인</span>
                        ) : ok ? (
                          <span className="text-emerald-700">
                            응답 {r.responseMs.toFixed(0)}ms · 확인 {timeAgo(r.lastChecked)}
                          </span>
                        ) : blacklisted ? (
                          <span className="text-amber-700">
                            ~{timeAgo(r.blacklistedUntil!)} 까지 일시 차단 — 사용 안 함
                          </span>
                        ) : (
                          <span className="text-red-600">
                            응답 없음 · 마지막 시도 {timeAgo(r.lastChecked)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="px-3 py-2 border-t flex items-center justify-between bg-zinc-50 text-[10px]">
            <div className="text-zinc-500">
              {lastCheck ? `최종 ${new Date(lastCheck).toLocaleTimeString()}` : '확인 전'}
              {' · CORS 차단 시 Edge Function 프록시 경유'}
            </div>
            <button onClick={() => void runCheck()} disabled={checking}
              className="inline-flex items-center gap-1 px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-zinc-300">
              <RefreshCw className={`w-3 h-3 ${checking ? 'animate-spin' : ''}`} />
              {checking ? '확인 중' : '재확인'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function isBlacklisted(r: TsaHealthCache): boolean {
  return !!r.blacklistedUntil && r.blacklistedUntil > Date.now();
}

function timeAgo(ts: number): string {
  const sec = Math.round((Date.now() - ts) / 1000);
  if (sec < 60) return `${sec}초 전`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}분 전`;
  const hr = Math.round(min / 60);
  return `${hr}시간 전`;
}
