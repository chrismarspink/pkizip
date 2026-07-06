/**
 * HeaderStatus — 상단 바 좌측 상태 클러스터.
 *
 * 3개 영역:
 *   1) 활성 인증서 (드롭다운으로 빠른 전환)
 *   2) 시스템 상태 (온라인/오프라인 + 버전 + 업데이트 + 저장소)
 *   3) 보안 배지 — 양자내성 암호 + 타임스탬프(TSA) 를 사용자 언어 단일 칩으로 통합
 *      (기술 용어 PQC/TSA 는 펼침 팝오버 안으로 숨김)
 *
 * 모바일 (<640px) 에선 인증서만 표시 (공간 부족).
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Shield, ChevronDown, Star, Lock, Wifi, WifiOff, Package, Download,
  Cpu, Check, AlertCircle, Loader2, RefreshCw, X,
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
    <div className="flex items-center gap-1.5 min-w-0 flex-1">
      <ActiveIdentityBadge />
      <div className="w-px h-6 bg-zinc-200 flex-shrink-0" />
      <SystemStatus compact={isMobile} />
      {!isMobile && <div className="w-px h-6 bg-zinc-200 flex-shrink-0" />}
      <SecurityBadge compact={isMobile} />
    </div>
  );
}

// ─────────────────────────────────────────────
// 1. 활성 인증서 + 빠른 전환
// ─────────────────────────────────────────────

function ActiveIdentityBadge() {
  const { t } = useTranslation();
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
            <span>{t('header.noCertificate')}</span>
          </>
        ) : locked ? (
          <>
            <Lock className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="truncate">{active.name}</span>
            <span className="text-[10px] opacity-80 flex-shrink-0">{t('header.locked')}</span>
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
            {t('header.activeCertificate')}
          </div>
          {identities.length === 0 ? (
            <div className="px-3 py-4 text-xs text-zinc-500">
              {t('header.noCertsRegistered')}
              <Link to="/certs" onClick={() => setOpen(false)}
                className="block mt-1 text-blue-600 hover:underline">
                {t('header.goToCerts')}
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
            {t('header.manageCerts')}
          </Link>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// 2. 시스템 상태 클러스터
// ─────────────────────────────────────────────

function SystemStatus({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const [online, setOnline] = useState(navigator.onLine);
  const [updateAvailable, setUpdateAvailable] = useState(false);

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

  const version = (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '?');
  const build = (typeof __APP_BUILD__ !== 'undefined' ? __APP_BUILD__ : '?');

  return (
    <div className="flex items-center gap-1 flex-shrink-0">
      <span title={online ? t('header.online') : t('header.offline')}>
        {online
          ? <Wifi className="w-3.5 h-3.5 text-emerald-600" />
          : <WifiOff className="w-3.5 h-3.5 text-amber-600" />}
      </span>
      {!compact && (
        <span title={`PKIZIP v${version} · build ${build}`}
          className="inline-flex items-center gap-1 text-[10px] text-zinc-500 font-mono">
          <Package className="w-3 h-3" /> v{version}
        </span>
      )}
      {updateAvailable && (
        <button
          onClick={() => window.pkizipUpdate?.(true)}
          title={t('header.updateAvailable')}
          className={`inline-flex items-center gap-0.5 text-blue-600 hover:bg-blue-50 px-1 py-0.5 rounded animate-pulse ${
            compact ? '' : 'text-[10px]'
          }`}>
          <Download className="w-3 h-3" />
          {!compact && <span className="text-[10px]">{t('header.update')}</span>}
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// 3. 보안 배지 — 양자내성 암호 + 타임스탬프(TSA) 통합 단일 칩
//    상시 노출은 사용자 언어("보안")로, 기술 상세(PQC/TSA)는 팝오버로 숨김
// ─────────────────────────────────────────────

function SecurityBadge({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const { pqcConfig } = useAppStore();
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [results, setResults] = useState<TsaHealthCache[]>([]);
  const [servers] = useState<TsaServer[]>(() => getTsaSettings().servers);
  const [lastCheck, setLastCheck] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void runCheck();
    // 5분 주기
    const iv = setInterval(() => void runCheck(), 5 * 60 * 1000);
    return () => clearInterval(iv);
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

  // 양자내성 암호 상태
  const pqcEnabled = pqcConfig.kemEnabled || pqcConfig.dsaEnabled;
  const pqcMode = pqcConfig.kemMode || pqcConfig.dsaMode || 'classic';
  const pqcLabel = pqcEnabled
    ? pqcMode === 'pqc-only' ? 'PQC Only'
    : pqcMode === 'hybrid' ? t('header.pqcHybrid')
    : `PQC ${pqcMode}`
    : t('header.pqcClassic');

  // TSA 요약 — 응답 가능한 서버 수 (-2 는 Mixed Content 로 확인 불가, 실패로 카운트 X)
  const checkable = results.filter(r => r.responseMs !== -2);
  const reachable = checkable.filter(r => r.responseMs > 0 && !isBlacklisted(r));
  const allFailed = checkable.length > 0 && reachable.length === 0;
  const tsaStatus: 'ok' | 'partial' | 'fail' | 'checking' =
    checking ? 'checking'
    : allFailed ? 'fail'
    : reachable.length === results.length ? 'ok'
    : 'partial';

  // 칩 색상은 양자내성 암호 활성 여부로 (보안 강도 신호), TSA 상태는 도트로 표시
  const chipColor = pqcEnabled
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
    : 'bg-zinc-100 text-zinc-600 border-zinc-200 hover:bg-zinc-200';
  const dotColor =
    tsaStatus === 'ok' ? 'bg-emerald-500'
    : tsaStatus === 'partial' ? 'bg-amber-500'
    : tsaStatus === 'fail' ? 'bg-red-500'
    : 'bg-zinc-300';

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button onClick={() => setOpen(s => !s)}
        title={t('header.securityTooltip')}
        className={`relative inline-flex items-center gap-1 px-1.5 py-0.5 rounded border transition ${chipColor}`}>
        <Shield className="w-3.5 h-3.5" />
        {!compact && <span className="text-[10px] font-medium">{t('header.security')}</span>}
        {/* TSA 상태 도트 — 확인 중이 아닐 때만 노출 */}
        {tsaStatus !== 'checking' && (
          <span className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full ring-1 ring-white ${dotColor}`} />
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-[420px] bg-white border border-zinc-200 rounded-lg shadow-xl z-50 overflow-hidden">
          <div className="px-3 py-2 border-b flex items-center justify-between bg-zinc-50">
            <div className="text-xs font-semibold text-zinc-700">{t('header.securityStatus')}</div>
            <button onClick={() => setOpen(false)} className="p-0.5 hover:bg-zinc-200 rounded">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* 섹션 A — 양자내성 암호 */}
          <Link to="/settings" onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2.5 border-b hover:bg-zinc-50 transition">
            <Cpu className={`w-4 h-4 flex-shrink-0 ${pqcEnabled ? 'text-violet-600' : 'text-zinc-400'}`} />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-zinc-700">{t('header.quantumCrypto')}</div>
              <div className="text-[10px] text-zinc-500 mt-0.5">{pqcLabel}</div>
            </div>
            <span className="text-[10px] text-blue-600 flex-shrink-0">{t('header.changeInSettings')}</span>
          </Link>

          {/* 섹션 B — 타임스탬프(TSA) */}
          <div className="px-3 py-2 border-b bg-zinc-50/50">
            <div className="text-xs font-semibold text-zinc-700">{t('header.timestampAuthority')}</div>
            <div className="text-[10px] text-zinc-500 mt-0.5">{t('header.tsaPolicy')}</div>
          </div>
          <div className="max-h-72 overflow-y-auto">
            {servers.map(srv => {
              const r = results.find(x => x.serverId === srv.id);
              const blacklisted = r ? isBlacklisted(r) : false;
              const mixedContent = r?.responseMs === -2;
              const ok = r && r.responseMs > 0 && !blacklisted;
              const dotColor = ok ? 'bg-emerald-500'
                : blacklisted ? 'bg-zinc-400'
                : mixedContent ? 'bg-zinc-300'
                : 'bg-red-500';
              return (
                <div key={srv.id} className="px-3 py-2 border-b border-zinc-100 last:border-b-0">
                  <div className="flex items-start gap-2">
                    <div className={`w-2 h-2 mt-1 rounded-full flex-shrink-0 ${dotColor}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-xs">{srv.name}</span>
                        <span className="text-[10px] text-zinc-400">{t('header.priority', { n: srv.priority })}</span>
                        {!srv.enabled && <span className="text-[10px] text-zinc-400">{t('header.inactive')}</span>}
                        {blacklisted && <span className="text-[10px] text-amber-600">{t('header.rateLimited')}</span>}
                        {mixedContent && <span className="text-[10px] text-zinc-500">{t('header.httpOnly')}</span>}
                      </div>
                      <div className="text-[10px] text-zinc-500 font-mono break-all mt-0.5">
                        {srv.url}
                      </div>
                      <div className="text-[10px] mt-0.5">
                        {!r ? (
                          <span className="text-zinc-400">{t('header.unknown')}</span>
                        ) : mixedContent ? (
                          <span className="text-zinc-500">
                            {t('header.mixedContent')}
                          </span>
                        ) : ok ? (
                          <span className="text-emerald-700">
                            {t('header.respondedMs', { ms: r.responseMs.toFixed(0), ago: timeAgoT(t, r.lastChecked) })}
                          </span>
                        ) : blacklisted ? (
                          <span className="text-amber-700">
                            {t('header.blocked', { ago: timeAgoT(t, r.blacklistedUntil!) })}
                          </span>
                        ) : (
                          <span className="text-red-600">
                            {t('header.noResponse', { ago: timeAgoT(t, r.lastChecked) })}
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
              {lastCheck ? t('header.lastCheck', { time: new Date(lastCheck).toLocaleTimeString() }) : t('header.neverChecked')}
              {t('header.edgeProxyNote')}
            </div>
            <button onClick={() => void runCheck()} disabled={checking}
              className="inline-flex items-center gap-1 px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-zinc-300">
              <RefreshCw className={`w-3 h-3 ${checking ? 'animate-spin' : ''}`} />
              {checking ? t('header.checking') : t('header.recheck')}
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

type TFn = (key: string, opts?: Record<string, unknown>) => string;
function timeAgoT(t: TFn, ts: number): string {
  const sec = Math.round((Date.now() - ts) / 1000);
  if (sec < 60) return t('header.secondsAgo', { n: sec });
  const min = Math.round(sec / 60);
  if (min < 60) return t('header.minutesAgo', { n: min });
  const hr = Math.round(min / 60);
  return t('header.hoursAgo', { n: hr });
}
