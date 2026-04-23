/**
 * /team/:slug/policies
 */
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useAuthStore } from '@/lib/supabase/auth-store';
import { useTeam } from '@/components/team/TeamLayout';
import { getPolicy, upsertPolicy, type TenantPolicy } from '@/lib/supabase/tenants';
import { logAudit } from '@/lib/supabase/audit';

export function TeamPoliciesPage() {
  const { tenant } = useTeam();
  const { user } = useAuthStore();
  const [policy, setPolicy] = useState<TenantPolicy | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => { getPolicy(tenant.id).then(p => { setPolicy(p); setDirty(false); }); }, [tenant.id]);

  if (!policy) return <div className="text-sm text-zinc-500">불러오는 중…</div>;

  const upd = <K extends keyof TenantPolicy>(k: K, v: TenantPolicy[K]) => {
    setPolicy({ ...policy, [k]: v });
    setDirty(true);
  };

  const save = async () => {
    try {
      await upsertPolicy(tenant.id, user!.id, policy);
      await logAudit(user!.id, 'policy.update', { tenantId: tenant.id, metadata: { ...policy } as Record<string, unknown> });
      toast.success('정책 저장');
      setDirty(false);
    } catch (err) { toast.error(`실패: ${err instanceof Error ? err.message : err}`); }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">보안 정책</h1>
      <div className="bg-white border border-zinc-200 rounded-xl p-5 space-y-4">
        <Toggle label="PQC 강제 (모든 서명/암호화에 Post-Quantum 사용)"
          value={policy.require_pqc} onChange={v => upd('require_pqc', v)} />
        <Toggle label="타임스탬프 강제 (모든 서명에 TSA 타임스탬프 요구)"
          value={policy.require_timestamp} onChange={v => upd('require_timestamp', v)} />
        <Toggle label="비밀번호 암호화 허용"
          value={policy.allow_password_encrypt} onChange={v => upd('allow_password_encrypt', v)} />
        <div>
          <label className="block text-sm font-medium mb-1">최대 파일 크기 (MB)</label>
          <input type="number" min={1} max={10000} value={policy.max_file_size_mb}
            onChange={e => upd('max_file_size_mb', parseInt(e.target.value || '100'))}
            className="w-32 px-3 py-2 text-sm border border-zinc-300 rounded-lg" />
        </div>
        <button onClick={save} disabled={!dirty}
          className="px-4 py-2 text-sm bg-[#175DDC] text-white rounded-lg disabled:opacity-40">저장</button>
      </div>
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
