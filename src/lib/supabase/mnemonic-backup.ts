/**
 * 니모닉 암호화 백업/복구 — 클라이언트 사이드 암호화만
 *
 * 서버에 평문 니모닉 절대 저장 안 함.
 * Web Crypto PBKDF2 (600,000회, 비동기) + AES-256-GCM
 */
import { supabase } from './client';

const toB64 = (b: Uint8Array) => {
  const chunks: string[] = [];
  for (let i = 0; i < b.length; i += 8192) {
    chunks.push(String.fromCharCode(...b.subarray(i, i + 8192)));
  }
  return btoa(chunks.join(''));
};
const frB64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

/** Web Crypto PBKDF2 → AES-256-GCM 키 (비동기, UI 블로킹 없음) */
async function deriveKey(password: string, salt: Uint8Array, usage: KeyUsage[]): Promise<CryptoKey> {
  const km = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    km,
    { name: 'AES-GCM', length: 256 },
    false,
    usage,
  );
}

/** 클라이언트 사이드 암호화 → Supabase 저장 */
export async function backupMnemonic(
  mnemonic: string,
  backupPassword: string,
  identityId: string,
  hint?: string
): Promise<void> {
  console.log('[PKIZIP-backup] 시작: deriveKey...');
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(backupPassword, salt, ['encrypt']);
  console.log('[PKIZIP-backup] deriveKey 완료, encrypt...');
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(mnemonic),
  );
  console.log('[PKIZIP-backup] encrypt 완료, getUser...');

  const { data: { user } } = await supabase.auth.getUser();
  console.log('[PKIZIP-backup] getUser:', user?.id ?? 'null');
  if (!user) throw new Error('로그인 필요');

  const { error } = await supabase.from('mnemonic_backups').upsert(
    {
      user_id: user.id,
      identity_id: identityId,
      encrypted_blob: toB64(new Uint8Array(ct)),
      kdf_salt: toB64(salt),
      kdf_iterations: 100_000,
      iv: toB64(iv),
      hint: hint ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,identity_id' },
  );
  if (error) throw new Error(`백업 저장 실패: ${error.message}`);
}

/** Supabase에서 조회 → 복호화 → 니모닉 반환 */
export async function restoreMnemonic(
  backupPassword: string,
  identityId: string
): Promise<string> {
  const { data, error } = await supabase
    .from('mnemonic_backups')
    .select('*')
    .eq('identity_id', identityId)
    .single();
  if (error || !data) throw new Error('백업을 찾을 수 없습니다');

  const key = await deriveKey(backupPassword, frB64(data.kdf_salt), ['decrypt']);

  try {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: frB64(data.iv) },
      key,
      frB64(data.encrypted_blob),
    );
    return new TextDecoder().decode(pt);
  } catch {
    throw new Error('백업 패스워드가 올바르지 않습니다');
  }
}

/** 백업 목록 조회 */
export async function listBackups() {
  const { data } = await supabase
    .from('mnemonic_backups')
    .select('identity_id, hint, updated_at')
    .order('updated_at', { ascending: false });
  return data ?? [];
}
