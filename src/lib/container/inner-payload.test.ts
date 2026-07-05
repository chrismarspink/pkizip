import { describe, it, expect } from 'vitest';
import { packInnerPayload, unpackInnerPayload } from './inner-payload';

const data = new Uint8Array([0, 1, 2, 250, 251, 255, 42, 7]);

const sigs = [
  { fingerprint: 'a1b2c3d4', signature: 'c2ln', publicKey: 'cHVi', timestamp: 1_700_000_000_000, label: 'alice' },
  { fingerprint: 'deadbeef', signature: 'c2ln2', publicKey: 'cHVi2', timestamp: 1_700_000_001_000 },
];

describe('inner-payload pack/unpack 라운드트립', () => {
  it('서명 없이: data 그대로 복원, signatures undefined', () => {
    const packed = packInnerPayload(data);
    const out = unpackInnerPayload(packed);
    expect(Array.from(out.data)).toEqual(Array.from(data));
    expect(out.signatures).toBeUndefined();
    expect(packed[0]).toBe(0); // flags: HAS_SIGNATURES 미설정
  });

  it('서명 포함: data + signatures 모두 복원', () => {
    const packed = packInnerPayload(data, sigs);
    const out = unpackInnerPayload(packed);
    expect(Array.from(out.data)).toEqual(Array.from(data));
    expect(out.signatures).toEqual(sigs);
    expect(packed[0] & 0x01).toBe(1); // flags: HAS_SIGNATURES 설정
  });

  it('빈 서명 배열은 서명 없음으로 취급', () => {
    const packed = packInnerPayload(data, []);
    const out = unpackInnerPayload(packed);
    expect(out.signatures).toBeUndefined();
    expect(Array.from(out.data)).toEqual(Array.from(data));
  });

  it('빈 data도 안전하게 왕복', () => {
    const empty = new Uint8Array(0);
    const out = unpackInnerPayload(packInnerPayload(empty, sigs));
    expect(out.data.length).toBe(0);
    expect(out.signatures).toEqual(sigs);
  });
});
