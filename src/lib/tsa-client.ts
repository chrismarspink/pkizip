import { debug } from "./debug";
/**
 * TSA Client — RFC 3161 타임스탬프 요청/응답
 *
 * 전송 경로는 실행 컨텍스트로 결정된다 (C5):
 *  - PWA(브라우저): 공개 TSA가 CORS를 지원하지 않으므로(2026-07 DigiCert/Sectigo/FreeTSA/
 *    GlobalSign 모두 미지원 확인) 직결 불가 → Edge Function 프록시 경유가 필수.
 *  - 확장 프로그램(host 권한) 등 크로스오리진 허용 컨텍스트 또는 명시적 옵트인 → TSA 직결.
 * SHA-256(서명값) → TimeStampReq → TSA → TimeStampResp → TST DER
 */
import * as asn1js from 'asn1js';
import { sha256 } from '@noble/hashes/sha2.js';
import { SUPABASE_URL } from './supabase/rest';
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

// Supabase Edge Function 프록시 (CORS 우회) — 백엔드 URL은 C4 단일 소스에서 도출
export const TSA_PROXY_URL = `${SUPABASE_URL}/functions/v1/tsa-proxy`;

/**
 * TSA 직결 가능 여부.
 * PWA는 CORS로 직결 불가 → false(프록시 경유). 확장 프로그램(chrome.runtime.id + host 권한)
 * 또는 사용자가 명시적으로 켠 경우에만 true.
 */
export function isDirectTsaCapable(): boolean {
  // 브라우저 확장 컨텍스트 (host_permissions로 크로스오리진 허용)
  const g = globalThis as { chrome?: { runtime?: { id?: string } } };
  if (g.chrome?.runtime?.id) return true;
  // 명시적 옵트인 (예: CORS 지원 사설 TSA를 쓰는 배포)
  try {
    return localStorage.getItem('pkizip-tsa-allow-direct') === '1';
  } catch {
    return false;
  }
}

/** 단일 TSA에 타임스탬프 요청. 컨텍스트에 따라 직결 또는 프록시 경유. */
export async function requestTst(
  server: TsaServer,
  reqDer: Uint8Array,
  timeoutMs: number,
): Promise<Uint8Array> {
  if (isDirectTsaCapable()) {
    // 확장/직결 가능 컨텍스트: TSA 직결 (프록시 미사용). 실패는 상위 루프가 다음 TSA로 폴백.
    return rawTsaPost(server.url, reqDer, timeoutMs);
  }
  // PWA 기본 경로: CORS 우회 프록시 (공개 TSA는 CORS 미지원이라 직결 시도 자체를 생략)
  return proxyTsaPost(server.url, reqDer, timeoutMs);
}

/** Edge Function 프록시를 통한 TSA POST */
async function proxyTsaPost(tsaUrl: string, reqDer: Uint8Array, timeoutMs: number): Promise<Uint8Array> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(TSA_PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/timestamp-query',
        'x-tsa-url': tsaUrl,
      },
      body: reqDer as unknown as BodyInit,
      signal: controller.signal,
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`TSA proxy HTTP ${res.status} ${errBody}`);
    }
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('timestamp-reply')) {
      throw new Error(`TSA proxy 응답 타입 오류: ${ct}`);
    }
    return new Uint8Array(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

async function rawTsaPost(url: string, reqDer: Uint8Array, timeoutMs: number): Promise<Uint8Array> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/timestamp-query' },
      body: reqDer as unknown as BodyInit,
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`TSA HTTP ${res.status}`);
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('timestamp-reply')) {
      throw new Error(`TSA 응답 타입 오류: ${ct}`);
    }
    return new Uint8Array(await res.arrayBuffer());
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
      debug.log(`[PKIZIP-TSA] 요청: ${server.name} (${server.url})`);
      const tstDer = await requestTst(server, reqDer, settings.timeoutMs);
      debug.log(`[PKIZIP-TSA] 성공: ${server.name} (${tstDer.length}B)`);

      return {
        success: true,
        tsaId: server.id,
        tsaName: server.name,
        timestampToken: tstDer,
        method: 'tst',
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      debug.warn(`[PKIZIP-TSA] 실패: ${server.name} — ${msg}`);
      blacklistTsa(server.id);
    }
  }

  // 전체 실패 → signingTime 폴백
  debug.warn('[PKIZIP-TSA] 모든 TSA 실패 — signingTime 폴백');
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
