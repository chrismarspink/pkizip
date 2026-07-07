/**
 * deposit-proof — 점진적 신뢰 승급의 OTC 바인딩 증명.
 *
 * 수신자가 공개키를 deposit 할 때, 링크만 가진 공격자가 가짜 키를 심는 것을 막기 위해
 * OTC 보유를 증명으로 묶는다:
 *   proofKey = PBKDF2(otcSecret, "pkizip-deposit-proof-v1", 600k)
 *   proof    = HMAC-SHA256(proofKey, tokenHash ‖ fingerprint ‖ canonicalJWK)
 *
 * 서버는 OTC 를 모르므로 proof 를 만들 수도 검증할 수도 없다(보관만).
 * 발송자는 OTC 를 알므로(로컬 보관) deposit 된 (fingerprint, jwk) 로 proof 를 재계산해
 * 일치할 때만 주소록 승급한다. 링크만 가진 공격자는 유효 proof 를 못 만든다.
 */
import { buf } from './buffer-utils';

const PROOF_SALT = new TextEncoder().encode('pkizip-deposit-proof-v1');

/** ECDH P-256 공개키 JWK 의 canonical 직렬화 (필드 순서 고정) */
function canonicalJwk(jwk: JsonWebKey): string {
  return JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y });
}

function hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function computeDepositProof(
  otcSecret: string, tokenHash: string, fingerprint: string, jwk: JsonWebKey,
): Promise<string> {
  const baseKey = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(otcSecret), 'PBKDF2', false, ['deriveBits'],
  );
  const proofKeyBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: buf(PROOF_SALT), iterations: 600000, hash: 'SHA-256' }, baseKey, 256,
  );
  const hmacKey = await crypto.subtle.importKey(
    'raw', proofKeyBits, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const msg = new TextEncoder().encode(`${tokenHash}|${fingerprint}|${canonicalJwk(jwk)}`);
  const sig = await crypto.subtle.sign('HMAC', hmacKey, buf(msg));
  return hex(sig);
}

/** 상수 시간 hex 비교 (타이밍 누출 방지) */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyDepositProof(
  otcSecret: string, tokenHash: string, fingerprint: string, jwk: JsonWebKey, proof: string,
): Promise<boolean> {
  const expected = await computeDepositProof(otcSecret, tokenHash, fingerprint, jwk);
  return timingSafeEqual(expected, proof);
}
