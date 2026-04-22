/**
 * /admin — 시스템 관리 (L4, system_admin만 접근)
 * 탭: 테넌트 | 사용자 | TSA 인증서 | 감사 로그
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ShieldAlert, Building2, Users, Clock, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '@/lib/supabase/auth-store';
import { isSystemAdmin, listAllTenants, listGlobalTsaCerts, searchUsers } from '@/lib/supabase/system-admin';
import { listAllAuditLogs, type AuditLog } from '@/lib/supabase/audit';
import type { Tenant } from '@/lib/supabase/tenants';

type Tab = 'tenants' | 'users' | 'tsa' | 'audit';

export function AdminPage() {
  const { user, loading } = useAuthStore();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>('tenants');

  useEffect(() => {
    if (!user) { setAllowed(false); return; }
    isSystemAdmin().then(setAllowed);
  }, [user?.id]);

  if (loading || allowed === null) return <div className="p-6">확인 중…</div>;
  if (!user) return <div className="p-6 text-red-500">로그인이 필요합니다</div>;
  if (!allowed) return <div className="p-6 text-red-500">시스템 관리자 권한이 없습니다</div>;

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 lg:py-10">
      <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-4 py-2 mb-5 flex items-center gap-2 text-sm">
        <ShieldAlert className="w-4 h-4" />
        시스템 관리 모드 — 모든 동작이 감사 로그에 기록됩니다
      </div>

      <h1 className="text-xl font-bold mb-6">시스템 관리</h1>

      <div className="flex gap-1 border-b border-zinc-200 mb-6 overflow-x-auto">
        <TabBtn active={tab === 'tenants'} onClick={() => setTab('tenants')} icon={Building2} label="테넌트" />
        <TabBtn active={tab === 'users'} onClick={() => setTab('users')} icon={Users} label="사용자" />
        <TabBtn active={tab === 'tsa'} onClick={() => setTab('tsa')} icon={Clock} label="TSA 인증서" />
        <TabBtn active={tab === 'audit'} onClick={() => setTab('audit')} icon={FileText} label="감사 로그" />
      </div>

      {tab === 'tenants' && <TenantsTab />}
      {tab === 'users' && <UsersTab />}
      {tab === 'tsa' && <TsaTab />}
      {tab === 'audit' && <AuditTab />}
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

function TenantsTab() {
  const [list, setList] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listAllTenants().then(rows => { setList(rows); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-sm text-zinc-500">불러오는 중…</div>;

  return (
    <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-zinc-50 border-b border-zinc-200">
          <tr><Th>이름</Th><Th>slug</Th><Th>플랜</Th><Th>멤버 수</Th><Th>생성</Th><Th></Th></tr>
        </thead>
        <tbody>
          {list.map(t => (
            <tr key={t.id} className="border-b border-zinc-100 last:border-0">
              <Td>{t.name}</Td>
              <Td className="font-mono text-xs">{t.slug}</Td>
              <Td><span className="text-[10px] bg-zinc-100 px-1.5 py-0.5 rounded">{t.plan}</span></Td>
              <Td>{(t as Tenant & { member_count?: number }).member_count ?? '-'}</Td>
              <Td className="text-xs text-zinc-500">{t.created_at ? new Date(t.created_at).toLocaleDateString() : '-'}</Td>
              <Td>
                {(t.plan === 'team' || t.plan === 'enterprise') && (
                  <Link to={`/team/${t.slug}`} className="text-xs text-[#175DDC] hover:underline">열기</Link>
                )}
              </Td>
            </tr>
          ))}
          {list.length === 0 && (
            <tr><td colSpan={6} className="text-center py-6 text-sm text-zinc-500">테넌트 없음</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function UsersTab() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Array<{ id: string; display_name: string | null }>>([]);

  const search = async () => {
    if (!q.trim()) return;
    try {
      setResults(await searchUsers(q.trim()));
    } catch (err) { toast.error(`검색 실패: ${err instanceof Error ? err.message : err}`); }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input value={q} onChange={e => setQ(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && search()}
          placeholder="이름 또는 ID로 검색"
          className="flex-1 px-3 py-2 text-sm border border-zinc-300 rounded-lg" />
        <button onClick={search} className="px-4 py-2 text-sm bg-[#175DDC] text-white rounded-lg">검색</button>
      </div>

      <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 border-b border-zinc-200">
            <tr><Th>표시 이름</Th><Th>사용자 ID</Th></tr>
          </thead>
          <tbody>
            {results.map(u => (
              <tr key={u.id} className="border-b border-zinc-100 last:border-0">
                <Td>{u.display_name ?? <span className="text-zinc-400">(이름 없음)</span>}</Td>
                <Td className="font-mono text-xs">{u.id}</Td>
              </tr>
            ))}
            {results.length === 0 && (
              <tr><td colSpan={2} className="text-center py-6 text-sm text-zinc-500">검색 결과 없음</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TsaTab() {
  const [list, setList] = useState<Array<{ id: string; issuer_name: string; subject_name: string; fingerprint: string; source_url: string | null }>>([]);
  useEffect(() => { listGlobalTsaCerts().then(setList).catch(() => setList([])); }, []);

  return (
    <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-zinc-50 border-b border-zinc-200">
          <tr><Th>발급자</Th><Th>주체</Th><Th>TSA URL</Th><Th>Fingerprint</Th></tr>
        </thead>
        <tbody>
          {list.map(c => (
            <tr key={c.id} className="border-b border-zinc-100 last:border-0">
              <Td>{c.issuer_name}</Td>
              <Td>{c.subject_name}</Td>
              <Td className="text-xs text-zinc-500">{c.source_url ?? '-'}</Td>
              <Td className="font-mono text-xs">{c.fingerprint.slice(0, 16)}…</Td>
            </tr>
          ))}
          {list.length === 0 && (
            <tr><td colSpan={4} className="text-center py-6 text-sm text-zinc-500">등록된 TSA 인증서 없음</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function AuditTab() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  useEffect(() => { listAllAuditLogs(300).then(setLogs).catch(() => setLogs([])); }, []);

  return (
    <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-zinc-50 border-b border-zinc-200">
          <tr><Th>시각</Th><Th>테넌트</Th><Th>행위자</Th><Th>액션</Th><Th>대상</Th></tr>
        </thead>
        <tbody>
          {logs.map(l => (
            <tr key={l.id} className="border-b border-zinc-100 last:border-0">
              <Td className="text-xs text-zinc-500">{new Date(l.created_at).toLocaleString()}</Td>
              <Td className="text-xs font-mono">{l.tenant_id?.slice(0, 8) ?? '-'}</Td>
              <Td className="text-xs font-mono">{l.actor_id?.slice(0, 8) ?? '-'}</Td>
              <Td className="text-xs font-medium text-[#175DDC]">{l.action}</Td>
              <Td className="text-xs">{l.target_type}:{l.target_id?.slice(0, 12) ?? '-'}</Td>
            </tr>
          ))}
          {logs.length === 0 && (
            <tr><td colSpan={5} className="text-center py-6 text-sm text-zinc-500">감사 로그 없음</td></tr>
          )}
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
