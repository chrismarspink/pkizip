import { describe, it, expect } from 'vitest';
import { recoverFromMnemonic } from './mnemonic';
import { deriveKeyIdentity } from './hd-key';
import { createSignedPackage, addSignature, verifyAllSignatures } from './signing';

const M1 = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const M2 = 'legal winner thank year wave sausage worth useful legal winner thank yellow';

const data = new TextEncoder().encode('서명 대상 문서 — pkizip round-trip test 🔐');

describe('signing 라운드트립', () => {
  it('서명 → 검증 성공', async () => {
    const { seed } = recoverFromMnemonic(M1);
    const id = await deriveKeyIdentity(seed);
    const pkg = await createSignedPackage(
      data, id.signingKey.privateKey, id.signingKey.publicKey, id.signingKey.fingerprint, 'alice',
    );
    const results = await verifyAllSignatures(data, pkg);
    expect(results).toHaveLength(1);
    expect(results[0].valid).toBe(true);
    expect(results[0].fingerprint).toBe(id.signingKey.fingerprint);
    expect(results[0].label).toBe('alice');
  });

  it('데이터 변조 시 검증 실패 (해시 불일치)', async () => {
    const { seed } = recoverFromMnemonic(M1);
    const id = await deriveKeyIdentity(seed);
    const pkg = await createSignedPackage(
      data, id.signingKey.privateKey, id.signingKey.publicKey, id.signingKey.fingerprint,
    );
    const tampered = new TextEncoder().encode('변조된 문서');
    const results = await verifyAllSignatures(tampered, pkg);
    expect(results[0].valid).toBe(false);
    expect(results[0].error).toContain('변조');
  });

  it('다중 서명: 두 서명자 모두 유효', async () => {
    const a = await deriveKeyIdentity(recoverFromMnemonic(M1).seed);
    const b = await deriveKeyIdentity(recoverFromMnemonic(M2).seed);

    let pkg = await createSignedPackage(
      data, a.signingKey.privateKey, a.signingKey.publicKey, a.signingKey.fingerprint, 'alice',
    );
    pkg = await addSignature(
      pkg, data, b.signingKey.privateKey, b.signingKey.publicKey, b.signingKey.fingerprint, 'bob',
    );

    const results = await verifyAllSignatures(data, pkg);
    expect(results).toHaveLength(2);
    expect(results.every(r => r.valid)).toBe(true);
  });

  it('같은 키로 중복 서명 시 throw', async () => {
    const a = await deriveKeyIdentity(recoverFromMnemonic(M1).seed);
    const pkg = await createSignedPackage(
      data, a.signingKey.privateKey, a.signingKey.publicKey, a.signingKey.fingerprint,
    );
    await expect(
      addSignature(pkg, data, a.signingKey.privateKey, a.signingKey.publicKey, a.signingKey.fingerprint),
    ).rejects.toThrow();
  });
});
