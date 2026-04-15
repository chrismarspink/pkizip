# PKIZIP

**CMS(RFC 5652) 기반 전자서명 · 암호화 · 압축 PWA**

BIP39 니모닉으로 키를 파생하여 로컬에서만 동작하는 보안 컨테이너 도구. 외부 서버 의존 없이 브라우저에서 파일을 서명 · 암호화하고 `.pki` 컨테이너로 배포합니다.

> **Live:** https://chrismarspink.github.io/pkizip/

---

## 특징

- **4가지 CMS 메시지 타입**
  - `CompressedMessage` — tar.gz 압축
  - `SignedMessage` — ECDSA P-256 전자서명
  - `EnvelopedMessage` — ECDH 공개키 다중 수신자 암호화 (+서명)
  - `EncryptedMessage` — AES-256-GCM 비밀번호 암호화 (+선택적 서명)

- **키 관리**
  - BIP39 12단어 니모닉 + BIP32 HD 키 파생
  - 다중 아이덴티티 (이름별로 관리)
  - 자체서명 X.509 인증서 자동 발급
  - 로고 이미지 인증서 임베딩 (RFC 3709 logotype extension)

- **잠금 해제 3경로**
  - 생체 인증 (WebAuthn PRF — Touch ID / Face ID / Windows Hello)
  - PIN (4~6자리 빠른 잠금 해제)
  - 비밀번호 (PBKDF2-SHA256 600k iterations)

- **완전 로컬**
  - 개인키는 IndexedDB에 AES-GCM 래핑되어 저장
  - 외부 서버 호출 없음
  - 오프라인 서명/복호화 동작
  - PWA 설치 가능

---

## 기술 스택

| 영역 | 라이브러리 |
|------|-----------|
| 프레임워크 | React 19 + TypeScript + Vite |
| 스타일 | Tailwind CSS 4 |
| 애니메이션 | Framer Motion |
| UI 프리미티브 | Radix UI |
| 가상 스크롤 | TanStack Virtual |
| PWA | vite-plugin-pwa |
| 키 파생 | `@scure/bip39`, `@scure/bip32` |
| 타원곡선 | `@noble/curves` (P-256) |
| 해시 | `@noble/hashes` (SHA-256) |
| CMS/X.509 | `pkijs`, `asn1js` |
| 압축 | `fflate` + 내장 tar |
| 저장소 | IndexedDB (`idb`) |

---

## 개발

```bash
npm install --legacy-peer-deps
npm run dev      # http://localhost:5173
npm run build    # dist/ 빌드
npm run preview  # 빌드 결과 미리보기
```

---

## 보안 설계

1. **개인키는 절대 서버로 전송되지 않음** — 모든 암호화 연산은 브라우저 SubtleCrypto로 수행
2. **시드 래핑** — PBKDF2(600,000) + AES-256-GCM
3. **생체 인증** — WebAuthn PRF Extension으로 시드를 **직접** 암호화 (플랫폼 키체인 동기화 차단: `residentKey: 'discouraged'`, `hints: ['client-device']`)
4. **inner payload** — EncryptedMessage의 서명은 암호화 **내부**에 포함 → 복호화해야만 서명 존재 여부 확인 가능
5. **니모닉 복원** — 기기 변경 시 BIP39 12단어로 재생성 (백업은 니모닉만)

---

## 라이선스

(미정)

---

## Disclaimer

이 프로젝트는 연구/교육 목적의 프로토타입입니다. 프로덕션 환경에서는 별도의 보안 감사 후 사용하세요.
