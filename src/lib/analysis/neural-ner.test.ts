import { describe, it, expect } from 'vitest';
import { splitWindows } from './neural-ner';

/**
 * 대용량 NER 윈도잉 골든 테스트 — 회귀 가드.
 * 이전 버그: 앞 4000자만 보고 나머지를 버림(silent truncation).
 * 수정: 문서 전체를 오프셋 추적 윈도우로 커버.
 */
describe('splitWindows (대용량 NER 윈도잉)', () => {
  it('짧은 텍스트는 단일 윈도우(offset 0)로 기존과 동일', () => {
    const text = 'a'.repeat(1500);
    const { windows, total } = splitWindows(text, 2000, 200, 64);
    expect(total).toBe(1);
    expect(windows).toHaveLength(1);
    expect(windows[0].offset).toBe(0);
    expect(windows[0].text).toBe(text);
  });

  it('긴 텍스트는 여러 윈도우로 나뉘고 마지막 윈도우가 문서 끝까지 도달', () => {
    const len = 10_000;
    const text = 'x'.repeat(len);
    const { windows, total } = splitWindows(text, 2000, 200, 64);
    expect(total).toBeGreaterThan(1);
    expect(windows.length).toBe(total); // 캡 미도달
    // 마지막 윈도우가 끝까지 커버
    const last = windows[windows.length - 1];
    expect(last.offset + last.text.length).toBe(len);
  });

  it('절단 없음 — 모든 문자 위치가 최소 한 윈도우에 포함 (캡 미도달 시)', () => {
    const len = 9_137; // 경계 어긋남 유도
    const text = 'y'.repeat(len);
    const { windows } = splitWindows(text, 2000, 200, 64);
    // 각 위치 커버 여부
    for (let pos = 0; pos < len; pos += 137) {
      const covered = windows.some(w => pos >= w.offset && pos < w.offset + w.text.length);
      expect(covered, `위치 ${pos} 미커버`).toBe(true);
    }
    // 마지막 문자도 커버
    const lastPos = len - 1;
    expect(windows.some(w => lastPos >= w.offset && lastPos < w.offset + w.text.length)).toBe(true);
  });

  it('연속 윈도우 오프셋 간격 = step(size-overlap), 경계 엔티티 보존용 overlap 존재', () => {
    const { windows } = splitWindows('z'.repeat(10_000), 2000, 200, 64);
    const step = 2000 - 200;
    for (let i = 1; i < windows.length; i++) {
      expect(windows[i].offset - windows[i - 1].offset).toBe(step);
    }
    // 인접 윈도우는 overlap 만큼 겹침
    if (windows.length >= 2) {
      const overlapChars = (windows[0].offset + windows[0].text.length) - windows[1].offset;
      expect(overlapChars).toBe(200);
    }
  });

  it('비용 캡: 초과 시 windows는 maxWindows개로 제한되고 total은 실제 전체 수(무음 truncation 금지)', () => {
    const step = 2000 - 200;
    const maxWindows = 4;
    // maxWindows 를 확실히 초과하는 길이
    const len = step * 20 + 2000;
    const { windows, total } = splitWindows('w'.repeat(len), 2000, 200, maxWindows);
    expect(windows).toHaveLength(maxWindows);
    expect(total).toBeGreaterThan(maxWindows); // 호출 측이 로깅으로 truncation 노출
  });
});
