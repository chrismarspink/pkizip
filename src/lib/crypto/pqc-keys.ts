/**
 * PQC 개인키/공개키 PEM 인코딩/디코딩
 *
 * RFC 9935 §6 (ML-KEM PKCS#8)
 * RFC 9881 §6 (ML-DSA PKCS#8)
 *
 * 개인키: OneAsymmetricKey (PKCS#8) — seed CHOICE [0] 태그 0x80
 * 공개키: SubjectPublicKeyInfo — BitString, unusedBits=0
 */
import * as asn1js from 'asn1js';
import { OID_ML_KEM_1024, OID_ML_DSA_87 } from './pqc-oids';

// ─── PEM 유틸 ──────────────────────────────────────────

function uint8ToBase64(data: Uint8Array): string {
  // 8KB chunks to avoid stack overflow on large keys
  const chunks: string[] = [];
  for (let i = 0; i < data.length; i += 8192) {
    chunks.push(String.fromCharCode(...data.subarray(i, i + 8192)));
  }
  return btoa(chunks.join(''));
}

function base64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

function derToPem(der: Uint8Array, label: string): string {
  const b64 = uint8ToBase64(der);
  const lines = b64.match(/.{1,64}/g)!.join('\n');
  return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----\n`;
}

function pemToDer(pem: string): Uint8Array {
  const b64 = pem.replace(/-----[^-]+-----|[\n\r\s]/g, '');
  return base64ToUint8(b64);
}

// ─── 개인키 인코딩 ─────────────────────────────────────

/**
 * ML-KEM 또는 ML-DSA seed를 RFC 9935/9881 준거 PKCS#8 PEM으로 인코딩.
 *
 * PKCS#8 (OneAsymmetricKey):
 *   SEQUENCE {
 *     INTEGER 0
 *     SEQUENCE { OID }                  -- parameters ABSENT
 *     OCTET STRING { [0] seed bytes }   -- 태그 0x80 (seed CHOICE)
 *   }
 *
 * @param seed  ML-KEM: 64B (d||z), ML-DSA: 32B
 * @param alg   'ml-kem-1024' | 'ml-dsa-87'
 */
export function encodeSeedPrivateKey(
  seed: Uint8Array,
  alg: 'ml-kem-1024' | 'ml-dsa-87'
): string {
  const oid = alg === 'ml-kem-1024' ? OID_ML_KEM_1024 : OID_ML_DSA_87;

  // seed CHOICE: [0] IMPLICIT OCTET STRING → 태그 0x80 | length | bytes
  const seedTagged = new Uint8Array(2 + seed.length);
  seedTagged[0] = 0x80;
  seedTagged[1] = seed.length;
  seedTagged.set(seed, 2);

  const privateKeyOctet = new asn1js.OctetString({
    valueHex: seedTagged.buffer.slice(seedTagged.byteOffset, seedTagged.byteOffset + seedTagged.byteLength) as ArrayBuffer,
  });

  const algId = new asn1js.Sequence({
    value: [new asn1js.ObjectIdentifier({ value: oid })],
    // parameters 없음 — RFC 9935/9881 준수
  });

  const pkcs8 = new asn1js.Sequence({
    value: [
      new asn1js.Integer({ value: 0 }), // version
      algId,
      privateKeyOctet,
    ],
  });

  const der = new Uint8Array(pkcs8.toBER());
  return derToPem(der, 'PRIVATE KEY');
}

// ─── 개인키 디코딩 ─────────────────────────────────────

/**
 * PKCS#8 PEM에서 seed를 추출한다.
 *
 * 태그 기반 파싱 (RFC 9881 §6):
 *   0x80 → seed
 *   0x04 → expandedKey
 *   0x30 → both (SEQUENCE { seed, expandedKey })
 */
export function decodeSeedPrivateKey(pem: string): {
  seed?: Uint8Array;
  expandedKey?: Uint8Array;
  algorithm: string;
} {
  const der = pemToDer(pem);
  const asn1 = asn1js.fromBER(der.buffer.slice(der.byteOffset, der.byteOffset + der.byteLength) as ArrayBuffer);
  if (asn1.offset === -1) throw new Error('PKCS#8 DER 파싱 실패');

  const seq = asn1.result as asn1js.Sequence;
  const algSeq = seq.valueBlock.value[1] as asn1js.Sequence;
  const oid = (algSeq.valueBlock.value[0] as asn1js.ObjectIdentifier).valueBlock.toString();

  const privKeyOctet = (seq.valueBlock.value[2] as asn1js.OctetString).valueBlock.valueHexView;
  const tag = privKeyOctet[0];

  if (tag === 0x80) {
    const len = privKeyOctet[1];
    const seed = new Uint8Array(privKeyOctet.slice(2, 2 + len));
    return { seed, algorithm: oid };
  }

  if (tag === 0x04) {
    const innerAsn1 = asn1js.fromBER(privKeyOctet.buffer.slice(privKeyOctet.byteOffset) as ArrayBuffer);
    const expandedKey = new Uint8Array((innerAsn1.result as asn1js.OctetString).valueBlock.valueHexView);
    return { expandedKey, algorithm: oid };
  }

  if (tag === 0x30) {
    const innerAsn1 = asn1js.fromBER(privKeyOctet.buffer.slice(privKeyOctet.byteOffset) as ArrayBuffer);
    const bothSeq = innerAsn1.result as asn1js.Sequence;
    const seedItem = bothSeq.valueBlock.value[0] as asn1js.Primitive;
    const seed = new Uint8Array(seedItem.valueBlock.valueHexView);
    return { seed, algorithm: oid };
  }

  throw new Error(`알 수 없는 개인키 CHOICE 태그: 0x${tag.toString(16)}`);
}

// ─── 공개키 인코딩 ─────────────────────────────────────

/**
 * ML-KEM / ML-DSA 공개키를 SubjectPublicKeyInfo PEM으로 인코딩.
 *
 * SEQUENCE {
 *   SEQUENCE { OID }       -- AlgorithmIdentifier (parameters ABSENT)
 *   BIT STRING { pubkey }  -- raw bytes, unusedBits=0
 * }
 */
export function encodePublicKey(
  publicKey: Uint8Array,
  alg: 'ml-kem-1024' | 'ml-dsa-87'
): string {
  const oid = alg === 'ml-kem-1024' ? OID_ML_KEM_1024 : OID_ML_DSA_87;

  // BIT STRING: 앞에 unusedBits(0x00) 바이트 추가
  const bitStringContent = new Uint8Array(1 + publicKey.length);
  bitStringContent[0] = 0x00; // unused bits
  bitStringContent.set(publicKey, 1);

  const spki = new asn1js.Sequence({
    value: [
      new asn1js.Sequence({
        value: [new asn1js.ObjectIdentifier({ value: oid })],
      }),
      new asn1js.BitString({
        valueHex: bitStringContent.buffer.slice(
          bitStringContent.byteOffset,
          bitStringContent.byteOffset + bitStringContent.byteLength
        ) as ArrayBuffer,
      }),
    ],
  });

  const der = new Uint8Array(spki.toBER());
  return derToPem(der, 'PUBLIC KEY');
}
