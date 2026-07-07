import { describe, it, expect } from 'vitest';
import { computeDepositProof, verifyDepositProof } from './deposit-proof';

// 실제 ECDH P-256 공개키 JWK 예시
const jwk: JsonWebKey = {
  kty: 'EC', crv: 'P-256',
  x: 'gI0GAILBdu7T53akrFmMyGcsF3n5dO7MmwNBHKW5SqQ',
  y: 'SLW_xSffzlPWrHEVI30DHM_4egVwt3NQqeUD7nMFUps',
};
const otc = 'K7QP9F3M2XTB0';
const tokenHash = 'a'.repeat(64);
const fp = 'deadbeef';

describe('deposit-proof (OTC 바인딩 증명)', () => {
  it('올바른 (otc, tokenHash, fp, jwk) 로 만든 proof 는 검증 통과', async () => {
    const proof = await computeDepositProof(otc, tokenHash, fp, jwk);
    expect(proof).toMatch(/^[0-9a-f]{64}$/);
    expect(await verifyDepositProof(otc, tokenHash, fp, jwk, proof)).toBe(true);
  });

  it('OTC 가 다르면 실패 (링크만 가진 공격자는 유효 proof 불가)', async () => {
    const proof = await computeDepositProof(otc, tokenHash, fp, jwk);
    expect(await verifyDepositProof('WRONGSECRET00', tokenHash, fp, jwk, proof)).toBe(false);
  });

  it('fingerprint 가 다르면 실패', async () => {
    const proof = await computeDepositProof(otc, tokenHash, fp, jwk);
    expect(await verifyDepositProof(otc, tokenHash, 'cafebabe', jwk, proof)).toBe(false);
  });

  it('공개키(jwk)가 바뀌면 실패 (키 스왑 방지)', async () => {
    const proof = await computeDepositProof(otc, tokenHash, fp, jwk);
    const other = { ...jwk, x: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' };
    expect(await verifyDepositProof(otc, tokenHash, fp, other, proof)).toBe(false);
  });

  it('proof 가 변조되면 실패', async () => {
    const proof = await computeDepositProof(otc, tokenHash, fp, jwk);
    const tampered = (proof[0] === '0' ? '1' : '0') + proof.slice(1);
    expect(await verifyDepositProof(otc, tokenHash, fp, jwk, tampered)).toBe(false);
  });

  it('결정적 — 같은 입력은 항상 같은 proof', async () => {
    const a = await computeDepositProof(otc, tokenHash, fp, jwk);
    const b = await computeDepositProof(otc, tokenHash, fp, jwk);
    expect(a).toBe(b);
  });
});
