/**
 * PoliciesPage — 사용자 정의 정책 룰 GUI (⚠ 실험 기능, 임시).
 *
 * 사이드바/탭바에서 [정책-실험] 으로 노출. 추후 제거 가능 — 다음만 지우면 끝:
 *   1) 이 파일
 *   2) src/lib/policy/custom-rules.ts
 *   3) opa-engine.ts 의 mergeCustomRules / invalidateCustomRulesCache (관련 import)
 *   4) App.tsx 의 라우트, SidebarNav/BottomTabBar 의 항목
 */
import { useEffect, useState } from 'react';
import { Trash2, Plus, FlaskConical, ToggleLeft, ToggleRight, Save, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  listCustomRules, saveCustomRule, deleteCustomRule, clearAllCustomRules, ulid,
  FIELD_LABELS, OP_LABELS,
  type CustomRule, type Condition, type FieldPath, type Op, type ActionType,
} from '@/lib/policy/custom-rules';
import { invalidateCustomRulesCache } from '@/lib/policy/opa-engine';

export function PoliciesPage() {
  const [rules, setRules] = useState<CustomRule[]>([]);
  const [editing, setEditing] = useState<CustomRule | null>(null);

  useEffect(() => { void load(); }, []);

  async function load() {
    setRules(await listCustomRules());
  }

  async function persist(rule: CustomRule) {
    await saveCustomRule(rule);
    await invalidateCustomRulesCache();
    await load();
    toast.success('룰 저장됨');
  }

  async function toggle(rule: CustomRule) {
    await persist({ ...rule, enabled: !rule.enabled });
  }

  async function remove(id: string) {
    if (!confirm('이 룰을 삭제하시겠습니까?')) return;
    await deleteCustomRule(id);
    await invalidateCustomRulesCache();
    await load();
    toast.success('삭제됨');
  }

  async function clearAll() {
    if (!confirm('모든 사용자 룰을 삭제하시겠습니까? 빌트인 룰은 유지됩니다.')) return;
    await clearAllCustomRules();
    await invalidateCustomRulesCache();
    await load();
    toast.success('전체 삭제됨');
  }

  function startNew() {
    setEditing({
      id: ulid(),
      name: '',
      enabled: true,
      conditions: [{ field: 'classification.grade', op: 'eq', value: 'C' }],
      action: { type: 'deny', reason: 'CUSTOM_' + Date.now().toString(36).toUpperCase(), message: '' },
      createdAt: Date.now(),
    });
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 lg:py-10">
      {/* 실험 표시 */}
      <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-300 flex items-start gap-2">
        <FlaskConical className="w-4 h-4 text-amber-700 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-amber-900 leading-relaxed">
          <b>실험 기능 (임시):</b> 사용자가 정책 룰을 추가/편집할 수 있습니다.
          저장된 룰은 IndexedDB <code className="font-mono">pkizip-policy / custom-rules-EXPERIMENTAL</code> 에 보관되며
          분석 다이얼로그의 OPA 평가 시 빌트인 룰과 함께 적용됩니다.
          이 페이지는 차후 제거될 수 있습니다.
        </div>
      </div>

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold">사용자 정의 정책 룰</h1>
        <div className="flex gap-2">
          {rules.length > 0 && (
            <button onClick={clearAll}
              className="text-xs px-2 py-1.5 border border-red-300 text-red-700 rounded hover:bg-red-50 inline-flex items-center gap-1">
              <Trash2 className="w-3 h-3" /> 전체 삭제
            </button>
          )}
          <button onClick={startNew}
            className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 inline-flex items-center gap-1.5">
            <Plus className="w-4 h-4" /> 새 룰
          </button>
        </div>
      </div>

      {/* 룰 목록 */}
      {rules.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-zinc-200 rounded-xl text-zinc-500">
          <p className="text-sm mb-2">사용자 정의 룰이 없습니다.</p>
          <p className="text-xs text-zinc-400">"새 룰" 을 눌러 빌트인 룰 위에 추가 룰을 정의하세요.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {rules.map(r => (
            <RuleCard key={r.id} rule={r}
              onToggle={() => toggle(r)}
              onEdit={() => setEditing({ ...r })}
              onDelete={() => remove(r.id)} />
          ))}
        </div>
      )}

      {/* 빌트인 룰 안내 (참고) */}
      <details className="mt-8 border rounded-lg bg-zinc-50">
        <summary className="cursor-pointer p-3 text-xs font-semibold text-zinc-600 uppercase">
          빌트인 룰 (참고만 — 편집 불가)
        </summary>
        <div className="px-3 pb-3 text-xs text-zinc-600 space-y-1.5">
          <div>• <b>C_GRADE_REQUIRES_PQC_FOR_EXTERNAL</b> — C + external + classic → 거부</div>
          <div>• <b>C_GRADE_REQUIRES_ANONYMIZATION_FOR_EXTERNAL</b> — C + external + 가명화 미적용 → 거부</div>
          <div>• <b>LANGUAGE_DOWNGRADE_BLOCKED</b> — 비한국어 + O + external → 거부</div>
          <div>• <b>OCR_C_GRADE_REQUIRES_REVIEW</b> — OCR + C + 가명화 미적용 → 거부</div>
        </div>
      </details>

      {/* 편집 모달 */}
      {editing && (
        <RuleEditor
          rule={editing}
          onSave={async (r) => { await persist(r); setEditing(null); }}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// 룰 카드
// ─────────────────────────────────────────────

function RuleCard({ rule, onToggle, onEdit, onDelete }: {
  rule: CustomRule; onToggle: () => void; onEdit: () => void; onDelete: () => void;
}) {
  return (
    <div className={`border rounded-lg p-3 ${rule.enabled ? 'bg-white border-zinc-200' : 'bg-zinc-50 border-zinc-200 opacity-60'}`}>
      <div className="flex items-start gap-3">
        <button onClick={onToggle} className="text-zinc-600 hover:text-blue-600 flex-shrink-0">
          {rule.enabled ? <ToggleRight className="w-6 h-6 text-emerald-600" /> : <ToggleLeft className="w-6 h-6" />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm">{rule.name || '(이름 없음)'}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
              rule.action.type === 'deny' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'
            }`}>
              {rule.action.type === 'deny' ? '거부' : '권장'}
            </span>
          </div>
          <div className="text-[11px] text-zinc-500 mt-1 font-mono">
            {rule.conditions.map((c, i) => (
              <span key={i}>
                {i > 0 && <span className="text-zinc-400"> AND </span>}
                {FIELD_LABELS[c.field].label} {OP_LABELS[c.op]} <b>{String(c.value)}</b>
              </span>
            ))}
          </div>
          {rule.action.message && (
            <div className="text-xs text-zinc-700 mt-1.5">→ {rule.action.message}</div>
          )}
        </div>
        <div className="flex gap-1 flex-shrink-0">
          <button onClick={onEdit} className="text-xs px-2 py-1 hover:bg-zinc-100 rounded">편집</button>
          <button onClick={onDelete} className="text-xs px-2 py-1 hover:bg-red-50 text-red-600 rounded">삭제</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 룰 편집 모달
// ─────────────────────────────────────────────

function RuleEditor({ rule, onSave, onCancel }: {
  rule: CustomRule; onSave: (r: CustomRule) => void; onCancel: () => void;
}) {
  const [draft, setDraft] = useState<CustomRule>(rule);
  const valid = draft.name.trim().length > 0 && draft.conditions.length > 0 && draft.action.message.trim().length > 0;

  function updateCondition(i: number, patch: Partial<Condition>) {
    const next = [...draft.conditions];
    next[i] = { ...next[i]!, ...patch };
    setDraft({ ...draft, conditions: next });
  }
  function addCondition() {
    setDraft({ ...draft, conditions: [...draft.conditions, { field: 'classification.grade', op: 'eq', value: 'C' }] });
  }
  function removeCondition(i: number) {
    setDraft({ ...draft, conditions: draft.conditions.filter((_, j) => j !== i) });
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="font-semibold">룰 {rule.name ? '편집' : '추가'}</h2>
          <button onClick={onCancel} className="p-1 hover:bg-zinc-100 rounded"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className="text-xs text-zinc-500">룰 이름</label>
            <input value={draft.name}
              onChange={e => setDraft({ ...draft, name: e.target.value })}
              placeholder="예: S 등급 외부전송 PQC 필수"
              className="w-full mt-1 px-2 py-1.5 border rounded text-sm" />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-zinc-500">조건 (모두 충족 시 fire — AND)</label>
              <button onClick={addCondition} className="text-xs text-blue-600 hover:text-blue-800">+ 조건 추가</button>
            </div>
            <div className="space-y-2">
              {draft.conditions.map((c, i) => (
                <ConditionRow key={i}
                  cond={c}
                  onChange={(patch) => updateCondition(i, patch)}
                  onRemove={draft.conditions.length > 1 ? () => removeCondition(i) : undefined} />
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs text-zinc-500">액션</label>
            <div className="grid grid-cols-2 gap-2 mt-1">
              {(['deny', 'recommend'] as ActionType[]).map(t => (
                <button key={t}
                  onClick={() => setDraft({ ...draft, action: { ...draft.action, type: t } })}
                  className={`px-3 py-2 text-sm rounded border ${
                    draft.action.type === t
                      ? t === 'deny' ? 'bg-red-600 text-white border-red-600' : 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white border-zinc-200 hover:border-blue-400'
                  }`}>
                  {t === 'deny' ? '🚫 거부 (송신 차단)' : '💡 권장 (안내만)'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs text-zinc-500">사용자 메시지 (사용자에게 표시)</label>
            <textarea value={draft.action.message}
              onChange={e => setDraft({ ...draft, action: { ...draft.action, message: e.target.value } })}
              placeholder="예: S 등급 문서는 외부 전송 시 PQC 암호화가 필요합니다."
              rows={2}
              className="w-full mt-1 px-2 py-1.5 border rounded text-sm resize-none" />
          </div>

          <div>
            <label className="text-xs text-zinc-500">룰 코드 (디버깅용)</label>
            <input value={draft.action.reason}
              onChange={e => setDraft({ ...draft, action: { ...draft.action, reason: e.target.value } })}
              className="w-full mt-1 px-2 py-1.5 border rounded text-sm font-mono text-xs" />
          </div>
        </div>

        <div className="flex justify-end gap-2 p-4 border-t bg-zinc-50">
          <button onClick={onCancel} className="px-3 py-2 text-sm hover:bg-zinc-100 rounded">취소</button>
          <button onClick={() => onSave(draft)} disabled={!valid}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded disabled:bg-zinc-300 disabled:cursor-not-allowed inline-flex items-center gap-1.5">
            <Save className="w-4 h-4" /> 저장
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 조건 한 줄
// ─────────────────────────────────────────────

function ConditionRow({ cond, onChange, onRemove }: {
  cond: Condition; onChange: (patch: Partial<Condition>) => void; onRemove?: () => void;
}) {
  const meta = FIELD_LABELS[cond.field];

  // 필드 변경 시 value 타입을 맞춰주기
  function changeField(field: FieldPath) {
    const m = FIELD_LABELS[field];
    const defaultValue: string | number | boolean =
      m.type === 'boolean' ? true
      : m.type === 'number' ? 0
      : (m.options?.[0] ?? '');
    onChange({ field, value: defaultValue });
  }

  return (
    <div className="flex items-center gap-2 bg-zinc-50 border border-zinc-200 rounded p-2">
      <select value={cond.field}
        onChange={e => changeField(e.target.value as FieldPath)}
        className="text-xs border border-zinc-300 rounded px-1.5 py-1 bg-white">
        {(Object.keys(FIELD_LABELS) as FieldPath[]).map(f => (
          <option key={f} value={f}>{FIELD_LABELS[f].label}</option>
        ))}
      </select>

      <select value={cond.op}
        onChange={e => onChange({ op: e.target.value as Op })}
        className="text-xs border border-zinc-300 rounded px-1.5 py-1 bg-white">
        {(Object.keys(OP_LABELS) as Op[])
          .filter(o => meta.type !== 'boolean' || o === 'eq' || o === 'neq')
          .filter(o => meta.type !== 'string' || o === 'eq' || o === 'neq')
          .map(o => <option key={o} value={o}>{OP_LABELS[o]}</option>)}
      </select>

      {meta.type === 'boolean' ? (
        <select value={String(cond.value)}
          onChange={e => onChange({ value: e.target.value === 'true' })}
          className="text-xs border border-zinc-300 rounded px-1.5 py-1 bg-white flex-1">
          <option value="true">참 (true)</option>
          <option value="false">거짓 (false)</option>
        </select>
      ) : meta.options ? (
        <select value={String(cond.value)}
          onChange={e => onChange({ value: e.target.value })}
          className="text-xs border border-zinc-300 rounded px-1.5 py-1 bg-white flex-1">
          {meta.options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : meta.type === 'number' ? (
        <input type="number" step="0.01" value={String(cond.value)}
          onChange={e => onChange({ value: parseFloat(e.target.value) || 0 })}
          className="text-xs border border-zinc-300 rounded px-1.5 py-1 bg-white flex-1" />
      ) : (
        <input value={String(cond.value)}
          onChange={e => onChange({ value: e.target.value })}
          className="text-xs border border-zinc-300 rounded px-1.5 py-1 bg-white flex-1" />
      )}

      {onRemove && (
        <button onClick={onRemove} className="text-red-500 hover:bg-red-50 rounded p-1">
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}
