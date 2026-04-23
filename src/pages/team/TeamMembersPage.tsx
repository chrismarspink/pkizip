/**
 * /team/:slug/members
 */
import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '@/lib/supabase/auth-store';
import { listMembers, updateMemberRole, removeMember, type TenantMember } from '@/lib/supabase/tenants';
import { logAudit } from '@/lib/supabase/audit';
import { useTeam } from '@/components/team/TeamLayout';

export function TeamMembersPage() {
  const { tenant, myRole } = useTeam();
  const { user } = useAuthStore();
  const [list, setList] = useState<TenantMember[]>([]);
  const reload = () => listMembers(tenant.id).then(setList);
  useEffect(() => { reload(); }, [tenant.id]);

  const isAdmin = myRole === 'owner' || myRole === 'admin';

  const changeRole = async (m: TenantMember, role: 'owner'|'admin'|'member') => {
    try {
      await updateMemberRole(tenant.id, m.user_id, role);
      await logAudit(user!.id, 'member.role_change', { tenantId: tenant.id, targetId: m.user_id, metadata: { role } });
      toast.success('역할 변경');
      reload();
    } catch (err) { toast.error(`실패: ${err instanceof Error ? err.message : err}`); }
  };

  const remove = async (m: TenantMember) => {
    if (!confirm(`${m.profile?.display_name ?? m.user_id.slice(0,8)} 님을 제거하시겠습니까?`)) return;
    try {
      await removeMember(tenant.id, m.user_id);
      await logAudit(user!.id, 'member.remove', { tenantId: tenant.id, targetId: m.user_id });
      toast.success('제거 완료');
      reload();
    } catch (err) { toast.error(`실패: ${err instanceof Error ? err.message : err}`); }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">멤버 ({list.length})</h1>
      <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 border-b border-zinc-200">
            <tr><Th>멤버</Th><Th>역할</Th><Th>가입일</Th><Th></Th></tr>
          </thead>
          <tbody>
            {list.map(m => (
              <tr key={m.user_id} className="border-b border-zinc-100 last:border-0">
                <Td>
                  <div className="font-medium">{m.profile?.display_name ?? m.user_id.slice(0,8)}</div>
                  <div className="text-xs text-zinc-500 font-mono">{m.user_id.slice(0,8)}…</div>
                </Td>
                <Td>
                  {isAdmin && m.user_id !== user!.id && m.role !== 'owner' ? (
                    <select value={m.role} onChange={e => changeRole(m, e.target.value as 'owner'|'admin'|'member')}
                      className="text-xs border border-zinc-300 rounded px-2 py-1">
                      <option value="member">member</option>
                      <option value="admin">admin</option>
                      {myRole === 'owner' && <option value="owner">owner</option>}
                    </select>
                  ) : (<span className="text-xs">{m.role}</span>)}
                </Td>
                <Td className="text-xs text-zinc-500">{m.created_at ? new Date(m.created_at).toLocaleDateString() : '-'}</Td>
                <Td>
                  {isAdmin && m.user_id !== user!.id && m.role !== 'owner' && (
                    <button onClick={() => remove(m)} className="p-1.5 text-zinc-400 hover:text-red-500">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return <th className="text-left px-4 py-2 text-xs font-semibold text-zinc-500 uppercase tracking-wider">{children}</th>;
}
function Td({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 align-middle ${className}`}>{children}</td>;
}
