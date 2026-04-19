# PKIZIP 내부 기술 문서

> 내부 참조용. 외부 공개 금지.
> 최종 갱신: 2026-04-18

---

## 1. 서비스 개요

PKIZIP은 CMS(RFC 5652) 기반의 전자서명·암호화·압축 PWA이다.
브라우저에서 완전히 로컬로 동작하며, 외부 서버 호출 없이 파일을 서명하고 암호화한다.
BIP39 니모닉에서 키를 파생하고, NIST 양자 내성 암호(PQC)를 하이브리드로 지원한다.

- **배포**: https://chrismarspink.github.io/pkizip/
- **저장소**: https://github.com/chrismarspink/pkizip (AGPL-3.0)
- **라이선스**: AGPL-3.0 (상업적 사용 별도 문의)

---

## 2. 기술 스택

### 2-1. 프레임워크 & 빌드

| 기술 | 버전 | 역할 |
|------|------|------|
| React | 19 | UI 라이브러리 |
| TypeScript | 6 | 타입 안전성 |
| Vite | 8 | 빌드 도구 (Rolldown 기반) |
| Tailwind CSS | 4 | 유틸리티 CSS |
| vite-plugin-pwa | 1.2 | PWA manifest + service worker |

### 2-2. UI 라이브러리

| 라이브러리 | 역할 |
|-----------|------|
| Framer Motion | 카드 애니메이션 (인증서 월렛, 페이지 전환) |
| Radix UI | 헤드리스 UI (Dialog, Tabs, DropdownMenu, Tooltip) |
| vaul | 모바일 바텀시트 (설치 시) |
| Lucide React | 아이콘 |
| sonner | 토스트 알림 |
| jdenticon | 핑거프린트 기반 고유 아바타 (Identicon) |
| TanStack Virtual | 대용량 파일 리스트 가상 스크롤 |

### 2-3. 암호화 라이브러리

| 라이브러리 | 버전 | 역할 |
|-----------|------|------|
| `@scure/bip39` | 2.x | BIP39 니모닉 생성/검증 |
| `@scure/bip32` | 2.x | BIP32 HD 키 파생 |
| `@noble/curves` | 2.x | P-256 타원곡선 (ECDSA 서명, ECDH 키 합의) |
| `@noble/hashes` | 2.x | SHA-256, SHA3-512, HKDF, PBKDF2 |
| `@noble/post-quantum` | 0.2 | ML-KEM-1024, ML-DSA-87 (PQC) |
| `pkijs` | 3.x | X.509 인증서 생성/파싱 (ASN.1) |
| `asn1js` | 3.x | ASN.1 DER 인코딩/디코딩 |
| `fflate` | 0.8 | ZLIB/ZIP/gzip 압축/해제 |
| Web Crypto API (내장) | — | AES-256-GCM, ECDSA, ECDH, PBKDF2 |

### 2-4. 상태 관리 & 저장

| 기술 | 역할 |
|------|------|
| Zustand | 전역 앱 상태 (메모리) |
| IndexedDB (via `idb`) | 영구 키/인증서/설정 저장 |
| localStorage | PQC UI 설정 오버라이드 |

---

## 3. 디렉토리 구조

```
pkizip/
├── index.html                      Vite 엔트리
├── vite.config.ts                  빌드 설정 (base: /pkizip/)
├── package.json                    의존성 (AGPL-3.0)
├── changes.txt                     버전별 변경 이력
├── CLAUDE.md                       AI 에이전트용 컨텍스트 (git 제외)
│
├── public/                         정적 자산
│   ├── icon-*.png                  PWA 아이콘 (9종 + 2 maskable)
│   ├── 404.html                    GitHub Pages SPA fallback
│   └── logo-owl.png                제품 로고 (선택)
│
├── scripts/
│   └── generate-icons.mjs          PWA 아이콘 생성 (sharp)
│
├── .github/workflows/
│   └── deploy.yml                  GitHub Actions → Pages 자동 배포
│
├── docs/                           내부 기술 문서
│   └── architecture.md             이 문서
│
└── src/
    ├── main.tsx                    React 엔트리
    ├── App.tsx                     BrowserRouter + Routes
    ├── index.css                   Tailwind + CSS 변수
    ├── version.ts                  package.json 버전 노출
    ├── vite-env.d.ts               Vite 타입 선언
    │
    ├── pages/                      라우트 페이지
    │   ├── CreatePage.tsx          파일 생성 위저드 (4단계)
    │   ├── FilesTempPage.tsx       .pki 파일 열기 (TaskStream UI)
    │   ├── CertsPage.tsx           인증서 월렛 뷰
    │   └── SettingsPage.tsx        아이덴티티/PQC/생체/PIN 설정
    │
    ├── components/
    │   ├── layout/
    │   │   ├── AppShell.tsx        레이아웃 셸 (사이드바/탭바 전환)
    │   │   ├── SidebarNav.tsx      PC 좌측 사이드바
    │   │   └── BottomTabBar.tsx    모바일 하단 탭바
    │   ├── cert/
    │   │   ├── CertCard.tsx        인증서 카드 (Apple Wallet 스타일)
    │   │   ├── CertWallet.tsx      카드 리스트 (Framer Motion)
    │   │   └── Identicon.tsx       핑거프린트 아바타 (jdenticon)
    │   ├── dialogs/
    │   │   └── MnemonicDialog.tsx  니모닉 생성/복구 위저드
    │   ├── Logo.tsx                제품 로고 (SVG/이미지 전환)
    │   ├── LogoCrop.tsx            이미지 크롭 (Canvas API, 외부 라이브러리 없음)
    │   ├── PqcBadge.tsx            Q/C 배지 (Quantum/Classical)
    │   └── TaskStream.tsx          Claude Code 스타일 실시간 작업 UI
    │
    ├── hooks/
    │   └── useMediaQuery.ts        반응형 훅 (모바일/태블릿/데스크탑)
    │
    └── lib/
        ├── crypto/                 암호화 코어
        │   ├── mnemonic.ts         BIP39 니모닉 생성/검증/복구
        │   ├── hd-key.ts           BIP32 → P-256 키 파생
        │   ├── key-manager.ts      다중 아이덴티티 IndexedDB CRUD
        │   ├── certificate.ts      X.509 자체서명 인증서 (pkijs)
        │   ├── encryption.ts       AES-256-GCM + ECDH 다중 수신자
        │   ├── signing.ts          ECDSA P-256 서명/검증
        │   ├── biometric.ts        WebAuthn 생체 인증 (PRF + fallback)
        │   ├── pin.ts              PIN 빠른 잠금 해제 (PBKDF2)
        │   └── buffer-utils.ts     Uint8Array 호환 유틸리티
        │
        ├── container/              .pki 컨테이너 포맷
        │   ├── pki-format.ts       바이너리 포맷 Reader/Writer
        │   ├── pki-operations.ts   seal/open 통합 API
        │   └── inner-payload.ts    암호화 내부 서명 포맷
        │
        ├── compression/
        │   ├── compression-types.ts 공유 타입 (InputFile, CompressResult, FileEntry)
        │   ├── archive.ts          ZIP 아카이브 빌더/파서 (fflate zipSync)
        │   └── compressor.ts       CMS RFC 3274 호환 압축 (ZLIB/ZIP + 레거시 호환)
        │
        ├── store/
        │   ├── app-store.ts        Zustand 전역 상태
        │   └── folder-store.ts     File System Access API
        │
        └── pqc/                    양자 내성 암호 (PQC)
            ├── pqc-config.json     전역/인증서별 PQC 설정
            ├── pqc-banner.js       콘솔 배너 + pqcHeader 생성
            ├── pqc-derive.js       니모닉 → 2벌 PQC 키 결정론적 도출
            ├── pqc-shield.js       ML-KEM-1024 CEK 캡슐화 엔진
            ├── pqc-signer.js       ML-DSA-87 전자서명 엔진
            ├── pqc-bundle.js       .pkizip 2-cert PQC 번들 관리
            ├── pqc-keystore.js     번들 IndexedDB 저장소
            ├── pqc-bridge.js       pki.js 투명 연동 레이어
            └── pqc-demo.js         통합 테스트 (10 시나리오)
```

---

## 4. 핵심 기능

### 4-1. CMS 메시지 타입 (4종)

| 타입 | 내용 | 키 필요 |
|------|------|--------|
| CompressedMessage | ZLIB/ZIP 압축 (RFC 3274) | ✗ |
| SignedMessage | 압축 + ECDSA P-256 서명 | ✓ |
| EnvelopedMessage | 압축 + 서명 + ECDH 공개키 다중 수신자 암호화 | ✓ |
| EncryptedMessage | 압축 + AES-256-GCM 비밀번호 암호화 (선택적 서명) | ✗ |

### 4-2. 키 파생 체계

```
니모닉 (12단어 BIP39)
    │
    ▼ BIP39 → 512-bit Seed
    │
    ├── m/44'/60'/0'/0/{n}   → ECDSA P-256 서명 키
    ├── m/44'/60'/0'/1/{n}   → ECDH P-256 암호화 키
    ├── m/9000'/1024'/0'/0   → ML-KEM-1024 암호화 키 (PQC)
    └── m/9000'/87'/0'/0     → ML-DSA-87 서명 키 (PQC)
```

- 동일 니모닉 + 동일 패스워드 → 항상 동일 키 (결정론적)
- PQC 경로는 PKIZIP 전용 (purpose 9000')
- secp256k1 경로는 제거됨 (블록체인 호환 불필요)

### 4-3. 잠금 해제 경로 (3중)

| 경로 | 방식 | 보안 수준 |
|------|------|----------|
| 비밀번호 | PBKDF2-SHA256 (600,000회) + AES-256-GCM | 최고 |
| 생체 인증 (PRF) | WebAuthn PRF extension → AES-256-GCM 직접 | 최고 |
| 생체 인증 (Fallback) | WebAuthn 검증 → IndexedDB 래핑 키 | 양호 |
| PIN | PBKDF2-SHA256 (600,000회) + AES-256-GCM | 양호 |

### 4-4. 양자 내성 암호 (PQC)

인증서 3개: ECDSA P-256 (classic, pkijs 생성), ML-KEM-1024, ML-DSA-87.
PQC 번들은 ML-KEM-1024 + ML-DSA-87 2벌만 포함 (secp256k1 제거).

| 알고리즘 | NIST 표준 | 용도 |
|---------|----------|------|
| ML-KEM-1024 | FIPS 203 | CEK 캡슐화 (EnvelopedData 수신자 보호) |
| ML-DSA-87 | FIPS 204 | 전자서명 (SignedData) |
| HKDF-SHA3-512 | — | sharedSecret → AES 키 파생 |

PQC 3가지 모드:
- **hybrid**: 기존 RSA/ECDSA + PQC 동시 포함 (기본값)
- **pqc-only**: PQC 전용
- **classical**: 기존 알고리즘만

---

## 5. .pki 컨테이너 포맷

```
[Magic: "PKI!" 4B][Version: 2B][Flags: 2B]
[Header Length: 4B][Header JSON]
[Payload Length: 4B][Payload]
[EOF Magic: "PKI!" 4B]
```

Flags 비트마스크:
- bit 0: `FLAG_COMPRESSED` (0x01)
- bit 1: `FLAG_ENCRYPTED` (0x02)
- bit 2: `FLAG_SIGNED` (0x04)
- bit 3: `FLAG_MULTI_FILE` (0x08)

### Payload 구조 (EncryptedMessage + 서명)

서명은 암호화 **내부**에 포함 (복호화해야만 서명 확인 가능):

```
encrypt(
  inner-payload: [1B flags][4B sig-len][signatures JSON][ZLIB 또는 ZIP 데이터]
)
```

### 압축 (CMS RFC 3274 호환)

압축 전략:
- **단일 파일** → ZLIB 직접 압축 (RFC 1950 스트림)
- **다중 파일/폴더** → ZIP 아카이브 (PKWARE APPNOTE, ISO 21320)

```
CompressedData (RFC 3274)
├── version: 0
├── compressionAlgorithm: id-alg-zlibCompress (OID 1.2.840.113549.1.9.16.3.8)
└── encapContentInfo
      └── eContent: OCTET STRING
            ├── [단일 파일] ZLIB(원본 데이터)  — RFC 1950 헤더 + DEFLATE + Adler-32
            └── [다중 파일] ZIP 아카이브 바이트  — 표준 ZIP 뷰어로 열림
```

ZIP 내부 압축:
- 이미 압축된 파일(PDF, JPEG, ZIP, MP4 등) → STORE(무압축) — CPU 절약
- 텍스트/비압축 파일 → DEFLATE level 6
- 256B 미만 파일 → STORE
- 파일명 UTF-8 인코딩 (EFS bit 11 설정)
- 디렉토리 구조 보존 ('/' 경로 구분자)

PkiHeader의 `compression` 필드:
```json
{
  "compression": {
    "method": "zip",
    "oid": "1.2.840.113549.1.9.16.3.8",
    "entries": 3,
    "originalSize": 1048576
  }
}
```

레거시 역호환 (읽기 전용):
- v1: `[4B metaLen][JSON array][tar.gz]` — 자동 감지
- v2: `[4B metaLen][JSON {version:2}][per-file deflate]` — 자동 감지

---

## 6. IndexedDB 스키마

### 6-1. `pkizip-keys` (메인 키 저장소, v3)

| 스토어 | keyPath | 내용 |
|--------|---------|------|
| `identity` | `id` (UUID) | 다중 아이덴티티 메타 + 암호화된 시드 |
| `keyring` | `fingerprint` | 주소록 (공개키) |
| `certificates` | `fingerprint` | 자체서명 X.509 인증서 + logotype |
| `settings` | `key` | 활성 아이덴티티 ID 등 |

### 6-2. `pkizip-biometric` (생체 인증, v2)

| 스토어 | keyPath | 내용 |
|--------|---------|------|
| `bindings` | `identityId` | WebAuthn credential + PRF/fallback 래핑된 시드 |

### 6-3. `pkizip-pin` (PIN, v1)

| 스토어 | keyPath | 내용 |
|--------|---------|------|
| `bindings` | `identityId` | PIN PBKDF2 래핑된 시드 + 시도 횟수/잠금 |

### 6-4. `pkizip-pqc-v3` (PQC 번들, v1)

| 스토어 | keyPath | 내용 |
|--------|---------|------|
| `bundles` | `id` | .pkizip 번들 PBKDF2 암호화 전체 |

### 6-5. `pkizip-folders` (출력 폴더, v1)

| 스토어 | keyPath | 내용 |
|--------|---------|------|
| `handles` | `key` | FileSystemDirectoryHandle 참조 |

---

## 7. 라우팅

| 경로 | 페이지 | 역할 |
|------|--------|------|
| `/` | CreatePage | CMS 파일 생성 위저드 |
| `/files` | FilesTempPage | .pki 파일 열기 (TaskStream 분석) |
| `/certs` | CertsPage | 인증서 월렛 |
| `/settings` | SettingsPage | 아이덴티티/PQC/생체/PIN 관리 |

모바일 (~640px): 하단 탭바 4개
태블릿/PC (641px~): 좌측 아이콘 사이드바

---

## 8. 보안 설계 원칙

1. **개인키는 절대 서버로 전송하지 않음** — 모든 연산은 브라우저 SubtleCrypto
2. **IndexedDB 전용 저장소** — localStorage, sessionStorage, 플랫폼 키체인 사용 금지
3. **생체 인증**: `residentKey: 'discouraged'` + `hints: ['client-device']` → iCloud/Google 키체인 동기화 차단
4. **서명은 암호화 내부 포함** — EncryptedMessage의 서명은 복호화해야만 확인 가능
5. **PBKDF2 600,000회** — 모든 비밀번호/PIN 기반 키 파생
6. **오프라인 완전 동작** — fetch/XMLHttpRequest 호출 없음

---

## 9. PQC .pkizip 번들 구조

```json
{
  "magic": "PKIZIP-BUNDLE",
  "version": 3,
  "mode": "full",
  "subject": { "name", "email" },
  "derivation": {
    "paths": {
      "kem": "m/9000'/1024'/0'/0",
      "dsa": "m/9000'/87'/0'/0"
    }
  },
  "certificates": {
    "kem": "<PEM ML-KEM-1024, RFC 9935>",
    "dsa": "<PEM ML-DSA-87, RFC 9881>"
  },
  "encryptedKeys": {
    "algorithm": "AES-256-GCM",
    "kdf": "PBKDF2-SHA256",
    "iterations": 600000,
    "salt_kem/dsa": "<각 독립 salt>",
    "iv_kem/dsa": "<각 독립 IV>",
    "cipher_kem/dsa": "<각 독립 암호문>"
  },
  "pqcHeader": { ... }
}
```

키 2벌은 동일 패스워드지만 **독립 salt**로 PBKDF2 수행 → 수학적 독립.
(secp256k1 키는 제거됨 — 블록체인 호환 불필요)

---

## 10. 배포 파이프라인

```
main 브랜치 push
    │
    ▼ GitHub Actions (.github/workflows/deploy.yml)
    │
    ├── npm ci --legacy-peer-deps
    ├── npx vite build (dist/ 생성)
    ├── 404.html 복사 (SPA fallback)
    └── deploy-pages → https://chrismarspink.github.io/pkizip/
```

PWA 서비스 워커 (Workbox): `precache` 모드, autoUpdate.

---

## 11. 키 크기 참조

| 알고리즘 | 개인키 | 공개키 | 서명 |
|---------|--------|--------|------|
| ECDSA P-256 | 32B | 65B (uncompressed) | 64B |
| ML-KEM-1024 | 3,168B | 1,568B | — |
| ML-DSA-87 | 4,896B | 2,592B | 4,627B |
| AES-256-GCM | 32B | — | 16B tag |

---

## 12. RFC/표준 참조

| 표준 | 내용 |
|------|------|
| RFC 5652 | CMS (Cryptographic Message Syntax) |
| RFC 3274 | CMS Compressed Data (id-alg-zlibCompress) |
| RFC 1950 | ZLIB Compressed Data Format |
| PKWARE APPNOTE 6.3.10 | ZIP File Format |
| ISO/IEC 21320-1:2015 | Document Container File (ZIP 기반) |
| NIST FIPS 203 | ML-KEM-1024 |
| NIST FIPS 204 | ML-DSA-87 |
| RFC 9935 | ML-KEM X.509 인증서 |
| RFC 9881 | ML-DSA X.509 인증서 |
| RFC 9882 | ML-DSA CMS SignedData |
| RFC 3709 | X.509 Logotype Extension |
| BIP39 | 니모닉 표준 |
| BIP32 | HD 키 파생 |
| BIP44 | HD 경로 표준 |

---

## 13. 의존성 전체 목록

### Runtime

| 패키지 | 용도 |
|--------|------|
| react, react-dom | UI |
| react-router-dom | SPA 라우팅 |
| zustand | 상태 관리 |
| framer-motion | 애니메이션 |
| @radix-ui/react-dialog | 모달 |
| @radix-ui/react-tabs | 탭 |
| @radix-ui/react-dropdown-menu | 드롭다운 |
| @radix-ui/react-tooltip | 툴팁 |
| vaul | 바텀시트 |
| @tanstack/react-virtual | 가상 스크롤 |
| sonner | 토스트 |
| lucide-react | 아이콘 |
| jdenticon | Identicon |
| idb | IndexedDB 래퍼 |
| @scure/bip39 | BIP39 니모닉 |
| @scure/bip32 | BIP32 HD 키 |
| @noble/curves | P-256 ECDSA/ECDH |
| @noble/hashes | SHA-256, SHA3-512, HKDF |
| @noble/post-quantum | ML-KEM-1024, ML-DSA-87 |
| pkijs | X.509 인증서 |
| asn1js | ASN.1 |
| pvtsutils | pkijs 유틸 |
| fflate | ZLIB/ZIP/gzip 압축 |

### Dev

| 패키지 | 용도 |
|--------|------|
| vite | 빌드 |
| @vitejs/plugin-react | React HMR |
| tailwindcss | CSS |
| @tailwindcss/vite | Tailwind Vite 플러그인 |
| typescript | 타입 체크 |
| @types/react, @types/react-dom | React 타입 |
| vite-plugin-pwa | PWA |
| sharp | 아이콘 생성 스크립트 |
