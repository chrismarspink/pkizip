# Claude Code 지시문: ML-KEM / ML-DSA 표준 X.509 인증서 + 개인키 + CMS 완전 구현

> **대상 파일**
> - `src/lib/crypto/pqc-oids.ts`        ← [신규] OID 상수
> - `src/lib/crypto/pqc-keys.ts`        ← [신규] 개인키 PEM 인코딩/디코딩
> - `src/lib/crypto/pqc-cert.ts`        ← [신규] X.509 인증서 생성/파싱
> - `src/lib/crypto/pqc-cms.ts`         ← [신규] CMS EnvelopedData/SignedData
> - `src/lib/pqc/pqc-bundle.js`         ← [수정] 커스텀 포맷 → 표준 PEM 교체
>
> **의존성**: `pkijs` 3.x, `asn1js` 3.x, `@noble/post-quantum` 0.2 (모두 기존)
> **추가 의존성 없음**

---

## 0. 절대 규칙

```
[MUST]  기존 P-256 ECDSA certificate.ts 함수는 건드리지 않는다
[MUST]  pkijs + asn1js 로만 구현 — 라이브러리 추가 금지
[MUST]  결과 PEM은 openssl x509 -text 로 파싱 가능해야 한다
[MUST]  개인키 PEM은 openssl pkey -text 로 파싱 가능해야 한다
[MUST]  RFC 9935 (ML-KEM), RFC 9881 (ML-DSA), RFC 9936 (CMS ML-KEM) 준거
[MUST]  개인키는 seed 형식으로 저장 (64B for ML-KEM, 32B for ML-DSA)
[MUST]  parameters 필드 ABSENT (ML-KEM/ML-DSA 모두)
[MUST]  ML-KEM keyUsage: keyEncipherment ONLY (critical)
[MUST]  ML-DSA keyUsage: digitalSignature + nonRepudiation (critical)
[SKIP]  CA 체인 불필요 — 자가 서명만
[SKIP]  CRL / OCSP 불필요
```

---

## 1. 개인키 형식 완전 정리 (구현 전 필독)

### 1-1. PEM 헤더

```
ML-KEM 개인키:  -----BEGIN PRIVATE KEY-----  /  -----END PRIVATE KEY-----
ML-DSA 개인키:  -----BEGIN PRIVATE KEY-----  /  -----END PRIVATE KEY-----
ML-KEM 공개키:  -----BEGIN PUBLIC KEY-----   /  -----END PUBLIC KEY-----
ML-DSA 공개키:  -----BEGIN PUBLIC KEY-----   /  -----END PUBLIC KEY-----
인증서:         -----BEGIN CERTIFICATE-----  /  -----END CERTIFICATE-----
```

RSA의 `-----BEGIN RSA PRIVATE KEY-----` 와 다르다.
모두 PKCS#8 `-----BEGIN PRIVATE KEY-----` 를 사용한다.

### 1-2. ML-KEM 개인키 PKCS#8 구조 (RFC 9935 §6)

```asn1
OneAsymmetricKey ::= SEQUENCE {
  version             INTEGER (0),
  privateKeyAlgorithm SEQUENCE {
    algorithm  OID 2.16.840.1.101.3.4.4.3   -- id-alg-ml-kem-1024
    -- parameters: ABSENT --
  },
  privateKey  OCTET STRING {
    -- 내부에 CHOICE DER 인코딩 포함 --
    ML-KEM-1024-PrivateKey ::= CHOICE {
      seed        [0] OCTET STRING (SIZE (64))    -- 태그 0x80, 권장
      expandedKey     OCTET STRING (SIZE (3168))   -- 태그 0x04
      both        SEQUENCE { seed, expandedKey }   -- 태그 0x30
    }
  },
  [1] publicKey BIT STRING OPTIONAL          -- 공개키 포함 가능
}
```

**크기 비교 (ML-KEM-1024):**

| 형식 | 내부 크기 | PEM 줄 수 | RFC 권장 |
|------|----------|-----------|---------|
| seed | 64B | ~5줄 | ✅ 권장 |
| expandedKey | 3,168B | ~70줄 | 호환용 |
| both | 3,234B | ~72줄 | 검증 포함 |

**pkizip은 seed 형식 사용** — 니모닉에서 결정론적으로 재생성 가능하므로 저장 크기 최소화.

### 1-3. ML-DSA 개인키 PKCS#8 구조 (RFC 9881 §6)

```asn1
OneAsymmetricKey ::= SEQUENCE {
  version             INTEGER (0),
  privateKeyAlgorithm SEQUENCE {
    algorithm  OID 2.16.840.1.101.3.4.3.19   -- id-ml-dsa-87
    -- parameters: ABSENT --
  },
  privateKey  OCTET STRING {
    ML-DSA-87-PrivateKey ::= CHOICE {
      seed        [0] OCTET STRING (SIZE (32))    -- 태그 0x80, 권장
      expandedKey     OCTET STRING (SIZE (4896))   -- 태그 0x04
      both        SEQUENCE { seed, expandedKey }   -- 태그 0x30
    }
  }
}
```

**크기 비교 (ML-DSA-87):**

| 형식 | 내부 크기 | PEM 줄 수 | RFC 권장 |
|------|----------|-----------|---------|
| seed | 32B | ~3줄 | ✅ 권장 |
| expandedKey | 4,896B | ~109줄 | 호환용 |

### 1-4. 태그 파싱 규칙 (RFC 9881 §6, RFC 9935 §6)

```
privateKey OCTET STRING 내부를 파싱할 때:
  첫 바이트 0x80  →  seed 형식
  첫 바이트 0x04  →  expandedKey 형식
  첫 바이트 0x30  →  both 형식 (SEQUENCE)
```

### 1-5. seed → 확장키 재생성

```typescript
// ML-KEM: seed(64B) = d(32B) || z(32B)
const { publicKey, secretKey } = ml_kem1024.keygen(seed.slice(0,32), seed.slice(32,64))

// ML-DSA: seed(32B) 직접 사용
const { publicKey, secretKey } = ml_dsa87.keygen(seed)
```

---

## 2. pqc-oids.ts

```typescript
// src/lib/crypto/pqc-oids.ts

export const OID_ML_KEM_512  = '2.16.840.1.101.3.4.4.1'
export const OID_ML_KEM_768  = '2.16.840.1.101.3.4.4.2'
export const OID_ML_KEM_1024 = '2.16.840.1.101.3.4.4.3'

export const OID_ML_DSA_44   = '2.16.840.1.101.3.4.3.17'
export const OID_ML_DSA_65   = '2.16.840.1.101.3.4.3.18'
export const OID_ML_DSA_87   = '2.16.840.1.101.3.4.3.19'

// X.509 Extensions
export const OID_KEY_USAGE           = '2.5.29.15'
export const OID_BASIC_CONSTRAINTS   = '2.5.29.19'
export const OID_SUBJECT_KEY_ID      = '2.5.29.14'

// X.520 AttributeType
export const OID_COMMON_NAME         = '2.5.4.3'
export const OID_EMAIL_ADDRESS       = '1.2.840.113549.1.9.1'
export const OID_ORGANIZATION        = '2.5.4.10'

// CMS (RFC 5652)
export const OID_DATA                = '1.2.840.113549.1.7.1'
export const OID_SIGNED_DATA         = '1.2.840.113549.1.7.2'
export const OID_ENVELOPED_DATA      = '1.2.840.113549.1.7.3'

// CMS ML-KEM KEM (RFC 9936)
export const OID_ML_KEM_RECIPIENT    = '2.16.840.1.101.3.4.4.3'

// AES-256-GCM
export const OID_AES_256_GCM         = '2.16.840.1.101.3.4.1.46'
```

---

## 3. pqc-keys.ts — 개인키 PEM 인코딩/디코딩

### 3-1. encodeSeedPrivateKey() — seed → PKCS#8 PEM

```typescript
import * as asn1js from 'asn1js'
import { OID_ML_KEM_1024, OID_ML_DSA_87 } from './pqc-oids'

/**
 * ML-KEM 또는 ML-DSA seed를 RFC 9935/9881 준거 PKCS#8 PEM으로 인코딩.
 *
 * PKCS#8 구조:
 *   SEQUENCE {
 *     INTEGER 0                          -- version
 *     SEQUENCE { OID }                   -- privateKeyAlgorithm (parameters ABSENT)
 *     OCTET STRING {                     -- privateKey
 *       [0] seed bytes                   -- 태그 0x80 (seed CHOICE)
 *     }
 *   }
 *
 * @param seed  ML-KEM: 64B, ML-DSA: 32B
 * @param alg   'ml-kem-1024' | 'ml-dsa-87'
 */
export function encodeSeedPrivateKey(
  seed: Uint8Array,
  alg: 'ml-kem-1024' | 'ml-dsa-87'
): string {

  const oid = alg === 'ml-kem-1024' ? OID_ML_KEM_1024 : OID_ML_DSA_87

  // seed CHOICE: [0] IMPLICIT OCTET STRING
  // 태그 0x80 | 길이 | seed bytes
  const seedTagged = new Uint8Array([0x80, seed.length, ...seed])

  // OCTET STRING 래핑 (privateKey 필드)
  const privateKeyOctet = new asn1js.OctetString({
    valueHex: seedTagged.buffer as ArrayBuffer
  })

  // AlgorithmIdentifier (parameters ABSENT)
  const algId = new asn1js.Sequence({
    value: [new asn1js.ObjectIdentifier({ value: oid })]
    // parameters 없음 — RFC 9935/9881 준수
  })

  // OneAsymmetricKey (PKCS#8)
  const pkcs8 = new asn1js.Sequence({
    value: [
      new asn1js.Integer({ value: 0 }),   // version
      algId,
      privateKeyOctet,
    ]
  })

  const der   = pkcs8.toBER()
  const b64   = btoa(String.fromCharCode(...new Uint8Array(der)))
  const lines = b64.match(/.{1,64}/g)!.join('\n')
  return `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----\n`
}

/**
 * PKCS#8 PEM에서 seed를 추출한다.
 *
 * 지원 형식: seed / expandedKey / both
 * 태그 기반 파싱 (RFC 9881 §6):
 *   0x80 → seed
 *   0x04 → expandedKey (seed 없음, expandedKey 반환)
 *   0x30 → both (seed 추출)
 */
export function decodeSeedPrivateKey(pem: string): {
  seed?:        Uint8Array
  expandedKey?: Uint8Array
  algorithm:    string
} {
  const b64 = pem.replace(/-----[^-]+-----|[\n\r]/g, '')
  const der  = Uint8Array.from(atob(b64), c => c.charCodeAt(0))

  const asn1   = asn1js.fromBER(der.buffer as ArrayBuffer)
  const seq    = asn1.result as asn1js.Sequence
  const algSeq = seq.valueBlock.value[1] as asn1js.Sequence
  const oid    = (algSeq.valueBlock.value[0] as asn1js.ObjectIdentifier).valueBlock.toString()

  const privKeyOctet = (seq.valueBlock.value[2] as asn1js.OctetString)
    .valueBlock.valueHexView

  // 내부 CHOICE 파싱
  const tag = privKeyOctet[0]

  if (tag === 0x80) {
    // seed 형식: 0x80 | len | bytes
    const len  = privKeyOctet[1]
    const seed = privKeyOctet.slice(2, 2 + len)
    return { seed: new Uint8Array(seed), algorithm: oid }
  }

  if (tag === 0x04) {
    // expandedKey 형식: OCTET STRING | len | bytes
    const innerAsn1 = asn1js.fromBER(privKeyOctet.buffer)
    const expandedKey = (innerAsn1.result as asn1js.OctetString)
      .valueBlock.valueHexView
    return { expandedKey: new Uint8Array(expandedKey), algorithm: oid }
  }

  if (tag === 0x30) {
    // both 형식: SEQUENCE { seed, expandedKey }
    const innerAsn1 = asn1js.fromBER(privKeyOctet.buffer)
    const bothSeq   = innerAsn1.result as asn1js.Sequence
    // seed는 첫 번째 [0] tagged
    const seedItem  = bothSeq.valueBlock.value[0] as asn1js.Primitive
    const seed      = new Uint8Array(seedItem.valueBlock.valueHexView)
    return { seed, algorithm: oid }
  }

  throw new Error(`알 수 없는 개인키 CHOICE 태그: 0x${tag.toString(16)}`)
}
```

### 3-2. encodePublicKey() — 공개키 SubjectPublicKeyInfo PEM

```typescript
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

  const oid = alg === 'ml-kem-1024' ? OID_ML_KEM_1024 : OID_ML_DSA_87

  const spki = new asn1js.Sequence({
    value: [
      new asn1js.Sequence({
        value: [new asn1js.ObjectIdentifier({ value: oid })]
      }),
      new asn1js.BitString({
        valueHex: publicKey.buffer as ArrayBuffer,
        unusedBits: 0,
      }),
    ]
  })

  const der   = spki.toBER()
  const b64   = btoa(String.fromCharCode(...new Uint8Array(der)))
  const lines = b64.match(/.{1,64}/g)!.join('\n')
  return `-----BEGIN PUBLIC KEY-----\n${lines}\n-----END PUBLIC KEY-----\n`
}
```

---

## 4. pqc-cert.ts — X.509 인증서 생성

### 4-1. buildMlKemCertificate()

```typescript
import * as pkijs  from 'pkijs'
import * as asn1js from 'asn1js'
import { ml_dsa87 }  from '@noble/post-quantum/ml-dsa'
import { sha256 }    from '@noble/hashes/sha2'
import * as OID from './pqc-oids'

export interface PqcSubject {
  commonName:    string
  email?:        string
  organization?: string
}

/**
 * RFC 9935 준거 ML-KEM-1024 X.509 자가 서명 인증서.
 *
 * - ML-KEM은 서명 불가 → ML-DSA-87 키로 서명
 * - keyUsage: keyEncipherment ONLY (critical)
 * - parameters: ABSENT
 *
 * @returns PEM 인증서 문자열
 */
export async function buildMlKemCertificate(p: {
  kemPublicKey:  Uint8Array   // 1568B
  dsaPrivateKey: Uint8Array   // 4896B (서명용, expanded key 필요)
  subject:       PqcSubject
  validityDays?: number
}): Promise<string> {

  const cert = new pkijs.Certificate()
  cert.version = 2

  // serialNumber: 16B 랜덤
  cert.serialNumber = new asn1js.Integer({
    valueHex: crypto.getRandomValues(new Uint8Array(16)).buffer as ArrayBuffer
  })

  // validity
  const now = new Date()
  cert.notBefore.value = now
  cert.notAfter.value  = new Date(now.getTime() + (p.validityDays ?? 3650) * 86400_000)

  // subject = issuer (자가 서명)
  const name = buildX500Name(p.subject)
  cert.subject = name
  cert.issuer  = name

  // SubjectPublicKeyInfo
  // algorithm.parameters ABSENT — RFC 9935 §4 명시
  cert.subjectPublicKeyInfo = new pkijs.PublicKeyInfo()
  cert.subjectPublicKeyInfo.algorithm = new pkijs.AlgorithmIdentifier({
    algorithmId: OID.OID_ML_KEM_1024,
    // algorithmParams 없음
  })
  cert.subjectPublicKeyInfo.subjectPublicKey = new asn1js.BitString({
    valueHex:   p.kemPublicKey.buffer as ArrayBuffer,
    unusedBits: 0,
  })

  // keyUsage: keyEncipherment (bit 2) ONLY — critical
  // DER raw: 03 02 05 20
  //   03 = BIT STRING tag
  //   02 = 2 bytes
  //   05 = 5 unused bits
  //   20 = 0010_0000 → bit2 = keyEncipherment
  cert.extensions = [
    makeKeyUsageExt([0x03, 0x02, 0x05, 0x20]),
    makeBasicConstraintsExt(),
    await makeSkiExt(p.kemPublicKey),
  ]

  // signatureAlgorithm: ML-DSA-87, parameters ABSENT
  cert.signatureAlgorithm = new pkijs.AlgorithmIdentifier({
    algorithmId: OID.OID_ML_DSA_87,
  })

  // TBSCertificate DER → ML-DSA-87 서명
  // cert.sign() 사용 불가 — SubtleCrypto 미지원 알고리즘
  const tbsDer = new Uint8Array(cert.encodeTBS().toBER())
  const sig    = ml_dsa87.sign(p.dsaPrivateKey, tbsDer)

  cert.signatureValue = new asn1js.BitString({
    valueHex:   sig.buffer as ArrayBuffer,
    unusedBits: 0,
  })

  return derToPem(new Uint8Array(cert.toSchema().toBER()), 'CERTIFICATE')
}

/**
 * RFC 9881 준거 ML-DSA-87 X.509 자가 서명 인증서.
 *
 * - 자가 서명 (ML-DSA 키로 직접 서명)
 * - keyUsage: digitalSignature + nonRepudiation (critical)
 */
export async function buildMlDsaCertificate(p: {
  dsaPublicKey:  Uint8Array   // 2592B
  dsaPrivateKey: Uint8Array   // 4896B (expanded key)
  subject:       PqcSubject
  validityDays?: number
}): Promise<string> {

  const cert = new pkijs.Certificate()
  cert.version = 2

  cert.serialNumber = new asn1js.Integer({
    valueHex: crypto.getRandomValues(new Uint8Array(16)).buffer as ArrayBuffer
  })

  const now = new Date()
  cert.notBefore.value = now
  cert.notAfter.value  = new Date(now.getTime() + (p.validityDays ?? 3650) * 86400_000)

  const name = buildX500Name(p.subject)
  cert.subject = name
  cert.issuer  = name

  cert.subjectPublicKeyInfo = new pkijs.PublicKeyInfo()
  cert.subjectPublicKeyInfo.algorithm = new pkijs.AlgorithmIdentifier({
    algorithmId: OID.OID_ML_DSA_87,
    // parameters ABSENT
  })
  cert.subjectPublicKeyInfo.subjectPublicKey = new asn1js.BitString({
    valueHex:   p.dsaPublicKey.buffer as ArrayBuffer,
    unusedBits: 0,
  })

  // keyUsage: digitalSignature(bit0) + nonRepudiation(bit1) — critical
  // DER raw: 03 02 06 C0
  //   06 = 6 unused bits
  //   C0 = 1100_0000 → bit0=digitalSignature, bit1=nonRepudiation
  cert.extensions = [
    makeKeyUsageExt([0x03, 0x02, 0x06, 0xC0]),
    makeBasicConstraintsExt(),
    await makeSkiExt(p.dsaPublicKey),
  ]

  cert.signatureAlgorithm = new pkijs.AlgorithmIdentifier({
    algorithmId: OID.OID_ML_DSA_87,
  })

  const tbsDer = new Uint8Array(cert.encodeTBS().toBER())
  const sig    = ml_dsa87.sign(p.dsaPrivateKey, tbsDer)

  cert.signatureValue = new asn1js.BitString({
    valueHex:   sig.buffer as ArrayBuffer,
    unusedBits: 0,
  })

  return derToPem(new Uint8Array(cert.toSchema().toBER()), 'CERTIFICATE')
}

// ─── 내부 헬퍼 ────────────────────────────────────────────────────

function buildX500Name(s: PqcSubject): pkijs.RelativeDistinguishedNames {
  const attrs: pkijs.AttributeTypeAndValue[] = []
  if (s.commonName)
    attrs.push(new pkijs.AttributeTypeAndValue({
      type: OID.OID_COMMON_NAME,
      value: new asn1js.Utf8String({ value: s.commonName }),
    }))
  if (s.email)
    attrs.push(new pkijs.AttributeTypeAndValue({
      type: OID.OID_EMAIL_ADDRESS,
      value: new asn1js.Utf8String({ value: s.email }),
    }))
  if (s.organization)
    attrs.push(new pkijs.AttributeTypeAndValue({
      type: OID.OID_ORGANIZATION,
      value: new asn1js.Utf8String({ value: s.organization }),
    }))
  return new pkijs.RelativeDistinguishedNames({ typesAndValues: attrs })
}

function makeKeyUsageExt(rawDer: number[]): pkijs.Extension {
  return new pkijs.Extension({
    extnID:   OID.OID_KEY_USAGE,
    critical: true,
    extnValue: new asn1js.OctetString({
      valueHex: new Uint8Array(rawDer).buffer as ArrayBuffer
    }),
  })
}

function makeBasicConstraintsExt(): pkijs.Extension {
  const seq = new asn1js.Sequence({ value: [] })
  return new pkijs.Extension({
    extnID:   OID.OID_BASIC_CONSTRAINTS,
    critical: false,
    extnValue: new asn1js.OctetString({
      valueHex: seq.toBER()
    }),
  })
}

async function makeSkiExt(pubKey: Uint8Array): Promise<pkijs.Extension> {
  const hash  = sha256(pubKey)
  const ski20 = hash.slice(0, 20)
  const inner = new asn1js.OctetString({ valueHex: ski20.buffer as ArrayBuffer })
  return new pkijs.Extension({
    extnID:   OID.OID_SUBJECT_KEY_ID,
    critical: false,
    extnValue: new asn1js.OctetString({ valueHex: inner.toBER() }),
  })
}

function derToPem(der: Uint8Array, label: string): string {
  const b64   = btoa(String.fromCharCode(...der))
  const lines = b64.match(/.{1,64}/g)!.join('\n')
  return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----\n`
}
```

---

## 5. pqc-cms.ts — CMS EnvelopedData / SignedData

### 5-1. CMS ML-KEM EnvelopedData (RFC 9936)

```typescript
import { ml_kem1024 } from '@noble/post-quantum/ml-kem'
import { ml_dsa87   } from '@noble/post-quantum/ml-dsa'
import { hkdf       } from '@noble/hashes/hkdf'
import { sha3_512   } from '@noble/hashes/sha3'
import { sha256     } from '@noble/hashes/sha2'

/**
 * RFC 9936 준거 CMS EnvelopedData 생성.
 *
 * 구조:
 *   ContentInfo {
 *     contentType: id-envelopedData
 *     content: EnvelopedData {
 *       version: 2
 *       recipientInfos: [
 *         KEMRecipientInfo {           ← RFC 9936 §3
 *           version: 0
 *           rid: { kemKeyId: sha256(encapKey) }
 *           kem: { id-alg-ml-kem-1024 }
 *           kemct: ML-KEM ciphertext (1568B)
 *           kdf: id-alg-hkdf-with-sha3-512
 *           kekLength: 32
 *           ukm: [optional]
 *           wrap: id-aes256-wrap
 *           encryptedKey: AES-256-WRAP(CEK)
 *         }
 *       ]
 *       encryptedContentInfo: {
 *         contentEncryptionAlgorithm: id-aes256-GCM
 *         encryptedContent: AES-256-GCM(plaintext)
 *       }
 *     }
 *   }
 */
export async function encryptWithMlKem(p: {
  plaintext:    Uint8Array
  kemPublicKey: Uint8Array   // 수신자 공개키 1568B
}): Promise<{
  cmsData:       Uint8Array  // DER 인코딩된 ContentInfo
  kemCiphertext: Uint8Array  // 1568B (별도 저장용)
  iv:            Uint8Array  // 12B GCM nonce
  kemKeyId:      string      // hex — 수신자 식별용
}> {

  // 1. ML-KEM encapsulate → sharedSecret + ciphertext
  const { cipherText, sharedSecret } =
    ml_kem1024.encapsulate(p.kemPublicKey)

  // 2. HKDF-SHA3-512 → CEK 32B
  const cek = hkdf(
    sha3_512,
    sharedSecret,
    undefined,                     // salt: undefined
    new TextEncoder().encode('pkizip-kem-v1'),  // info
    32
  )

  // 3. AES-256-GCM 암호화
  const iv  = crypto.getRandomValues(new Uint8Array(12))
  const key = await crypto.subtle.importKey(
    'raw', cek, { name: 'AES-GCM' }, false, ['encrypt']
  )
  const encryptedContent = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, p.plaintext)
  )

  // 4. kemKeyId = SHA-256(kemPublicKey)[0..19] hex
  const kemKeyId = Array.from(sha256(p.kemPublicKey).slice(0, 20))
    .map(b => b.toString(16).padStart(2, '0')).join(':')

  // 5. CMS 구조 직렬화 (pkijs 사용)
  // ... pkijs EnvelopedData 조립
  // (전체 CMS DER 직렬화는 pkijs EnvelopedData API 사용)

  return {
    cmsData: encryptedContent,  // 실제 구현 시 전체 CMS DER
    kemCiphertext: cipherText,
    iv,
    kemKeyId,
  }
}

/**
 * ML-KEM CMS EnvelopedData 복호화.
 *
 * @param kemCiphertext  1568B ML-KEM 암호문
 * @param kemSecretKey   수신자 개인키 (3168B expanded 또는 seed에서 재생성)
 * @param encryptedContent  AES-GCM 암호문
 * @param iv             12B GCM nonce
 */
export async function decryptWithMlKem(p: {
  kemCiphertext:    Uint8Array  // 1568B
  kemSecretKey:     Uint8Array  // 3168B
  encryptedContent: Uint8Array
  iv:               Uint8Array  // 12B
}): Promise<Uint8Array> {

  // 1. ML-KEM decapsulate → sharedSecret
  const sharedSecret = ml_kem1024.decapsulate(p.kemCiphertext, p.kemSecretKey)

  // 2. HKDF → CEK
  const cek = hkdf(
    sha3_512,
    sharedSecret,
    undefined,
    new TextEncoder().encode('pkizip-kem-v1'),
    32
  )

  // 3. AES-256-GCM 복호화
  const key = await crypto.subtle.importKey(
    'raw', cek, { name: 'AES-GCM' }, false, ['decrypt']
  )

  return new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: p.iv },
      key,
      p.encryptedContent
    )
  )
}

/**
 * ML-DSA-87 CMS SignedData 서명 (RFC 9882).
 *
 * @param content      서명할 원본 데이터
 * @param dsaPrivKey   ML-DSA-87 서명 개인키 4896B (expanded)
 * @returns signature  4627B
 */
export function signWithMlDsa(
  content:    Uint8Array,
  dsaPrivKey: Uint8Array
): Uint8Array {
  return ml_dsa87.sign(dsaPrivKey, content)
}

/**
 * ML-DSA-87 서명 검증.
 *
 * @param content    원본 데이터
 * @param signature  4627B
 * @param dsaPubKey  2592B
 * @returns boolean
 */
export function verifyMlDsa(
  content:    Uint8Array,
  signature:  Uint8Array,
  dsaPubKey:  Uint8Array
): boolean {
  return ml_dsa87.verify(dsaPubKey, content, signature)
}
```

---

## 6. pqc-bundle.js 수정 — 커스텀 포맷 제거

### 기존 코드 제거

```javascript
// [제거] 커스텀 포맷 생성 코드
// buildPkizipCustomCert(), -----PKIZIP-CERT-*----- 전부 제거
```

### 신규 코드

```javascript
import {
  buildMlKemCertificate,
  buildMlDsaCertificate
} from '../crypto/pqc-cert'
import {
  encodeSeedPrivateKey,
  encodePublicKey,
  decodeSeedPrivateKey
} from '../crypto/pqc-keys'

// 번들 생성 시
async function createBundle(opts) {
  const { kemKeyPair, dsaKeyPair, subject, validity } = opts

  // 인증서 생성
  const kemCertPem = await buildMlKemCertificate({
    kemPublicKey:  kemKeyPair.publicKey,    // 1568B
    dsaPrivateKey: dsaKeyPair.secretKey,   // 4896B expanded
    subject,
    validityDays: validity,
  })

  const dsaCertPem = await buildMlDsaCertificate({
    dsaPublicKey:  dsaKeyPair.publicKey,   // 2592B
    dsaPrivateKey: dsaKeyPair.secretKey,   // 4896B expanded
    subject,
    validityDays: validity,
  })

  // 개인키 PEM (seed 형식)
  // kem seed = HD 도출 시 privKey(32B) || chainCode(32B)
  const kemPrivPem = encodeSeedPrivateKey(kemKeyPair.seed,  'ml-kem-1024')
  const dsaPrivPem = encodeSeedPrivateKey(dsaKeyPair.seed,  'ml-dsa-87')

  // 공개키 PEM
  const kemPubPem  = encodePublicKey(kemKeyPair.publicKey, 'ml-kem-1024')
  const dsaPubPem  = encodePublicKey(dsaKeyPair.publicKey, 'ml-dsa-87')

  return {
    certificates: {
      kem: kemCertPem,    // -----BEGIN CERTIFICATE-----
      dsa: dsaCertPem,
    },
    privateKeys: {
      kem: kemPrivPem,    // -----BEGIN PRIVATE KEY----- (seed 64B)
      dsa: dsaPrivPem,    // -----BEGIN PRIVATE KEY----- (seed 32B)
    },
    publicKeys: {
      kem: kemPubPem,     // -----BEGIN PUBLIC KEY-----
      dsa: dsaPubPem,
    },
  }
}

// 번들 복원 시 (seed → expanded key 재생성)
function restoreKeysFromSeed(kemPrivPem, dsaPrivPem) {
  const { seed: kemSeed } = decodeSeedPrivateKey(kemPrivPem)
  const { seed: dsaSeed } = decodeSeedPrivateKey(dsaPrivPem)

  // ML-KEM: seed(64B) = d(32B) || z(32B)
  const kemKeys = ml_kem1024.keygen(kemSeed.slice(0,32), kemSeed.slice(32,64))

  // ML-DSA: seed(32B) 직접
  const dsaKeys = ml_dsa87.keygen(dsaSeed)

  return { kemKeys, dsaKeys }
}
```

---

## 7. 개인키 저장/내보내기 흐름

```
니모닉 + 패스워드
    │
    ▼ BIP32 HD 도출
    │
    ├─ KEM seed (64B) ─→ encodeSeedPrivateKey() ─→ PEM
    │                                               │
    │                                               ├─ AES-256-GCM 암호화 (IndexedDB 저장)
    │                                               └─ 내보내기 시 복호화 후 PEM 제공
    │
    └─ DSA seed (32B) ─→ encodeSeedPrivateKey() ─→ PEM
                                                    │
                                                    ├─ AES-256-GCM 암호화 (IndexedDB 저장)
                                                    └─ 내보내기 시 복호화 후 PEM 제공

내보내기 옵션:
  1. seed PEM     — 가장 작음, 64B/32B, openssl 파싱 가능
  2. expanded PEM — 호환성 최대, 3168B/4896B
  3. PKCS#12 (.p12) — 인증서 + 개인키 번들, 향후 구현
```

---

## 8. 구현 완료 체크리스트

```
[ ] pqc-oids.ts
    [ ] ML-KEM/DSA OID 전체
    [ ] Extension OID
    [ ] CMS OID

[ ] pqc-keys.ts
    [ ] encodeSeedPrivateKey() → -----BEGIN PRIVATE KEY-----
        [ ] seed 태그 0x80 올바른 ASN.1 인코딩
        [ ] AlgorithmIdentifier parameters ABSENT
        [ ] PEM 64자 줄바꿈
    [ ] decodeSeedPrivateKey()
        [ ] 0x80 (seed) 파싱
        [ ] 0x04 (expandedKey) 파싱
        [ ] 0x30 (both) 파싱
    [ ] encodePublicKey() → -----BEGIN PUBLIC KEY-----
        [ ] BitString unusedBits=0
        [ ] parameters ABSENT

[ ] pqc-cert.ts
    [ ] buildMlKemCertificate()
        [ ] version=2 (v3)
        [ ] serialNumber 랜덤 16B
        [ ] notBefore/notAfter
        [ ] subject=issuer (자가 서명)
        [ ] SubjectPublicKeyInfo: OID_ML_KEM_1024, parameters ABSENT
        [ ] subjectPublicKey: raw 1568B, unusedBits=0
        [ ] keyUsage: keyEncipherment ONLY, critical
        [ ] basicConstraints: CA:FALSE
        [ ] SKI: SHA-256(pubKey)[0..19]
        [ ] signatureAlgorithm: OID_ML_DSA_87, parameters ABSENT
        [ ] TBSCertificate DER → ml_dsa87.sign()
        [ ] signatureValue: unusedBits=0
        [ ] PEM 출력
    [ ] buildMlDsaCertificate()
        [ ] keyUsage: digitalSignature + nonRepudiation
        [ ] 자가 서명
    [ ] parsePemCertificate() — 검증용
        [ ] OID 추출
        [ ] keyUsage 추출
        [ ] 파싱 실패 → null

[ ] pqc-cms.ts
    [ ] encryptWithMlKem()
        [ ] ml_kem1024.encapsulate()
        [ ] HKDF-SHA3-512 → CEK 32B
        [ ] AES-256-GCM 암호화
        [ ] kemKeyId = SHA-256(pubKey) hex
    [ ] decryptWithMlKem()
        [ ] ml_kem1024.decapsulate()
        [ ] HKDF → CEK
        [ ] AES-256-GCM 복호화
    [ ] signWithMlDsa() — ml_dsa87.sign()
    [ ] verifyMlDsa()   — ml_dsa87.verify()

[ ] pqc-bundle.js 수정
    [ ] 커스텀 PKIZIP-CERT 포맷 완전 제거
    [ ] buildMlKemCertificate / buildMlDsaCertificate 호출
    [ ] encodeSeedPrivateKey 호출
    [ ] restoreKeysFromSeed 구현

[ ] 검증
    [ ] openssl x509 -text -in kem.pem → id-alg-ml-kem-1024 확인
    [ ] openssl x509 -text -in dsa.pem → id-ml-dsa-87 확인
    [ ] openssl pkey -text -in kem-priv.pem → 파싱 성공 확인
    [ ] keyUsage 정확성 (KEM: keyEncipherment, DSA: digitalSignature+nonRepudiation)
    [ ] CMS encrypt → decrypt 왕복 일치
    [ ] DSA sign → verify 성공
    [ ] 잘못된 키로 verify → false
```

---

## 9. 주의사항 — 구현 함정

```
[주의1]  cert.sign() 사용 금지
         pkijs.Certificate.sign()은 내부적으로 SubtleCrypto.sign() 호출
         ML-DSA는 Web Crypto API 미지원 → 직접 ml_dsa87.sign() 후 삽입

[주의2]  parameters ABSENT ≠ parameters: null
         AlgorithmIdentifier 객체에 algorithmParams 키 자체를 생략
         undefined 할당도 안 됨 — pkijs가 OPTIONAL로 처리

[주의3]  BitString unusedBits: 0 반드시 명시
         생략 시 DER 패딩 오류 발생

[주의4]  seed vs expanded key
         ml_dsa87.sign()은 expanded key (4896B) 필요
         seed(32B) → ml_dsa87.keygen(seed) → secretKey(4896B) 먼저 재생성

[주의5]  ML-KEM encapsulate 입력
         ml_kem1024.encapsulate()는 publicKey (1568B) 필요 — secretKey 아님

[주의6]  AES-GCM 태그 포함
         crypto.subtle.encrypt AES-GCM 결과는 ciphertext + 16B auth tag 포함
         복호화 시 같은 크기 사용

[주의7]  Uint8Array.buffer 공유 주의
         slice()는 복사, subarray()는 공유
         .buffer as ArrayBuffer 전달 시 offset 불일치 발생 가능
         → new Uint8Array(data).buffer 로 복사 후 전달

[주의8]  keyUsage DER 직접 인코딩
         pkijs Extension에 keyUsage 값을 설정하는 고수준 API가 불안정
         raw DER 바이트 [0x03, 0x02, 0x05, 0x20] 직접 OctetString으로 삽입
```