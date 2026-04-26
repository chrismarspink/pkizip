/**
 * 서명 동의 게이트 — 매 서명 시 사용자 동의를 요구
 *
 * 키가 메모리에 이미 풀려 있어도, 사용자 의도 확인을 위해
 * 생체 인증(WebAuthn) 또는 PIN/비밀번호 입력을 강제한다.
 *
 * 우선순위: 생체(등록 시) → PIN(등록 시) → 비밀번호
 */
import { hasBiometric, unlockWithBiometric } from './biometric';
import { hasPin, unlockWithPin } from './pin';
import { loadIdentitySeed, getActiveIdentityId } from './key-manager';

export type ConsentMethod = 'biometric' | 'pin' | 'password';

export interface ConsentResult {
  ok: boolean;
  method?: ConsentMethod;
  error?: string;
}

export interface ConsentOptions {
  /** PIN 또는 비밀번호 (없으면 호출자가 prompt 띄워야 함) */
  secret?: string;
  /** 사용자가 명시적으로 메서드 강제 */
  force?: ConsentMethod;
}

/**
 * 동의 가능한 방법 조회
 */
export async function getAvailableConsentMethods(): Promise<ConsentMethod[]> {
  const id = await getActiveIdentityId();
  if (!id) return [];
  const methods: ConsentMethod[] = [];
  if (await hasBiometric(id)) methods.push('biometric');
  if (await hasPin(id)) methods.push('pin');
  methods.push('password'); // 항상 가능
  return methods;
}

/**
 * 서명 동의 요청.
 * 생체가 등록되어 있고 force가 없으면 무조건 생체 시도.
 * PIN/password는 secret이 필수.
 */
export async function requireSigningConsent(opts: ConsentOptions = {}): Promise<ConsentResult> {
  const id = await getActiveIdentityId();
  if (!id) return { ok: false, error: '활성 아이덴티티가 없습니다' };

  const tryBio = !opts.force || opts.force === 'biometric';
  const tryPin = !opts.force || opts.force === 'pin';
  const tryPw = !opts.force || opts.force === 'password';

  // 1) 생체
  if (tryBio && await hasBiometric(id)) {
    try {
      await unlockWithBiometric(id); // 시드는 버림 — assertion 자체가 동의
      return { ok: true, method: 'biometric' };
    } catch (err) {
      if (opts.force === 'biometric') return { ok: false, method: 'biometric', error: String(err) };
      // fallthrough: PIN/password 시도
    }
  }

  // 2) PIN
  if (tryPin && opts.secret && /^\d{4,6}$/.test(opts.secret) && await hasPin(id)) {
    try {
      await unlockWithPin(id, opts.secret);
      return { ok: true, method: 'pin' };
    } catch (err) {
      return { ok: false, method: 'pin', error: err instanceof Error ? err.message : 'PIN 불일치' };
    }
  }

  // 3) 비밀번호
  if (tryPw && opts.secret) {
    try {
      await loadIdentitySeed(id, opts.secret);
      return { ok: true, method: 'password' };
    } catch (err) {
      return { ok: false, method: 'password', error: err instanceof Error ? err.message : '비밀번호 불일치' };
    }
  }

  return { ok: false, error: '인증 입력이 필요합니다' };
}
