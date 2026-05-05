/**
 * DPV 통계 페이지 — `/stats`.
 *
 * 마지막 지정한 폴더의 모든 .pki 봉투 헤더를 스캔 → DPV 메타 집계 → 시각화.
 * 폴더 권한 없으면 ExplorerPage 로 안내.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
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
      alert('회사명을 입력하세요.');
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
        setError('마지막 사용한 폴더가 없습니다. "내 파일" 페이지에서 폴더를 먼저 지정하세요.');
        setEntries([]);
        return;
      }
      setFolderName(last.rootName || '저장된 폴더');
      const perm = await checkHandlePermission(last.dirHandle);
      if (perm !== 'granted') {
        const granted = await requestHandlePermission(last.dirHandle);
        if (granted !== 'granted') {
          setError('폴더 접근 권한이 거부되었습니다.');
          setEntries([]);
          return;
        }
      }
      const scanned = await scanDirHandle(last.dirHandle);
      setEntries(scanned);
    } catch (e) {
      setError(`스캔 실패: ${(e as Error).message}`);
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
              <h1 className="font-semibold text-lg">DPV 통계</h1>
              <p className="text-xs text-zinc-500">
                {folderName ? `폴더: ${folderName} · ` : ''}
                봉투 메타 집계로 PII 처리 현황을 한눈에 확인 (PIPA 처리방침 데이터 source)
              </p>
            </div>
          </div>
          <button onClick={rescan} disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border rounded text-sm hover:bg-zinc-50 disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            다시 스캔
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
                <FolderOpen className="w-3.5 h-3.5" /> 내 파일 페이지로 이동
              </Link>
            </div>
          </div>
        )}

        {/* 요약 카드 4개 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <SummaryCard label="전체 봉투" value={stats.totalEnvelopes} color="zinc" />
          <SummaryCard label="DPV 메타 부착" value={stats.envelopesWithDpv}
            sub={`${dpvCoverage}% 커버리지`} color="violet" />
          <SummaryCard label="PII 포함 봉투" value={stats.envelopesWithPii} color="red" />
          <SummaryCard label="C/S 등급" value={stats.gradeDistribution.C + stats.gradeDistribution.S}
            sub={`C ${stats.gradeDistribution.C} · S ${stats.gradeDistribution.S} · O ${stats.gradeDistribution.O}`}
            color="amber" />
        </div>

        {/* 데이터 카테고리 분포 */}
        <ChartSection title="데이터 카테고리 분포 — dpv:PersonalData"
                      subtitle="봉투 안에 들어있는 개인정보 종류"
                      items={stats.dataCategories}
                      total={stats.totalEnvelopes} type="category" />

        {/* 처리 활동 분포 */}
        <ChartSection title="처리 활동 분포 — dpv:Processing"
                      subtitle="봉투에 적용된 처리 행위 (저장/전송/암호화/가명화 등)"
                      items={stats.processingActivities}
                      total={stats.totalEnvelopes} type="activity" />

        {/* 적용 조치 분포 */}
        <ChartSection title="적용 조치 분포 — dpv:TechnicalMeasure"
                      subtitle="봉투에 적용된 기술적 보호 조치 (암호화/서명/타임스탬프 등)"
                      items={stats.appliedMeasures}
                      total={stats.totalEnvelopes} type="measure" />

        {/* 시계열 */}
        <Timeline data={stats.timeline} />

        {/* PIPA 제30조 처리방침 PDF 자동 생성 */}
        <div className="bg-white border border-zinc-200 rounded-lg p-4">
          <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
            <h3 className="font-semibold text-sm flex items-center gap-1.5">
              <FileText className="w-4 h-4 text-blue-600" />
              PIPA 제30조 처리방침 자동 생성
            </h3>
            <span className="text-[11px] text-zinc-500">
              위 통계로 일부 항목 자동 채움 — 회사 정보 입력 후 인쇄 (PDF 저장)
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-[11px] text-zinc-600 mb-1">회사명 *</label>
              <input
                value={companyName}
                onChange={e => { setCompanyName(e.target.value); saveInput('company', e.target.value); }}
                placeholder="(주) 회사명"
                className="w-full px-2 py-1.5 border rounded text-sm"
              />
            </div>
            <div>
              <label className="block text-[11px] text-zinc-600 mb-1">보유 기간 (년)</label>
              <input
                type="number" min="1" max="30"
                value={retentionYears}
                onChange={e => { const v = Number(e.target.value); setRetentionYears(v); saveInput('retention', v); }}
                className="w-full px-2 py-1.5 border rounded text-sm"
              />
            </div>
            <div>
              <label className="block text-[11px] text-zinc-600 mb-1">개인정보 보호책임자 (DPO) 성명</label>
              <input
                value={dpoName}
                onChange={e => { setDpoName(e.target.value); saveInput('dpoName', e.target.value); }}
                placeholder="홍길동"
                className="w-full px-2 py-1.5 border rounded text-sm"
              />
            </div>
            <div>
              <label className="block text-[11px] text-zinc-600 mb-1">DPO 이메일</label>
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
              자동 채움: <strong>처리 항목</strong> ({stats.dataCategories.length}종) ·
              <strong> 안전성 확보 조치</strong> ({stats.appliedMeasures.length}개) ·
              <strong> 적용일</strong> (오늘)<br />
              ⚠ 자동 생성 초안 — 시행 전 법무 검토 필수.
            </div>
            <button
              onClick={handlePrintPolicyDoc}
              disabled={!companyName.trim()}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-300 disabled:cursor-not-allowed text-white rounded text-sm font-medium">
              <Printer className="w-4 h-4" />
              처리방침 PDF 인쇄
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

function ChartSection({ title, subtitle, items, total, type }: {
  title: string;
  subtitle: string;
  items: Array<{ iri: string; count: number }>;
  total: number;
  type: 'category' | 'activity' | 'measure';
}) {
  const max = items.length > 0 ? items[0]!.count : 1;
  const barColor = type === 'category' ? 'bg-violet-400'
                 : type === 'activity' ? 'bg-blue-400'
                 :                       'bg-emerald-400';
  return (
    <div className="bg-white border border-zinc-200 rounded-lg p-4">
      <div className="flex items-baseline justify-between mb-1 flex-wrap gap-2">
        <h3 className="font-semibold text-sm">{title}</h3>
        <span className="text-[11px] text-zinc-500">{items.length}종</span>
      </div>
      <p className="text-xs text-zinc-500 mb-3">{subtitle}</p>
      {items.length === 0 ? (
        <div className="text-xs text-zinc-400 italic py-4 text-center">데이터 없음</div>
      ) : (
        <div className="space-y-1.5">
          {items.map(({ iri, count }) => {
            const pct = max > 0 ? (count / max) * 100 : 0;
            const totalPct = total > 0 ? Math.round((count / total) * 100) : 0;
            const risk = type === 'category' ? dpvRisk(iri) : 'low';
            return (
              <div key={iri} className="flex items-center gap-2 text-xs">
                <div className={`w-44 flex-shrink-0 px-2 py-0.5 rounded border truncate ${
                  type === 'category' ? dpvChipClass(risk) : 'bg-zinc-50 border-zinc-200 text-zinc-700'
                }`} title={iri}>
                  {dpvIcon(iri)} {dpvLabel(iri, 'ko')}
                </div>
                <div className="flex-1 bg-zinc-100 rounded-full h-5 relative overflow-hidden">
                  <div className={`h-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
                  <div className="absolute inset-0 flex items-center px-2 text-[11px] font-mono text-zinc-700">
                    {count.toLocaleString()} <span className="text-zinc-400 ml-1">({totalPct}%)</span>
                  </div>
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
  const max = Math.max(1, ...data.map(d => d.count));
  return (
    <div className="bg-white border border-zinc-200 rounded-lg p-4">
      <h3 className="font-semibold text-sm mb-1">최근 30일 봉투 생성 추이</h3>
      <p className="text-xs text-zinc-500 mb-3">일자별 봉투 생성 수</p>
      <div className="flex items-end gap-0.5 h-24">
        {data.map(d => {
          const h = max > 0 ? (d.count / max) * 100 : 0;
          return (
            <div key={d.date} className="flex-1 flex flex-col items-center justify-end relative group">
              <div className="w-full bg-violet-400 hover:bg-violet-500 rounded-sm transition-all"
                   style={{ height: `${h}%`, minHeight: d.count > 0 ? '2px' : '0' }} />
              <div className="absolute bottom-full mb-1 hidden group-hover:block bg-zinc-900 text-white text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap">
                {d.date} · {d.count}건
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
