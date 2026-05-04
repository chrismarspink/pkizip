/**
 * TSA 서버 상태 관리 — 헬스체크, 서버 선택, 블랙리스트
 */

export interface TsaServer {
  id: string;
  name: string;
  url: string;
  priority: number;
  enabled: boolean;
}

export interface TsaHealthCache {
  serverId: string;
  responseMs: number;
  lastChecked: number;
  blacklistedUntil?: number;
}

export const DEFAULT_TSA_LIST: TsaServer[] = [
  { id: 'digicert',   name: 'DigiCert',   url: 'https://timestamp.digicert.com',                      priority: 1, enabled: true },
  { id: 'sectigo',    name: 'Sectigo',     url: 'https://timestamp.sectigo.com',                       priority: 2, enabled: true },
  { id: 'globalsign', name: 'GlobalSign',  url: 'http://timestamp.globalsign.com/tsa/r6advanced1',     priority: 3, enabled: true },
  { id: 'freetsa',    name: 'FreeTSA',     url: 'https://freetsa.org/tsr',                             priority: 4, enabled: true },
];

const CACHE_KEY = 'pkizip-tsa-health';
const CACHE_TTL = 60 * 60 * 1000; // 1시간
const BLACKLIST_DURATION = 30 * 60 * 1000; // 30분

/** localStorage에서 캐시 로드 */
function loadCache(): TsaHealthCache[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveCache(cache: TsaHealthCache[]) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch {}
}

/** 단일 TSA 헬스체크 (HEAD 또는 빈 POST) */
async function checkSingleTsa(server: TsaServer, timeoutMs = 3000): Promise<number> {
  // HTTPS 페이지에서 HTTP TSA 직접 호출은 Mixed Content 로 차단됨.
  // 실제 서명 시에는 Edge Function 프록시 경유라 동작하지만, 헬스체크는 스킵.
  if (typeof window !== 'undefined'
      && window.location.protocol === 'https:'
      && server.url.startsWith('http://')) {
    return -2; // -2 = mixed content 로 확인 불가 (실패와 구분)
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = performance.now();

  try {
    await fetch(server.url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/timestamp-query' },
      body: new Uint8Array(0), // 빈 요청 — 에러 응답이라도 연결 가능 여부 확인
      mode: 'no-cors', // CORS 우회 — 응답 읽기 불가하지만 연결 가능 여부 확인
    });
    return performance.now() - start;
  } catch {
    return -1; // 실패
  } finally {
    clearTimeout(timer);
  }
}

/** 전체 TSA 헬스체크 (앱 시작 시 1회) */
export async function checkAllTsaHealth(servers?: TsaServer[]): Promise<TsaHealthCache[]> {
  const list = servers ?? DEFAULT_TSA_LIST;
  const cache = loadCache();
  const now = Date.now();

  // 캐시 유효하면 스킵
  if (cache.length > 0 && cache.every(c => now - c.lastChecked < CACHE_TTL)) {
    return cache;
  }

  const results: TsaHealthCache[] = await Promise.all(
    list.filter(s => s.enabled).map(async server => {
      const existing = cache.find(c => c.serverId === server.id);
      // 블랙리스트 중이면 스킵
      if (existing?.blacklistedUntil && existing.blacklistedUntil > now) {
        return existing;
      }
      const ms = await checkSingleTsa(server);
      return {
        serverId: server.id,
        responseMs: ms > 0 ? ms : 9999,
        lastChecked: now,
        blacklistedUntil: ms < 0 ? now + BLACKLIST_DURATION : undefined,
      };
    }),
  );

  saveCache(results);
  return results;
}

/** 최적 TSA 선택 */
export function selectBestTsa(
  healthCache: TsaHealthCache[],
  servers?: TsaServer[],
): TsaServer | null {
  const list = servers ?? DEFAULT_TSA_LIST;
  const now = Date.now();

  const candidates = list
    .filter(s => s.enabled)
    .filter(s => {
      const h = healthCache.find(c => c.serverId === s.id);
      return !h?.blacklistedUntil || h.blacklistedUntil <= now;
    })
    .map(s => {
      const h = healthCache.find(c => c.serverId === s.id);
      const ms = h?.responseMs ?? 9999;
      // DigiCert 신뢰도 보너스 20%
      const score = s.id === 'digicert' ? ms * 0.8 : ms;
      return { server: s, score };
    })
    .sort((a, b) => a.score - b.score);

  return candidates[0]?.server ?? null;
}

/** 블랙리스트 등록 */
export function blacklistTsa(serverId: string, durationMs = BLACKLIST_DURATION) {
  const cache = loadCache();
  const idx = cache.findIndex(c => c.serverId === serverId);
  if (idx >= 0) {
    cache[idx].blacklistedUntil = Date.now() + durationMs;
  } else {
    cache.push({
      serverId,
      responseMs: 9999,
      lastChecked: Date.now(),
      blacklistedUntil: Date.now() + durationMs,
    });
  }
  saveCache(cache);
}

/** TSA 설정 로드 */
export function getTsaSettings(): { enabled: boolean; servers: TsaServer[]; timeoutMs: number } {
  try {
    const enabled = localStorage.getItem('pkizip-tsa-enabled');
    const servers = localStorage.getItem('pkizip-tsa-servers');
    const timeout = localStorage.getItem('pkizip-tsa-timeout');
    return {
      enabled: enabled !== null ? enabled === 'true' : true,
      servers: servers ? JSON.parse(servers) : DEFAULT_TSA_LIST,
      timeoutMs: timeout ? parseInt(timeout) : 3000,
    };
  } catch {
    return { enabled: true, servers: DEFAULT_TSA_LIST, timeoutMs: 3000 };
  }
}

/** TSA 설정 저장 */
export function saveTsaSettings(settings: { enabled?: boolean; servers?: TsaServer[]; timeoutMs?: number }) {
  if (settings.enabled !== undefined) localStorage.setItem('pkizip-tsa-enabled', String(settings.enabled));
  if (settings.servers) localStorage.setItem('pkizip-tsa-servers', JSON.stringify(settings.servers));
  if (settings.timeoutMs) localStorage.setItem('pkizip-tsa-timeout', String(settings.timeoutMs));
}
