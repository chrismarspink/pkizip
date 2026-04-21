/**
 * 3rd Party 인증서 저장소 — TSA, CA, 중간 인증서, 루트 인증서 등
 * Supabase REST API 직접 호출
 */

const SUPABASE_URL = 'https://ikyhpuerwljxypyzkpiw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlreWhwdWVyd2xqeHlweXprcGl3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1OTM1NjQsImV4cCI6MjA5MjE2OTU2NH0.31GrKSlBzcGRXCU7yHioEVIChO3EMi6di75O6mLFlBU';

function getAccessToken(): string | null {
  try {
    const raw = localStorage.getItem('sb-ikyhpuerwljxypyzkpiw-auth-token');
    if (!raw) return null;
    return JSON.parse(raw)?.access_token ?? null;
  } catch { return null; }
}

function hdrs(prefer?: string): Record<string, string> {
  const token = getAccessToken();
  const h: Record<string, string> = {
    'apikey': SUPABASE_ANON_KEY,
    'Content-Type': 'application/json',
  };
  if (prefer) h['Prefer'] = prefer;
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

export type CertType = 'tsa' | 'ca' | 'intermediate' | 'root' | 'other';

export interface ThirdPartyCert {
  id: string;
  cert_type: CertType;
  issuer_name: string;
  subject_name?: string;
  cert_pem: string;
  fingerprint?: string;
  not_before?: string;
  not_after?: string;
  source_url?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

/** 인증서 추가 */
export async function addThirdPartyCert(
  userId: string,
  cert: {
    cert_type: CertType;
    issuer_name: string;
    subject_name?: string;
    cert_pem: string;
    fingerprint?: string;
    not_before?: string;
    not_after?: string;
    source_url?: string;
    notes?: string;
  }
): Promise<void> {
  const body = {
    user_id: userId,
    ...cert,
    updated_at: new Date().toISOString(),
  };

  const res = await fetch(`${SUPABASE_URL}/rest/v1/third_party_certs?on_conflict=user_id,fingerprint`, {
    method: 'POST',
    headers: hdrs('resolution=merge-duplicates,return=minimal'),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`인증서 저장 실패: ${res.status} ${err}`);
  }
}

/** 내 인증서 목록 조회 */
export async function listThirdPartyCerts(
  userId: string,
  certType?: CertType,
): Promise<ThirdPartyCert[]> {
  let url = `${SUPABASE_URL}/rest/v1/third_party_certs?user_id=eq.${userId}&select=*&order=created_at.desc`;
  if (certType) url += `&cert_type=eq.${certType}`;

  const res = await fetch(url, { headers: hdrs() });
  if (!res.ok) return [];
  return await res.json();
}

/** 인증서 삭제 */
export async function deleteThirdPartyCert(
  userId: string,
  certId: string,
): Promise<void> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/third_party_certs?user_id=eq.${userId}&id=eq.${certId}`,
    { method: 'DELETE', headers: hdrs() },
  );
  if (!res.ok) throw new Error(`삭제 실패: ${res.status}`);
}

/** TSA 인증서 조회 (타입 필터) */
export async function listTsaCerts(userId: string): Promise<ThirdPartyCert[]> {
  return listThirdPartyCerts(userId, 'tsa');
}
