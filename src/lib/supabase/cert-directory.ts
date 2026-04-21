/**
 * 인증서 번들 디렉토리 — 공개키만 서버 저장
 * Supabase REST API를 fetch로 직접 호출 (supabase-js 세션 문제 우회)
 */

const SUPABASE_URL = 'https://ikyhpuerwljxypyzkpiw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlreWhwdWVyd2xqeHlweXprcGl3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1OTM1NjQsImV4cCI6MjA5MjE2OTU2NH0.31GrKSlBzcGRXCU7yHioEVIChO3EMi6di75O6mLFlBU';

function getAccessToken(): string | null {
  // Supabase JS가 localStorage에 저장하는 세션 키
  const key = `sb-ikyhpuerwljxypyzkpiw-auth-token`;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.access_token ?? null;
  } catch {
    return null;
  }
}

function headers(): Record<string, string> {
  const token = getAccessToken();
  const h: Record<string, string> = {
    'apikey': SUPABASE_ANON_KEY,
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal',
  };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

export interface CertBundle {
  id: string;
  username: string;
  display_name: string;
  email?: string;
  cert_classic?: string;
  cert_kem?: string;
  cert_dsa?: string;
  fingerprint?: string;
  uploaded_at: string;
  updated_at: string;
}

/** 인증서 번들 업로드 또는 갱신 */
export async function uploadCertBundle(
  userId: string,
  bundle: {
    display_name: string;
    email?: string;
    cert_classic?: string;
    cert_kem?: string;
    cert_dsa?: string;
    fingerprint?: string;
  }
): Promise<void> {
  const username = 'u-' + (bundle.fingerprint || userId).slice(0, 8).toLowerCase();
  console.log('[PKIZIP-cert] upload:', { userId, username, name: bundle.display_name });

  const body = {
    user_id: userId,
    username,
    display_name: bundle.display_name,
    email: bundle.email ?? null,
    cert_classic: bundle.cert_classic ?? null,
    cert_kem: bundle.cert_kem ?? null,
    cert_dsa: bundle.cert_dsa ?? null,
    fingerprint: bundle.fingerprint ?? null,
    is_public: true,
    updated_at: new Date().toISOString(),
  };

  const res = await fetch(`${SUPABASE_URL}/rest/v1/cert_bundles?on_conflict=user_id`, {
    method: 'POST',
    headers: { ...headers(), 'Prefer': 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(body),
  });

  console.log('[PKIZIP-cert] upsert status:', res.status);
  if (!res.ok) {
    const err = await res.text();
    console.error('[PKIZIP-cert] upsert error:', err);
    throw new Error(`업로드 실패: ${res.status} ${err}`);
  }
}

/** 내 인증서 번들 조회 */
export async function getMyCertBundle(userId: string): Promise<CertBundle | null> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/cert_bundles?user_id=eq.${userId}&select=*&limit=1`,
    { headers: headers() },
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data?.[0] ?? null;
}

/** 인증서 번들 삭제 */
export async function deleteCertBundle(userId: string): Promise<void> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/cert_bundles?user_id=eq.${userId}`,
    { method: 'DELETE', headers: headers() },
  );
  if (!res.ok) throw new Error(`삭제 실패: ${res.status}`);
}

/** 이름/이메일/username으로 검색 */
export async function searchCertBundles(query: string): Promise<CertBundle[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const filter = `or=(username.ilike.*${q}*,display_name.ilike.*${q}*,email.ilike.*${q}*)`;
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/cert_bundles?is_public=eq.true&${filter}&select=id,username,display_name,email,fingerprint,cert_kem,cert_dsa,cert_classic,uploaded_at,updated_at&limit=20`,
    { headers: headers() },
  );
  if (!res.ok) {
    console.error('[PKIZIP] cert search error:', res.status);
    return [];
  }
  return await res.json();
}

/** username 단건 조회 */
export async function getCertBundleByUsername(username: string): Promise<CertBundle | null> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/cert_bundles?username=eq.${username.toLowerCase()}&select=*&limit=1`,
    { headers: headers() },
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data?.[0] ?? null;
}
