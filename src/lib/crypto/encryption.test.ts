import { describe, it, expect } from 'vitest';
import { recoverFromMnemonic } from './mnemonic';
import { deriveKeyIdentity } from './hd-key';
import {
  encryptForRecipients,
  decryptAsRecipient,
  encryptWithPassword,
  decryptWithPassword,
} from './encryption';

const M1 = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const M2 = 'legal winner thank year wave sausage worth useful legal winner thank yellow';

const plaintext = new TextEncoder().encode('기밀 문서 내용 — AES-256-GCM 라운드트립 🔐');
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

describe('password 암호화 라운드트립', () => {
  it('encryptWithPassword → decryptWithPassword 원문 복원', async () => {
    const { ciphertext, iv, salt } = await encryptWithPassword(plaintext, 'hunter2');
    const out = await decryptWithPassword(ciphertext, 'hunter2', iv, salt);
    expect(dec(out)).toBe(dec(plaintext));
  });

  it('틀린 비밀번호는 복호화 실패', async () => {
    const { ciphertext, iv, salt } = await encryptWithPassword(plaintext, 'hunter2');
    await expect(decryptWithPassword(ciphertext, 'wrong', iv, salt)).rejects.toBeDefined();
  });

  it('매 암호화마다 salt/iv 랜덤', async () => {
    const a = await encryptWithPassword(plaintext, 'pw');
    const b = await encryptWithPassword(plaintext, 'pw');
    expect(Array.from(a.salt)).not.toEqual(Array.from(b.salt));
    expect(Array.from(a.iv)).not.toEqual(Array.from(b.iv));
  });
});

describe('ECDH 다중 수신자 라운드트립', () => {
  it('수신자 본인이 복호화하면 원문 복원', async () => {
    const bob = await deriveKeyIdentity(recoverFromMnemonic(M2).seed);
    const pkg = await encryptForRecipients(plaintext, [
      { fingerprint: bob.encryptionKey.fingerprint, encryptionPublicKey: bob.encryptionKey.publicKey, label: 'bob' },
    ]);
    const res = await decryptAsRecipient(pkg, bob.encryptionKey.privateKey, bob.encryptionKey.fingerprint);
    expect(dec(res.plaintext)).toBe(dec(plaintext));
    expect(res.recipientFingerprint).toBe(bob.encryptionKey.fingerprint);
  });

  it('여러 수신자: 각자 자신의 키로 복호화 가능', async () => {
    const alice = await deriveKeyIdentity(recoverFromMnemonic(M1).seed);
    const bob = await deriveKeyIdentity(recoverFromMnemonic(M2).seed);
    const pkg = await encryptForRecipients(plaintext, [
      { fingerprint: alice.encryptionKey.fingerprint, encryptionPublicKey: alice.encryptionKey.publicKey },
      { fingerprint: bob.encryptionKey.fingerprint, encryptionPublicKey: bob.encryptionKey.publicKey },
    ]);
    expect(pkg.recipients).toHaveLength(2);

    const ra = await decryptAsRecipient(pkg, alice.encryptionKey.privateKey, alice.encryptionKey.fingerprint);
    const rb = await decryptAsRecipient(pkg, bob.encryptionKey.privateKey, bob.encryptionKey.fingerprint);
    expect(dec(ra.plaintext)).toBe(dec(plaintext));
    expect(dec(rb.plaintext)).toBe(dec(plaintext));
  });

  it('수신자가 아닌 키는 복호화 실패', async () => {
    const alice = await deriveKeyIdentity(recoverFromMnemonic(M1).seed);
    const bob = await deriveKeyIdentity(recoverFromMnemonic(M2).seed);
    // alice에게만 암호화
    const pkg = await encryptForRecipients(plaintext, [
      { fingerprint: alice.encryptionKey.fingerprint, encryptionPublicKey: alice.encryptionKey.publicKey },
    ]);
    // bob의 키로 시도 → 실패해야 함
    await expect(
      decryptAsRecipient(pkg, bob.encryptionKey.privateKey, bob.encryptionKey.fingerprint),
    ).rejects.toThrow();
  });

  it('수신자 0명이면 throw', async () => {
    await expect(encryptForRecipients(plaintext, [])).rejects.toThrow();
  });
});
