import { describe, it, expect } from 'vitest';
import { generateNewMnemonic, recoverFromMnemonic, isValidMnemonic } from './mnemonic';

// BIP39 테스트 벡터 (표준 니모닉 → 고정 seed). 파생 결정론을 잠근다.
const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
// mnemonicToSeedSync(위 니모닉, passphrase 없음)의 앞부분 (BIP39 표준 벡터)
const EXPECTED_SEED_PREFIX = '5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc1';

const hex = (b: Uint8Array) => Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');

describe('mnemonic', () => {
  it('generateNewMnemonic: 12단어 + 64바이트 seed 생성', () => {
    const { mnemonic, seed } = generateNewMnemonic();
    expect(mnemonic.split(' ')).toHaveLength(12);
    expect(seed).toBeInstanceOf(Uint8Array);
    expect(seed.length).toBe(64);
    expect(isValidMnemonic(mnemonic)).toBe(true);
  });

  it('generateNewMnemonic: 매 호출 서로 다른 니모닉', () => {
    expect(generateNewMnemonic().mnemonic).not.toBe(generateNewMnemonic().mnemonic);
  });

  it('recoverFromMnemonic: BIP39 표준 벡터와 일치 (결정론)', () => {
    const { seed } = recoverFromMnemonic(TEST_MNEMONIC);
    expect(hex(seed).startsWith(EXPECTED_SEED_PREFIX)).toBe(true);
  });

  it('recoverFromMnemonic: 대소문자/공백 정규화 후 동일 seed', () => {
    const a = recoverFromMnemonic(TEST_MNEMONIC);
    const b = recoverFromMnemonic(`  ${TEST_MNEMONIC.toUpperCase()}  `.replace(/ +/g, '   '));
    expect(hex(a.seed)).toBe(hex(b.seed));
  });

  it('recoverFromMnemonic: passphrase 다르면 seed 달라짐', () => {
    const a = recoverFromMnemonic(TEST_MNEMONIC);
    const b = recoverFromMnemonic(TEST_MNEMONIC, 'extra');
    expect(hex(a.seed)).not.toBe(hex(b.seed));
  });

  it('recoverFromMnemonic: 잘못된 니모닉은 throw', () => {
    expect(() => recoverFromMnemonic('not a valid mnemonic phrase at all here now')).toThrow();
  });
});
