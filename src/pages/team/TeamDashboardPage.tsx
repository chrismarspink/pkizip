/**
 * /team/:slug — 대시보드
 */
import { useEffect, useState } from 'react';
import { Users, BookUser, FileText, ShieldCheck, Plus, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTeam } from '@/components/team/TeamLayout';
import { listMembers } from '@/lib/supabase/tenants';
import { listContacts } from '@/lib/supabase/address-book';
import { listAuditLogs, type AuditLog } from '@/lib/supabase/audit';

export function TeamDashboardPage() {
  const { tenant, myRole } = useTeam();
  const [memberCount, setMemberCount] = useState<number | null>(null);
  const [contactCount, setContactCount] = useState<number | null>(null);
  const [recentLogs, setRecentLogs] = useState<AuditLog[]>([]);

  useEffect(() => {
    listMembers(tenant.id).then(m => setMemberCount(m.length)).catch(() => setMemberCount(0));
    listContacts(tenant.id).then(c => setContactCount(c.length)).catch(() => setContactCount(0));
    if (myRole === 'owner' || myRole === 'admin') {
      listAuditLogs(tenant.id, 8).then(setRecentLogs).catch(() => setRecentLogs([]));
    }
  }, [tenant.id, myRole]);

  const isAdmin = myRole === 'owner' || myRole === 'admin';

  return (
    <div className="space-y-6">
      <Header tenant={tenant} />

      {/* 통계 카드 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat icon={Users} label="멤버" value={memberCount} accent="blue" />
        <Stat icon={BookUser} label="공용 주소록" value={contactCount} accent="purple" />
        <Stat icon={FileText} label="이번달 활동" value={recentLogs.length > 0 ? `${recentLogs.length}+` : 0} accent="green" />
        <Stat icon={ShieldCheck} label="정책 위반" value={0} accent="amber" />
      </div>

      {/* 빠른 액션 */}
      {isAdmin && (
        <div className="bg-white border border-zinc-200 rounded-xl p-5">
          <h3 className="text-sm font-semibold mb-3">빠른 액션</h3>
          <div className="flex flex-wrap gap-2">
            <QuickAction to="invites" icon={Plus} label="멤버 초대" />
            <QuickAction to="contacts" icon={BookUser} label="거래처 추가" />
            <QuickAction to="policies" icon={ShieldCheck} label="정책 검토" />
            <QuickAction to="audit" icon={FileText} label="감사 로그" />
          </div>
        </div>
      )}

      {/* 최근 활동 */}
      {isAdmin && (
        <div className="bg-white border border-zinc-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold">최근 활동</h3>
            <Link to="audit" className="text-xs text-[#175DDC] hover:underline flex items-center gap-1">
              전체 보기 <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {recentLogs.length === 0 ? (
            <div className="text-xs text-zinc-400 py-4 text-center">활동 기록 없음</div>
          ) : (
            <ul className="space-y-2">
              {recentLogs.map(l => (
                <li key={l.id} className="flex items-center gap-2 text-xs">
                  <span className="text-zinc-400 font-mono shrink-0">
                    {new Date(l.created_at).toLocaleString()}
                  </span>
                  <span className="font-medium text-[#175DDC]">{l.action}</span>
                  <span className="text-zinc-500 truncate">
                    {l.target_type}:{l.target_id?.slice(0, 12) ?? '-'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Header({ tenant }: { tenant: { name: string; plan: string } }) {
  return (
    <div>
      <h1 className="text-xl font-bold">{tenant.name}</h1>
      <p className="text-sm text-zinc-500 mt-0.5">조직 관리 콘솔 · 플랜: {tenant.plan}</p>
    </div>
  );
}

function Stat({ icon: Icon, label, value, accent }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string; value: number | string | null;
  accent: 'blue' | 'purple' | 'green' | 'amber';
}) {
  const accentMap = {
    blue: 'bg-blue-100 text-blue-700',
    purple: 'bg-purple-100 text-purple-700',
    green: 'bg-green-100 text-green-700',
    amber: 'bg-amber-100 text-amber-700',
  };
  return (
    <div className="bg-white border border-zinc-200 rounded-xl p-4 flex items-center gap-3">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${accentMap[accent]}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <div className="text-[11px] text-zinc-500">{label}</div>
        <div className="text-xl font-bold">{value ?? '…'}</div>
      </div>
    </div>
  );
}

function QuickAction({ to, icon: Icon, label }: {
  to: string; icon: React.ComponentType<{ className?: string }>; label: string;
}) {
  return (
    <Link to={to}
      className="flex items-center gap-1.5 text-xs px-3 py-2 border border-zinc-200 rounded-lg hover:border-[#175DDC] hover:text-[#175DDC] hover:bg-[#175DDC]/5 transition-colors">
      <Icon className="w-3.5 h-3.5" /> {label}
    </Link>
  );
}
