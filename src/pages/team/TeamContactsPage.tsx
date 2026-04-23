/**
 * /team/:slug/contacts — 조직 공용 주소록
 */
import { useEffect, useMemo, useState } from 'react';
import { Plus, Search, Trash2, Pencil, X as XIcon, BookUser, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '@/lib/supabase/auth-store';
import { useTeam } from '@/components/team/TeamLayout';
import {
  listContacts, createContact, updateContact, deleteContact,
  type OrgContact, type ContactCategory, type ContactDraft,
} from '@/lib/supabase/address-book';
import { logAudit } from '@/lib/supabase/audit';
import { addToKeyRing } from '@/lib/crypto/key-manager';

const CATEGORY_LABEL: Record<ContactCategory, string> = {
  member: '내부 멤버', partner: '외부 거래처', custom: '기타',
};
const CATEGORY_BADGE: Record<ContactCategory, string> = {
  member: 'bg-blue-100 text-blue-700',
  partner: 'bg-amber-100 text-amber-700',
  custom: 'bg-zinc-100 text-zinc-600',
};

export function TeamContactsPage() {
  const { tenant, myRole } = useTeam();
  const { user } = useAuthStore();
  const [list, setList] = useState<OrgContact[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | ContactCategory>('all');
  const [editing, setEditing] = useState<OrgContact | null>(null);
  const [creating, setCreating] = useState(false);

  const isAdmin = myRole === 'owner' || myRole === 'admin';

  const reload = () => listContacts(tenant.id).then(setList).catch(() => setList([]));
  useEffect(() => { reload(); }, [tenant.id]);

  const filtered = useMemo(() => {
    let arr = list;
    if (filter !== 'all') arr = arr.filter(c => c.category === filter);
    if (query.trim()) {
      const q = query.toLowerCase();
      arr = arr.filter(c =>
        c.display_name.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q) ||
        c.organization?.toLowerCase().includes(q) ||
        c.job_title?.toLowerCase().includes(q),
      );
    }
    return arr;
  }, [list, filter, query]);

  const onSave = async (draft: ContactDraft, id?: string) => {
    try {
      if (id) {
        await updateContact(id, draft);
        await logAudit(user!.id, 'contact.update', { tenantId: tenant.id, targetId: id });
        toast.success('수정 완료');
      } else {
        const c = await createContact(tenant.id, user!.id, draft);
        await logAudit(user!.id, 'contact.create', { tenantId: tenant.id, targetId: c.id });
        toast.success('추가 완료');
      }
      setEditing(null); setCreating(false);
      reload();
    } catch (err) { toast.error(`실패: ${err instanceof Error ? err.message : err}`); }
  };

  const onDelete = async (c: OrgContact) => {
    if (!confirm(`${c.display_name}을(를) 삭제하시겠습니까?`)) return;
    try {
      await deleteContact(c.id);
      await logAudit(user!.id, 'contact.delete', { tenantId: tenant.id, targetId: c.id });
      toast.success('삭제 완료');
      reload();
    } catch (err) { toast.error(`실패: ${err instanceof Error ? err.message : err}`); }
  };

  const onImportToKeyring = async (c: OrgContact) => {
    if (!c.fingerprint) { toast.warning('인증서 정보가 없습니다'); return; }
    try {
      await addToKeyRing({
        fingerprint: c.fingerprint,
        label: `${c.display_name}${c.email ? ` <${c.email}>` : ''}`,
        signingKeyJWK: {},
        encryptionKeyJWK: c.enc_jwk_classic ?? {},
        createdAt: Date.now(),
        type: 'imported',
        displayName: c.display_name,
        email: c.email ?? undefined,
        certClassicPem: c.cert_classic ?? undefined,
        certKemPem: c.cert_kem ?? undefined,
        certDsaPem: c.cert_dsa ?? undefined,
      });
      toast.success('내 주소록에 추가됨');
    } catch (err) { toast.error(`실패: ${err instanceof Error ? err.message : err}`); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">공용 주소록 ({list.length})</h1>
          <p className="text-xs text-zinc-500 mt-0.5">조직 멤버와 외부 거래처의 인증서를 한곳에서 관리합니다.</p>
        </div>
        {isAdmin && (
          <button onClick={() => setCreating(true)}
            className="flex items-center gap-1 text-sm bg-[#175DDC] text-white px-3 py-2 rounded-lg">
            <Plus className="w-4 h-4" /> 신규
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
          <input value={query} onChange={e => setQuery(e.target.value)}
            placeholder="이름·이메일·조직·직책 검색"
            className="w-full pl-9 pr-3 py-2 text-sm border border-zinc-300 rounded-lg" />
        </div>
        <div className="flex gap-1">
          {(['all','member','partner','custom'] as const).map(c => (
            <button key={c} onClick={() => setFilter(c)}
              className={`text-xs px-3 py-1.5 rounded-lg border ${
                filter === c ? 'bg-[#175DDC] text-white border-[#175DDC]'
                : 'bg-white border-zinc-300 text-zinc-600 hover:bg-zinc-50'
              }`}>
              {c === 'all' ? '전체' : CATEGORY_LABEL[c]}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-sm text-zinc-400 bg-white border border-dashed border-zinc-300 rounded-xl">
          <BookUser className="w-10 h-10 mx-auto mb-2 text-zinc-300" />
          {list.length === 0 ? '주소록이 비어있습니다' : '검색 결과 없음'}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {filtered.map(c => (
            <ContactCard key={c.id} contact={c} isAdmin={isAdmin}
              onEdit={() => setEditing(c)} onDelete={() => onDelete(c)}
              onImport={() => onImportToKeyring(c)} />
          ))}
        </div>
      )}

      {(editing || creating) && (
        <ContactDialog
          contact={editing}
          onClose={() => { setEditing(null); setCreating(false); }}
          onSave={onSave}
        />
      )}
    </div>
  );
}

function ContactCard({ contact, isAdmin, onEdit, onDelete, onImport }: {
  contact: OrgContact; isAdmin: boolean;
  onEdit: () => void; onDelete: () => void; onImport: () => void;
}) {
  return (
    <div className="bg-white border border-zinc-200 rounded-xl p-4">
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 rounded-lg bg-zinc-100 flex items-center justify-center overflow-hidden shrink-0">
          {contact.logotype
            ? <img src={contact.logotype} alt="logo" className="w-full h-full object-cover" />
            : <BookUser className="w-5 h-5 text-zinc-400" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm truncate">{contact.display_name}</span>
            <span className={`text-[9px] px-1.5 py-0.5 rounded ${CATEGORY_BADGE[contact.category]}`}>
              {CATEGORY_LABEL[contact.category]}
            </span>
          </div>
          {contact.organization && <div className="text-xs text-zinc-600 truncate">{contact.organization}{contact.job_title ? ` · ${contact.job_title}` : ''}</div>}
          {contact.email && <div className="text-xs text-zinc-500 truncate">{contact.email}</div>}
          {contact.fingerprint && (
            <div className="text-[10px] text-zinc-400 font-mono mt-0.5">0x{contact.fingerprint.slice(0,8)}</div>
          )}
          <div className="flex flex-wrap gap-1 mt-1.5">
            {contact.cert_classic && <span className="text-[8px] bg-zinc-100 text-zinc-600 px-1.5 py-0.5 rounded font-bold">ECDSA</span>}
            {contact.cert_kem && <span className="text-[8px] bg-violet-100 text-violet-600 px-1.5 py-0.5 rounded font-bold">ML-KEM</span>}
            {contact.cert_dsa && <span className="text-[8px] bg-violet-100 text-violet-600 px-1.5 py-0.5 rounded font-bold">ML-DSA</span>}
            {contact.tags?.map(t => (
              <span key={t} className="text-[9px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">#{t}</span>
            ))}
          </div>
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-3 pt-2 border-t border-zinc-100">
        {contact.fingerprint && (
          <button onClick={onImport}
            className="text-xs flex items-center gap-1 text-[#175DDC] hover:bg-[#175DDC]/5 px-2 py-1 rounded">
            <UserPlus className="w-3 h-3" /> 내 주소록에 추가
          </button>
        )}
        {isAdmin && (
          <>
            <button onClick={onEdit}
              className="text-xs flex items-center gap-1 text-zinc-600 hover:bg-zinc-100 px-2 py-1 rounded">
              <Pencil className="w-3 h-3" /> 편집
            </button>
            <button onClick={onDelete}
              className="text-xs flex items-center gap-1 text-red-500 hover:bg-red-50 px-2 py-1 rounded">
              <Trash2 className="w-3 h-3" /> 삭제
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── 신규/편집 다이얼로그 ──
function ContactDialog({ contact, onClose, onSave }: {
  contact: OrgContact | null;
  onClose: () => void;
  onSave: (draft: ContactDraft, id?: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState<ContactDraft>({
    category: contact?.category ?? 'partner',
    display_name: contact?.display_name ?? '',
    email: contact?.email ?? '',
    organization: contact?.organization ?? '',
    job_title: contact?.job_title ?? '',
    phone: contact?.phone ?? '',
    notes: contact?.notes ?? '',
    tags: contact?.tags ?? [],
    fingerprint: contact?.fingerprint ?? '',
    cert_classic: contact?.cert_classic ?? '',
    cert_kem: contact?.cert_kem ?? '',
    cert_dsa: contact?.cert_dsa ?? '',
    enc_jwk_classic: contact?.enc_jwk_classic ?? null,
    logotype: contact?.logotype ?? '',
    source: contact?.source ?? 'manual',
  });
  const [tagInput, setTagInput] = useState('');
  const [saving, setSaving] = useState(false);

  const upd = <K extends keyof ContactDraft>(k: K, v: ContactDraft[K]) =>
    setDraft(d => ({ ...d, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.display_name.trim()) { toast.error('이름은 필수입니다'); return; }
    setSaving(true);
    try { await onSave(draft, contact?.id); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100">
          <h2 className="font-semibold">{contact ? '연락처 편집' : '신규 연락처'}</h2>
          <button type="button" onClick={onClose} className="p-1 hover:bg-zinc-100 rounded-lg">
            <XIcon className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-3">
          <Field label="카테고리">
            <select value={draft.category} onChange={e => upd('category', e.target.value as ContactCategory)}
              className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg">
              <option value="member">내부 멤버</option>
              <option value="partner">외부 거래처</option>
              <option value="custom">기타</option>
            </select>
          </Field>
          <Field label="이름 *">
            <input value={draft.display_name} onChange={e => upd('display_name', e.target.value)}
              required className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="이메일">
              <input type="email" value={draft.email ?? ''} onChange={e => upd('email', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg" />
            </Field>
            <Field label="전화">
              <input value={draft.phone ?? ''} onChange={e => upd('phone', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="조직">
              <input value={draft.organization ?? ''} onChange={e => upd('organization', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg" />
            </Field>
            <Field label="직책">
              <input value={draft.job_title ?? ''} onChange={e => upd('job_title', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg" />
            </Field>
          </div>
          <Field label="태그 (쉼표 또는 Enter)">
            <div className="flex flex-wrap gap-1 p-2 border border-zinc-300 rounded-lg">
              {draft.tags?.map(t => (
                <span key={t} className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded flex items-center gap-1">
                  #{t}
                  <button type="button" onClick={() => upd('tags', draft.tags?.filter(x => x !== t))}
                    className="text-blue-400 hover:text-red-500"><XIcon className="w-3 h-3"/></button>
                </span>
              ))}
              <input value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => {
                  if ((e.key === 'Enter' || e.key === ',') && tagInput.trim()) {
                    e.preventDefault();
                    const t = tagInput.trim().replace(/^#/, '');
                    if (!draft.tags?.includes(t)) upd('tags', [...(draft.tags ?? []), t]);
                    setTagInput('');
                  }
                }}
                className="flex-1 min-w-[80px] text-xs outline-none" placeholder="태그..." />
            </div>
          </Field>
          <Field label="메모">
            <textarea rows={2} value={draft.notes ?? ''} onChange={e => upd('notes', e.target.value)}
              className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg" />
          </Field>

          <details className="border-t border-zinc-100 pt-3">
            <summary className="text-sm font-semibold cursor-pointer text-zinc-700">인증서 (선택)</summary>
            <div className="space-y-3 mt-3">
              <Field label="Fingerprint (hex)">
                <input value={draft.fingerprint ?? ''} onChange={e => upd('fingerprint', e.target.value)}
                  placeholder="예: 20a52b52..."
                  className="w-full px-3 py-2 text-xs font-mono border border-zinc-300 rounded-lg" />
              </Field>
              <Field label="Classical 인증서 PEM (ECDSA)">
                <textarea rows={3} value={draft.cert_classic ?? ''} onChange={e => upd('cert_classic', e.target.value)}
                  placeholder="-----BEGIN CERTIFICATE-----..."
                  className="w-full px-3 py-2 text-xs font-mono border border-zinc-300 rounded-lg" />
              </Field>
              <Field label="ML-KEM 인증서 PEM">
                <textarea rows={3} value={draft.cert_kem ?? ''} onChange={e => upd('cert_kem', e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono border border-zinc-300 rounded-lg" />
              </Field>
              <Field label="ML-DSA 인증서 PEM">
                <textarea rows={3} value={draft.cert_dsa ?? ''} onChange={e => upd('cert_dsa', e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono border border-zinc-300 rounded-lg" />
              </Field>
              <Field label="ECDH 암호화 공개키 JWK (JSON)">
                <textarea rows={3}
                  value={draft.enc_jwk_classic ? JSON.stringify(draft.enc_jwk_classic, null, 2) : ''}
                  onChange={e => {
                    const v = e.target.value.trim();
                    if (!v) { upd('enc_jwk_classic', null); return; }
                    try { upd('enc_jwk_classic', JSON.parse(v)); } catch { /* ignore */ }
                  }}
                  className="w-full px-3 py-2 text-xs font-mono border border-zinc-300 rounded-lg" />
              </Field>
            </div>
          </details>
        </div>
        <div className="px-5 py-3 border-t border-zinc-100 flex justify-end gap-2">
          <button type="button" onClick={onClose}
            className="px-4 py-2 text-sm border border-zinc-300 rounded-lg">취소</button>
          <button type="submit" disabled={saving}
            className="px-4 py-2 text-sm bg-[#175DDC] text-white rounded-lg disabled:opacity-50">
            {saving ? '저장 중…' : '저장'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-zinc-500 mb-1 block">{label}</span>
      {children}
    </label>
  );
}
