/**
 * /team/:slug/billing
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuthStore } from '@/lib/supabase/auth-store';
import { useTeam } from '@/components/team/TeamLayout';
import { updateTenant, deleteTenant, type Tenant } from '@/lib/supabase/tenants';
import { logAudit } from '@/lib/supabase/audit';

export function TeamBillingPage() {
  const { tenant } = useTeam();
  const { user } = useAuthStore();
  const nav = useNavigate();
  const [plan, setPlan] = useState<Tenant['plan']>(tenant.plan);

  const changePlan = async () => {
    try {
      await updateTenant(tenant.id, { plan });
      await logAudit(user!.id, 'tenant.plan_change', { tenantId: tenant.id, metadata: { from: tenant.plan, to: plan } });
      toast.success('플랜 변경');
    } catch (err) { toast.error(`실패: ${err instanceof Error ? err.message : err}`); }
  };

  const drop = async () => {
    if (!confirm(`"${tenant.name}" 조직을 영구 삭제하시겠습니까? 복구 불가.`)) return;
    try {
      await deleteTenant(tenant.id);
      await logAudit(user!.id, 'tenant.delete', { tenantId: tenant.id });
      toast.success('삭제 완료');
      nav('/me');
    } catch (err) { toast.error(`실패: ${err instanceof Error ? err.message : err}`); }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">결제 / 플랜</h1>
      <div className="bg-white border border-zinc-200 rounded-xl p-5">
        <h3 className="font-semibold mb-3">플랜</h3>
        <div className="flex items-center gap-3">
          <select value={plan} onChange={e => setPlan(e.target.value as Tenant['plan'])}
            className="px-3 py-2 text-sm border border-zinc-300 rounded-lg">
            <option value="free">Free</option>
            <option value="team">Team</option>
            <option value="enterprise">Enterprise</option>
          </select>
          <button onClick={changePlan} className="px-4 py-2 text-sm bg-[#175DDC] text-white rounded-lg">변경</button>
        </div>
        <p className="text-xs text-zinc-500 mt-2">※ 실제 결제 연동은 추후 Stripe로 대체됩니다.</p>
      </div>
      <div className="bg-white border border-red-200 rounded-xl p-5">
        <h3 className="font-semibold text-red-600 mb-2">위험 구역</h3>
        <button onClick={drop} className="px-4 py-2 text-sm bg-red-500 text-white rounded-lg hover:bg-red-600">
          조직 삭제
        </button>
      </div>
    </div>
  );
}
