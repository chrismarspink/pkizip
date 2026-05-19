/**
 * Per-stage 성능 측정 — HE-TEST `perf.py` 의 클라이언트 포팅.
 *
 * 파이프라인 각 단계의 latency 측정 + IndexedDB 누적 → 대시보드 표시 가능.
 * 브라우저 Performance API (performance.mark / measure) 활용 — overhead 미미.
 *
 * 사용:
 *   const t = perfStart('ai-classify');
 *   const result = await classify(...);
 *   t.end({ inputChars: text.length, findings: result.findings.length });
 *
 * 측정값:
 *   - duration_ms: end - start
 *   - 단계 이름 (event)
 *   - 추가 메타 (입력 크기, 결과 수 등)
 *
 * Settings:
 *   prefs.classifier.perfCollect === true 일 때만 IndexedDB 에 누적.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

export interface PerfEvent {
  /** ULID-like — ts + random */
  id: string;
  /** Unix ms */
  ts: number;
  /** 단계 식별자 — 'pii-detect' / 'ai-classify' / 'anonymize' 등 */
  stage: string;
  /** ms */
  durationMs: number;
  /** 입력/출력 메타 */
  meta?: Record<string, number | string | boolean>;
}

interface PerfDBSchema extends DBSchema {
  events: {
    key: string;
    value: PerfEvent;
    indexes: { 'by-time': number; 'by-stage': string };
  };
}

const DB_NAME = 'pkizip-perf';
const DB_VERSION = 1;
const MAX_RETAIN = 5000;
let dbPromise: Promise<IDBPDatabase<PerfDBSchema>> | null = null;

function db(): Promise<IDBPDatabase<PerfDBSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<PerfDBSchema>(DB_NAME, DB_VERSION, {
      upgrade(database) {
        const store = database.createObjectStore('events', { keyPath: 'id' });
        store.createIndex('by-time', 'ts');
        store.createIndex('by-stage', 'stage');
      },
    });
  }
  return dbPromise;
}

function randomId(): string {
  // ULID-like — 시간 prefix + random suffix (정렬 친화)
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${ts}-${rand}`;
}

// 메모리 토글 — 호출 측이 prefs 확인 안 해도 되도록 setEnabled() 로 외부 제어
let _collectionEnabled = true;
export function setEnabled(enabled: boolean): void { _collectionEnabled = enabled; }
export function isEnabled(): boolean { return _collectionEnabled; }

/**
 * 단계 측정 시작 → 시작 마크 + .end() 호출 가능한 객체 반환.
 *
 * @example
 *   const t = perfStart('ai-classify');
 *   const out = await classify(...);
 *   await t.end({ findings: out.findings.length });
 */
export function perfStart(stage: string): {
  end: (meta?: Record<string, number | string | boolean>) => Promise<PerfEvent | null>;
  cancel: () => void;
} {
  const startMs = performance.now();
  const startMarkName = `pkizip-perf-${stage}-${randomId()}-start`;
  let cancelled = false;
  try { performance.mark(startMarkName); } catch { /* ignore */ }

  return {
    cancel() { cancelled = true; },
    async end(meta) {
      if (cancelled || !_collectionEnabled) return null;
      const durationMs = Math.round((performance.now() - startMs) * 100) / 100;
      const event: PerfEvent = {
        id: randomId(),
        ts: Date.now(),
        stage,
        durationMs,
        meta,
      };
      try {
        const database = await db();
        await database.put('events', event);
        // 정기 cleanup — 5000건 초과 시 오래된 것 삭제
        const count = await database.count('events');
        if (count > MAX_RETAIN) {
          const oldest = await database.getAllFromIndex('events', 'by-time', undefined, count - MAX_RETAIN);
          for (const o of oldest) await database.delete('events', o.id);
        }
      } catch { /* IDB 실패는 silent */ }
      return event;
    },
  };
}

export interface StageStats {
  stage: string;
  n: number;
  /** 평균 ms */
  meanMs: number;
  /** p50 */
  p50Ms: number;
  /** p95 */
  p95Ms: number;
  /** 최대 */
  maxMs: number;
}

/**
 * 단계별 통계 — UI 대시보드.
 *
 * @param sinceMs - 이 시각 이후 이벤트만 (기본 24h)
 */
export async function stageStats(sinceMs?: number): Promise<StageStats[]> {
  const cutoff = sinceMs ?? Date.now() - 24 * 60 * 60 * 1000;
  const database = await db();
  const all = await database.getAllFromIndex('events', 'by-time');
  const recent = all.filter(e => e.ts >= cutoff);

  const byStage = new Map<string, number[]>();
  for (const e of recent) {
    const arr = byStage.get(e.stage) || [];
    arr.push(e.durationMs);
    byStage.set(e.stage, arr);
  }

  const out: StageStats[] = [];
  for (const [stage, ms] of byStage) {
    const sorted = [...ms].sort((a, b) => a - b);
    const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    out.push({
      stage,
      n: sorted.length,
      meanMs: Math.round(mean * 100) / 100,
      p50Ms: Math.round(p50 * 100) / 100,
      p95Ms: Math.round(p95 * 100) / 100,
      maxMs: sorted[sorted.length - 1],
    });
  }
  return out.sort((a, b) => b.meanMs - a.meanMs);
}

/**
 * 누적 데이터 정리 — UI 의 "초기화" 버튼.
 */
export async function clearAll(): Promise<void> {
  const database = await db();
  await database.clear('events');
}

/** 단위 테스트용 — IDB 거치지 않는 통계. */
export function _testStats(events: PerfEvent[]): StageStats[] {
  const byStage = new Map<string, number[]>();
  for (const e of events) {
    const arr = byStage.get(e.stage) || [];
    arr.push(e.durationMs);
    byStage.set(e.stage, arr);
  }
  const out: StageStats[] = [];
  for (const [stage, ms] of byStage) {
    const sorted = [...ms].sort((a, b) => a - b);
    const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    out.push({
      stage,
      n: sorted.length,
      meanMs: Math.round(mean * 100) / 100,
      p50Ms: sorted[Math.floor(sorted.length * 0.5)],
      p95Ms: sorted[Math.floor(sorted.length * 0.95)],
      maxMs: sorted[sorted.length - 1],
    });
  }
  return out.sort((a, b) => b.meanMs - a.meanMs);
}
