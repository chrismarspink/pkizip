/**
 * 수신자 호환성 사전 확인.
 *
 * 봉투를 보내기 전 수신자가 PKIZIP DPV 메타를 인식할 수 있는지 점검.
 *
 * 패턴:
 *   1) 수신자가 PKIZIP 사용자 → Supabase 에 등록된 fingerprint 로 확인
 *   2) 수신자 도메인의 .well-known/pkizip-dpv.json (옵션) — 외부 DPV 도구 호환
 *   3) 수신자 미확인 → "메타가 보존되지만 자동 인식 안될 수 있음" 안내
 */

export interface RecipientCompatInfo {
  status: 'pkizip' | 'dpv-aware' | 'unknown';
  /** 호환 표준 목록 — pkizip / dpv-aware 일 때 */
  supportedStandards?: string[];
  /** 사용자에게 보여줄 안내 메시지 */
  message: string;
  /** 호환 X 시 권고 동작 */
  recommendation?: string;
}

const COMPAT_CACHE = new Map<string, { info: RecipientCompatInfo; cachedAt: number }>();
const CACHE_TTL = 30 * 60 * 1000; // 30분

/** 수신자 fingerprint 가 PKIZIP 사용자인지 체크 (Supabase 의 public_keys 테이블). */
async function isPkizipUser(fingerprint: string): Promise<boolean> {
  // PKIZIP 의 contacts 또는 public_keys 테이블 조회 — 등록된 사용자만 PKIZIP 호환 확실
  // 현재 PKIZIP contacts 시스템과 통합. 단순화: 로컬 contacts 에 등록되어 있으면 호환 가정.
  try {
    const { listContacts } = await import('@/lib/supabase/contacts');
    const contacts = await listContacts();
    return contacts.some(c => c.fingerprint === fingerprint);
  } catch {
    return false;
  }
}

/** 수신자 도메인의 .well-known/pkizip-dpv.json fetch 시도. */
async function fetchWellKnown(domain: string): Promise<string[] | null> {
  try {
    const url = `https://${domain}/.well-known/pkizip-dpv.json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data?.supported_standards) ? data.supported_standards : null;
  } catch {
    return null;
  }
}

/** 수신자 호환성 확인. 결과 30분 캐시. */
export async function checkRecipientCompat(
  fingerprint: string,
  email?: string,
): Promise<RecipientCompatInfo> {
  const key = fingerprint || email || '';
  const now = Date.now();
  const cached = COMPAT_CACHE.get(key);
  if (cached && now - cached.cachedAt < CACHE_TTL) {
    return cached.info;
  }

  // 1) PKIZIP 사용자 확인
  if (fingerprint && await isPkizipUser(fingerprint)) {
    const info: RecipientCompatInfo = {
      status: 'pkizip',
      supportedStandards: ['DPV v2', 'CMS RFC 5652', 'PQC (ML-KEM/ML-DSA)', 'TSA RFC 3161'],
      message: '✅ PKIZIP 사용자 — DPV 메타 자동 인식 + 봉투 직접 풀기 가능',
    };
    COMPAT_CACHE.set(key, { info, cachedAt: now });
    return info;
  }

  // 2) 이메일 도메인의 well-known 시도
  if (email) {
    const domain = email.split('@')[1];
    if (domain) {
      const standards = await fetchWellKnown(domain);
      if (standards && standards.length > 0) {
        const info: RecipientCompatInfo = {
          status: 'dpv-aware',
          supportedStandards: standards,
          message: `✅ DPV 호환 도구 사용 (${domain}) — 메타 자동 인식 가능`,
        };
        COMPAT_CACHE.set(key, { info, cachedAt: now });
        return info;
      }
    }
  }

  // 3) 미확인
  const info: RecipientCompatInfo = {
    status: 'unknown',
    message: '⚠ 호환성 미확인 — DPV 메타가 봉투에 보존되지만 자동 인식 안될 수 있음',
    recommendation: '수신자에게 PKIZIP 또는 DPV 호환 도구 사용을 요청하거나, 메타 export (JSON-LD) 를 별도 전송하세요.',
  };
  COMPAT_CACHE.set(key, { info, cachedAt: now });
  return info;
}

export function clearRecipientCompatCache() {
  COMPAT_CACHE.clear();
}
