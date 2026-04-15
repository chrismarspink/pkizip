/**
 * BIP39 Mnemonic Generation & Recovery
 *
 * 12-word mnemonic → 512-bit seed → master key
 * 사용자의 신원(Identity)은 이 니모닉에 기반한다.
 */
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

export interface MnemonicResult {
  mnemonic: string;      // 12 words separated by space
  seed: Uint8Array;      // 512-bit (64 bytes) seed
}

/**
 * 새로운 12단어 니모닉 생성
 * BIP39 표준: 128-bit entropy → 12 words
 */
export function generateNewMnemonic(): MnemonicResult {
  const mnemonic = generateMnemonic(wordlist, 128);
  const seed = mnemonicToSeedSync(mnemonic);
  return { mnemonic, seed };
}

/**
 * 기존 니모닉으로부터 시드 복구
 * @param mnemonic - 공백으로 구분된 12단어
 * @param passphrase - 선택적 BIP39 패스프레이즈 (추가 보안 계층)
 */
export function recoverFromMnemonic(mnemonic: string, passphrase?: string): MnemonicResult {
  const normalized = mnemonic.trim().toLowerCase().replace(/\s+/g, ' ');

  if (!validateMnemonic(normalized, wordlist)) {
    throw new Error('유효하지 않은 니모닉입니다. 12개의 올바른 단어를 입력하세요.');
  }

  const seed = mnemonicToSeedSync(normalized, passphrase);
  return { mnemonic: normalized, seed };
}

/**
 * 니모닉 유효성 검증
 */
export function isValidMnemonic(mnemonic: string): boolean {
  const normalized = mnemonic.trim().toLowerCase().replace(/\s+/g, ' ');
  return validateMnemonic(normalized, wordlist);
}
