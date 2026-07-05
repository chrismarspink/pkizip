import { describe, it, expect } from 'vitest';
import { recoverFromMnemonic } from './mnemonic';
import { deriveKeyIdentity } from './hd-key';

const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

describe('hd-key 파생 결정론', () => {
  it('같은 seed → 같은 fingerprint (결정론)', async () => {
    const { seed } = recoverFromMnemonic(TEST_MNEMONIC);
    const a = await deriveKeyIdentity(seed);
    const b = await deriveKeyIdentity(seed);

    expect(a.signingKey.fingerprint).toBe(b.signingKey.fingerprint);
    expect(a.encryptionKey.fingerprint).toBe(b.encryptionKey.fingerprint);
    expect(a.masterFingerprint).toBe(b.masterFingerprint);
  });

  it('fingerprint 형식: 8 hex chars', async () => {
    const { seed } = recoverFromMnemonic(TEST_MNEMONIC);
    const id = await deriveKeyIdentity(seed);
    expect(id.signingKey.fingerprint).toMatch(/^[0-9a-f]{8}$/);
    expect(id.encryptionKey.fingerprint).toMatch(/^[0-9a-f]{8}$/);
  });

  it('signing/encryption 키는 서로 다른 경로 → 다른 fingerprint', async () => {
    const { seed } = recoverFromMnemonic(TEST_MNEMONIC);
    const id = await deriveKeyIdentity(seed);
    expect(id.signingKey.fingerprint).not.toBe(id.encryptionKey.fingerprint);
    expect(id.signingKey.path).toBe("m/44'/60'/0'/0/0");
    expect(id.encryptionKey.path).toBe("m/44'/60'/0'/1/0");
  });

  it('index가 다르면 다른 키', async () => {
    const { seed } = recoverFromMnemonic(TEST_MNEMONIC);
    const i0 = await deriveKeyIdentity(seed, 0, 0);
    const i1 = await deriveKeyIdentity(seed, 1, 0);
    expect(i0.signingKey.fingerprint).not.toBe(i1.signingKey.fingerprint);
    expect(i0.encryptionKey.fingerprint).toBe(i1.encryptionKey.fingerprint); // encryptionIndex 동일
  });

  it('공개키 raw는 65바이트 비압축 포맷 (0x04 프리픽스)', async () => {
    const { seed } = recoverFromMnemonic(TEST_MNEMONIC);
    const id = await deriveKeyIdentity(seed);
    expect(id.signingKey.publicKeyRaw.length).toBe(65);
    expect(id.signingKey.publicKeyRaw[0]).toBe(0x04);
  });
});
