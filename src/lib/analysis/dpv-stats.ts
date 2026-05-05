/**
 * DPV 메타 통계 집계 — 봉투 헤더들로부터 카테고리/활동/조치 분포 산출.
 *
 * StatsPage 가 사용. 처리방침 PDF 생성 (Phase 4) 의 데이터 source.
 */
import type { PkiHeader } from '../container/pki-format';
import type { Grade } from './types';

export interface DpvStats {
  totalEnvelopes: number;
  envelopesWithDpv: number;
  envelopesWithPii: number;
  /** IRI → 봉투 수 */
  dataCategories: Array<{ iri: string; count: number }>;
  processingActivities: Array<{ iri: string; count: number }>;
  appliedMeasures: Array<{ iri: string; count: number }>;
  /** 등급별 봉투 수 */
  gradeDistribution: Record<Grade | 'unknown', number>;
  /** 일자별 봉투 수 (YYYY-MM-DD) — 최근 30일 */
  timeline: Array<{ date: string; count: number }>;
}

interface EntryLike {
  header: PkiHeader | null;
  addedAt?: number;
}

const EMPTY_STATS: DpvStats = {
  totalEnvelopes: 0,
  envelopesWithDpv: 0,
  envelopesWithPii: 0,
  dataCategories: [],
  processingActivities: [],
  appliedMeasures: [],
  gradeDistribution: { C: 0, S: 0, O: 0, unknown: 0 },
  timeline: [],
};

export function aggregateDpvStats(entries: EntryLike[]): DpvStats {
  const pkiEntries = entries.filter(e => e.header !== null);
  if (pkiEntries.length === 0) return { ...EMPTY_STATS };

  const cat = new Map<string, number>();
  const act = new Map<string, number>();
  const msr = new Map<string, number>();
  const grade: Record<Grade | 'unknown', number> = { C: 0, S: 0, O: 0, unknown: 0 };
  const timelineMap = new Map<string, number>();

  let withDpv = 0;
  let withPii = 0;

  for (const e of pkiEntries) {
    const h = e.header!;
    const dpv = h.dpv;
    if (dpv) {
      withDpv += 1;
      for (const c of dpv.data_categories || [])      cat.set(c, (cat.get(c) || 0) + 1);
      for (const a of dpv.processing_activities || []) act.set(a, (act.get(a) || 0) + 1);
      for (const m of dpv.applied_measures || [])      msr.set(m, (msr.get(m) || 0) + 1);
    }
    if (h.classification?.findingsSummary && Object.keys(h.classification.findingsSummary).length > 0) {
      withPii += 1;
    }
    const g = h.classification?.grade ?? 'unknown';
    grade[g] = (grade[g] || 0) + 1;

    // 타임라인 — addedAt 또는 createdAt
    const ts = e.addedAt || h.createdAt || 0;
    if (ts > 0) {
      const d = new Date(ts).toISOString().slice(0, 10);
      timelineMap.set(d, (timelineMap.get(d) || 0) + 1);
    }
  }

  // 최근 30일만 + 빈 일자 채움
  const today = new Date();
  const timeline: Array<{ date: string; count: number }> = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    timeline.push({ date: key, count: timelineMap.get(key) || 0 });
  }

  const sortByCount = <T extends { count: number }>(a: T, b: T) => b.count - a.count;

  return {
    totalEnvelopes: pkiEntries.length,
    envelopesWithDpv: withDpv,
    envelopesWithPii: withPii,
    dataCategories: [...cat.entries()].map(([iri, count]) => ({ iri, count })).sort(sortByCount),
    processingActivities: [...act.entries()].map(([iri, count]) => ({ iri, count })).sort(sortByCount),
    appliedMeasures: [...msr.entries()].map(([iri, count]) => ({ iri, count })).sort(sortByCount),
    gradeDistribution: grade,
    timeline,
  };
}
