# PKIZIP 표준·프로토콜 참조 문서

> 내부 참조용. 외부 공개 금지.
> 최종 갱신: 2026-04-18

---

## 1. CMS (Cryptographic Message Syntax)

### RFC 5652 — CMS 기본 구조

PKIZIP의 모든 보안 컨테이너는 CMS 구조를 기반으로 한다.

| ContentType | OID | PKIZIP 사용 |
|-------------|-----|------------|
| SignedData | 1.2.840.113549.1.7.2 | SignedMessage (서명) |
| EnvelopedData | 1.2.840.113549.1.7.3 | EnvelopedMessage (공개키 암호화) |
| EncryptedData | 1.2.840.113549.1.7.6 | EncryptedMessage (비밀번호 암호화) |
| CompressedData | 1.2.840.113549.1.9.16.1.9 | CompressedMessage (압축) |

### SignedData 구조 (RFC 5652 §5)

```asn1
SignedData ::= SEQUENCE {
    version           CMSVersion,
    digestAlgorithms  DigestAlgorithmIdentifiers,
    encapContentInfo  EncapsulatedContentInfo,
    certificates  [0] IMPLICIT CertificateSet OPTIONAL,
    crls          [1] IMPLICIT RevocationInfoChoices OPTIONAL,
    signerInfos       SignerInfos
}

SignerInfo ::= SEQUENCE {
    version                   CMSVersion,
    sid                       SignerIdentifier,
    digestAlgorithm           DigestAlgorithmIdentifier,
    signedAttrs           [0] IMPLICIT SignedAttributes OPTIONAL,
    signatureAlgorithm        SignatureAlgorithmIdentifier,
    signature                 SignatureValue,
    unsignedAttrs         [1] IMPLICIT UnsignedAttributes OPTIONAL
}
```

PKIZIP 적용:
- `digestAlgorithm`: SHA-256 (기존) / SHA3-512 (PQC)
- `signatureAlgorithm`: ECDSA P-256 (기존) / ML-DSA-87 (PQC)
- hybrid 모드: SignerInfo 2개 (ECDSA + ML-DSA) 병존

### EnvelopedData 구조 (RFC 5652 §6)

```asn1
EnvelopedData ::= SEQUENCE {
    version               CMSVersion,
    originatorInfo    [0] IMPLICIT OriginatorInfo OPTIONAL,
    recipientInfos        RecipientInfos,
    encryptedContentInfo  EncryptedContentInfo
}

RecipientInfo ::= CHOICE {
    ktri  KeyTransRecipientInfo,      -- RSA-OAEP
    kari  KeyAgreeRecipientInfo,      -- ECDH
    kekri KEKRecipientInfo,
    pwri  PasswordRecipientInfo,
    ori   OtherRecipientInfo          -- ML-KEM (RFC 9629)
}
```

PKIZIP 적용:
- `contentEncryptionAlgorithm`: AES-256-GCM
- CEK: 32바이트 랜덤 생성
- hybrid 모드: RecipientInfo 2개 (RSA/ECDH + ML-KEM) 동일 CEK

---

## 2. 양자 내성 암호 (Post-Quantum Cryptography)

### NIST FIPS 203 — ML-KEM (Module-Lattice Key Encapsulation Mechanism)

| 항목 | ML-KEM-1024 |
|------|-------------|
| 보안 레벨 | NIST Level 5 (AES-256 동등) |
| 공개키 크기 | 1,568 bytes |
| 비밀키 크기 | 3,168 bytes |
| 캡슐문 크기 | 1,568 bytes |
| 공유 비밀 | 32 bytes |
| 기반 문제 | M-LWE (Module Learning With Errors) |
| 확정 일자 | 2024년 8월 |

PKIZIP 사용:
- EnvelopedData의 CEK 보호 (수신자 공개키 암호화)
- EncryptedData의 CEK 보호 (직접 암호화)
- 키 파생: `HKDF-SHA3-512(sharedSecret, salt, "pqczip-kem-v3")` → AES-256 래핑키
- CEK를 AES-256-GCM으로 래핑

```
ml_kem1024.encapsulate(publicKey) → { cipherText(1568B), sharedSecret(32B) }
ml_kem1024.decapsulate(cipherText, secretKey) → sharedSecret(32B)
```

### NIST FIPS 204 — ML-DSA (Module-Lattice Digital Signature Algorithm)

| 항목 | ML-DSA-87 |
|------|-----------|
| 보안 레벨 | NIST Level 5 |
| 공개키 크기 | 2,592 bytes |
| 비밀키 크기 | 4,896 bytes |
| 서명 크기 | ~4,627 bytes |
| 기반 문제 | M-LWE + M-SIS |
| 확정 일자 | 2024년 8월 |

PKIZIP 사용:
- SignedData의 전자서명 (CMS SignerInfo)
- Detached 서명 (파일과 별도 저장)
- 서명 전 SHA3-512 다이제스트 생성

```
ml_dsa87.sign(message, secretKey) → signature(~4627B)
ml_dsa87.verify(signature, message, publicKey) → boolean
```

### RFC 9935 — ML-KEM X.509 인증서

ML-KEM 공개키를 X.509 인증서에 포함하는 표준.

```
SubjectPublicKeyInfo.algorithm = id-alg-ml-kem-1024
OID: 2.16.840.1.101.3.4.4.3
keyUsage: keyEncipherment (ONLY — digitalSignature 금지)
```

### RFC 9881 — ML-DSA X.509 인증서

ML-DSA 서명 키를 X.509 인증서에 포함하는 표준.

```
SubjectPublicKeyInfo.algorithm = id-ml-dsa-87
OID: 2.16.840.1.101.3.4.3.19
keyUsage: digitalSignature, nonRepudiation
```

### RFC 9882 — ML-DSA CMS SignedData

CMS SignedData에서 ML-DSA 서명을 사용하는 방법.

```
SignerInfo.signatureAlgorithm = id-ml-dsa-87 (OID 2.16.840.1.101.3.4.3.19)
SignerInfo.digestAlgorithm = SHA3-512
```

### RFC 9629 — KEM CMS RecipientInfo

CMS EnvelopedData에서 KEM 기반 수신자 정보를 사용하는 방법.

```
OtherRecipientInfo 내 KEMRecipientInfo 구조:
  kemAlgorithm: id-alg-ml-kem-1024
  kemCiphertext: OCTET STRING (1568B)
  kdf: HKDF-SHA3-512
  wrap: AES-256-GCM
```

---

## 3. 키 파생 표준

### BIP39 — 니모닉 (Bitcoin Improvement Proposal 39)

| 항목 | 값 |
|------|-----|
| 엔트로피 | 128 bit (12단어) 또는 256 bit (24단어) |
| 체크섬 | SHA-256 해시 앞 4/8 bit |
| 단어 사전 | 2,048개 영어 단어 |
| 시드 생성 | PBKDF2(mnemonic, "mnemonic"+password, 2048, SHA-512) → 512 bit |

PKIZIP 기본: 12단어 (128 bit 엔트로피)

### BIP32 — HD 키 파생 (Hierarchical Deterministic Keys)

```
Master Seed (512 bit)
    │
    ▼ HMAC-SHA512(key="Bitcoin seed", data=seed)
Master Key (256 bit) + Chain Code (256 bit)
    │
    ▼ Child Key Derivation (CKD)
    ├── Normal: HMAC-SHA512(chainCode, pubKey || index)
    └── Hardened: HMAC-SHA512(chainCode, 0x00 || privKey || index)
```

Hardened 파생(`'`): 공개키로부터 자식 키 유도 불가 → 보안 강화

### BIP44 — HD 경로 표준

```
m / purpose' / coin_type' / account' / change / address_index
```

PKIZIP 경로:

| 키 | 경로 | 설명 |
|---|------|------|
| ECDSA P-256 서명 | `m/44'/60'/0'/0/{n}` | 이더리움 호환 BIP44 |
| ECDH P-256 암호화 | `m/44'/60'/0'/1/{n}` | 내부 변경(change=1) |
| ML-KEM-1024 | `m/9000'/1024'/0'/0` | PKIZIP 전용 purpose |
| ML-DSA-87 | `m/9000'/87'/0'/0` | PKIZIP 전용 purpose |
| secp256k1 | `m/44'/60'/0'/0/0` | 블록체인 호환 |

`9000'`: PKIZIP 전용 purpose (BIP43 미할당 범위)

---

## 4. 대칭 암호

### AES-256-GCM (NIST FIPS 197 + SP 800-38D)

| 항목 | 값 |
|------|-----|
| 키 크기 | 256 bit (32 bytes) |
| IV 크기 | 96 bit (12 bytes) — GCM 권장 |
| Auth Tag | 128 bit (16 bytes) |
| 모드 | Galois/Counter Mode (인증 암호화) |

PKIZIP 사용처:
- CMS EncryptedContentInfo (CEK로 콘텐츠 암호화)
- CEK 래핑 (ML-KEM sharedSecret → HKDF → AES-GCM wrap)
- 개인키 저장 보호 (PBKDF2 → AES-GCM)
- 비밀번호 암호화 (EncryptedMessage)
- 생체 인증 시드 래핑 (PRF/fallback)
- PIN 시드 래핑

### AES-KW (AES Key Wrap, RFC 3394)

| 항목 | 값 |
|------|-----|
| 키 크기 | 256 bit |
| 용도 | ECDH 공유 비밀 → CEK 래핑 |

PKIZIP 사용: EnvelopedMessage의 ECDH 수신자 CEK 래핑

---

## 5. 비대칭 암호

### ECDSA P-256 (NIST FIPS 186-4)

| 항목 | 값 |
|------|-----|
| 곡선 | NIST P-256 (secp256r1, prime256v1) |
| 키 크기 | 개인키 32B, 공개키 65B (uncompressed) |
| 서명 크기 | 64B (r + s, 각 32B) |
| 해시 | SHA-256 |

PKIZIP 사용: SignedMessage 전자서명, 인증서 자체서명

### ECDH P-256 (NIST SP 800-56A)

| 항목 | 값 |
|------|-----|
| 곡선 | NIST P-256 |
| 공유 비밀 | 32B |
| 키 래핑 | ECDH → AES-KW → CEK |

PKIZIP 사용: EnvelopedMessage 다중 수신자 키 합의
- Ephemeral 키쌍 생성 → ECDH → KEK → AES-KW(CEK)

### secp256k1 (SEC 2)

| 항목 | 값 |
|------|-----|
| 곡선 | Koblitz secp256k1 |
| 키 크기 | 개인키 32B, 공개키 33B (compressed) |
| 용도 | 블록체인 호환 (이더리움/비트코인) |

PKIZIP 사용: PQC 번들 내 secp256k1 키 (향후 블록체인 앵커링 대비)

---

## 6. 해시 함수

| 알고리즘 | 출력 | 표준 | PKIZIP 사용처 |
|---------|------|------|-------------|
| SHA-256 | 32B | FIPS 180-4 | CMS 다이제스트, 핑거프린트, pqcKeyId |
| SHA-512 | 64B | FIPS 180-4 | BIP32 HMAC-SHA512, BIP39 PBKDF2 |
| SHA3-512 | 64B | FIPS 202 | ML-DSA 서명 다이제스트, HKDF |
| HMAC-SHA512 | 64B | RFC 2104 | BIP32 키 파생 |

---

## 7. 키 파생 함수 (KDF)

### PBKDF2 (NIST SP 800-132)

| 사용처 | 해시 | 반복 | 솔트 | 출력 |
|--------|------|------|------|------|
| 니모닉 → 시드 | SHA-512 | 2,048 | "mnemonic"+password | 64B |
| 비밀번호 → AES 키 | SHA-256 | 600,000 | 32B random | 32B |
| PIN → AES 키 | SHA-256 | 600,000 | 32B random | 32B |

### HKDF (RFC 5869)

| 사용처 | 해시 | 솔트 | info | 출력 |
|--------|------|------|------|------|
| ML-KEM sharedSecret → AES 래핑키 | SHA3-512 | 32B random | "pqczip-kem-v3" | 32B |

---

## 8. X.509 인증서 (RFC 5280)

### 기본 프로필

```asn1
Certificate ::= SEQUENCE {
    tbsCertificate      TBSCertificate,
    signatureAlgorithm  AlgorithmIdentifier,
    signatureValue      BIT STRING
}

TBSCertificate ::= SEQUENCE {
    version         [0] EXPLICIT INTEGER DEFAULT v1,
    serialNumber        CertificateSerialNumber,
    signature           AlgorithmIdentifier,
    issuer              Name,
    validity            Validity,
    subject             Name,
    subjectPublicKeyInfo SubjectPublicKeyInfo,
    extensions      [3] EXPLICIT Extensions OPTIONAL
}
```

### PKIZIP 인증서 확장 필드

| OID | 확장 | critical | 내용 |
|-----|------|----------|------|
| 2.5.29.19 | BasicConstraints | ✓ | CA=FALSE |
| 2.5.29.15 | KeyUsage | ✓ | digitalSignature + keyEncipherment |
| 2.5.29.17 | SubjectAltName | ✗ | rfc822Name (이메일) |
| 1.3.6.1.5.5.7.1.12 | Logotype | ✗ | JPEG 이미지 (64KB 이하) |

### PQC 인증서 keyUsage 구분

| 인증서 | keyUsage | 근거 |
|--------|----------|------|
| secp256k1 | digitalSignature | RFC 5480 |
| ML-KEM-1024 | keyEncipherment **ONLY** | RFC 9935 §4 |
| ML-DSA-87 | digitalSignature, nonRepudiation | RFC 9881 §4 |

ML-KEM 인증서에 digitalSignature를 설정하면 RFC 9935 위반.

---

## 9. 압축 포맷

### tar (POSIX ustar)

| 필드 | 오프셋 | 크기 | 내용 |
|------|--------|------|------|
| name | 0 | 100B | 파일명 (ASCII, PKIZIP은 f0/f1/... 사용) |
| mode | 100 | 8B | 0644 (8진수) |
| size | 124 | 12B | 파일 크기 (8진수) |
| mtime | 136 | 12B | Unix timestamp (8진수) |
| typeflag | 156 | 1B | '0' = 일반 파일 |
| magic | 257 | 6B | "ustar\0" |
| checksum | 148 | 8B | 헤더 바이트 합 (8진수) |

블록 크기: 512B (데이터도 512B 정렬 패딩)
EOF: 빈 블록 2개 (1024B)

PKIZIP 특징:
- tar 내부 파일명: `f0`, `f1`, ... (100B 한계 우회)
- 메타데이터 JSON에 원본 파일명 (UTF-8 한글) 보존
- tar → gzip 압축 (fflate level 6)

### gzip (RFC 1952)

fflate 라이브러리로 gzipSync / gunzipSync 수행.

---

## 10. WebAuthn (W3C Web Authentication)

### 사용 API

```javascript
navigator.credentials.create({ publicKey: options })  // 등록
navigator.credentials.get({ publicKey: options })      // 인증
```

### PKIZIP WebAuthn 설정

| 옵션 | 값 | 이유 |
|------|-----|------|
| authenticatorAttachment | `platform` | 로컬 기기만 |
| userVerification | `required` | 생체 인증 필수 |
| residentKey | `discouraged` | 키체인 동기화 차단 |
| hints | `['client-device']` | 크로스-디바이스 차단 |
| attestation | `none` | 제조사 인증서 미전송 |
| transports | `['internal']` | 내장 인증자만 |

### PRF Extension (Pseudo-Random Function)

```javascript
extensions: { prf: { eval: { first: salt(32B) } } }
// 결과: getClientExtensionResults().prf.results.first → 32B secret
```

- PRF 지원 시: secret으로 시드 직접 AES-GCM 암호화 (가장 안전)
- PRF 미지원 시 (Android 등): WebAuthn 검증만 → IndexedDB 래핑 키로 fallback

---

## 11. PWA (Progressive Web App)

### Web App Manifest (W3C)

```json
{
  "name": "PKIZIP - 전자서명 · 암호화",
  "display": "standalone",
  "theme_color": "#1DC078",
  "start_url": "/pkizip/",
  "scope": "/pkizip/",
  "id": "/pkizip/",
  "orientation": "any",
  "categories": ["security", "utilities"],
  "icons": [48, 72, 96, 128, 144, 192, 256, 384, 512],
  "shortcuts": ["파일 생성", "내 인증서"]
}
```

### Service Worker (Workbox)

- 전략: `generateSW` (자동 생성)
- Precache: HTML, CSS, JS, PNG, SVG
- 등록: `autoUpdate` (새 버전 감지 시 자동 갱신)

### iOS 메타태그

```html
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="PKIZIP">
<link rel="apple-touch-icon" href="/pkizip/icon-192.png">
```

---

## 12. File System Access API (WICG)

출력 폴더 선택에 사용 (Chrome/Edge 전용).

```javascript
const handle = await window.showDirectoryPicker()
await handle.getFileHandle(name, { create: true })
const writable = await fileHandle.createWritable()
```

- 지원: Chrome 86+, Edge 86+
- 미지원: Firefox, Safari → 다운로드 폴더 fallback
- 권한: `queryPermission({ mode: 'readwrite' })` / `requestPermission()`
- IndexedDB에 DirectoryHandle 저장 (세션 간 유지)

---

## 13. OID 참조 테이블

| OID | 알고리즘/확장 | 출처 |
|-----|-------------|------|
| 1.2.840.113549.1.7.2 | CMS SignedData | RFC 5652 |
| 1.2.840.113549.1.7.3 | CMS EnvelopedData | RFC 5652 |
| 1.2.840.113549.1.7.6 | CMS EncryptedData | RFC 5652 |
| 2.16.840.1.101.3.4.1.46 | AES-256-GCM | NIST |
| 1.2.840.10045.4.3.2 | ECDSA-with-SHA256 | RFC 5758 |
| 1.2.840.10045.3.1.7 | P-256 (prime256v1) | RFC 5480 |
| 1.3.132.0.10 | secp256k1 | SEC 2 |
| 2.16.840.1.101.3.4.4.3 | ML-KEM-1024 | RFC 9935 |
| 2.16.840.1.101.3.4.3.19 | ML-DSA-87 | RFC 9881 |
| 2.16.840.1.101.3.4.2.10 | SHA3-512 | NIST FIPS 202 |
| 2.5.29.15 | KeyUsage | RFC 5280 |
| 2.5.29.17 | SubjectAltName | RFC 5280 |
| 2.5.29.19 | BasicConstraints | RFC 5280 |
| 1.3.6.1.5.5.7.1.12 | Logotype Extension | RFC 3709 |

---

## 14. RFC/표준 전체 목록

| 번호 | 제목 | 상태 | PKIZIP 적용 |
|------|------|------|------------|
| RFC 5652 | CMS | 표준 | 4종 메시지 타입 기반 |
| RFC 5280 | X.509 PKI | 표준 | 인증서 프로필 |
| RFC 5480 | ECC X.509 | 표준 | P-256 인증서 |
| RFC 3394 | AES Key Wrap | 표준 | ECDH CEK 래핑 |
| RFC 5869 | HKDF | 정보 | ML-KEM 키 파생 |
| RFC 1952 | gzip | 표준 | tar.gz 압축 |
| RFC 3709 | Logotype Extension | 표준 | 인증서 이미지 |
| FIPS 197 | AES | 표준 | AES-256-GCM |
| FIPS 180-4 | SHA-2 | 표준 | SHA-256, SHA-512 |
| FIPS 202 | SHA-3 | 표준 | SHA3-512 |
| FIPS 203 | ML-KEM | 표준 (2024) | ML-KEM-1024 |
| FIPS 204 | ML-DSA | 표준 (2024) | ML-DSA-87 |
| RFC 9935 | ML-KEM X.509 | 표준 (2025) | KEM 인증서 |
| RFC 9881 | ML-DSA X.509 | 표준 (2025) | DSA 인증서 |
| RFC 9882 | ML-DSA CMS | 표준 (2025) | CMS 서명 |
| RFC 9629 | KEM CMS | 표준 (2024) | CMS RecipientInfo |
| SP 800-38D | GCM | 가이드 | AES-GCM 파라미터 |
| SP 800-56A | Key Agreement | 가이드 | ECDH |
| SP 800-132 | PBKDF | 가이드 | PBKDF2 반복 횟수 |
| BIP39 | 니모닉 | 업계표준 | 12/24단어 시드 |
| BIP32 | HD 키 | 업계표준 | HMAC-SHA512 파생 |
| BIP43 | Purpose | 업계표준 | m/purpose'/... |
| BIP44 | Multi-Account | 업계표준 | m/44'/coin'/... |
| W3C WebAuthn L2 | 생체 인증 | 표준 | PRF extension |
| W3C Web App Manifest | PWA | 표준 | 앱 설치 |
| WICG File System Access | 폴더 접근 | 초안 | 출력 폴더 |
