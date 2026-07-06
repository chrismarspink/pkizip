/**
 * envelopes — 안전 링크 발송/열람 클라이언트.
 *
 * 신뢰 모델(요약): 서버엔 암호문 blob + 비밀 없는 메타만. 복호화(OTC)는 여기(클라이언트)서만.
 *   - 발송: 파일 → OTC 로 비밀번호 암호화(.pki blob, 파일명도 암호화 계층 안) → Storage 업로드.
 *           링크(토큰)와 OTC 를 분리 채널로 전달.
 *   - 열람: 토큰으로 blob 다운로드 → OTC 입력 → 로컬 복호화.
 *
 * Edge Functions: create-share(JWT) / fetch-envelope(anon) / delete-share(JWT).
 */
import { SUPABASE_URL, SUPABASE_ANON_KEY, getAccessToken } from './rest';
import { supabase } from './client';
import { encryptWithPassword, decryptWithPassword } from '../crypto/encryption';
import {
  writePkiContainer, readPkiContainer, arrayBufferToBase64, base64ToArrayBuffer,
  FLAG_COMPRESSED, FLAG_ENCRYPTED, setFlag, type PkiHeader,
} from '../container/pki-format';
import { packInnerPayload, unpackInnerPayload } from '../container/inner-payload';
import { serializeEntries, deserializeEntries } from '../compression/compressor';
import { generateOtc } from '../crypto/otc';
import type { FileEntry } from '../compression/compressor';

const ENVELOPES_BUCKET = 'envelopes';

// ── Edge Function 호출 (tsa-client 와 동일 베이스) ────────────────────
async function fn<T>(name: string, body: unknown, auth = false): Promise<T> {
  const headers: Record<string, string> = {
    apikey: SUPABASE_ANON_KEY,
    'Content-Type': 'application/json',
  };
  if (auth) {
    const token = getAccessToken();
    if (!token) throw new Error('로그인이 필요합니다.');
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try { msg = (await res.json()).error ?? msg; } catch { /* noop */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

// ── 해시 / 토큰 ───────────────────────────────────────────────────────
function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
async function sha256hex(bytes: Uint8Array): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource));
}
function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function randomToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32))); // 256비트
}

// ── blob 조립/해제 (파일명은 암호화 계층 안, 평문 헤더엔 없음) ──────────
export async function buildEnvelopeBlob(files: FileEntry[], otcSecret: string): Promise<Uint8Array> {
  const compressed = serializeEntries(files);
  const inner = packInnerPayload(compressed);
  const { ciphertext, iv, salt } = await encryptWithPassword(inner, otcSecret);
  let flags = setFlag(0, FLAG_COMPRESSED);
  flags = setFlag(flags, FLAG_ENCRYPTED);
  const header: PkiHeader = {
    version: 1, flags, createdAt: Date.now(),
    files: [], // ← 파일명 평문 노출 방지 (실제 이름은 암호화된 payload 안 tar 헤더에)
    encryption: {
      algorithm: 'AES-256-GCM',
      iv: arrayBufferToBase64(iv),
      recipients: [{ fingerprint: 'password', wrappedKey: arrayBufferToBase64(salt), ephemeralPublicKey: '', label: 'safe-link' }],
    },
  };
  return writePkiContainer({ header, payload: new Uint8Array(ciphertext) });
}

export async function openEnvelopeBlob(blob: Uint8Array, otcSecret: string): Promise<FileEntry[]> {
  const { header, payload } = readPkiContainer(blob);
  const enc = header.encryption;
  if (!enc || enc.recipients[0]?.fingerprint !== 'password') {
    throw new Error('안전 링크 봉투 형식이 아닙니다.');
  }
  const iv = new Uint8Array(base64ToArrayBuffer(enc.iv));
  const salt = new Uint8Array(base64ToArrayBuffer(enc.recipients[0].wrappedKey));
  const payloadBuf = new ArrayBuffer(payload.byteLength);
  new Uint8Array(payloadBuf).set(payload);
  const decrypted = await decryptWithPassword(payloadBuf, otcSecret, iv, salt);
  const inner = unpackInnerPayload(decrypted);
  return deserializeEntries(inner.data);
}

// ── 발송 ──────────────────────────────────────────────────────────────
export interface SafeLinkResult {
  link: string;
  otcDisplay: string;
  envelopeId: string;
  expiresAt: string;
}

export async function createSafeLink(
  files: FileEntry[],
  opts: { maxDownloads?: number; expiresHours?: number } = {},
): Promise<SafeLinkResult> {
  const otc = generateOtc();
  const blob = await buildEnvelopeBlob(files, otc.secret);
  const token = randomToken();
  const tokenHash = await sha256hex(new TextEncoder().encode(token));
  const contentHash = await sha256hex(blob);
  const expiresHours = opts.expiresHours ?? 24;
  const expiresAt = new Date(Date.now() + expiresHours * 3600 * 1000).toISOString();
  const maxDownloads = opts.maxDownloads ?? 1;

  const { envelopeId, upload } = await fn<{ envelopeId: string; upload: { path: string; token: string } }>(
    'create-share',
    { tokenHash, sizeBytes: blob.byteLength, contentHash, expiresAt, maxDownloads },
    true,
  );

  const { error: upErr } = await supabase.storage
    .from(ENVELOPES_BUCKET)
    .uploadToSignedUrl(upload.path, upload.token, blob, { contentType: 'application/octet-stream' });
  if (upErr) {
    // 업로드 실패 → 봉투 폐기 시도(모범적 정리)
    try { await deleteShare(envelopeId); } catch { /* noop */ }
    throw new Error(`업로드 실패: ${upErr.message}`);
  }

  const link = new URL(`${import.meta.env.BASE_URL}open/${token}`, location.origin).href;
  return { link, otcDisplay: otc.display, envelopeId, expiresAt };
}

export async function deleteShare(envelopeId: string): Promise<void> {
  await fn('delete-share', { envelopeId }, true);
}

// ── 열람 ──────────────────────────────────────────────────────────────
export interface EnvelopeInfo {
  signedUrl: string;
  sizeBytes: number;
  hasRecipientSlot: boolean;
}

/** 토큰으로 게이트 통과 + 단명 서명 URL 획득 (다운로드 카운트 1 증가) */
export async function fetchEnvelope(token: string): Promise<EnvelopeInfo> {
  return fn<EnvelopeInfo>('fetch-envelope', { token }, false);
}

/** 서명 URL 에서 암호문 blob 다운로드 */
export async function downloadEnvelopeBlob(signedUrl: string): Promise<Uint8Array> {
  const res = await fetch(signedUrl);
  if (!res.ok) throw new Error(`다운로드 실패: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}
