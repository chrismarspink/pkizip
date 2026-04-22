/**
 * 테넌트 CRUD + 멤버 관리
 */
import { restGet, restPost, restPatch, restDelete, SUPABASE_URL, SUPABASE_ANON_KEY, getAccessToken } from './rest';

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  plan: 'local' | 'free' | 'team' | 'enterprise';
  created_at?: string;
}

export interface TenantMember {
  tenant_id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'member';
  created_at?: string;
  profile?: { display_name: string | null; id: string };
  email?: string;
}

export interface TenantPolicy {
  tenant_id: string;
  require_pqc: boolean;
  require_timestamp: boolean;
  allow_password_encrypt: boolean;
  max_file_size_mb: number;
  allowed_tsa_list: string[] | null;
  updated_at: string;
}

/** 내가 소속된 모든 테넌트 */
export async function listMyTenants(userId: string): Promise<(TenantMember & { tenant: Tenant })[]> {
  type Row = { tenant_id: string; user_id: string; role: 'owner'|'admin'|'member'; tenants: Tenant };
  const rows = await restGet<Row[]>(`tenant_members?user_id=eq.${userId}&select=tenant_id,user_id,role,tenants(*)`);
  return rows.map(r => ({ tenant_id: r.tenant_id, user_id: r.user_id, role: r.role, tenant: r.tenants }));
}

/** slug로 테넌트 단건 조회 */
export async function getTenantBySlug(slug: string): Promise<Tenant | null> {
  const rows = await restGet<Tenant[]>(`tenants?slug=eq.${encodeURIComponent(slug)}&limit=1`);
  return rows[0] ?? null;
}

/** 새 조직 생성 (caller가 owner) */
export async function createTenant(userId: string, name: string, slug: string, plan: 'team' | 'enterprise' = 'team'): Promise<Tenant> {
  const rows = await restPost<Tenant[]>('tenants', { name, slug, plan });
  const t = rows[0];
  await restPost('tenant_members', { tenant_id: t.id, user_id: userId, role: 'owner' }, 'return=minimal');
  return t;
}

/** 테넌트 삭제 (owner만) */
export async function deleteTenant(tenantId: string): Promise<void> {
  await restDelete(`tenants?id=eq.${tenantId}`);
}

/** 테넌트 이름/플랜 변경 */
export async function updateTenant(tenantId: string, patch: Partial<Pick<Tenant,'name'|'plan'>>): Promise<void> {
  await restPatch(`tenants?id=eq.${tenantId}`, patch);
}

/** 멤버 목록 (profile join) */
export async function listMembers(tenantId: string): Promise<TenantMember[]> {
  type Row = { tenant_id: string; user_id: string; role: 'owner'|'admin'|'member'; created_at: string;
    profiles: { id: string; display_name: string | null } | null };
  const rows = await restGet<Row[]>(`tenant_members?tenant_id=eq.${tenantId}&select=*,profiles(id,display_name)&order=created_at.asc`);
  return rows.map(r => ({
    tenant_id: r.tenant_id, user_id: r.user_id, role: r.role, created_at: r.created_at,
    profile: r.profiles ?? undefined,
  }));
}

/** 멤버 역할 변경 */
export async function updateMemberRole(tenantId: string, userId: string, role: 'owner'|'admin'|'member'): Promise<void> {
  await restPatch(`tenant_members?tenant_id=eq.${tenantId}&user_id=eq.${userId}`, { role });
}

/** 멤버 제거 */
export async function removeMember(tenantId: string, userId: string): Promise<void> {
  await restDelete(`tenant_members?tenant_id=eq.${tenantId}&user_id=eq.${userId}`);
}

/** 정책 조회 (없으면 기본값 반환) */
export async function getPolicy(tenantId: string): Promise<TenantPolicy> {
  const rows = await restGet<TenantPolicy[]>(`tenant_policies?tenant_id=eq.${tenantId}&limit=1`);
  if (rows[0]) return rows[0];
  return {
    tenant_id: tenantId,
    require_pqc: false,
    require_timestamp: false,
    allow_password_encrypt: true,
    max_file_size_mb: 100,
    allowed_tsa_list: null,
    updated_at: new Date().toISOString(),
  };
}

/** 정책 upsert */
export async function upsertPolicy(tenantId: string, userId: string, patch: Partial<TenantPolicy>): Promise<void> {
  const body = { tenant_id: tenantId, updated_by: userId, updated_at: new Date().toISOString(), ...patch };
  const token = getAccessToken();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/tenant_policies?on_conflict=tenant_id`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=minimal',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`정책 저장 실패: ${await res.text()}`);
}
