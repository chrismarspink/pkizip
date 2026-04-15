/**
 * Inner Payload — 암호화 내부에 서명을 포함하는 포맷
 *
 * 구조:
 *   [1 byte: flags] [4 bytes: sig length] [signatures JSON] [compressed data]
 *
 * flags:
 *   bit 0: has_signatures
 *
 * 복호화 후 이 포맷을 파싱하면 서명 존재 여부를 알 수 있다.
 * 암호화 전에는 서명 정보가 전혀 노출되지 않는다.
 */
import { strToU8, strFromU8 } from 'fflate';
import type { PkiHeader } from './pki-format';

const HAS_SIGNATURES = 0x01;

type SerializedSig = NonNullable<PkiHeader['signatures']>;

export interface InnerPayload {
  data: Uint8Array;                   // 압축된 파일 데이터
  signatures?: SerializedSig;         // 서명 정보 (복호화 후 발견)
}

/**
 * 내부 페이로드 패킹 (암호화 전)
 */
export function packInnerPayload(
  data: Uint8Array,
  signatures?: SerializedSig
): Uint8Array {
  let flags = 0;
  let sigBytes = new Uint8Array(0);

  if (signatures && signatures.length > 0) {
    flags |= HAS_SIGNATURES;
    sigBytes = new Uint8Array(strToU8(JSON.stringify(signatures)));
  }

  const sigLen = new Uint32Array([sigBytes.length]);
  const sigLenBytes = new Uint8Array(sigLen.buffer);

  // [1 flags][4 sigLen][sigBytes][data]
  const result = new Uint8Array(1 + 4 + sigBytes.length + data.length);
  result[0] = flags;
  result.set(sigLenBytes, 1);
  result.set(sigBytes, 5);
  result.set(data, 5 + sigBytes.length);

  return result;
}

/**
 * 내부 페이로드 언패킹 (복호화 후)
 */
export function unpackInnerPayload(raw: Uint8Array): InnerPayload {
  const flags = raw[0];
  const sigLen = new Uint32Array(raw.slice(1, 5).buffer)[0];

  let signatures: SerializedSig | undefined;
  if ((flags & HAS_SIGNATURES) && sigLen > 0) {
    const sigBytes = raw.slice(5, 5 + sigLen);
    signatures = JSON.parse(strFromU8(sigBytes));
  }

  const data = raw.slice(5 + sigLen);

  return { data, signatures };
}
