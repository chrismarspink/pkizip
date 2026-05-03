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
import { Trash2, Plus, FlaskConical, ToggleLeft, ToggleRight, Save, X, Copy } from 'lucide-react';
import { toast } from 'sonner';
import {
  listCustomRules, saveCustomRule, deleteCustomRule, clearAllCustomRules, ulid,
  listEffectiveBuiltinRules, setBuiltinDisabled, BUILTIN_RULES,
  FIELD_LABELS, OP_LABELS,
  type CustomRule, type Condition, type FieldPath, type Op, type ActionType,
} from '@/lib/policy/custom-rules';
import { invalidateCustomRulesCache, invalidateDisabledBuiltinsCache } from '@/lib/policy/opa-engine';

export function PoliciesPage() {
  const [rules, setRules] = useState<CustomRule[]>([]);
  const [builtins, setBuiltins] = useState<CustomRule[]>([]);
  const [editing, setEditing] = useState<CustomRule | null>(null);
  // 빌트인에서 복제한 룰을 편집 중일 때 — 저장 시 원본 자동 비활성화 대상
  const [cloneFromReason, setCloneFromReason] = useState<string | null>(null);

  useEffect(() => { void load(); }, []);

  async function load() {
    try {
      setRules(await listCustomRules());
    } catch (e) {
      console.warn('[PoliciesPage] custom rules 로드 실패', e);
      setRules([]);
    }
    try {
      const list = await listEffectiveBuiltinRules();
      console.log('[PoliciesPage] builtin rules 로드:', list.length, list.map(r => r.action.reason));
      setBuiltins(list);
    } catch (e) {
      console.error('[PoliciesPage] builtin rules 로드 실패 — 폴백 적용', e);
      setBuiltins(BUILTIN_RULES.map(r => ({ ...r })));
    }
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

  async function toggleBuiltin(rule: CustomRule) {
    // enabled 가 true 였으면 disabled 로, false 였으면 disabled 해제 (활성화)
    await setBuiltinDisabled(rule.action.reason, rule.enabled);
    await invalidateDisabledBuiltinsCache();
    await load();
    toast.success(rule.enabled ? '비활성화됨' : '활성화됨');
  }

  async function cloneBuiltin(rule: CustomRule) {
    // 빌트인 → 사용자 룰 (편집 가능). 원본 자동 비활성화.
    const cloned: CustomRule = {
      id: ulid(),
      name: rule.name + ' (복사)',
      enabled: true,
      conditions: rule.conditions.map(c => ({ ...c })),
      action: {
        type: rule.action.type,
        reason: 'CUSTOM_' + rule.action.reason,
        message: rule.action.message,
      },
      createdAt: Date.now(),
    };
    setEditing(cloned);
    setCloneFromReason(rule.action.reason);
    // 원본 비활성화는 사용자가 저장하는 시점 (handleEditorSave) 에서 처리
  }

  async function handleEditorSave(r: CustomRule) {
    await saveCustomRule(r);
    if (cloneFromReason) {
      // 복제 저장 → 원본 빌트인 자동 비활성화
      await setBuiltinDisabled(cloneFromReason, true);
      await invalidateDisabledBuiltinsCache();
    }
    await invalidateCustomRulesCache();
    setEditing(null);
    setCloneFromReason(null);
    await load();
    toast.success(cloneFromReason ? '복제 저장됨 — 원본 빌트인 비활성화' : '룰 저장됨');
  }

  function handleEditorCancel() {
    setEditing(null);
    setCloneFromReason(null);
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

      {/* 빌트인 룰 — toggle / 복제 가능 */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <h2 className="text-sm font-semibold text-zinc-700">빌트인 룰 ({builtins.length})</h2>
          <span className="text-[11px] text-zinc-500">— 끄거나 복제하여 편집할 수 있습니다 (코드 자체는 불변)</span>
        </div>
        <div className="space-y-2">
          {builtins.map(r => (
            <RuleCard key={r.id} rule={r} kind="builtin"
              onToggle={() => toggleBuiltin(r)}
              onClone={() => cloneBuiltin(r)} />
          ))}
        </div>
      </div>

      {/* 사용자 룰 */}
      <div>
        <h2 className="text-sm font-semibold text-zinc-700 mb-2">사용자 룰 ({rules.length})</h2>
        {rules.length === 0 ? (
          <div className="text-center py-10 border-2 border-dashed border-zinc-200 rounded-xl text-zinc-500">
            <p className="text-sm mb-1">사용자 정의 룰이 없습니다.</p>
            <p className="text-xs text-zinc-400">"새 룰" 또는 빌트인 룰의 [복제하여 편집] 으로 추가하세요.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {rules.map(r => (
              <RuleCard key={r.id} rule={r} kind="custom"
                onToggle={() => toggle(r)}
                onEdit={() => setEditing({ ...r })}
                onDelete={() => remove(r.id)} />
            ))}
          </div>
        )}
      </div>

      {/* 편집 모달 */}
      {editing && (
        <RuleEditor
          rule={editing}
          cloneFromReason={cloneFromReason}
          onSave={handleEditorSave}
          onCancel={handleEditorCancel}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// 룰 카드
// ─────────────────────────────────────────────

function RuleCard({ rule, kind, onToggle, onEdit, onDelete, onClone }: {
  rule: CustomRule;
  kind: 'builtin' | 'custom';
  onToggle: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onClone?: () => void;
}) {
  return (
    <div className={`border rounded-lg p-3 ${
      rule.enabled ? 'bg-white border-zinc-200' : 'bg-zinc-50 border-zinc-200 opacity-60'
    } ${kind === 'builtin' ? 'border-l-4 border-l-zinc-400' : 'border-l-4 border-l-blue-400'}`}>
      <div className="flex items-start gap-3">
        <button onClick={onToggle} className="text-zinc-600 hover:text-blue-600 flex-shrink-0" title={rule.enabled ? '비활성화' : '활성화'}>
          {rule.enabled ? <ToggleRight className="w-6 h-6 text-emerald-600" /> : <ToggleLeft className="w-6 h-6" />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
              kind === 'builtin' ? 'bg-zinc-200 text-zinc-700' : 'bg-blue-100 text-blue-700'
            }`}>
              {kind === 'builtin' ? '🛡 빌트인' : '✏️ 사용자'}
            </span>
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
          <div className="text-[10px] text-zinc-400 mt-1 font-mono">
            reason: {rule.action.reason}
          </div>
        </div>
        <div className="flex gap-1 flex-shrink-0 flex-wrap justify-end">
          {kind === 'builtin' && onClone && (
            <button onClick={onClone}
              className="text-xs px-2 py-1 hover:bg-blue-50 text-blue-700 rounded inline-flex items-center gap-1"
              title="이 빌트인 룰을 사용자 룰로 복제하여 편집 (저장 시 원본 자동 비활성화)">
              <Copy className="w-3 h-3" /> 복제하여 편집
            </button>
          )}
          {kind === 'custom' && onEdit && (
            <button onClick={onEdit} className="text-xs px-2 py-1 hover:bg-zinc-100 rounded">편집</button>
          )}
          {kind === 'custom' && onDelete && (
            <button onClick={onDelete} className="text-xs px-2 py-1 hover:bg-red-50 text-red-600 rounded">삭제</button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 룰 편집 모달
// ─────────────────────────────────────────────

function RuleEditor({ rule, cloneFromReason, onSave, onCancel }: {
  rule: CustomRule;
  cloneFromReason?: string | null;
  onSave: (r: CustomRule) => void;
  onCancel: () => void;
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
          <h2 className="font-semibold">
            {cloneFromReason ? '빌트인 룰 복제 → 사용자 룰 편집' : (rule.name ? '룰 편집' : '룰 추가')}
          </h2>
          <button onClick={onCancel} className="p-1 hover:bg-zinc-100 rounded"><X className="w-4 h-4" /></button>
        </div>

        {cloneFromReason && (
          <div className="mx-4 mt-3 p-2.5 rounded bg-blue-50 border border-blue-200 text-[11px] text-blue-900 leading-relaxed">
            <b>📋 빌트인 룰 복제 중:</b> <code className="font-mono">{cloneFromReason}</code>.
            저장하면 사용자 룰로 추가되며, <b>원본 빌트인 룰은 자동 비활성화</b>됩니다.
            취소 시 원본은 그대로 유지됩니다.
          </div>
        )}

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
