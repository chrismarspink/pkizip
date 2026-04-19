/**
 * 니모닉 암호화 백업/복구 — 클라이언트 사이드 암호화만
 *
 * 서버에 평문 니모닉 절대 저장 안 함.
 * PBKDF2-SHA256 (600,000회) + AES-256-GCM
 */
import { supabase } from './client';
import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';

const toB64 = (b: Uint8Array) => {
  const chunks: string[] = [];
  for (let i = 0; i < b.length; i += 8192) {
    chunks.push(String.fromCharCode(...b.subarray(i, i + 8192)));
  }
  return btoa(chunks.join(''));
};
const frB64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

/** 클라이언트 사이드 암호화 → Supabase 저장 */
export async function backupMnemonic(
  mnemonic: string,
  backupPassword: string,
  identityId: string,
  hint?: string
): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const rawKey = pbkdf2(sha256, new TextEncoder().encode(backupPassword), salt, { c: 600_000, dkLen: 32 });
  const key = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt']);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(mnemonic),
  );

  const { error } = await supabase.from('mnemonic_backups').upsert(
    {
      identity_id: identityId,
      encrypted_blob: toB64(new Uint8Array(ct)),
      kdf_salt: toB64(salt),
      kdf_iterations: 600_000,
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

  const rawKey = pbkdf2(
    sha256,
    new TextEncoder().encode(backupPassword),
    frB64(data.kdf_salt),
    { c: data.kdf_iterations, dkLen: 32 },
  );
  const key = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt']);

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
