import { describe, it, expect } from 'vitest';
import {
  charWindows,
  tokenWindows,
  aggregateWindowGrades,
  classifyWindowed,
  MAX_CHUNKS,
  type GradeScores,
  type ClassifyProgress,
} from './windowing';

describe('charWindows 슬라이딩', () => {
  it('짧은 텍스트는 단일 윈도우', () => {
    const r = charWindows('hello', 10, 2, 64);
    expect(r.windows).toEqual(['hello']);
    expect(r.total).toBe(1);
    expect(r.capped).toBe(false);
  });

  it('긴 텍스트: stride/오버랩 정확', () => {
    const text = 'abcdefghijklmnopqrstuvwxyz0123'; // 30자
    const r = charWindows(text, 10, 2, 64);         // step=8
    expect(r.total).toBe(4);                         // start 0,8,16,24
    expect(r.windows[0]).toBe(text.slice(0, 10));
    expect(r.windows[1]).toBe(text.slice(8, 18));    // 오버랩 2
    expect(r.capped).toBe(false);
  });

  it('MAX_CHUNKS 캡: 무음 아님 (capped + total>windows)', () => {
    const text = 'abcdefghijklmnopqrstuvwxyz0123'; // 30자, step8 → 4개 필요
    const r = charWindows(text, 10, 2, 2);           // 캡 2
    expect(r.windows).toHaveLength(2);
    expect(r.total).toBe(4);
    expect(r.capped).toBe(true);
  });
});

describe('tokenWindows (tokenizer 주입)', () => {
  const encode = (t: string) => [...t].map(c => c.charCodeAt(0));
  const decode = (ids: number[]) => String.fromCharCode(...ids);

  it('토큰 id 배열로 윈도우 후 decode', () => {
    const text = 'abcdefghijkl'; // 12 토큰
    const r = tokenWindows(text, encode, decode, 5, 1, 64); // step=4 → start 0,4,8
    expect(r.total).toBe(3);
    expect(r.windows[0]).toBe('abcde');
    expect(r.windows[1]).toBe('efghi');
  });
});

describe('aggregateWindowGrades — DLP worst-case', () => {
  it('한 윈도우라도 CONFIDENTIAL floor 넘으면 문서는 CONFIDENTIAL', () => {
    const per: GradeScores[] = [
      { OPEN: 0.9, SENSITIVE: 0.1, CONFIDENTIAL: 0.05 },
      { OPEN: 0.2, SENSITIVE: 0.3, CONFIDENTIAL: 0.6 },
    ];
    const r = aggregateWindowGrades(per);
    expect(r.grade).toBe('CONFIDENTIAL');
    expect(r.confidence).toBeCloseTo(0.6);
  });

  it('floor(0.5) 정확히 도달도 승격', () => {
    const r = aggregateWindowGrades([{ OPEN: 0, SENSITIVE: 0.5, CONFIDENTIAL: 0 }]);
    expect(r.grade).toBe('SENSITIVE');
  });

  it('아무도 floor 못 넘으면 argmax 폴백', () => {
    const r = aggregateWindowGrades([{ OPEN: 0.4, SENSITIVE: 0.3, CONFIDENTIAL: 0.2 }]);
    expect(r.grade).toBe('OPEN');
  });

  it('동점은 더 심각한 등급으로 (rank-broken)', () => {
    const r = aggregateWindowGrades([{ OPEN: 0.4, SENSITIVE: 0.4, CONFIDENTIAL: 0.1 }]);
    expect(r.grade).toBe('SENSITIVE');
  });
});

describe('classifyWindowed — 진짜 진행률 + worst-window', () => {
  const infer = async (w: string): Promise<GradeScores> =>
    w.includes('SECRET')
      ? { OPEN: 0.1, SENSITIVE: 0.1, CONFIDENTIAL: 0.7 }
      : { OPEN: 0.9, SENSITIVE: 0.05, CONFIDENTIAL: 0.05 };

  it('단일 윈도우: 진행 이벤트 neural→aggregate', async () => {
    const events: ClassifyProgress[] = [];
    const r = await classifyWindowed('짧은 문서', infer, { onProgress: e => events.push(e) });
    expect(r.chunksScanned).toBe(1);
    expect(r.chunksTotal).toBe(1);
    expect(r.grade).toBe('OPEN');
    expect(events.map(e => e.stage)).toEqual(['neural', 'aggregate']);
    expect(events[0].pct).toBe(1); // 1/1
  });

  it('두 윈도우 중 하나에 SECRET → CONFIDENTIAL', async () => {
    const text = 'a'.repeat(2600) + 'SECRET' + 'a'.repeat(200); // ~2806자 → 2 윈도우
    const r = await classifyWindowed(text, infer);
    expect(r.chunksScanned).toBe(2);
    expect(r.grade).toBe('CONFIDENTIAL');
  });

  it('진행률은 실제 current/total (시간 추정 아님) — 단조 증가', async () => {
    const text = 'a'.repeat(2600) + 'x';
    const events: ClassifyProgress[] = [];
    await classifyWindowed(text, infer, { onProgress: e => events.push(e) });
    const neural = events.filter(e => e.stage === 'neural');
    expect(neural.length).toBe(2);
    expect(neural[0].pct).toBeCloseTo(0.5); // 1/2
    expect(neural[1].pct).toBe(1);          // 2/2
    expect(neural[0].total).toBe(2);
  });

  it('MAX_CHUNKS 초과: 캡 적용 + chunksTotal>scanned', async () => {
    const text = 'a'.repeat(130_000); // 2000/200 step1800 → 64개 초과
    const r = await classifyWindowed(text, infer);
    expect(r.chunksScanned).toBe(MAX_CHUNKS);
    expect(r.chunksTotal).toBeGreaterThan(MAX_CHUNKS);
    expect(r.capped).toBe(true);
  });
});
