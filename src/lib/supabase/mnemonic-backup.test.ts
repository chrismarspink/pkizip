import { describe, it, expect } from 'vitest';
import {
  encryptMnemonicPayload,
  decryptMnemonicPayload,
  type EncryptedMnemonicPayload,
} from './mnemonic-backup';

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PW = 'backup-pass-word';

describe('mnemonic-backup 암호 페이로드 (C1)', () => {
  it('신규 백업은 기본 KDF 600k 사용', async () => {
    const p = await encryptMnemonicPayload(MNEMONIC, PW);
    expect(p.kdf_iterations).toBe(600_000);
  });

  it('암호화 → 복호화 왕복으로 니모닉 복원', async () => {
    const p = await encryptMnemonicPayload(MNEMONIC, PW);
    expect(await decryptMnemonicPayload(p, PW)).toBe(MNEMONIC);
  });

  it('하위호환: 구 100k 백업도 저장된 kdf_iterations로 복호화됨', async () => {
    // 구 버전이 만든 백업을 시뮬레이션 (100k로 암호화)
    const legacy = await encryptMnemonicPayload(MNEMONIC, PW, 100_000);
    expect(legacy.kdf_iterations).toBe(100_000);
    // 복호화는 페이로드에 저장된 반복횟수를 사용 → 성공해야 함
    expect(await decryptMnemonicPayload(legacy, PW)).toBe(MNEMONIC);
  });

  it('신규 600k 백업도 정상 복호화 (100k와 혼재 가능)', async () => {
    const modern = await encryptMnemonicPayload(MNEMONIC, PW, 600_000);
    expect(await decryptMnemonicPayload(modern, PW)).toBe(MNEMONIC);
  });

  it('틀린 비밀번호는 복호화 실패', async () => {
    const p = await encryptMnemonicPayload(MNEMONIC, PW);
    await expect(decryptMnemonicPayload(p, 'wrong-pass')).rejects.toThrow('백업 패스워드');
  });

  it('회귀 가드: kdf_iterations를 무시하면(구 버그) 복호화 실패함을 증명', async () => {
    // 100k로 만든 페이로드의 iterations를 600k로 위조 → 옛 버그(고정 iterations)를 재현
    const legacy = await encryptMnemonicPayload(MNEMONIC, PW, 100_000);
    const mismatched: EncryptedMnemonicPayload = { ...legacy, kdf_iterations: 600_000 };
    // 저장값과 실제 암호화 반복횟수가 어긋나면 키가 달라져 복호화 실패 → 하위호환 로직의 필요성 입증
    await expect(decryptMnemonicPayload(mismatched, PW)).rejects.toThrow();
  });
});
