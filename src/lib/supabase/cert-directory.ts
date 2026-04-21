/**
 * 인증서 번들 디렉토리 — 공개키만 서버 저장 (개인키 절대 금지)
 * getSession/getUser 호출 없음 — userId를 파라미터로 받음
 */
import { supabase } from './client';

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
  // username 자동 생성: fingerprint 앞 8자
  const username = 'u-' + (bundle.fingerprint || userId).slice(0, 8).toLowerCase();

  console.log('[PKIZIP-cert] upload:', { userId, username, name: bundle.display_name });
  const row = {
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

  const { error } = await supabase.from('cert_bundles').upsert(row, { onConflict: 'user_id' });
  console.log('[PKIZIP-cert] upsert result:', error ? error.message : 'OK');
  if (error) {
    throw new Error(`업로드 실패: ${error.message}`);
  }
}

/** 내 인증서 번들 조회 */
export async function getMyCertBundle(userId: string): Promise<CertBundle | null> {
  const { data } = await supabase.from('cert_bundles').select('*').eq('user_id', userId).maybeSingle();
  return data;
}

/** 인증서 번들 삭제 */
export async function deleteCertBundle(userId: string): Promise<void> {
  const { error } = await supabase.from('cert_bundles').delete().eq('user_id', userId);
  if (error) throw new Error(`삭제 실패: ${error.message}`);
}

/** 이름/이메일/username으로 검색 (로그인 필수) */
export async function searchCertBundles(query: string): Promise<CertBundle[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const { data, error } = await supabase
    .from('cert_bundles')
    .select('id,username,display_name,email,fingerprint,cert_kem,cert_dsa,cert_classic,uploaded_at,updated_at')
    .eq('is_public', true)
    .or(`username.ilike.*${q}*,display_name.ilike.*${q}*,email.ilike.*${q}*`)
    .limit(20);
  if (error) console.error('[PKIZIP] cert search error:', error);
  return data ?? [];
}

/** username 단건 조회 */
export async function getCertBundleByUsername(username: string): Promise<CertBundle | null> {
  const { data } = await supabase
    .from('cert_bundles')
    .select('*')
    .eq('username', username.toLowerCase())
    .maybeSingle();
  return data;
}
