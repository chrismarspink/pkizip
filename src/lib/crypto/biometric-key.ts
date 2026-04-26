/**
 * biometric-key.ts — Settings UI용 생체 인증 wrapper
 *
 * 기존 biometric.ts의 PRF/Fallback 로직을 활용해 활성 아이덴티티 기반 API 제공.
 */
import {
  isWebAuthnSupported,
  isPlatformAuthenticatorAvailable,
  registerBiometric as _register,
  unlockWithBiometric as _unlock,
  hasBiometric,
  removeBiometric as _remove,
  getBiometricMode,
} from './biometric';
import { getActiveIdentityId, getIdentityMeta } from './key-manager';

export interface BiometricSupportInfo {
  supported: boolean;
  prfSupported: boolean;
  reason?: string;
}

/** 지원 여부 확인 (PRF는 실제 등록 시도 전엔 정확히 판별 불가, supported만 신뢰) */
export async function checkBiometricSupport(): Promise<BiometricSupportInfo> {
  if (!isWebAuthnSupported()) {
    return { supported: false, prfSupported: false, reason: 'WebAuthn 미지원' };
  }
  const platformAvailable = await isPlatformAuthenticatorAvailable();
  if (!platformAvailable) {
    return { supported: false, prfSupported: false, reason: '플랫폼 인증자 없음' };
  }
  return { supported: true, prfSupported: true };
}

/** 활성 아이덴티티의 생체 인증 등록 여부 */
export async function isBiometricRegistered(): Promise<boolean> {
  const id = await getActiveIdentityId();
  if (!id) return false;
  return hasBiometric(id);
}

export async function getActiveBiometricMode(): Promise<'prf' | 'fallback' | null> {
  const id = await getActiveIdentityId();
  if (!id) return null;
  return getBiometricMode(id);
}

/**
 * 생체 인증 등록 — 활성 아이덴티티가 메모리(seed)에 풀려 있어야 한다.
 * Settings에서 호출 시 `useAppStore`의 `keyIdentity.seed`를 사용해야 하므로
 * 호출자는 미리 잠금 해제된 상태여야 한다.
 *
 * @param seed BIP39 시드 (32바이트)
 */
export async function registerBiometric(seed?: Uint8Array): Promise<'prf' | 'fallback'> {
  const id = await getActiveIdentityId();
  if (!id) throw new Error('활성 아이덴티티가 없습니다');
  const meta = await getIdentityMeta(id);
  if (!meta) throw new Error('아이덴티티 정보를 찾을 수 없습니다');

  if (!seed) {
    // 호출자가 seed를 제공하지 않은 경우, app-store에서 시도
    const { useAppStore } = await import('@/lib/store/app-store');
    const ki = useAppStore.getState().keyIdentity;
    if (!ki) throw new Error('키가 잠금 해제되어 있지 않습니다. 먼저 니모닉으로 잠금 해제하세요.');
    // keyIdentity는 KeyPair를 가지지만 raw seed는 없음 — 이 경우 등록 불가
    throw new Error(
      '활성 키에서 시드를 추출할 수 없습니다. 새 아이덴티티 생성/복구 시점에 생체 인증을 등록하세요.',
    );
  }

  return _register(id, meta.name, seed);
}

/** 생체 인증 해제 */
export async function removeBiometric(): Promise<void> {
  const id = await getActiveIdentityId();
  if (!id) return;
  await _remove(id);
}

/** 생체 인증으로 잠금 해제 → 시드 반환 */
export async function unlockWithBiometric(): Promise<Uint8Array> {
  const id = await getActiveIdentityId();
  if (!id) throw new Error('활성 아이덴티티가 없습니다');
  return _unlock(id);
}
