/**
 * link-store — 안전 링크 관련 로컬 저장소 (별도 IndexedDB `pkizip-links`).
 *
 * 두 스토어:
 *   - sent:     발송자가 만든 링크. proof 검증·승급을 위해 otcSecret 을 로컬 보관
 *               (발송자 본인 기기에만, 서버 전송 절대 없음).
 *   - received: 수신자가 무설치 열람 중 만든 ECDH 키쌍(개인키 포함). 기기에만 보관.
 *
 * 메인 키 DB(pkizip-keys)와 분리해 스키마 버전 충돌을 피한다.
 */
import { openDB, type IDBPDatabase } from 'idb';
import { computeJWKFingerprint } from '../crypto/key-manager';

const DB_NAME = 'pkizip-links';
const DB_VERSION = 1;
const STORE_SENT = 'sent';
const STORE_RECEIVED = 'received';

export interface SentLink {
  envelopeId: string;
  tokenHash: string;
  otcSecret: string;      // 발송자 로컬 전용 — proof 재검증용. 서버 미전송.
  createdAt: number;
  promoted?: boolean;     // 수신자 공개키를 주소록에 승급 완료
  label?: string;
}

export interface ReceivedKey {
  fingerprint: string;
  publicJwk: JsonWebKey;
  privateJwk: JsonWebKey;   // 수신자 기기에만. 서버 미전송.
  createdAt: number;
}

let _db: Promise<IDBPDatabase> | null = null;
function db(): Promise<IDBPDatabase> {
  if (!_db) {
    _db = openDB(DB_NAME, DB_VERSION, {
      upgrade(d) {
        if (!d.objectStoreNames.contains(STORE_SENT)) d.createObjectStore(STORE_SENT, { keyPath: 'envelopeId' });
        if (!d.objectStoreNames.contains(STORE_RECEIVED)) d.createObjectStore(STORE_RECEIVED, { keyPath: 'fingerprint' });
      },
    });
  }
  return _db;
}

// ── 발송자 sent-links ──────────────────────────────────────────────────
export async function recordSentLink(link: SentLink): Promise<void> {
  await (await db()).put(STORE_SENT, link);
}
export async function getSentLinks(): Promise<SentLink[]> {
  return (await db()).getAll(STORE_SENT);
}
export async function markPromoted(envelopeId: string): Promise<void> {
  const d = await db();
  const link = await d.get(STORE_SENT, envelopeId);
  if (link) { link.promoted = true; await d.put(STORE_SENT, link); }
}

// ── 수신자 생성 키 ──────────────────────────────────────────────────────
/** ECDH P-256 키쌍 생성 → 로컬 보관, 공개키+지문 반환 (개인키는 기기에만) */
export async function generateAndStoreReceivedKey(): Promise<{ publicJwk: JsonWebKey; fingerprint: string }> {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits'],
  );
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const fingerprint = computeJWKFingerprint(publicJwk);
  await (await db()).put(STORE_RECEIVED, { fingerprint, publicJwk, privateJwk, createdAt: Date.now() } as ReceivedKey);
  return { publicJwk, fingerprint };
}
