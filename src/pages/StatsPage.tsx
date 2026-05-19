/**
 * DPV 통계 페이지 — `/stats`.
 *
 * 마지막 지정한 폴더의 모든 .pki 봉투 헤더를 스캔 → DPV 메타 집계 → 시각화.
 * 폴더 권한 없으면 ExplorerPage 로 안내.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BarChart3, FolderOpen, RefreshCw, AlertCircle, FileText, Printer } from 'lucide-react';
import {
  loadLastFolder, checkHandlePermission, requestHandlePermission,
} from '@/lib/store/last-folder';
import { isPkiFile, readPkiHeader, type PkiHeader } from '@/lib/container/pki-format';
import { aggregateDpvStats, type DpvStats } from '@/lib/analysis/dpv-stats';
import { dpvLabel, dpvIcon, dpvRisk, dpvChipClass } from '@/lib/policy/standards/dpv-labels';
import { openPolicyDocPrint } from '@/lib/analysis/dpv-policy-doc';

const PKI_EXTS = ['.pki', '.pkizip', '.pqcz'];
function isPkiByName(name: string): boolean {
  const lower = name.toLowerCase();
  return PKI_EXTS.some(e => lower.endsWith(e));
}

interface ScannedEntry {
  name: string;
  header: PkiHeader | null;
  addedAt?: number;
}

async function scanDirHandle(
  handle: FileSystemDirectoryHandle,
): Promise<ScannedEntry[]> {
  const out: ScannedEntry[] = [];
  for await (const [, entry] of handle.entries()) {
    if (entry.kind === 'file') {
      const file = await (entry as FileSystemFileHandle).getFile();
      let header: PkiHeader | null = null;
      if (isPkiByName(file.name)) {
        try {
          const buf = new Uint8Array(await file.arrayBuffer());
          if (isPkiFile(buf)) header = readPkiHeader(buf);
        } catch { /* skip */ }
      }
      out.push({ name: file.name, header, addedAt: file.lastModified });
    } else if (entry.kind === 'directory') {
      const nested = await scanDirHandle(entry as FileSystemDirectoryHandle);
      out.push(...nested);
    }
  }
  return out;
}

const POLICY_INPUT_KEY = 'pkizip-policy-doc-input';

export function StatsPage() {
  const { t, i18n } = useTranslation();
  const [entries, setEntries] = useState<ScannedEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [folderName, setFolderName] = useState<string>('');
  const [companyName, setCompanyName] = useState(() => localStorage.getItem(`${POLICY_INPUT_KEY}-company`) || '');
  const [dpoName, setDpoName] = useState(() => localStorage.getItem(`${POLICY_INPUT_KEY}-dpoName`) || '');
  const [dpoEmail, setDpoEmail] = useState(() => localStorage.getItem(`${POLICY_INPUT_KEY}-dpoEmail`) || '');
  const [retentionYears, setRetentionYears] = useState(() => Number(localStorage.getItem(`${POLICY_INPUT_KEY}-retention`)) || 5);

  function saveInput<K extends string>(key: K, value: string | number) {
    try { localStorage.setItem(`${POLICY_INPUT_KEY}-${key}`, String(value)); } catch { /* skip */ }
  }

  function handlePrintPolicyDoc() {
    if (!companyName.trim()) {
      alert(t('statsPage.enterCompany'));
      return;
    }
    openPolicyDocPrint(stats, {
      companyName: companyName.trim(),
      dpoName: dpoName.trim(),
      dpoEmail: dpoEmail.trim(),
      retentionYears,
    });
  }

  const stats: DpvStats = useMemo(() => aggregateDpvStats(entries), [entries]);

  async function rescan() {
    setLoading(true);
    setError(null);
    try {
      const last = await loadLastFolder();
      if (!last || last.accessMode !== 'fs-access' || !last.dirHandle) {
        setError(t('statsPage.errNoFolder'));
        setEntries([]);
        return;
      }
      setFolderName(last.rootName || t('statsPage.savedFolder'));
      const perm = await checkHandlePermission(last.dirHandle);
      if (perm !== 'granted') {
        const granted = await requestHandlePermission(last.dirHandle);
        if (granted !== 'granted') {
          setError(t('statsPage.errPermDenied'));
          setEntries([]);
          return;
        }
      }
      const scanned = await scanDirHandle(last.dirHandle);
      setEntries(scanned);
    } catch (e) {
      setError(t('statsPage.errScan', { msg: (e as Error).message }));
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void rescan();
  }, []);

  const dpvCoverage = stats.totalEnvelopes > 0
    ? Math.round((stats.envelopesWithDpv / stats.totalEnvelopes) * 100)
    : 0;

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="border-b bg-white sticky top-0 z-10 px-6 py-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <BarChart3 className="w-5 h-5 text-violet-600" />
            <div>
              <h1 className="font-semibold text-lg">{t('statsPage.title')}</h1>
              <p className="text-xs text-zinc-500">
                {folderName ? t('statsPage.folderPrefix', { name: folderName }) : ''}
                {t('statsPage.subtitle')}
              </p>
            </div>
          </div>
          <button onClick={rescan} disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border rounded text-sm hover:bg-zinc-50 disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            {t('statsPage.rescan')}
          </button>
        </div>
      </div>

      <div className="p-6 max-w-6xl mx-auto space-y-5">
        {error && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="font-medium text-amber-900">{error}</div>
              <Link to="/explorer" className="inline-flex items-center gap-1 mt-1 text-sm text-amber-700 hover:text-amber-900 underline">
                <FolderOpen className="w-3.5 h-3.5" /> {t('statsPage.goExplorer')}
              </Link>
            </div>
          </div>
        )}

        {/* 요약 카드 4개 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <SummaryCard label={t('statsPage.cardTotal')} value={stats.totalEnvelopes} color="zinc" />
          <SummaryCard label={t('statsPage.cardDpv')} value={stats.envelopesWithDpv}
            sub={t('statsPage.cardCoverage', { n: dpvCoverage })} color="violet" />
          <SummaryCard label={t('statsPage.cardPii')} value={stats.envelopesWithPii} color="red" />
          <SummaryCard label={t('statsPage.cardGradeCS')} value={stats.gradeDistribution.C + stats.gradeDistribution.S}
            sub={t('statsPage.cardGradeBreakdown', { c: stats.gradeDistribution.C, s: stats.gradeDistribution.S, o: stats.gradeDistribution.O })}
            color="amber" />
        </div>

        <ChartSection title={t('statsPage.chartCategoryTitle')}
                      subtitle={t('statsPage.chartCategorySub')}
                      items={stats.dataCategories}
                      total={stats.totalEnvelopes} type="category"
                      lang={i18n.language} />

        <ChartSection title={t('statsPage.chartActivityTitle')}
                      subtitle={t('statsPage.chartActivitySub')}
                      items={stats.processingActivities}
                      total={stats.totalEnvelopes} type="activity"
                      lang={i18n.language} />

        <ChartSection title={t('statsPage.chartMeasureTitle')}
                      subtitle={t('statsPage.chartMeasureSub')}
                      items={stats.appliedMeasures}
                      total={stats.totalEnvelopes} type="measure"
                      lang={i18n.language} />

        <Timeline data={stats.timeline} />

        <div className="bg-white border border-zinc-200 rounded-lg p-4">
          <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
            <h3 className="font-semibold text-sm flex items-center gap-1.5">
              <FileText className="w-4 h-4 text-blue-600" />
              {t('statsPage.pipaTitle')}
            </h3>
            <span className="text-[11px] text-zinc-500">
              {t('statsPage.pipaHint')}
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-[11px] text-zinc-600 mb-1">{t('statsPage.company')}</label>
              <input
                value={companyName}
                onChange={e => { setCompanyName(e.target.value); saveInput('company', e.target.value); }}
                placeholder={t('statsPage.companyPh')}
                className="w-full px-2 py-1.5 border rounded text-sm"
              />
            </div>
            <div>
              <label className="block text-[11px] text-zinc-600 mb-1">{t('statsPage.retention')}</label>
              <input
                type="number" min="1" max="30"
                value={retentionYears}
                onChange={e => { const v = Number(e.target.value); setRetentionYears(v); saveInput('retention', v); }}
                className="w-full px-2 py-1.5 border rounded text-sm"
              />
            </div>
            <div>
              <label className="block text-[11px] text-zinc-600 mb-1">{t('statsPage.dpoName')}</label>
              <input
                value={dpoName}
                onChange={e => { setDpoName(e.target.value); saveInput('dpoName', e.target.value); }}
                placeholder={t('statsPage.dpoNamePh')}
                className="w-full px-2 py-1.5 border rounded text-sm"
              />
            </div>
            <div>
              <label className="block text-[11px] text-zinc-600 mb-1">{t('statsPage.dpoEmail')}</label>
              <input
                type="email"
                value={dpoEmail}
                onChange={e => { setDpoEmail(e.target.value); saveInput('dpoEmail', e.target.value); }}
                placeholder="dpo@example.com"
                className="w-full px-2 py-1.5 border rounded text-sm"
              />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-[11px] text-zinc-500 flex-1">
              {t('statsPage.autofill', { cats: stats.dataCategories.length, meas: stats.appliedMeasures.length })}<br />
              {t('statsPage.legalWarn')}
            </div>
            <button
              onClick={handlePrintPolicyDoc}
              disabled={!companyName.trim()}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-300 disabled:cursor-not-allowed text-white rounded text-sm font-medium">
              <Printer className="w-4 h-4" />
              {t('statsPage.printBtn')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, sub, color }: {
  label: string; value: number; sub?: string;
  color: 'zinc' | 'violet' | 'red' | 'amber';
}) {
  const colors = {
    zinc:   'border-zinc-200 bg-white',
    violet: 'border-violet-200 bg-violet-50',
    red:    'border-red-200 bg-red-50',
    amber:  'border-amber-200 bg-amber-50',
  };
  return (
    <div className={`border rounded-lg p-4 ${colors[color]}`}>
      <div className="text-xs text-zinc-500 uppercase">{label}</div>
      <div className="text-2xl font-bold mt-1">{value.toLocaleString()}</div>
      {sub && <div className="text-[11px] text-zinc-500 mt-1">{sub}</div>}
    </div>
  );
}

function ChartSection({ title, subtitle, items, total, type, lang }: {
  title: string;
  subtitle: string;
  items: Array<{ iri: string; count: number }>;
  total: number;
  type: 'category' | 'activity' | 'measure';
  lang: string;
}) {
  const { t } = useTranslation();
  const barColor = type === 'category' ? 'bg-violet-400'
                 : type === 'activity' ? 'bg-blue-400'
                 :                       'bg-emerald-400';
  const dpvLabelLang = lang.startsWith('ko') ? 'ko' : 'en';
  return (
    <div className="bg-white border border-zinc-200 rounded-lg p-4">
      <div className="flex items-baseline justify-between mb-1 flex-wrap gap-2">
        <h3 className="font-semibold text-sm">{title}</h3>
        <span className="text-[11px] text-zinc-500">{t('statsPage.chartCount', { n: items.length, m: total.toLocaleString() })}</span>
      </div>
      <p className="text-xs text-zinc-500 mb-3">{subtitle}</p>
      {items.length === 0 ? (
        <div className="text-xs text-zinc-400 italic py-4 text-center">{t('statsPage.noData')}</div>
      ) : (
        <div className="space-y-1.5">
          {items.map(({ iri, count }) => {
            const totalPctRaw = total > 0 ? (count / total) * 100 : 0;
            const totalPct = Math.round(totalPctRaw);
            const risk = type === 'category' ? dpvRisk(iri) : 'low';
            return (
              <div key={iri} className="flex items-center gap-2 text-xs">
                <div className={`w-44 flex-shrink-0 px-2 py-0.5 rounded border truncate ${
                  type === 'category' ? dpvChipClass(risk) : 'bg-zinc-50 border-zinc-200 text-zinc-700'
                }`} title={iri}>
                  {dpvIcon(iri)} {dpvLabel(iri, dpvLabelLang)}
                </div>
                <div className="flex-1 bg-zinc-100 rounded-full h-5 overflow-hidden">
                  <div className={`h-full ${barColor} transition-all`}
                       style={{ width: `${totalPctRaw}%`, minWidth: count > 0 ? '4px' : '0' }} />
                </div>
                <div className="w-20 flex-shrink-0 text-right font-mono text-zinc-800 tabular-nums">
                  <span className="font-semibold">{count.toLocaleString()}</span>
                  <span className="text-zinc-500 ml-1">({totalPct}%)</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Timeline({ data }: { data: Array<{ date: string; count: number }> }) {
  const { t } = useTranslation();
  const max = Math.max(1, ...data.map(d => d.count));
  return (
    <div className="bg-white border border-zinc-200 rounded-lg p-4">
      <h3 className="font-semibold text-sm mb-1">{t('statsPage.timelineTitle')}</h3>
      <p className="text-xs text-zinc-500 mb-3">{t('statsPage.timelineSub')}</p>
      <div className="flex items-end gap-0.5 h-24">
        {data.map(d => {
          const h = max > 0 ? (d.count / max) * 100 : 0;
          return (
            <div key={d.date} className="flex-1 flex flex-col items-center justify-end relative group">
              <div className="w-full bg-violet-400 hover:bg-violet-500 rounded-sm transition-all"
                   style={{ height: `${h}%`, minHeight: d.count > 0 ? '2px' : '0' }} />
              <div className="absolute bottom-full mb-1 hidden group-hover:block bg-zinc-900 text-white text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap">
                {d.date} · {t('statsPage.timelineUnit', { n: d.count })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] text-zinc-400 mt-1">
        <span>{data[0]?.date}</span>
        <span>{data[data.length - 1]?.date}</span>
      </div>
    </div>
  );
}
