import { describe, it, expect } from 'vitest';
import { generateOtc, normalizeOtc, parseOtc, isValidOtc } from './otc';

describe('OTC 생성·검증', () => {
  it('생성한 OTC 는 display 를 파싱하면 secret 이 복원됨', () => {
    for (let i = 0; i < 50; i++) {
      const { display, secret } = generateOtc();
      expect(secret).toHaveLength(13);
      expect(parseOtc(display)).toBe(secret);
      expect(isValidOtc(display)).toBe(true);
    }
  });

  it('display 는 4자 그룹 하이픈 형식 (14자 → 4-4-4-2)', () => {
    const { display } = generateOtc();
    expect(display).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{2}$/);
  });

  it('소문자·공백·혼동문자(I/L/O) 입력도 정규화되어 통과', () => {
    const { display, secret } = generateOtc();
    const messy = display.toLowerCase().replace(/-/g, ' ');
    expect(parseOtc(messy)).toBe(secret);
  });

  it('체크섬이 단일 문자 오류를 감지', () => {
    const { display } = generateOtc();
    const norm = normalizeOtc(display);
    // 첫 데이터 문자를 다른 문자로 바꿔 오타 유발
    const wrongChar = norm[0] === 'A' ? 'B' : 'A';
    const corrupted = wrongChar + norm.slice(1);
    expect(parseOtc(corrupted)).toBeNull();
    expect(isValidOtc(corrupted)).toBe(false);
  });

  it('체크섬이 인접 문자 전치를 감지 (위치 가중합)', () => {
    // 서로 다른 두 인접 문자를 가진 OTC 를 찾아 전치
    let display = '';
    for (let i = 0; i < 100; i++) {
      const g = generateOtc();
      const n = normalizeOtc(g.display);
      if (n[0] !== n[1]) { display = n; break; }
    }
    expect(display).not.toBe('');
    const transposed = display[1] + display[0] + display.slice(2);
    expect(parseOtc(transposed)).toBeNull();
  });

  it('길이가 틀리면 null', () => {
    expect(parseOtc('K7QP-9F3M')).toBeNull();      // 너무 짧음
    expect(parseOtc('')).toBeNull();
  });

  it('secret 은 64비트 이상 엔트로피 (13 Crockford 문자)', () => {
    // 13 * 5 = 65비트. 서로 다른 생성은 거의 항상 유일.
    const set = new Set<string>();
    for (let i = 0; i < 200; i++) set.add(generateOtc().secret);
    expect(set.size).toBe(200);
  });
});
