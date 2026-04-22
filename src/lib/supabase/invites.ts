/**
 * 조직 초대
 */
import { restGet, restPost, restPatch, restDelete } from './rest';

export interface Invite {
  id: string;
  tenant_id: string;
  email: string;
  role: 'admin' | 'member';
  invited_by: string;
  token: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

function genToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function listTenantInvites(tenantId: string): Promise<Invite[]> {
  return restGet<Invite[]>(`tenant_invites?tenant_id=eq.${tenantId}&select=*&order=created_at.desc`);
}

export async function listMyInvites(email: string): Promise<(Invite & { tenant: { name: string; slug: string } })[]> {
  type Row = Invite & { tenants: { name: string; slug: string } };
  const rows = await restGet<Row[]>(
    `tenant_invites?email=eq.${encodeURIComponent(email)}&accepted_at=is.null&select=*,tenants(name,slug)&order=created_at.desc`
  );
  return rows.map(r => ({ ...r, tenant: r.tenants }));
}

export async function createInvite(tenantId: string, invitedBy: string, email: string, role: 'admin'|'member'): Promise<Invite> {
  const token = genToken();
  const rows = await restPost<Invite[]>('tenant_invites', {
    tenant_id: tenantId, email: email.toLowerCase().trim(), role, invited_by: invitedBy, token,
  });
  return rows[0];
}

export async function deleteInvite(id: string): Promise<void> {
  await restDelete(`tenant_invites?id=eq.${id}`);
}

export async function acceptInvite(token: string, userId: string): Promise<{ tenant_id: string; role: string }> {
  const rows = await restGet<Invite[]>(`tenant_invites?token=eq.${encodeURIComponent(token)}&accepted_at=is.null&limit=1`);
  const inv = rows[0];
  if (!inv) throw new Error('초대를 찾을 수 없거나 이미 수락되었습니다');
  if (new Date(inv.expires_at) < new Date()) throw new Error('초대가 만료되었습니다');

  // 멤버 추가
  await restPost('tenant_members', { tenant_id: inv.tenant_id, user_id: userId, role: inv.role }, 'return=minimal');
  // 수락 처리
  await restPatch(`tenant_invites?id=eq.${inv.id}`, { accepted_at: new Date().toISOString() });
  return { tenant_id: inv.tenant_id, role: inv.role };
}
