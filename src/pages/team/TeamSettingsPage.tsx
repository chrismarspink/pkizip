/**
 * /team/:slug/settings — 조직 메타데이터
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuthStore } from '@/lib/supabase/auth-store';
import { useTeam } from '@/components/team/TeamLayout';
import { updateTenant } from '@/lib/supabase/tenants';
import { logAudit } from '@/lib/supabase/audit';

export function TeamSettingsPage() {
  const { tenant } = useTeam();
  const { user } = useAuthStore();
  const nav = useNavigate();
  const [name, setName] = useState(tenant.name);
  const [slug, setSlug] = useState(tenant.slug);
  const [saving, setSaving] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const patch: { name?: string } = {};
      if (name.trim() !== tenant.name) patch.name = name.trim();
      if (Object.keys(patch).length === 0) { toast('변경 사항 없음'); return; }
      await updateTenant(tenant.id, patch);
      await logAudit(user!.id, 'tenant.update', { tenantId: tenant.id, metadata: patch });
      toast.success('저장 완료');
      if (slug !== tenant.slug) nav(`/team/${slug}/settings`);
    } catch (err) { toast.error(`실패: ${err instanceof Error ? err.message : err}`); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">조직 설정</h1>
      <form onSubmit={save} className="bg-white border border-zinc-200 rounded-xl p-5 space-y-3 max-w-md">
        <label className="block">
          <span className="text-xs text-zinc-500 mb-1 block">조직 이름</span>
          <input value={name} onChange={e => setName(e.target.value)} required
            className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg" />
        </label>
        <label className="block">
          <span className="text-xs text-zinc-500 mb-1 block">slug (URL)</span>
          <input value={slug} disabled
            className="w-full px-3 py-2 text-sm font-mono border border-zinc-200 bg-zinc-50 text-zinc-500 rounded-lg" />
          <span className="text-[10px] text-zinc-400">slug 변경은 추후 지원 예정</span>
        </label>
        <button type="submit" disabled={saving}
          className="px-4 py-2 text-sm bg-[#175DDC] text-white rounded-lg disabled:opacity-50">
          {saving ? '저장 중…' : '저장'}
        </button>
      </form>
    </div>
  );
}
