/**
 * /me — 내 계정
 * 탭: 프로필 | 소속 테넌트 | 받은 초대
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { User, Building2, Mail, Plus, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '@/lib/supabase/auth-store';
import { listMyTenants, createTenant, type Tenant } from '@/lib/supabase/tenants';
import { listMyInvites, acceptInvite, deleteInvite, type Invite } from '@/lib/supabase/invites';
import { logAudit } from '@/lib/supabase/audit';

type Tab = 'profile' | 'tenants' | 'invites';

export function MePage() {
  const { user, profile, loading } = useAuthStore();
  const [tab, setTab] = useState<Tab>('profile');

  if (loading) return <div className="p-6">불러오는 중…</div>;
  if (!user) return (
    <div className="max-w-xl mx-auto px-4 py-10 text-center text-zinc-500">
      로그인이 필요합니다
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 lg:py-10">
      <h1 className="text-xl font-bold mb-6">내 계정</h1>

      <div className="flex gap-1 border-b border-zinc-200 mb-6">
        <TabBtn active={tab === 'profile'} onClick={() => setTab('profile')} icon={User} label="프로필" />
        <TabBtn active={tab === 'tenants'} onClick={() => setTab('tenants')} icon={Building2} label="소속 테넌트" />
        <TabBtn active={tab === 'invites'} onClick={() => setTab('invites')} icon={Mail} label="받은 초대" />
      </div>

      {tab === 'profile' && <ProfileSection />}
      {tab === 'tenants' && <TenantsSection />}
      {tab === 'invites' && <InvitesSection />}
    </div>
  );
}

function TabBtn({ active, onClick, icon: Icon, label }: {
  active: boolean; onClick: () => void;
  icon: React.ComponentType<{ className?: string }>; label: string;
}) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors
        ${active ? 'border-[#175DDC] text-[#175DDC]' : 'border-transparent text-zinc-500 hover:text-zinc-800'}`}>
      <Icon className="w-4 h-4" /> {label}
    </button>
  );
}

function ProfileSection() {
  const { user, profile } = useAuthStore();
  return (
    <div className="bg-white border border-zinc-200 rounded-xl p-5">
      <dl className="space-y-3 text-sm">
        <Row label="이메일" value={user?.email ?? '-'} />
        <Row label="표시 이름" value={profile?.display_name ?? '-'} />
        <Row label="사용자 ID" value={<span className="font-mono text-xs">{user?.id.slice(0, 8)}…</span>} />
      </dl>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] items-center">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="text-zinc-800">{value}</dd>
    </div>
  );
}

function TenantsSection() {
  const { user, activeTenant, switchTenant } = useAuthStore();
  const [list, setList] = useState<Array<{ tenant: Tenant; role: string }>>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');

  const reload = async () => {
    if (!user) return;
    const rows = await listMyTenants(user.id);
    setList(rows.map(r => ({ tenant: r.tenant, role: r.role })));
  };
  useEffect(() => { reload(); }, [user?.id]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !name.trim() || !slug.trim()) return;
    try {
      const t = await createTenant(user.id, name.trim(), slug.trim().toLowerCase(), 'team');
      await logAudit(user.id, 'tenant.create', { tenantId: t.id, metadata: { name, slug } });
      toast.success(`조직 "${t.name}" 생성 완료`);
      setCreating(false); setName(''); setSlug('');
      reload();
    } catch (err) {
      toast.error(`생성 실패: ${err instanceof Error ? err.message : err}`);
    }
  };

  return (
    <div className="space-y-3">
      {list.map(({ tenant, role }) => (
        <div key={tenant.id} className="bg-white border border-zinc-200 rounded-xl p-4 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold">{tenant.name}</span>
              <PlanBadge plan={tenant.plan} />
              <RoleBadge role={role} />
              {activeTenant?.id === tenant.id && <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded">활성</span>}
            </div>
            <div className="text-xs text-zinc-500 font-mono mt-0.5">{tenant.slug}</div>
          </div>
          <div className="flex gap-2">
            {activeTenant?.id !== tenant.id && (
              <button onClick={() => switchTenant(tenant.id)}
                className="text-xs px-3 py-1.5 border border-zinc-300 rounded-lg hover:bg-zinc-50">활성화</button>
            )}
            {(role === 'owner' || role === 'admin') && (tenant.plan === 'team' || tenant.plan === 'enterprise') && (
              <Link to={`/team/${tenant.slug}`}
                className="text-xs px-3 py-1.5 bg-[#175DDC] text-white rounded-lg hover:bg-[#134db3]">관리</Link>
            )}
          </div>
        </div>
      ))}

      {creating ? (
        <form onSubmit={handleCreate} className="bg-white border border-zinc-200 rounded-xl p-4 space-y-2">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="조직 이름"
            className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg" required />
          <input value={slug} onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
            placeholder="slug (영문/숫자/-)"
            className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg font-mono" required />
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setCreating(false)}
              className="text-xs px-3 py-1.5 border border-zinc-300 rounded-lg">취소</button>
            <button type="submit"
              className="text-xs px-3 py-1.5 bg-[#175DDC] text-white rounded-lg">생성</button>
          </div>
        </form>
      ) : (
        <button onClick={() => setCreating(true)}
          className="w-full flex items-center justify-center gap-1.5 py-3 border-2 border-dashed border-zinc-300 rounded-xl text-zinc-500 hover:border-[#175DDC] hover:text-[#175DDC]">
          <Plus className="w-4 h-4" /> 새 조직 만들기
        </button>
      )}
    </div>
  );
}

function InvitesSection() {
  const { user, loadProfile } = useAuthStore();
  const [list, setList] = useState<Array<Invite & { tenant: { name: string; slug: string } }>>([]);

  const reload = async () => {
    if (!user?.email) return;
    try {
      setList(await listMyInvites(user.email));
    } catch { setList([]); }
  };
  useEffect(() => { reload(); }, [user?.email]);

  const accept = async (inv: typeof list[number]) => {
    if (!user) return;
    try {
      await acceptInvite(inv.token, user.id);
      await logAudit(user.id, 'invite.accept', { tenantId: inv.tenant_id, targetId: inv.id });
      toast.success(`"${inv.tenant.name}" 참여 완료`);
      await loadProfile();
      reload();
    } catch (err) {
      toast.error(`수락 실패: ${err instanceof Error ? err.message : err}`);
    }
  };

  const reject = async (inv: typeof list[number]) => {
    try {
      await deleteInvite(inv.id);
      toast.success('초대 거절');
      reload();
    } catch (err) {
      toast.error(`실패: ${err instanceof Error ? err.message : err}`);
    }
  };

  if (list.length === 0) {
    return <div className="text-sm text-zinc-500 text-center py-10">받은 초대가 없습니다</div>;
  }

  return (
    <div className="space-y-2">
      {list.map(inv => (
        <div key={inv.id} className="bg-white border border-zinc-200 rounded-xl p-4 flex items-center justify-between">
          <div>
            <div className="font-semibold text-sm">{inv.tenant.name}</div>
            <div className="text-xs text-zinc-500">역할: {inv.role} · 만료 {new Date(inv.expires_at).toLocaleDateString()}</div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => accept(inv)} title="수락"
              className="p-2 text-green-600 hover:bg-green-50 rounded-lg"><Check className="w-4 h-4" /></button>
            <button onClick={() => reject(inv)} title="거절"
              className="p-2 text-zinc-400 hover:text-red-500 hover:bg-red-50 rounded-lg"><X className="w-4 h-4" /></button>
          </div>
        </div>
      ))}
    </div>
  );
}

function PlanBadge({ plan }: { plan: Tenant['plan'] }) {
  const map = {
    local: ['bg-zinc-100 text-zinc-600', 'Local'],
    free: ['bg-blue-100 text-blue-700', 'Free'],
    team: ['bg-purple-100 text-purple-700', 'Team'],
    enterprise: ['bg-amber-100 text-amber-700', 'Enterprise'],
  } as const;
  const [cls, label] = map[plan] ?? map.free;
  return <span className={`text-[10px] px-1.5 py-0.5 rounded ${cls}`}>{label}</span>;
}

function RoleBadge({ role }: { role: string }) {
  const map: Record<string, string> = {
    owner: 'bg-red-100 text-red-700',
    admin: 'bg-orange-100 text-orange-700',
    member: 'bg-zinc-100 text-zinc-600',
  };
  return <span className={`text-[10px] px-1.5 py-0.5 rounded ${map[role] ?? map.member}`}>{role}</span>;
}
