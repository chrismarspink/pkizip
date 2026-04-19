/**
 * PQC X.509 인증서 생성 — ML-KEM-1024 (RFC 9935) / ML-DSA-87 (RFC 9881)
 *
 * pkijs + asn1js로 표준 DER/PEM 생성.
 * cert.sign() 사용 불가 (Web Crypto API 미지원) → ml_dsa87.sign() 직접 사용.
 *
 * 인증서 3개 구성:
 *   1. ECDSA P-256 (classic) — certificate.ts에서 생성 (건드리지 않음)
 *   2. ML-KEM-1024 — ML-DSA-87 키로 서명 (KEM은 서명 불가)
 *   3. ML-DSA-87 — 자가 서명
 */
import * as pkijs from 'pkijs';
import * as asn1js from 'asn1js';
import { ml_dsa87 } from '@noble/post-quantum/ml-dsa.js';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  OID_ML_KEM_1024, OID_ML_DSA_87,
  OID_KEY_USAGE, OID_BASIC_CONSTRAINTS, OID_SUBJECT_KEY_ID,
  OID_COMMON_NAME, OID_EMAIL_ADDRESS,
} from './pqc-oids';

export interface PqcSubject {
  commonName: string;
  email?: string;
}

// ─── 공개 API ──────────────────────────────────────────

/**
 * RFC 9935 준거 ML-KEM-1024 X.509 자가서명 인증서.
 *
 * ML-KEM은 서명 불가 → ML-DSA-87 키로 서명한다.
 * keyUsage: keyEncipherment ONLY (critical)
 * parameters: ABSENT
 */
export async function buildMlKemCertificate(p: {
  kemPublicKey: Uint8Array;    // 1568B
  dsaSecretKey: Uint8Array;    // 4896B expanded (서명용)
  subject: PqcSubject;
  validityDays?: number;
}): Promise<string> {
  const cert = new pkijs.Certificate();
  cert.version = 2; // v3

  cert.serialNumber = randomSerialNumber();

  const now = new Date();
  cert.notBefore.value = now;
  cert.notAfter.value = new Date(now.getTime() + (p.validityDays ?? 3650) * 86400_000);

  const name = buildSubjectName(p.subject);
  cert.subject = name;
  cert.issuer = buildSubjectName(p.subject); // self-signed

  // SubjectPublicKeyInfo — ML-KEM-1024, parameters ABSENT
  cert.subjectPublicKeyInfo = new pkijs.PublicKeyInfo();
  cert.subjectPublicKeyInfo.algorithm = new pkijs.AlgorithmIdentifier({
    algorithmId: OID_ML_KEM_1024,
  });
  cert.subjectPublicKeyInfo.subjectPublicKey = makeBitString(p.kemPublicKey);

  // Extensions
  cert.extensions = [
    // keyUsage: keyEncipherment (bit 2) ONLY — critical
    // BIT STRING: 03 02 05 20 → 5 unused bits, 0x20 = 0010_0000
    makeRawKeyUsageExt(new Uint8Array([0x03, 0x02, 0x05, 0x20])),
    makeBasicConstraintsExt(),
    makeSkiExt(p.kemPublicKey),
  ];

  // signatureAlgorithm: ML-DSA-87, parameters ABSENT
  cert.signatureAlgorithm = new pkijs.AlgorithmIdentifier({
    algorithmId: OID_ML_DSA_87,
  });

  // TBSCertificate DER → ML-DSA-87 서명 (cert.sign() 사용 불가)
  const tbsDer = copyUint8(new Uint8Array(cert.encodeTBS().toBER()));
  const sig = ml_dsa87.sign(tbsDer, p.dsaSecretKey);

  cert.signatureValue = makeBitString(sig);

  const fullDer = copyUint8(new Uint8Array(cert.toSchema().toBER()));
  return derToPem(fullDer, 'CERTIFICATE');
}

/**
 * RFC 9881 준거 ML-DSA-87 X.509 자가서명 인증서.
 *
 * 자가 서명 (ML-DSA 키로 직접 서명).
 * keyUsage: digitalSignature + nonRepudiation (critical)
 */
export async function buildMlDsaCertificate(p: {
  dsaPublicKey: Uint8Array;    // 2592B
  dsaSecretKey: Uint8Array;    // 4896B expanded
  subject: PqcSubject;
  validityDays?: number;
}): Promise<string> {
  const cert = new pkijs.Certificate();
  cert.version = 2;

  cert.serialNumber = randomSerialNumber();

  const now = new Date();
  cert.notBefore.value = now;
  cert.notAfter.value = new Date(now.getTime() + (p.validityDays ?? 3650) * 86400_000);

  const name = buildSubjectName(p.subject);
  cert.subject = name;
  cert.issuer = buildSubjectName(p.subject);

  cert.subjectPublicKeyInfo = new pkijs.PublicKeyInfo();
  cert.subjectPublicKeyInfo.algorithm = new pkijs.AlgorithmIdentifier({
    algorithmId: OID_ML_DSA_87,
  });
  cert.subjectPublicKeyInfo.subjectPublicKey = makeBitString(p.dsaPublicKey);

  // keyUsage: digitalSignature (bit 0) + nonRepudiation (bit 1) — critical
  // BIT STRING: 03 02 06 C0 → 6 unused bits, 0xC0 = 1100_0000
  cert.extensions = [
    makeRawKeyUsageExt(new Uint8Array([0x03, 0x02, 0x06, 0xC0])),
    makeBasicConstraintsExt(),
    makeSkiExt(p.dsaPublicKey),
  ];

  cert.signatureAlgorithm = new pkijs.AlgorithmIdentifier({
    algorithmId: OID_ML_DSA_87,
  });

  const tbsDer = copyUint8(new Uint8Array(cert.encodeTBS().toBER()));
  const sig = ml_dsa87.sign(tbsDer, p.dsaSecretKey);

  cert.signatureValue = makeBitString(sig);

  const fullDer = copyUint8(new Uint8Array(cert.toSchema().toBER()));
  return derToPem(fullDer, 'CERTIFICATE');
}

// ─── 내부 헬퍼 ─────────────────────────────────────────

function buildSubjectName(s: PqcSubject): pkijs.RelativeDistinguishedNames {
  const rdn = new pkijs.RelativeDistinguishedNames();
  rdn.typesAndValues.push(
    new pkijs.AttributeTypeAndValue({
      type: OID_COMMON_NAME,
      value: new asn1js.Utf8String({ value: s.commonName }),
    })
  );
  if (s.email) {
    rdn.typesAndValues.push(
      new pkijs.AttributeTypeAndValue({
        type: OID_EMAIL_ADDRESS,
        value: new asn1js.IA5String({ value: s.email }),
      })
    );
  }
  return rdn;
}

function randomSerialNumber(): asn1js.Integer {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[0] = bytes[0] & 0x7F; // 양수 보장
  return new asn1js.Integer({
    valueHex: copyBuffer(bytes),
  });
}

/** Uint8Array → BIT STRING (unusedBits=0) */
function makeBitString(data: Uint8Array): asn1js.BitString {
  return new asn1js.BitString({
    valueHex: copyBuffer(data),
    unusedBits: 0,
  });
}

function makeRawKeyUsageExt(rawDer: Uint8Array): pkijs.Extension {
  return new pkijs.Extension({
    extnID: OID_KEY_USAGE,
    critical: true,
    extnValue: copyBuffer(rawDer),
  });
}

function makeBasicConstraintsExt(): pkijs.Extension {
  const seq = new asn1js.Sequence({ value: [] }); // CA:FALSE
  return new pkijs.Extension({
    extnID: OID_BASIC_CONSTRAINTS,
    critical: false,
    extnValue: seq.toBER(),
  });
}

function makeSkiExt(pubKey: Uint8Array): pkijs.Extension {
  const hash = sha256(pubKey);
  const ski20 = hash.slice(0, 20);
  const inner = new asn1js.OctetString({ valueHex: copyBuffer(ski20) });
  return new pkijs.Extension({
    extnID: OID_SUBJECT_KEY_ID,
    critical: false,
    extnValue: inner.toBER(),
  });
}

/** DER → PEM (8KB chunk 방식으로 큰 인증서도 안전) */
function derToPem(der: Uint8Array, label: string): string {
  const chunks: string[] = [];
  for (let i = 0; i < der.length; i += 8192) {
    chunks.push(String.fromCharCode(...der.subarray(i, i + 8192)));
  }
  const b64 = btoa(chunks.join(''));
  const lines = b64.match(/.{1,64}/g)!.join('\n');
  return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----\n`;
}

/** Uint8Array → ArrayBuffer 복사 (subarray offset 문제 방지) */
function copyBuffer(data: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(data.length);
  copy.set(data);
  return copy.buffer as ArrayBuffer;
}

/** Uint8Array 복사 */
function copyUint8(data: Uint8Array): Uint8Array {
  const copy = new Uint8Array(data.length);
  copy.set(data);
  return copy;
}
