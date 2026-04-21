/**
 * 니모닉 암호화 백업/복구
 * 클라이언트 사이드 암호화 → Supabase REST API 직접 호출
 * 사용자당 최대 5개 백업
 */

const SUPABASE_URL = 'https://ikyhpuerwljxypyzkpiw.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlreWhwdWVyd2xqeHlweXprcGl3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1OTM1NjQsImV4cCI6MjA5MjE2OTU2NH0.31GrKSlBzcGRXCU7yHioEVIChO3EMi6di75O6mLFlBU';

const MAX_BACKUPS = 5;

function getAccessToken(): string | null {
  try {
    const raw = localStorage.getItem('sb-ikyhpuerwljxypyzkpiw-auth-token');
    if (!raw) return null;
    return JSON.parse(raw)?.access_token ?? null;
  } catch { return null; }
}

function hdrs(prefer?: string): Record<string, string> {
  const token = getAccessToken();
  const h: Record<string, string> = {
    'apikey': SUPABASE_ANON_KEY,
    'Content-Type': 'application/json',
  };
  if (prefer) h['Prefer'] = prefer;
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

const toB64 = (b: Uint8Array) => {
  const chunks: string[] = [];
  for (let i = 0; i < b.length; i += 8192) {
    chunks.push(String.fromCharCode(...b.subarray(i, i + 8192)));
  }
  return btoa(chunks.join(''));
};
const frB64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

async function deriveKey(password: string, salt: Uint8Array, usage: KeyUsage[]): Promise<CryptoKey> {
  const km = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations: 100_000, hash: 'SHA-256' },
    km, { name: 'AES-GCM', length: 256 }, false, usage,
  );
}

export interface BackupEntry {
  identity_id: string;
  hint: string | null;
  updated_at: string;
}

/** 백업 목록 조회 */
export async function listBackups(userId: string): Promise<BackupEntry[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/mnemonic_backups?user_id=eq.${userId}&select=identity_id,hint,updated_at&order=updated_at.desc`,
    { headers: hdrs() },
  );
  if (!res.ok) return [];
  return await res.json();
}

/** 클라이언트 사이드 암호화 → 서버 저장 (최대 5개) */
export async function backupMnemonic(
  mnemonic: string,
  backupPassword: string,
  identityId: string,
  hint?: string,
  userId?: string,
): Promise<void> {
  if (!userId) throw new Error('로그인 필요');

  // 기존 백업 개수 확인
  const existing = await listBackups(userId);
  const alreadyExists = existing.some(e => e.identity_id === identityId);
  if (!alreadyExists && existing.length >= MAX_BACKUPS) {
    throw new Error(`최대 ${MAX_BACKUPS}개까지 백업 가능합니다. 기존 백업을 삭제한 후 다시 시도하세요.`);
  }

  const salt = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(backupPassword, salt, ['encrypt']);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, new TextEncoder().encode(mnemonic),
  );

  const body = {
    user_id: userId,
    identity_id: identityId,
    encrypted_blob: toB64(new Uint8Array(ct)),
    kdf_salt: toB64(salt),
    kdf_iterations: 100_000,
    iv: toB64(iv),
    hint: hint ?? null,
    updated_at: new Date().toISOString(),
  };

  const res = await fetch(`${SUPABASE_URL}/rest/v1/mnemonic_backups?on_conflict=user_id,identity_id`, {
    method: 'POST',
    headers: hdrs('resolution=merge-duplicates,return=minimal'),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`백업 저장 실패: ${res.status} ${err}`);
  }
}

/** 서버에서 조회 → 복호화 → 니모닉 반환 */
export async function restoreMnemonic(
  backupPassword: string,
  identityId: string,
  userId: string,
): Promise<string> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/mnemonic_backups?user_id=eq.${userId}&identity_id=eq.${identityId}&select=*&limit=1`,
    { headers: hdrs() },
  );
  if (!res.ok) throw new Error('백업을 찾을 수 없습니다');
  const rows = await res.json();
  const data = rows?.[0];
  if (!data) throw new Error('백업을 찾을 수 없습니다');

  const key = await deriveKey(backupPassword, frB64(data.kdf_salt), ['decrypt']);
  try {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: frB64(data.iv) }, key, frB64(data.encrypted_blob),
    );
    return new TextDecoder().decode(pt);
  } catch {
    throw new Error('백업 패스워드가 올바르지 않습니다');
  }
}

/** 특정 백업 삭제 */
export async function deleteBackup(userId: string, identityId: string): Promise<void> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/mnemonic_backups?user_id=eq.${userId}&identity_id=eq.${identityId}`,
    { method: 'DELETE', headers: hdrs() },
  );
  if (!res.ok) throw new Error(`삭제 실패: ${res.status}`);
}
