# pkizip v1.0 - Architecture Design Document

## 1. Overview

**pkizip**은 CMS(RFC 5652) 기반의 암호화 보안 컨테이너(.pki)를 생성/관리하는 PWA 애플리케이션이다.
일반 압축 프로그램(WinZip)의 파일 아카이브 기능과 PGP(WinPGP)의 암호화/서명 기능을 결합하며,
블록체인 니모닉(BIP39/BIP32) 기반의 키 관리 체계를 핵심으로 한다.

### 핵심 가치
- **Zero-CA**: 인증 기관 없이 수학적 무결성 증명
- **Mnemonic Identity**: 12단어 니모닉이 곧 사용자의 신원
- **CMS Standard**: RFC 5652 표준 준수 (SignedData + EnvelopedData)
- **PWA**: 설치 없는 브라우저 기반 사용성

---

## 2. Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Framework | Next.js 14 (App Router) + TypeScript | PWA Frontend |
| Styling | Tailwind CSS + shadcn/ui | WinZip-style Desktop UI |
| Mnemonic | `@scure/bip39` + `@scure/bip32` | BIP39/BIP32 HD Key Derivation |
| Crypto | Web Crypto API | AES-256-GCM, ECDSA P-256, ECDH |
| CMS | `pkijs` + `asn1js` | RFC 5652 CMS Operations |
| Compression | `fflate` | Deflate/Gzip Compression |
| Blockchain | `ethers.js` | Polygon Testnet Anchoring (Phase 2) |
| State | Zustand | Client-side State Management |
| Storage | IndexedDB (via `idb`) | Local Key/File Storage |

---

## 3. Key Derivation Architecture (BIP39 → BIP32 → CMS Keys)

```
┌─────────────────────────────────────────────────────────┐
│                    12-Word Mnemonic                       │
│  (예: "abandon ability able about above absent ...")     │
└──────────────────────┬──────────────────────────────────┘
                       │ BIP39 → 512-bit Seed
                       ▼
              ┌────────────────┐
              │   Master Key   │
              │  (BIP32 Root)  │
              └───────┬────────┘
                      │
          ┌───────────┴───────────┐
          ▼                       ▼
   m/44'/60'/0'/0              m/44'/60'/0'/1
   ┌─────────────┐            ┌─────────────┐
   │ Signing Keys│            │Encryption   │
   │ (ECDSA P256)│            │Keys (ECDH)  │
   └──────┬──────┘            └──────┬──────┘
          │                          │
    ┌─────┼─────┐              ┌─────┼─────┐
    ▼     ▼     ▼              ▼     ▼     ▼
  /0/0  /0/1  /0/2           /1/0  /1/1  /1/2
  Key0  Key1  Key2           Key0  Key1  Key2
```

### Key Derivation Path Convention
- **서명용 키**: `m/44'/60'/0'/0/{index}` — ECDSA P-256 (secp256r1)
- **암호화용 키**: `m/44'/60'/0'/1/{index}` — ECDH P-256 (key agreement)
- **Purpose 60'**: Ethereum 호환 경로 (Polygon 앵커링 대비)

---

## 4. .pki Container Format

### 4.1 Binary Layout

```
┌──────────────────────────────────────────────┐
│  Magic Number: "PKI!" (4 bytes: 0x504B4921)  │
├──────────────────────────────────────────────┤
│  Version: 0x0001 (2 bytes, Big-Endian)       │
├──────────────────────────────────────────────┤
│  Flags: (2 bytes)                            │
│    bit 0: compressed                         │
│    bit 1: encrypted                          │
│    bit 2: signed                             │
│    bit 3: multi-file                         │
├──────────────────────────────────────────────┤
│  Header Length: (4 bytes, Big-Endian)        │
├──────────────────────────────────────────────┤
│  Header (JSON):                              │
│  {                                           │
│    "files": [                                │
│      { "name", "size", "compressedSize",     │
│        "hash", "offset", "method" }          │
│    ],                                        │
│    "encryption": {                           │
│      "algorithm": "AES-256-GCM",             │
│      "recipients": [{ "keyId", "wrappedKey"}]│
│    },                                        │
│    "signatures": [                           │
│      { "signerId", "algorithm", "timestamp" }│
│    ]                                         │
│  }                                           │
├──────────────────────────────────────────────┤
│  CMS ContentInfo (ASN.1 DER):               │
│    ├─ SignedData (RFC 5652 §5)               │
│    │    ├─ DigestAlgorithms: SHA-256         │
│    │    ├─ EncapContentInfo                  │
│    │    │    └─ EnvelopedData (RFC 5652 §6)  │
│    │    │         ├─ RecipientInfos[]        │
│    │    │         └─ EncryptedContent        │
│    │    │              └─ Compressed Payload  │
│    │    └─ SignerInfos[]                     │
│    └─ [0] MerkleProofInfo (OPTIONAL)         │
├──────────────────────────────────────────────┤
│  EOF Marker: "PKI!" (4 bytes)               │
└──────────────────────────────────────────────┘
```

### 4.2 CMS ASN.1 Structure

```asn1
pkizipContainer ::= SEQUENCE {
  version        INTEGER (1),
  contentInfo    ContentInfo,        -- SignedData wrapping EnvelopedData
  blockchainMeta [0] EXPLICIT MerkleProofInfo OPTIONAL
}

MerkleProofInfo ::= SEQUENCE {
  merkleRoot  OCTET STRING,          -- 블록체인 기록 최종 해시
  proofPath   SEQUENCE OF OCTET STRING,
  txId        UTF8String,            -- Polygon TxID
  timestamp   GeneralizedTime
}
```

---

## 5. Core Modules Architecture

```
src/
├── lib/
│   ├── crypto/
│   │   ├── mnemonic.ts          # BIP39 니모닉 생성/복구
│   │   ├── hd-key.ts            # BIP32 HD Key Derivation
│   │   ├── key-manager.ts       # 키 저장/조회/내보내기
│   │   ├── encryption.ts        # AES-256-GCM 암복호화
│   │   ├── signing.ts           # ECDSA P-256 서명/검증
│   │   └── key-agreement.ts     # ECDH 키 합의 (다중 암호화용)
│   ├── container/
│   │   ├── pki-format.ts        # .pki 바이너리 포맷 Reader/Writer
│   │   ├── cms-builder.ts       # CMS SignedData/EnvelopedData 빌더
│   │   ├── cms-parser.ts        # CMS 파싱/검증
│   │   └── file-entry.ts        # 아카이브 내 파일 엔트리 관리
│   ├── compression/
│   │   ├── compressor.ts        # deflate 압축
│   │   └── decompressor.ts      # deflate 해제
│   └── store/
│       ├── key-store.ts         # IndexedDB 키 저장소
│       ├── archive-store.ts     # 현재 열린 아카이브 상태
│       └── app-store.ts         # 전역 앱 상태 (Zustand)
├── components/
│   ├── layout/
│   │   ├── MenuBar.tsx          # WinZip-style 메뉴바
│   │   ├── Toolbar.tsx          # 아이콘 툴바
│   │   ├── StatusBar.tsx        # 하단 상태바
│   │   └── AppShell.tsx         # 전체 레이아웃 셸
│   ├── panels/
│   │   ├── FileListPanel.tsx    # 파일 목록 (메인 영역)
│   │   ├── KeyPanel.tsx         # 키 관리 사이드 패널
│   │   ├── PropertyPanel.tsx    # 파일 속성 패널
│   │   └── DropZone.tsx         # 드래그&드롭 영역
│   ├── dialogs/
│   │   ├── MnemonicDialog.tsx   # 니모닉 생성/복구 다이얼로그
│   │   ├── EncryptDialog.tsx    # 암호화 옵션 다이얼로그
│   │   ├── SignDialog.tsx       # 서명 옵션 다이얼로그
│   │   ├── RecipientDialog.tsx  # 수신자 선택 다이얼로그
│   │   └── VerifyDialog.tsx     # 검증 결과 다이얼로그
│   └── common/
│       ├── FileIcon.tsx         # 파일 타입별 아이콘
│       └── Badge.tsx            # 상태 배지 (서명됨/암호화됨)
└── app/
    ├── layout.tsx               # Root Layout
    ├── page.tsx                 # Main Application Page
    └── globals.css              # Global Styles
```

---

## 6. UI Design: WinZip/WinPGP Style Menu Structure

### 6.1 메뉴바 (Menu Bar)

```
┌──────────────────────────────────────────────────────────────────┐
│ 📁 파일(F)  ✏️ 편집(E)  ⚡ 작업(A)  🔑 키(K)  🔧 도구(T)  ❓ 도움말(H) │
└──────────────────────────────────────────────────────────────────┘
```

#### 파일(File) 메뉴
| 메뉴 항목 | 단축키 | 설명 |
|---------|--------|------|
| 새 아카이브 | Ctrl+N | 빈 .pki 아카이브 생성 |
| 열기 | Ctrl+O | 기존 .pki 파일 열기 |
| 최근 파일 | — | 최근 작업 파일 목록 |
| 닫기 | Ctrl+W | 현재 아카이브 닫기 |
| 저장 | Ctrl+S | 현재 아카이브 저장 |
| 다른 이름으로 저장 | Ctrl+Shift+S | 새 이름으로 저장 |
| 파일 추출(풀기) | Ctrl+E | 선택 파일을 디스크에 추출 |
| 전체 추출 | Ctrl+Shift+E | 모든 파일 추출 |
| — | — | — |
| 속성 | Alt+Enter | 아카이브 속성 보기 |
| 종료 | Alt+F4 | 프로그램 종료 |

#### 편집(Edit) 메뉴
| 메뉴 항목 | 단축키 | 설명 |
|---------|--------|------|
| 파일 추가 | Insert | 파일을 아카이브에 추가 |
| 폴더 추가 | Ctrl+Shift+A | 폴더째 추가 |
| 선택 파일 제거 | Delete | 아카이브에서 제거 |
| 전체 선택 | Ctrl+A | 모든 파일 선택 |
| 선택 해제 | Ctrl+D | 선택 해제 |

#### 작업(Actions) 메뉴 — *핵심 기능*
| 메뉴 항목 | 단축키 | 설명 |
|---------|--------|------|
| **압축하여 저장** | Ctrl+B | 선택 파일 압축 (Deflate) |
| **압축 풀기** | Ctrl+U | 선택 파일 압축 해제 |
| — | — | — |
| **암호화** | Ctrl+Shift+K | 수신자 공개키로 암호화 (AES-256-GCM + ECDH) |
| **복호화** | Ctrl+Shift+D | 내 개인키로 복호화 |
| **수신자 추가** | — | 다중 암호화 수신자 추가 |
| — | — | — |
| **서명** | Ctrl+Shift+S | 내 개인키로 서명 (ECDSA P-256) |
| **서명 추가 (다중)** | — | 기존 서명에 추가 서명 |
| **서명 검증** | Ctrl+Shift+V | 서명 유효성 검증 |
| — | — | — |
| **봉인 (Seal)** | Ctrl+Shift+B | 압축 + 암호화 + 서명 일괄 수행 |
| 무결성 검사 | — | 파일 해시 무결성 확인 |

#### 키(Keys) 메뉴
| 메뉴 항목 | 단축키 | 설명 |
|---------|--------|------|
| **니모닉 생성** | — | 새 12단어 니모닉 생성 |
| **니모닉 복구** | — | 기존 12단어로 키 복구 |
| — | — | — |
| 내 키 정보 | Ctrl+K | 현재 키 핑거프린트/공개키 보기 |
| 공개키 내보내기 | — | 내 공개키를 파일로 내보내기 |
| 공개키 가져오기 | — | 상대방 공개키 등록 |
| — | — | — |
| 키 링 관리 | — | 등록된 공개키 목록 관리 |
| 하위 키 파생 | — | 새 하위 키 생성 (BIP32 인덱스 증가) |

#### 도구(Tools) 메뉴
| 메뉴 항목 | 설명 |
|---------|------|
| 파일 해시 계산 | 드래그한 파일의 SHA-256 해시 계산 |
| 설정 | 기본 압축 수준, 알고리즘 선택 등 |

#### 도움말(Help) 메뉴
| 메뉴 항목 | 설명 |
|---------|------|
| 사용 가이드 | 기본 사용법 안내 |
| pkizip 정보 | 버전 및 라이선스 |

### 6.2 툴바 (Toolbar)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ [📄 새로 만들기] [📂 열기] [➕ 추가] │ [📦 압축] [📤 풀기] │              │
│ [🔒 암호화] [🔓 복호화] │ [✍️ 서명] [✅ 검증] │ [🔑 키 관리] [🛡 봉인] │
└─────────────────────────────────────────────────────────────────────────┘
```

### 6.3 메인 영역 (File List Panel)

```
┌──────────────────────────────────────────────────────────────────────┐
│ 이름 ▼     │ 원본 크기 │ 압축 크기 │ 압축률  │ 타입   │ 상태        │
├────────────┼──────────┼──────────┼────────┼───────┼────────────┤
│ 📄 계약서.pdf│ 2.4 MB  │ 1.8 MB  │  25%   │ PDF   │ 🔒✍️       │
│ 📄 설계서.docx│ 1.1 MB │ 0.4 MB  │  63%   │ DOCX  │ 🔒✍️✍️     │
│ 📁 첨부/     │   —     │   —     │   —    │ 폴더   │            │
│   📄 img.png│ 3.2 MB  │ 3.1 MB  │   3%   │ PNG   │ 🔒         │
│   📄 data.csv│ 0.5 MB │ 0.1 MB  │  80%   │ CSV   │ 🔒✍️       │
└────────────┴──────────┴──────────┴────────┴───────┴────────────┘
  상태 아이콘: 🔒=암호화됨  ✍️=서명됨 (✍️ 개수 = 서명자 수)
```

### 6.4 상태바 (Status Bar)

```
┌──────────────────────────────────────────────────────────────────────┐
│ 🔑 0x3a7f...c2d1 (내 키) │ 파일 4개 │ 총 7.2MB → 5.4MB (25%) │ 준비 │
└──────────────────────────────────────────────────────────────────────┘
```

### 6.5 사이드 패널 (Key/Property Panel)

```
┌─────────────────────────┐
│ 📋 아카이브 정보          │
│ ─────────────────────── │
│ 포맷: .pki v1           │
│ 생성: 2026-04-12        │
│ 파일 수: 4              │
│ 압축 방식: Deflate       │
│ 암호화: AES-256-GCM     │
│                         │
│ 📝 서명 정보             │
│ ─────────────────────── │
│ 서명자 1: 0x3a7f..c2d1  │
│   ✅ 유효 (2026-04-12)  │
│ 서명자 2: 0x8b2e..f4a3  │
│   ✅ 유효 (2026-04-12)  │
│                         │
│ 🔐 암호화 수신자          │
│ ─────────────────────── │
│ alice@example.com       │
│ bob@company.com         │
└─────────────────────────┘
```

---

## 7. Core Workflows

### 7.1 파일 봉인 (Seal) — 압축 + 암호화 + 서명

```
[원본 파일들]
    │
    ▼ (1) Deflate 압축
[압축된 바이너리]
    │
    ▼ (2) AES-256-GCM 대칭 암호화
    │     → CEK(Content Encryption Key) 랜덤 생성
    │     → 각 수신자 공개키로 ECDH → KEK → CEK 래핑
[CMS EnvelopedData]
    │
    ▼ (3) ECDSA P-256 서명
    │     → 콘텐츠 해시(SHA-256) 생성
    │     → 서명자 개인키로 서명
    │     → SignerInfo 배열에 추가
[CMS SignedData wrapping EnvelopedData]
    │
    ▼ (4) .pki 컨테이너 패킹
[.pki 파일 완성]
```

### 7.2 파일 열기 (Open & Verify)

```
[.pki 파일]
    │
    ▼ (1) Magic Number / Version 확인
    │
    ▼ (2) CMS 파싱 → SignedData 추출
    │
    ▼ (3) 서명 검증 (각 SignerInfo)
    │     → 서명자 공개키로 ECDSA verify
    │
    ▼ (4) EnvelopedData 추출
    │     → 내 개인키로 ECDH → KEK → CEK 복호화
    │     → AES-256-GCM 복호화
    │
    ▼ (5) Deflate 해제
    │
    ▼ (6) 파일 목록 표시
[복호화된 원본 파일들]
```

### 7.3 다중 서명 (Multi-Signature)

```
[기안자 A] ──서명──▶ SignerInfo[0] ──┐
[검토자 B] ──서명──▶ SignerInfo[1] ──┤──▶ SignedData.signerInfos[]
[승인자 C] ──서명──▶ SignerInfo[2] ──┘
```

### 7.4 다중 암호화 (Multi-Recipient Encryption)

```
CEK (AES-256 랜덤키) ──┬── ECDH(수신자A 공개키) → RecipientInfo[0]
                       ├── ECDH(수신자B 공개키) → RecipientInfo[1]
                       └── ECDH(수신자C 공개키) → RecipientInfo[2]

파일 데이터 ──AES-256-GCM(CEK)──▶ EncryptedContent
```

---

## 8. Security Design

### 8.1 키 저장
- 개인키는 **절대** 서버에 전송하지 않음
- IndexedDB에 AES-256-GCM으로 암호화하여 저장 (비밀번호 기반 PBKDF2 키 래핑)
- 니모닉은 최초 표시 후 메모리에서 즉시 제거

### 8.2 암호화 체계
- **대칭키**: AES-256-GCM (96-bit IV, 128-bit Auth Tag)
- **비대칭 키 합의**: ECDH P-256 → HKDF → AES Key Wrapping
- **서명**: ECDSA P-256 with SHA-256

### 8.3 향후 PQC 대응
- OID 기반 알고리즘 식별 → ML-KEM, ML-DSA 교체 가능 구조
- 가변 길이 키/서명 필드

---

## 9. Implementation Phases

### Phase 1 (현재 - v1.0): Core Container
- [x] 니모닉 생성/복구 + HD Key Derivation
- [x] .pki 컨테이너 생성/읽기
- [x] 단일/다중 파일 압축 (Deflate)
- [x] AES-256-GCM 암호화/복호화
- [x] ECDSA P-256 서명/검증
- [x] 다중 서명 / 다중 암호화
- [x] WinZip-style PWA UI

### Phase 2: Blockchain Anchoring
- [ ] Merkle Tree 생성 (merkletreejs)
- [ ] Polygon Amoy Testnet 앵커링
- [ ] 온체인 검증 모듈

### Phase 3: Identity & Enterprise
- [ ] 이메일 OTP 인증 + 공개키 등록
- [ ] Enterprise 계정 관리
- [ ] 정책(Policy) 엔진
