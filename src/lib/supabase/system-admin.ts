/**
 * 시스템 관리자 (L4) API
 */
import { restGet, rpc } from './rest';
import type { Tenant } from './tenants';

export interface SystemAdmin {
  user_id: string;
  role: 'admin' | 'superadmin';
  created_at: string;
}

let _cache: boolean | null = null;

/** 현재 로그인 사용자가 system_admin인지 */
export async function isSystemAdmin(): Promise<boolean> {
  if (_cache !== null) return _cache;
  try {
    const r = await rpc<boolean>('is_system_admin');
    _cache = !!r;
    return _cache;
  } catch {
    _cache = false;
    return false;
  }
}

export function clearSystemAdminCache(): void {
  _cache = null;
}

/** 전체 테넌트 목록 (멤버 수 포함) */
export async function listAllTenants(): Promise<(Tenant & { member_count?: number })[]> {
  return restGet<(Tenant & { member_count?: number })[]>('tenants?select=*&order=created_at.desc');
}

/** 사용자 검색 (profile 기반, email은 auth 권한 필요) */
export async function searchUsers(query: string): Promise<Array<{ id: string; display_name: string | null }>> {
  const q = encodeURIComponent(`%${query}%`);
  return restGet(`profiles?or=(display_name.ilike.${q},id.ilike.${q})&select=id,display_name&limit=50`);
}

/** 전체 3rd-party 인증서 (system_admin이 관리하는 기본 TSA 목록) */
export async function listGlobalTsaCerts(): Promise<Array<{
  id: string; issuer_name: string; subject_name: string; fingerprint: string;
  source_url: string | null; notes: string | null;
}>> {
  return restGet(`third_party_certs?cert_type=eq.tsa&select=id,issuer_name,subject_name,fingerprint,source_url,notes&order=issuer_name.asc&limit=200`);
}
