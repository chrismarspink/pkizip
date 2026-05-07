/**
 * 텍스트 봉투 인코딩 — `pkizip:1:<base64>` 형식.
 *
 * 클립보드/메신저로 PKIZIP 봉투 전송 시 사용.
 * 받는 쪽은 같은 형식 디코딩 후 readPkiContainer() 로 풀기.
 */
import { arrayBufferToBase64, base64ToArrayBuffer } from './pki-format';

const PREFIX = 'pkizip:1:';

/** 봉투 바이너리 → "pkizip:1:<base64>" 텍스트. */
export function encodeTextEnvelope(pkiData: Uint8Array): string {
  return PREFIX + arrayBufferToBase64(pkiData);
}

/** "pkizip:1:<base64>" 텍스트 → 봉투 바이너리. 형식 불일치 시 null. */
export function decodeTextEnvelope(text: string): Uint8Array | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith(PREFIX)) return null;
  const b64 = trimmed.slice(PREFIX.length).replace(/\s+/g, '');
  try {
    return new Uint8Array(base64ToArrayBuffer(b64));
  } catch {
    return null;
  }
}

/** 입력이 텍스트 봉투 형식인지 빠른 체크. */
export function isTextEnvelope(text: string): boolean {
  return text.trim().startsWith(PREFIX);
}
