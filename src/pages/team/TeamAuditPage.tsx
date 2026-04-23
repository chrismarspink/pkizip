/**
 * /team/:slug/audit
 */
import { useEffect, useState } from 'react';
import { useTeam } from '@/components/team/TeamLayout';
import { listAuditLogs, type AuditLog } from '@/lib/supabase/audit';

export function TeamAuditPage() {
  const { tenant } = useTeam();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [actionFilter, setActionFilter] = useState('');

  useEffect(() => {
    listAuditLogs(tenant.id, 200).then(setLogs).catch(() => setLogs([]));
  }, [tenant.id]);

  const filtered = actionFilter
    ? logs.filter(l => l.action.toLowerCase().includes(actionFilter.toLowerCase()))
    : logs;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">감사 로그</h1>
      <input value={actionFilter} onChange={e => setActionFilter(e.target.value)}
        placeholder="액션 필터 (예: contact, member, policy)"
        className="w-full max-w-sm px-3 py-2 text-sm border border-zinc-300 rounded-lg" />
      {filtered.length === 0 ? (
        <div className="text-sm text-zinc-500 text-center py-10">감사 로그 없음</div>
      ) : (
        <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 border-b border-zinc-200">
              <tr>
                <Th>시각</Th><Th>행위자</Th><Th>액션</Th><Th>대상</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(l => (
                <tr key={l.id} className="border-b border-zinc-100 last:border-0">
                  <Td className="text-xs text-zinc-500">{new Date(l.created_at).toLocaleString()}</Td>
                  <Td className="text-xs font-mono">{l.actor_id?.slice(0,8) ?? '-'}</Td>
                  <Td className="text-xs font-medium text-[#175DDC]">{l.action}</Td>
                  <Td className="text-xs">{l.target_type}:{l.target_id?.slice(0,12) ?? '-'}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return <th className="text-left px-4 py-2 text-xs font-semibold text-zinc-500 uppercase tracking-wider">{children}</th>;
}
function Td({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 align-middle ${className}`}>{children}</td>;
}
