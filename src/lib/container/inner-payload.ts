/**
 * Inner Payload — 암호화 내부에 서명·메타데이터를 포함하는 포맷
 *
 * 구조 (HAS_META 없을 때 — 하위호환 기존 포맷):
 *   [1 byte: flags] [4 bytes: sig length] [signatures JSON] [compressed data]
 *
 * 구조 (HAS_META 세트 시):
 *   [1 byte: flags] [4 bytes: sig length] [4 bytes: meta length]
 *   [signatures JSON] [meta JSON] [compressed data]
 *
 * flags:
 *   bit 0 (0x01): has_signatures
 *   bit 1 (0x02): has_meta
 *
 * 복호화 후 이 포맷을 파싱하면 서명 존재 여부와 분류 등급 등 메타를 알 수 있다.
 * 암호화 전에는 서명·메타가 전혀 노출되지 않는다(분류 등급도 암호화 계층 안에만 존재).
 */
import { strToU8, strFromU8 } from 'fflate';
import type { PkiHeader } from './pki-format';

const HAS_SIGNATURES = 0x01;
const HAS_META = 0x02;

type SerializedSig = NonNullable<PkiHeader['signatures']>;

/** 암호화 계층 안에 숨겨 기록하는 메타데이터 (복호화 후에만 노출).
 *  등급은 평문 헤더의 header.classification 과 동일 구조를 재사용한다. */
export interface InnerMeta {
  classification?: PkiHeader['classification'];
}

export interface InnerPayload {
  data: Uint8Array;                   // 압축된 파일 데이터
  signatures?: SerializedSig;         // 서명 정보 (복호화 후 발견)
  meta?: InnerMeta;                   // 분류 등급 등 메타 (복호화 후 발견)
}

/**
 * 내부 페이로드 패킹 (암호화 전)
 */
export function packInnerPayload(
  data: Uint8Array,
  signatures?: SerializedSig,
  meta?: InnerMeta,
): Uint8Array {
  let flags = 0;
  let sigBytes = new Uint8Array(0);
  let metaBytes = new Uint8Array(0);

  if (signatures && signatures.length > 0) {
    flags |= HAS_SIGNATURES;
    sigBytes = new Uint8Array(strToU8(JSON.stringify(signatures)));
  }

  const hasMeta = !!meta && Object.keys(meta).length > 0;
  if (hasMeta) {
    flags |= HAS_META;
    metaBytes = new Uint8Array(strToU8(JSON.stringify(meta)));
  }

  const sigLenBytes = new Uint8Array(new Uint32Array([sigBytes.length]).buffer);

  if (!hasMeta) {
    // 기존 레이아웃 (하위호환): [1 flags][4 sigLen][sig][data]
    const result = new Uint8Array(1 + 4 + sigBytes.length + data.length);
    result[0] = flags;
    result.set(sigLenBytes, 1);
    result.set(sigBytes, 5);
    result.set(data, 5 + sigBytes.length);
    return result;
  }

  // 확장 레이아웃: [1 flags][4 sigLen][4 metaLen][sig][meta][data]
  const metaLenBytes = new Uint8Array(new Uint32Array([metaBytes.length]).buffer);
  const result = new Uint8Array(1 + 4 + 4 + sigBytes.length + metaBytes.length + data.length);
  result[0] = flags;
  result.set(sigLenBytes, 1);
  result.set(metaLenBytes, 5);
  result.set(sigBytes, 9);
  result.set(metaBytes, 9 + sigBytes.length);
  result.set(data, 9 + sigBytes.length + metaBytes.length);
  return result;
}

/**
 * 내부 페이로드 언패킹 (복호화 후)
 */
export function unpackInnerPayload(raw: Uint8Array): InnerPayload {
  const flags = raw[0];
  const sigLen = new Uint32Array(raw.slice(1, 5).buffer)[0];
  const hasMeta = (flags & HAS_META) !== 0;

  // meta 있으면 sigLen 뒤에 metaLen(4B)이 추가로 온다
  const headerLen = hasMeta ? 9 : 5;
  const metaLen = hasMeta ? new Uint32Array(raw.slice(5, 9).buffer)[0] : 0;

  let signatures: SerializedSig | undefined;
  if ((flags & HAS_SIGNATURES) && sigLen > 0) {
    const sigBytes = raw.slice(headerLen, headerLen + sigLen);
    signatures = JSON.parse(strFromU8(sigBytes));
  }

  let meta: InnerMeta | undefined;
  if (hasMeta && metaLen > 0) {
    const metaBytes = raw.slice(headerLen + sigLen, headerLen + sigLen + metaLen);
    meta = JSON.parse(strFromU8(metaBytes));
  }

  const data = raw.slice(headerLen + sigLen + metaLen);

  return { data, signatures, meta };
}
