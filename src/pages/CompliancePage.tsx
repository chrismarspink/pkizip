/**
 * 4관할 컴플라이언스 페이지 — KR · US · JP · EU.
 *
 * 사용 시나리오:
 *   1) 사용자가 텍스트 붙여넣기 또는 분석 세션에서 자동 전달받은 findings
 *   2) 탭으로 관할 선택 (또는 4관할 동시 평가)
 *   3) verdict (compliant/partial/insufficient) + 카테고리별 entity + 권장 조치 표시
 *   4) "유출신고 양식 생성" 버튼 → JSON 미리보기 + 다운로드
 *
 * 새 API: src/lib/analysis/compliance.ts 의 evaluate() / buildBreachDraft().
 */
import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import {
  evaluate, evaluateAll, buildBreachDraft, JURISDICTIONS,
  type Jurisdiction, type ComplianceResult,
} from '@/lib/analysis/compliance';
import { detect } from '@/lib/analysis/pii-detector';
import { classify } from '@/lib/analysis/classifier';
import type { Finding } from '@/lib/analysis/types';

export function CompliancePage() {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [activeJur, setActiveJur] = useState<Jurisdiction>('kr');
  const [draftJson, setDraftJson] = useState<string | null>(null);
  const [affectedSubjects, setAffectedSubjects] = useState(0);
  const [memo, setMemo] = useState('');

  // 텍스트 변경 시 자동 분석
  const findings: Finding[] = useMemo(() => {
    if (text.trim().length < 5) return [];
    return detect(text);
  }, [text]);

  const classification = useMemo(() => {
    if (findings.length === 0) return null;
    return classify(findings, text);
  }, [findings, text]);

  // 활성 관할의 평가 결과
  const result: ComplianceResult | null = useMemo(() => {
    if (findings.length === 0) return null;
    return evaluate(activeJur, findings, { affectedSubjects });
  }, [activeJur, findings, affectedSubjects]);

  // 4관할 동시 평가 (요약 뱃지용)
  const allResults = useMemo(() => {
    if (findings.length === 0) return null;
    return evaluateAll(findings, { affectedSubjects });
  }, [findings, affectedSubjects]);

  const handleGenerate = () => {
    const draft = buildBreachDraft(activeJur, 'pasted-text.txt', findings, {
      classification: classification ?? undefined,
      affectedSubjects,
      affectedIndividuals: affectedSubjects,
      memo,
    });
    setDraftJson(JSON.stringify(draft, null, 2));
  };

  const handleDownload = () => {
    if (!draftJson) return;
    const blob = new Blob([draftJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `breach-draft-${activeJur}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm text-zinc-500 mb-3">
        <Link to="/" className="hover:text-zinc-700">{t("compliance.breadcrumbHome")}</Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <span className="text-zinc-700">{t("compliance.breadcrumbHere")}</span>
      </div>

      <h1 className="text-2xl font-bold mb-1">{t("compliance.title")}</h1>
      <p className="text-sm text-zinc-500 mb-6">
        {t("compliance.subtitle")}
      </p>

      {/* 입력 영역 */}
      <div className="bg-white border border-zinc-200 rounded-lg p-4 mb-4">
        <label className="block text-sm font-medium text-zinc-700 mb-2">
          {t("compliance.pasteLabel")}
        </label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("compliance.pastePlaceholder")}
          className="w-full h-32 border border-zinc-200 rounded p-2 text-sm font-mono"
        />
        <div className="flex flex-wrap gap-3 mt-3 text-sm">
          <div className="text-zinc-600">
            {t("compliance.detected")}: <span className="font-mono font-semibold">{findings.length}</span>{t("compliance.cases")}
          </div>
          {classification && (
            <div className="text-zinc-600">
              {t("compliance.grade")}: <span className="font-mono font-semibold">{classification.grade}</span>
              ({classification.score})
            </div>
          )}
          <label className="ml-auto flex items-center gap-2 text-zinc-600">
            {t("compliance.affectedSubjects")}:
            <input
              type="number"
              min={0}
              value={affectedSubjects}
              onChange={(e) => setAffectedSubjects(Number(e.target.value) || 0)}
              className="w-24 border border-zinc-200 rounded px-2 py-0.5"
            />
          </label>
        </div>
      </div>

      {/* 관할 탭 */}
      <div className="flex gap-1 mb-3 border-b border-zinc-200">
        {JURISDICTIONS.map((j) => {
          const verdict = allResults?.[j.code]?.verdict;
          const verdictColor =
            verdict === 'compliant' ? 'bg-emerald-100 text-emerald-700'
            : verdict === 'partial' ? 'bg-amber-100 text-amber-700'
            : verdict === 'insufficient' ? 'bg-red-100 text-red-700'
            : 'bg-zinc-100 text-zinc-500';
          return (
            <button
              key={j.code}
              onClick={() => setActiveJur(j.code)}
              className={
                'px-4 py-2 text-sm font-medium flex items-center gap-2 ' +
                (activeJur === j.code
                  ? 'border-b-2 border-emerald-500 text-zinc-900'
                  : 'text-zinc-500 hover:text-zinc-700')
              }
            >
              <span>{j.flag}</span>
              <span>{j.code.toUpperCase()}</span>
              {verdict && (
                <span className={`text-xs px-1.5 py-0.5 rounded ${verdictColor}`}>
                  {verdict}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 결과 영역 */}
      {result ? <ResultPanel result={result} /> : (
        <div className="text-center py-12 text-zinc-400 text-sm">
          {t("compliance.emptyHint")}
        </div>
      )}

      {/* 유출신고 양식 생성 */}
      {result && (
        <div className="bg-white border border-zinc-200 rounded-lg p-4 mt-4">
          <h2 className="text-lg font-semibold mb-2">{t("compliance.generateTitle")}</h2>
          <input
            type="text"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder={t("compliance.memoPlaceholder")}
            className="w-full border border-zinc-200 rounded p-2 text-sm mb-2"
          />
          <div className="flex gap-2 mb-3">
            <button
              onClick={handleGenerate}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm rounded"
            >
              {JURISDICTIONS.find(j => j.code === activeJur)?.flag} {t("compliance.generateBtn")}
            </button>
            {draftJson && (
              <button
                onClick={handleDownload}
                className="px-4 py-2 border border-zinc-300 hover:bg-zinc-50 text-sm rounded"
              >
                {t("compliance.downloadJson")}
              </button>
            )}
          </div>
          {draftJson && (
            <pre className="bg-zinc-50 border border-zinc-200 rounded p-3 text-xs max-h-96 overflow-auto">
              {draftJson}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function ResultPanel({ result }: { result: ComplianceResult }) {
  const { t } = useTranslation();
  const verdictBgColor =
    result.verdict === 'compliant' ? 'bg-emerald-50 border-emerald-200'
    : result.verdict === 'partial' ? 'bg-amber-50 border-amber-200'
    : 'bg-red-50 border-red-200';

  // buckets — union type 의 공통 접근. 타입 좁히기.
  const buckets =
    'buckets' in result ? (result as { buckets: Record<string, string[]> }).buckets : {};
  const filledBuckets = Object.entries(buckets).filter(([, v]) => v && v.length > 0);

  return (
    <div className="space-y-3">
      <div className={`border rounded-lg p-4 ${verdictBgColor}`}>
        <div className="flex items-baseline gap-3 mb-1">
          <h2 className="text-lg font-bold">{result.name}</h2>
          <span className="text-xs text-zinc-500">{result.regulator}</span>
        </div>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm font-semibold">{t("compliance.evaluation")}:</span>
          <span className={
            'text-xs px-2 py-0.5 rounded font-bold ' +
            (result.verdict === 'compliant' ? 'bg-emerald-600 text-white'
              : result.verdict === 'partial' ? 'bg-amber-600 text-white'
              : 'bg-red-600 text-white')
          }>
            {result.verdict.toUpperCase()}
          </span>
        </div>
        <p className="text-sm text-zinc-700">{result.rationale}</p>
      </div>

      {filledBuckets.length > 0 && (
        <div className="bg-white border border-zinc-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-zinc-700 mb-2">{t("compliance.categoryDetected")}</h3>
          <div className="space-y-1.5">
            {filledBuckets.map(([cat, entities]) => (
              <div key={cat} className="flex items-baseline gap-2 text-sm">
                <span className="text-zinc-600 font-medium min-w-[160px]">{cat}</span>
                <span className="text-zinc-900 font-mono text-xs">
                  {Array.from(new Set(entities as string[])).join(', ')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="bg-white border border-zinc-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-emerald-700 mb-2">{t("compliance.requirementsMet")}</h3>
          <ul className="space-y-1 text-sm text-zinc-700">
            {result.requirementsMet.map((r, i) => (
              <li key={i}>· {r}</li>
            ))}
          </ul>
        </div>
        <div className="bg-white border border-zinc-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-amber-700 mb-2">{t("compliance.requirementsPending")}</h3>
          <ul className="space-y-1 text-sm text-zinc-700">
            {result.requirementsPending.map((r, i) => (
              <li key={i}>· {r}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
