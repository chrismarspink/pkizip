/**
 * /team/:slug/invites
 */
import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '@/lib/supabase/auth-store';
import { listTenantInvites, createInvite, deleteInvite, type Invite } from '@/lib/supabase/invites';
import { logAudit } from '@/lib/supabase/audit';
import { useTeam } from '@/components/team/TeamLayout';

export function TeamInvitesPage() {
  const { tenant } = useTeam();
  const { user } = useAuthStore();
  const [list, setList] = useState<Invite[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin'|'member'>('member');

  const reload = () => listTenantInvites(tenant.id).then(setList);
  useEffect(() => { reload(); }, [tenant.id]);

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    try {
      const inv = await createInvite(tenant.id, user!.id, email, role);
      await logAudit(user!.id, 'invite.create', { tenantId: tenant.id, targetId: inv.id, metadata: { email, role } });
      toast.success(`${email} 초대 (토큰: ${inv.token.slice(0,12)}…)`);
      setEmail('');
      reload();
    } catch (err) { toast.error(`실패: ${err instanceof Error ? err.message : err}`); }
  };

  const cancel = async (id: string) => {
    try {
      await deleteInvite(id); toast.success('초대 취소'); reload();
    } catch (err) { toast.error(`실패: ${err instanceof Error ? err.message : err}`); }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">초대</h1>
      <form onSubmit={invite} className="bg-white border border-zinc-200 rounded-xl p-4 flex gap-2">
        <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="초대 이메일"
          className="flex-1 px-3 py-2 text-sm border border-zinc-300 rounded-lg" required />
        <select value={role} onChange={e => setRole(e.target.value as 'admin'|'member')}
          className="px-3 py-2 text-sm border border-zinc-300 rounded-lg">
          <option value="member">member</option>
          <option value="admin">admin</option>
        </select>
        <button type="submit" className="flex items-center gap-1 px-4 py-2 text-sm bg-[#175DDC] text-white rounded-lg">
          <Plus className="w-4 h-4" /> 초대
        </button>
      </form>
      <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 border-b border-zinc-200">
            <tr><Th>이메일</Th><Th>역할</Th><Th>상태</Th><Th>만료</Th><Th></Th></tr>
          </thead>
          <tbody>
            {list.map(i => (
              <tr key={i.id} className="border-b border-zinc-100 last:border-0">
                <Td>{i.email}</Td>
                <Td className="text-xs">{i.role}</Td>
                <Td>{i.accepted_at ? <span className="text-xs text-green-600">수락</span>
                  : new Date(i.expires_at) < new Date() ? <span className="text-xs text-red-500">만료</span>
                  : <span className="text-xs text-zinc-500">대기</span>}</Td>
                <Td className="text-xs text-zinc-500">{new Date(i.expires_at).toLocaleDateString()}</Td>
                <Td>
                  {!i.accepted_at && (
                    <button onClick={() => cancel(i.id)} className="p-1.5 text-zinc-400 hover:text-red-500">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </Td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr><td colSpan={5} className="text-center py-6 text-sm text-zinc-500">초대 내역 없음</td></tr>
            )}
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
