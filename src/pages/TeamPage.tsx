/**
 * /team/:slug — 조직 관리
 * 탭: 멤버 | 초대 | 정책 | 감사 | 결제
 */
import { useEffect, useState } from 'react';
import { useParams, Navigate, Link } from 'react-router-dom';
import { Users, Mail, Shield, FileText, CreditCard, Trash2, Plus, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '@/lib/supabase/auth-store';
import {
  getTenantBySlug, listMembers, updateMemberRole, removeMember,
  getPolicy, upsertPolicy, deleteTenant, updateTenant,
  type Tenant, type TenantMember, type TenantPolicy,
} from '@/lib/supabase/tenants';
import {
  listTenantInvites, createInvite, deleteInvite, type Invite,
} from '@/lib/supabase/invites';
import { listAuditLogs, logAudit, type AuditLog } from '@/lib/supabase/audit';

type Tab = 'members' | 'invites' | 'policy' | 'audit' | 'billing';

export function TeamPage() {
  const { slug } = useParams();
  const { user } = useAuthStore();
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [myRole, setMyRole] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('members');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (!slug || !user) return;
      setLoading(true);
      try {
        const t = await getTenantBySlug(slug);
        if (!t) { setTenant(null); return; }
        setTenant(t);
        const members = await listMembers(t.id);
        const me = members.find(m => m.user_id === user.id);
        setMyRole(me?.role ?? null);
      } finally { setLoading(false); }
    })();
  }, [slug, user?.id]);

  if (!user) return <Navigate to="/" replace />;
  if (loading) return <div className="p-6">불러오는 중…</div>;
  if (!tenant) return <div className="p-6 text-red-500">조직을 찾을 수 없습니다</div>;
  if (!myRole) return <div className="p-6 text-red-500">접근 권한이 없습니다</div>;

  const isAdmin = myRole === 'owner' || myRole === 'admin';
  const isOwner = myRole === 'owner';

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 lg:py-10">
      <div className="mb-6">
        <Link to="/me" className="text-xs text-zinc-500 hover:text-[#175DDC] flex items-center gap-1 mb-2">
          <ArrowLeft className="w-3 h-3" /> 내 계정으로
        </Link>
        <h1 className="text-xl font-bold flex items-center gap-2">
          {tenant.name}
          <span className="text-xs font-normal bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">{tenant.plan}</span>
          <span className="text-xs font-normal text-zinc-500">· {myRole}</span>
        </h1>
        <div className="text-xs text-zinc-500 font-mono mt-1">{tenant.slug}</div>
      </div>

      <div className="flex gap-1 border-b border-zinc-200 mb-6 overflow-x-auto">
        <TabBtn active={tab === 'members'} onClick={() => setTab('members')} icon={Users} label="멤버" />
        {isAdmin && <TabBtn active={tab === 'invites'} onClick={() => setTab('invites')} icon={Mail} label="초대" />}
        {isAdmin && <TabBtn active={tab === 'policy'} onClick={() => setTab('policy')} icon={Shield} label="정책" />}
        {isAdmin && <TabBtn active={tab === 'audit'} onClick={() => setTab('audit')} icon={FileText} label="감사" />}
        {isOwner && <TabBtn active={tab === 'billing'} onClick={() => setTab('billing')} icon={CreditCard} label="결제" />}
      </div>

      {tab === 'members' && <MembersTab tenant={tenant} myRole={myRole} />}
      {tab === 'invites' && isAdmin && <InvitesTab tenant={tenant} />}
      {tab === 'policy' && isAdmin && <PolicyTab tenant={tenant} />}
      {tab === 'audit' && isAdmin && <AuditTab tenant={tenant} />}
      {tab === 'billing' && isOwner && <BillingTab tenant={tenant} onDeleted={() => window.location.assign('/me')} />}
    </div>
  );
}

function TabBtn({ active, onClick, icon: Icon, label }: {
  active: boolean; onClick: () => void;
  icon: React.ComponentType<{ className?: string }>; label: string;
}) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap
        ${active ? 'border-[#175DDC] text-[#175DDC]' : 'border-transparent text-zinc-500 hover:text-zinc-800'}`}>
      <Icon className="w-4 h-4" /> {label}
    </button>
  );
}

// ── 멤버 ──
function MembersTab({ tenant, myRole }: { tenant: Tenant; myRole: string }) {
  const { user } = useAuthStore();
  const [list, setList] = useState<TenantMember[]>([]);
  const reload = () => listMembers(tenant.id).then(setList);
  useEffect(() => { reload(); }, [tenant.id]);

  const isAdmin = myRole === 'owner' || myRole === 'admin';

  const changeRole = async (m: TenantMember, role: 'owner'|'admin'|'member') => {
    try {
      await updateMemberRole(tenant.id, m.user_id, role);
      await logAudit(user!.id, 'member.role_change', { tenantId: tenant.id, targetId: m.user_id, metadata: { role } });
      toast.success('역할 변경 완료');
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
    <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-zinc-50 border-b border-zinc-200">
          <tr><Th>멤버</Th><Th>역할</Th><Th>가입일</Th><Th></Th></tr>
        </thead>
        <tbody>
          {list.map(m => (
            <tr key={m.user_id} className="border-b border-zinc-100 last:border-0">
              <Td>
                <div className="font-medium">{m.profile?.display_name ?? m.user_id.slice(0, 8)}</div>
                <div className="text-xs text-zinc-500 font-mono">{m.user_id.slice(0, 8)}…</div>
              </Td>
              <Td>
                {isAdmin && m.user_id !== user!.id && m.role !== 'owner' ? (
                  <select value={m.role} onChange={e => changeRole(m, e.target.value as 'owner'|'admin'|'member')}
                    className="text-xs border border-zinc-300 rounded px-2 py-1">
                    <option value="member">member</option>
                    <option value="admin">admin</option>
                    {myRole === 'owner' && <option value="owner">owner</option>}
                  </select>
                ) : (
                  <span className="text-xs">{m.role}</span>
                )}
              </Td>
              <Td>{m.created_at ? new Date(m.created_at).toLocaleDateString() : '-'}</Td>
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
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return <th className="text-left px-4 py-2 text-xs font-semibold text-zinc-500 uppercase tracking-wider">{children}</th>;
}
function Td({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 align-middle ${className}`}>{children}</td>;
}

// ── 초대 ──
function InvitesTab({ tenant }: { tenant: Tenant }) {
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
      toast.success(`${email} 초대 생성 (토큰: ${inv.token.slice(0,12)}…)`);
      setEmail('');
      reload();
    } catch (err) { toast.error(`실패: ${err instanceof Error ? err.message : err}`); }
  };

  const cancel = async (id: string) => {
    try {
      await deleteInvite(id);
      toast.success('초대 취소');
      reload();
    } catch (err) { toast.error(`실패: ${err instanceof Error ? err.message : err}`); }
  };

  return (
    <div className="space-y-4">
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
                <Td>
                  {i.accepted_at
                    ? <span className="text-xs text-green-600">수락됨</span>
                    : new Date(i.expires_at) < new Date()
                    ? <span className="text-xs text-red-500">만료</span>
                    : <span className="text-xs text-zinc-500">대기</span>}
                </Td>
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

// ── 정책 ──
function PolicyTab({ tenant }: { tenant: Tenant }) {
  const { user } = useAuthStore();
  const [policy, setPolicy] = useState<TenantPolicy | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => { getPolicy(tenant.id).then(p => { setPolicy(p); setDirty(false); }); }, [tenant.id]);

  if (!policy) return <div className="text-sm text-zinc-500">불러오는 중…</div>;

  const save = async () => {
    try {
      await upsertPolicy(tenant.id, user!.id, policy);
      await logAudit(user!.id, 'policy.update', { tenantId: tenant.id, metadata: { ...policy } as Record<string, unknown> });
      toast.success('정책 저장 완료');
      setDirty(false);
    } catch (err) { toast.error(`실패: ${err instanceof Error ? err.message : err}`); }
  };

  const upd = <K extends keyof TenantPolicy>(k: K, v: TenantPolicy[K]) => {
    setPolicy({ ...policy, [k]: v });
    setDirty(true);
  };

  return (
    <div className="bg-white border border-zinc-200 rounded-xl p-5 space-y-4">
      <Toggle label="PQC 강제 (모든 서명/암호화에 Post-Quantum 사용)"
        value={policy.require_pqc} onChange={v => upd('require_pqc', v)} />
      <Toggle label="타임스탬프 강제 (모든 서명에 TSA 타임스탬프 요구)"
        value={policy.require_timestamp} onChange={v => upd('require_timestamp', v)} />
      <Toggle label="비밀번호 암호화 허용"
        value={policy.allow_password_encrypt} onChange={v => upd('allow_password_encrypt', v)} />

      <div>
        <label className="block text-sm font-medium mb-1">최대 파일 크기 (MB)</label>
        <input type="number" min={1} max={10000}
          value={policy.max_file_size_mb}
          onChange={e => upd('max_file_size_mb', parseInt(e.target.value || '100'))}
          className="w-32 px-3 py-2 text-sm border border-zinc-300 rounded-lg" />
      </div>

      <button onClick={save} disabled={!dirty}
        className="px-4 py-2 text-sm bg-[#175DDC] text-white rounded-lg disabled:opacity-40">
        저장
      </button>
    </div>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer">
      <input type="checkbox" checked={value} onChange={e => onChange(e.target.checked)} className="w-4 h-4" />
      <span className="text-sm">{label}</span>
    </label>
  );
}

// ── 감사 ──
function AuditTab({ tenant }: { tenant: Tenant }) {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  useEffect(() => { listAuditLogs(tenant.id, 200).then(setLogs).catch(() => setLogs([])); }, [tenant.id]);

  if (logs.length === 0) return <div className="text-sm text-zinc-500 text-center py-10">감사 로그 없음</div>;

  return (
    <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-zinc-50 border-b border-zinc-200">
          <tr><Th>시각</Th><Th>행위자</Th><Th>액션</Th><Th>대상</Th></tr>
        </thead>
        <tbody>
          {logs.map(l => (
            <tr key={l.id} className="border-b border-zinc-100 last:border-0">
              <Td className="text-xs text-zinc-500">{new Date(l.created_at).toLocaleString()}</Td>
              <Td className="text-xs font-mono">{l.actor_id?.slice(0, 8) ?? '-'}</Td>
              <Td className="text-xs font-medium text-[#175DDC]">{l.action}</Td>
              <Td className="text-xs">{l.target_type}:{l.target_id?.slice(0, 12) ?? '-'}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── 결제 ──
function BillingTab({ tenant, onDeleted }: { tenant: Tenant; onDeleted: () => void }) {
  const { user } = useAuthStore();
  const [plan, setPlan] = useState(tenant.plan);

  const changePlan = async () => {
    try {
      await updateTenant(tenant.id, { plan });
      await logAudit(user!.id, 'tenant.plan_change', { tenantId: tenant.id, metadata: { from: tenant.plan, to: plan } });
      toast.success('플랜 변경 완료');
    } catch (err) { toast.error(`실패: ${err instanceof Error ? err.message : err}`); }
  };

  const drop = async () => {
    if (!confirm(`"${tenant.name}" 조직을 영구 삭제하시겠습니까? 복구 불가.`)) return;
    try {
      await deleteTenant(tenant.id);
      await logAudit(user!.id, 'tenant.delete', { tenantId: tenant.id });
      toast.success('삭제 완료');
      onDeleted();
    } catch (err) { toast.error(`실패: ${err instanceof Error ? err.message : err}`); }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white border border-zinc-200 rounded-xl p-5">
        <h3 className="font-semibold mb-3">플랜</h3>
        <div className="flex items-center gap-3">
          <select value={plan} onChange={e => setPlan(e.target.value as Tenant['plan'])}
            className="px-3 py-2 text-sm border border-zinc-300 rounded-lg">
            <option value="free">Free</option>
            <option value="team">Team</option>
            <option value="enterprise">Enterprise</option>
          </select>
          <button onClick={changePlan}
            className="px-4 py-2 text-sm bg-[#175DDC] text-white rounded-lg">변경</button>
        </div>
        <p className="text-xs text-zinc-500 mt-2">※ 실제 결제 연동은 추후 Stripe로 대체됩니다.</p>
      </div>

      <div className="bg-white border border-red-200 rounded-xl p-5">
        <h3 className="font-semibold text-red-600 mb-2">위험 구역</h3>
        <button onClick={drop}
          className="px-4 py-2 text-sm bg-red-500 text-white rounded-lg hover:bg-red-600">
          조직 삭제
        </button>
      </div>
    </div>
  );
}
