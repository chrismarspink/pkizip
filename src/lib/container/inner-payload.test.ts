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

const meta = {
  classification: { grade: 'C' as const, score: 42, confidence: 0.92, classifierVersion: 'rule-v1.2' },
};

describe('inner-payload meta(분류 등급) 세그먼트', () => {
  it('meta만: data + meta 복원, signatures undefined, HAS_META 세트', () => {
    const packed = packInnerPayload(data, undefined, meta);
    const out = unpackInnerPayload(packed);
    expect(Array.from(out.data)).toEqual(Array.from(data));
    expect(out.meta).toEqual(meta);
    expect(out.signatures).toBeUndefined();
    expect(packed[0] & 0x02).toBe(0x02); // HAS_META
    expect(packed[0] & 0x01).toBe(0);     // HAS_SIGNATURES 미설정
  });

  it('서명 + meta 동시: 셋 다 복원', () => {
    const packed = packInnerPayload(data, sigs, meta);
    const out = unpackInnerPayload(packed);
    expect(Array.from(out.data)).toEqual(Array.from(data));
    expect(out.signatures).toEqual(sigs);
    expect(out.meta).toEqual(meta);
    expect(packed[0] & 0x03).toBe(0x03); // HAS_SIGNATURES | HAS_META
  });

  it('빈 meta 객체는 meta 없음으로 취급 (HAS_META 미설정)', () => {
    const packed = packInnerPayload(data, sigs, {});
    const out = unpackInnerPayload(packed);
    expect(out.meta).toBeUndefined();
    expect(packed[0] & 0x02).toBe(0);
    expect(out.signatures).toEqual(sigs);
  });

  it('하위호환: meta 없이 패킹한 구 포맷은 meta undefined 로 파싱', () => {
    const packed = packInnerPayload(data, sigs); // 구 경로 (metaLen 필드 없음)
    const out = unpackInnerPayload(packed);
    expect(out.meta).toBeUndefined();
    expect(out.signatures).toEqual(sigs);
    expect(Array.from(out.data)).toEqual(Array.from(data));
  });
});
