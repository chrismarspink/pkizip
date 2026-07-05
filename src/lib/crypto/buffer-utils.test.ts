import { describe, it, expect } from 'vitest';
import { toBuffer, buf } from './buffer-utils';

describe('buffer-utils', () => {
  it('toBuffer: Uint8Array → 동일 내용 ArrayBuffer', () => {
    const src = new Uint8Array([10, 20, 30, 40]);
    const ab = toBuffer(src);
    expect(ab).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(ab))).toEqual([10, 20, 30, 40]);
  });

  it('toBuffer: byteOffset 있는 뷰도 해당 구간만 복사', () => {
    const backing = new Uint8Array([0, 1, 2, 3, 4, 5]);
    const view = backing.subarray(2, 5); // [2,3,4]
    const ab = toBuffer(view);
    expect(Array.from(new Uint8Array(ab))).toEqual([2, 3, 4]);
    expect(ab.byteLength).toBe(3);
  });

  it('buf: Web Crypto가 받아들이는 BufferSource로 통과 (digest 왕복)', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const digest = await crypto.subtle.digest('SHA-256', buf(bytes));
    expect(digest.byteLength).toBe(32);
  });
});
