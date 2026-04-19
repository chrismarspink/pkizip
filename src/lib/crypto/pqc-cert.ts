/**
 * PQC X.509 인증서 생성 — ML-KEM-1024 (RFC 9935) / ML-DSA-87 (RFC 9881)
 *
 * pkijs의 cert.sign()은 Web Crypto 미지원 알고리즘에서 작동하지 않으므로
 * 전체 TBSCertificate를 ASN.1로 직접 구성하고 ml_dsa87.sign()으로 서명한다.
 *
 * SubjectPublicKeyInfo도 pkijs.PublicKeyInfo 대신 raw ASN.1로 구성한다
 * (pkijs.PublicKeyInfo.toSchema()가 PQC OID에서 내부 필드 누락으로 실패하므로).
 */
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
 * ML-KEM은 서명 불가 → ML-DSA-87 키로 서명.
 * keyUsage: keyEncipherment ONLY (critical)
 */
export async function buildMlKemCertificate(p: {
  kemPublicKey: Uint8Array;
  dsaSecretKey: Uint8Array;
  subject: PqcSubject;
  validityDays?: number;
}): Promise<string> {
  const validity = p.validityDays ?? 3650;

  const tbs = buildTBSCertificate({
    serialNumber: randomSerial(),
    signatureAlgorithmOID: OID_ML_DSA_87,
    subject: p.subject,
    validityDays: validity,
    publicKeyOID: OID_ML_KEM_1024,
    publicKeyBytes: p.kemPublicKey,
    keyUsageDer: new Uint8Array([0x03, 0x02, 0x05, 0x20]), // keyEncipherment
  });

  const tbsDer = new Uint8Array(tbs.toBER());
  const sig = ml_dsa87.sign(tbsDer, p.dsaSecretKey);

  return buildSignedCert(tbs, OID_ML_DSA_87, sig);
}

/**
 * RFC 9881 준거 ML-DSA-87 X.509 자가서명 인증서.
 * keyUsage: digitalSignature + nonRepudiation (critical)
 */
export async function buildMlDsaCertificate(p: {
  dsaPublicKey: Uint8Array;
  dsaSecretKey: Uint8Array;
  subject: PqcSubject;
  validityDays?: number;
}): Promise<string> {
  const validity = p.validityDays ?? 3650;

  const tbs = buildTBSCertificate({
    serialNumber: randomSerial(),
    signatureAlgorithmOID: OID_ML_DSA_87,
    subject: p.subject,
    validityDays: validity,
    publicKeyOID: OID_ML_DSA_87,
    publicKeyBytes: p.dsaPublicKey,
    keyUsageDer: new Uint8Array([0x03, 0x02, 0x06, 0xC0]), // digitalSignature + nonRepudiation
  });

  const tbsDer = new Uint8Array(tbs.toBER());
  const sig = ml_dsa87.sign(tbsDer, p.dsaSecretKey);

  return buildSignedCert(tbs, OID_ML_DSA_87, sig);
}

// ─── TBSCertificate 구성 (순수 ASN.1) ─────────────────

interface TBSParams {
  serialNumber: Uint8Array;
  signatureAlgorithmOID: string;
  subject: PqcSubject;
  validityDays: number;
  publicKeyOID: string;
  publicKeyBytes: Uint8Array;
  keyUsageDer: Uint8Array;
}

/**
 * TBSCertificate ASN.1 구성.
 *
 * TBSCertificate ::= SEQUENCE {
 *   version         [0] EXPLICIT INTEGER (2),   -- v3
 *   serialNumber    INTEGER,
 *   signature       AlgorithmIdentifier,
 *   issuer          Name,
 *   validity        Validity,
 *   subject         Name,
 *   subjectPublicKeyInfo SubjectPublicKeyInfo,
 *   extensions      [3] EXPLICIT Extensions
 * }
 */
function buildTBSCertificate(p: TBSParams): asn1js.Sequence {
  const now = new Date();
  const notAfter = new Date(now.getTime() + p.validityDays * 86400_000);

  // version [0] EXPLICIT INTEGER 2
  const version = new asn1js.Constructed({
    idBlock: { tagClass: 3, tagNumber: 0 }, // [0] EXPLICIT
    value: [new asn1js.Integer({ value: 2 })],
  });

  // serialNumber
  const serial = new asn1js.Integer({
    valueHex: copyBuf(p.serialNumber),
  });

  // signature AlgorithmIdentifier (parameters ABSENT)
  const sigAlg = makeAlgId(p.signatureAlgorithmOID);

  // issuer = subject (self-signed)
  const issuerName = makeX500Name(p.subject);
  const subjectName = makeX500Name(p.subject);

  // validity
  const validity = new asn1js.Sequence({
    value: [
      new asn1js.UTCTime({ valueDate: now }),
      new asn1js.UTCTime({ valueDate: notAfter }),
    ],
  });

  // SubjectPublicKeyInfo (raw ASN.1 — pkijs.PublicKeyInfo 사용 안 함)
  const spki = new asn1js.Sequence({
    value: [
      makeAlgId(p.publicKeyOID),
      new asn1js.BitString({
        valueHex: copyBuf(p.publicKeyBytes),
        unusedBits: 0,
      }),
    ],
  });

  // Extensions [3] EXPLICIT
  const extensions = new asn1js.Constructed({
    idBlock: { tagClass: 3, tagNumber: 3 }, // [3] EXPLICIT
    value: [
      new asn1js.Sequence({
        value: [
          // keyUsage (critical)
          makeExtension(OID_KEY_USAGE, true, p.keyUsageDer),
          // basicConstraints (CA:FALSE)
          makeExtension(OID_BASIC_CONSTRAINTS, false,
            new Uint8Array(new asn1js.Sequence({ value: [] }).toBER())),
          // SKI
          makeSkiExtension(p.publicKeyBytes),
        ],
      }),
    ],
  });

  return new asn1js.Sequence({
    value: [version, serial, sigAlg, issuerName, validity, subjectName, spki, extensions],
  });
}

// ─── 서명된 인증서 조립 ────────────────────────────────

/**
 * Certificate ::= SEQUENCE {
 *   tbsCertificate     TBSCertificate,
 *   signatureAlgorithm AlgorithmIdentifier,
 *   signatureValue     BIT STRING
 * }
 */
function buildSignedCert(tbs: asn1js.Sequence, sigAlgOID: string, sig: Uint8Array): string {
  const cert = new asn1js.Sequence({
    value: [
      tbs,
      makeAlgId(sigAlgOID),
      new asn1js.BitString({
        valueHex: copyBuf(sig),
        unusedBits: 0,
      }),
    ],
  });

  const der = new Uint8Array(cert.toBER());
  return derToPem(der, 'CERTIFICATE');
}

// ─── 헬퍼 ──────────────────────────────────────────────

/** AlgorithmIdentifier — parameters ABSENT */
function makeAlgId(oid: string): asn1js.Sequence {
  return new asn1js.Sequence({
    value: [new asn1js.ObjectIdentifier({ value: oid })],
  });
}

/** X.500 Name (RDNSequence) */
function makeX500Name(s: PqcSubject): asn1js.Sequence {
  const rdns: asn1js.Set[] = [];

  rdns.push(new asn1js.Set({
    value: [new asn1js.Sequence({
      value: [
        new asn1js.ObjectIdentifier({ value: OID_COMMON_NAME }),
        new asn1js.Utf8String({ value: s.commonName }),
      ],
    })],
  }));

  if (s.email) {
    rdns.push(new asn1js.Set({
      value: [new asn1js.Sequence({
        value: [
          new asn1js.ObjectIdentifier({ value: OID_EMAIL_ADDRESS }),
          new asn1js.IA5String({ value: s.email }),
        ],
      })],
    }));
  }

  return new asn1js.Sequence({ value: rdns });
}

/** X.509 Extension wrapper */
function makeExtension(oid: string, critical: boolean, valueDer: Uint8Array): asn1js.Sequence {
  const items: asn1js.AsnType[] = [
    new asn1js.ObjectIdentifier({ value: oid }),
  ];
  if (critical) {
    items.push(new asn1js.Boolean({ value: true }));
  }
  items.push(new asn1js.OctetString({ valueHex: copyBuf(valueDer) }));
  return new asn1js.Sequence({ value: items });
}

/** Subject Key Identifier extension */
function makeSkiExtension(pubKey: Uint8Array): asn1js.Sequence {
  const hash = sha256(pubKey);
  const ski20 = hash.slice(0, 20);
  // SKI extnValue = OCTET STRING { OCTET STRING { 20 bytes } }
  const inner = new asn1js.OctetString({ valueHex: copyBuf(ski20) });
  const outerDer = new Uint8Array(inner.toBER());
  return makeExtension(OID_SUBJECT_KEY_ID, false, outerDer);
}

function randomSerial(): Uint8Array {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[0] = bytes[0] & 0x7F; // 양수 보장
  return bytes;
}

/** DER → PEM (8KB chunk 방식) */
function derToPem(der: Uint8Array, label: string): string {
  const chunks: string[] = [];
  for (let i = 0; i < der.length; i += 8192) {
    chunks.push(String.fromCharCode(...der.subarray(i, i + 8192)));
  }
  const b64 = btoa(chunks.join(''));
  const lines = b64.match(/.{1,64}/g)!.join('\n');
  return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----\n`;
}

/** Uint8Array → ArrayBuffer 복사 */
function copyBuf(data: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(data.length);
  copy.set(data);
  return copy.buffer as ArrayBuffer;
}
