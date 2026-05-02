/**
 * 사용자 최종 분류 결정 저장소 — 학습 루프의 입력 데이터.
 *
 * HE-TEST 의 user_decisions.jsonl 동등 기능을 IndexedDB 로 구현.
 * 사용자가 AI 분류 결과에 동의하지 않고 다른 등급을 선택할 때마다 기록 →
 * Batch 4 trainer 가 이 데이터로 keyword/entity 가중치를 보정.
 *
 * 스키마:
 *   key: ulid (timestamp prefix → 시간순 정렬)
 *   value: Decision
 *
 * 인덱스:
 *   by-textHash: 같은 문서 재분석 시 이전 결정 조회
 *   by-time:     최근 결정 N개 가져오기
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ClassificationReason, Finding, Grade } from '../analysis/types';

export interface Decision {
  /** ULID — 시간순 정렬 가능한 unique ID */
  id: string;
  /** 결정 시각 (Unix ms) */
  ts: number;
  /** 본문 SHA-256 (앞 16바이트 hex) — 같은 문서 재방문 식별용 */
  textHash: string;
  /** 본문 길이 (정규화 신호) */
  textLength: number;
  /** AI 가 제시한 등급 + 점수 */
  ai: {
    grade: Grade;
    score: number;
    confidence: number;
    version: string;
    reasons: ClassificationReason[];
  };
  /** 사용자가 최종 채택한 등급 */
  user: {
    grade: Grade;
    /** AI 와의 거리 (0 = 동의, 1/2 = 한/두 단계 차이) */
    gap: number;
    memo?: string;
  };
  /** 학습 신호 — 양수면 AI 등급이 너무 낮음, 음수면 너무 높음 */
  signedDelta: -2 | -1 | 0 | 1 | 2;
  /** 결정 시점 findings 스냅샷 (가중치 학습용) */
  findings: Pick<Finding, 'entityType' | 'text' | 'score' | 'recognizer'>[];
  /** 결정 시점 언어 */
  language?: string;
}

interface DecisionDBSchema extends DBSchema {
  decisions: {
    key: string;
    value: Decision;
    indexes: { 'by-textHash': string; 'by-time': number };
  };
}

const DB_NAME = 'pkizip-learning';
const DB_VERSION = 1;
let dbPromise: Promise<IDBPDatabase<DecisionDBSchema>> | null = null;

function db(): Promise<IDBPDatabase<DecisionDBSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<DecisionDBSchema>(DB_NAME, DB_VERSION, {
      upgrade(database) {
        const store = database.createObjectStore('decisions', { keyPath: 'id' });
        store.createIndex('by-textHash', 'textHash');
        store.createIndex('by-time', 'ts');
      },
    });
  }
  return dbPromise;
}

// ─────────────────────────────────────────────
// 유틸 — ULID 형식 ID, SHA-256 hash
// ─────────────────────────────────────────────

const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function ulid(): string {
  const ts = Date.now();
  let tsPart = '';
  let n = ts;
  for (let i = 0; i < 10; i++) {
    tsPart = ULID_ALPHABET[n % 32] + tsPart;
    n = Math.floor(n / 32);
  }
  let randPart = '';
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  for (const b of buf) randPart += ULID_ALPHABET[b % 32];
  return tsPart + randPart;
}

export async function textHash(text: string): Promise<string> {
  const enc = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', enc);
  const bytes = new Uint8Array(digest).slice(0, 16);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

const RANK: Record<Grade, number> = { O: 0, S: 1, C: 2 };

function signedDelta(ai: Grade, user: Grade): Decision['signedDelta'] {
  return (RANK[user] - RANK[ai]) as Decision['signedDelta'];
}

// ─────────────────────────────────────────────
// CRUD
// ─────────────────────────────────────────────

export interface SaveDecisionInput {
  textHash: string;
  textLength: number;
  ai: Decision['ai'];
  userGrade: Grade;
  memo?: string;
  findings: Finding[];
  language?: string;
}

export async function saveDecision(input: SaveDecisionInput): Promise<Decision> {
  const decision: Decision = {
    id: ulid(),
    ts: Date.now(),
    textHash: input.textHash,
    textLength: input.textLength,
    ai: input.ai,
    user: {
      grade: input.userGrade,
      gap: Math.abs(RANK[input.ai.grade] - RANK[input.userGrade]),
      memo: input.memo?.trim() || undefined,
    },
    signedDelta: signedDelta(input.ai.grade, input.userGrade),
    findings: input.findings.map(f => ({
      entityType: f.entityType,
      text: f.text,
      score: f.score,
      recognizer: f.recognizer,
    })),
    language: input.language,
  };
  const database = await db();
  await database.put('decisions', decision);
  return decision;
}

export async function listDecisions(limit = 100): Promise<Decision[]> {
  const database = await db();
  const all = await database.getAllFromIndex('decisions', 'by-time');
  return all.reverse().slice(0, limit);
}

export async function findByTextHash(hash: string): Promise<Decision[]> {
  const database = await db();
  return database.getAllFromIndex('decisions', 'by-textHash', hash);
}

export async function deleteDecision(id: string): Promise<void> {
  const database = await db();
  await database.delete('decisions', id);
}

export async function clearAll(): Promise<void> {
  const database = await db();
  await database.clear('decisions');
}

export async function decisionStats(): Promise<{
  total: number;
  agreements: number;
  disagreements: number;
  /** signedDelta 별 카운트 — 학습 신호 분포 */
  byDelta: Record<string, number>;
}> {
  const all = await listDecisions(10_000);
  const byDelta: Record<string, number> = {};
  let agreements = 0;
  for (const d of all) {
    byDelta[String(d.signedDelta)] = (byDelta[String(d.signedDelta)] || 0) + 1;
    if (d.signedDelta === 0) agreements++;
  }
  return {
    total: all.length,
    agreements,
    disagreements: all.length - agreements,
    byDelta,
  };
}
