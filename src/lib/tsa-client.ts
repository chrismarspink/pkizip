/**
 * TSA Client — RFC 3161 타임스탬프 요청/응답
 *
 * 브라우저에서 TSA 서버에 직접 POST (CORS 제한으로 실패 가능 → signingTime 폴백)
 * SHA-256(서명값) → TimeStampReq → TSA → TimeStampResp → TST DER
 */
import * as asn1js from 'asn1js';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  checkAllTsaHealth, selectBestTsa, blacklistTsa, getTsaSettings,
  type TsaServer,
} from './tsa-health';

export interface TimestampResult {
  success: boolean;
  tsaId?: string;
  tsaName?: string;
  timestampToken?: Uint8Array;
  signingTime?: Date;
  method: 'tst' | 'signingTime' | 'none';
  error?: string;
}

// SHA-256 OID: 2.16.840.1.101.3.4.2.1
const OID_SHA256 = '2.16.840.1.101.3.4.2.1';

/**
 * TimeStampReq ASN.1 DER 빌드 (RFC 3161 §2.4.1)
 *
 * TimeStampReq ::= SEQUENCE {
 *   version          INTEGER (1),
 *   messageImprint   MessageImprint,
 *   nonce            INTEGER OPTIONAL,
 *   certReq          BOOLEAN DEFAULT FALSE
 * }
 *
 * MessageImprint ::= SEQUENCE {
 *   hashAlgorithm    AlgorithmIdentifier,
 *   hashedMessage    OCTET STRING
 * }
 */
function buildTimestampRequest(hash: Uint8Array, nonce: Uint8Array): Uint8Array {
  const msgImprint = new asn1js.Sequence({
    value: [
      // AlgorithmIdentifier { OID SHA-256 }
      new asn1js.Sequence({
        value: [
          new asn1js.ObjectIdentifier({ value: OID_SHA256 }),
          new asn1js.Null(),
        ],
      }),
      // hashedMessage
      new asn1js.OctetString({ valueHex: copyBuf(hash) }),
    ],
  });

  const req = new asn1js.Sequence({
    value: [
      new asn1js.Integer({ value: 1 }), // version
      msgImprint,
      new asn1js.Integer({ valueHex: copyBuf(nonce) }), // nonce
      new asn1js.Boolean({ value: true }), // certReq
    ],
  });

  return new Uint8Array(req.toBER());
}

/** 단일 TSA에 타임스탬프 요청 */
async function requestTst(
  server: TsaServer,
  reqDer: Uint8Array,
  timeoutMs: number,
): Promise<Uint8Array> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(server.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/timestamp-query' },
      body: reqDer as unknown as BodyInit,
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`TSA HTTP ${res.status}`);

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('timestamp-reply')) {
      throw new Error(`TSA 응답 타입 오류: ${contentType}`);
    }

    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 서명값에 대한 TST 획득 (폴백 체인 포함)
 *
 * 1. 최적 TSA 선택
 * 2. SHA-256(signatureBytes)
 * 3. TimeStampReq 빌드
 * 4. TSA 순차 요청 (실패 시 다음 TSA)
 * 5. 전체 실패 → signingTime 폴백
 */
export async function getTimestampToken(
  signatureBytes: Uint8Array,
): Promise<TimestampResult> {
  const settings = getTsaSettings();

  if (!settings.enabled) {
    return { success: false, method: 'none' };
  }

  if (!navigator.onLine) {
    return {
      success: false,
      method: 'signingTime',
      signingTime: new Date(),
      error: '오프라인 — 로컬 시각 사용',
    };
  }

  const hash = sha256(signatureBytes);
  const nonce = crypto.getRandomValues(new Uint8Array(8));
  const reqDer = buildTimestampRequest(hash, nonce);

  const healthCache = await checkAllTsaHealth(settings.servers);
  const enabledServers = settings.servers.filter(s => s.enabled);

  // 최적 순서로 정렬
  const sorted = [...enabledServers].sort((a, b) => {
    const best = selectBestTsa(healthCache, [a, b]);
    return best?.id === a.id ? -1 : 1;
  });

  for (const server of sorted) {
    try {
      console.log(`[PKIZIP-TSA] 요청: ${server.name} (${server.url})`);
      const tstDer = await requestTst(server, reqDer, settings.timeoutMs);
      console.log(`[PKIZIP-TSA] 성공: ${server.name} (${tstDer.length}B)`);

      return {
        success: true,
        tsaId: server.id,
        tsaName: server.name,
        timestampToken: tstDer,
        method: 'tst',
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[PKIZIP-TSA] 실패: ${server.name} — ${msg}`);
      blacklistTsa(server.id);
    }
  }

  // 전체 실패 → signingTime 폴백
  console.warn('[PKIZIP-TSA] 모든 TSA 실패 — signingTime 폴백');
  return {
    success: false,
    method: 'signingTime',
    signingTime: new Date(),
    error: '모든 TSA 서버 연결 실패',
  };
}

function copyBuf(data: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(data.length);
  copy.set(data);
  return copy.buffer as ArrayBuffer;
}
