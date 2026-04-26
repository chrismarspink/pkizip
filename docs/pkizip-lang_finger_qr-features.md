# pkizip — 3가지 기능 구현 명세

## 구현 범위 개요

- 기능 1: 다국어 지원 (i18n)
- 기능 2: 지문으로 개인키 접근 (Biometric + WebAuthn PRF)
- 기능 3: QR 코드로 인증서 추가

**공통 원칙:**
- 기존 코드 로직 변경 없음
- 오류 수정 없이 3가지 기능만 추가
- 기존 IndexedDB 스키마 변경 없음
- 기존 니모닉/키 관리 구조 유지

---

## 기능 1 — 다국어 지원 (i18n)

### 구현 범위

- 신규: `src/i18n/` 디렉토리
- 신규: `src/i18n/index.ts` — i18n 초기화
- 신규: `src/i18n/locales/ko.json` — 한국어
- 신규: `src/i18n/locales/en.json` — 영어
- 신규: `src/i18n/locales/ja.json` — 일본어
- 신규: `src/i18n/locales/zh.json` — 중국어 (간체)
- 수정: 모든 페이지/컴포넌트 — 하드코딩 문자열 → i18n 키로 교체
- 수정: `src/pages/SettingsPage.tsx` — 언어 선택 UI 추가

### 라이브러리

```bash
npm install i18next react-i18next
```

### 디렉토리 구조

```
src/
  i18n/
    index.ts          ← i18n 초기화
    locales/
      ko.json         ← 한국어 (기본값)
      en.json         ← 영어
      ja.json         ← 일본어
      zh.json         ← 중국어 간체
```

### i18n 초기화 (`src/i18n/index.ts`)

```typescript
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ko from './locales/ko.json';
import en from './locales/en.json';
import ja from './locales/ja.json';
import zh from './locales/zh.json';

// IndexedDB에서 저장된 언어 설정 로드
const savedLang = localStorage.getItem('pkizip_lang') || 'ko';

i18n
  .use(initReactI18next)
  .init({
    resources: { ko: { translation: ko }, en: { translation: en },
                 ja: { translation: ja }, zh: { translation: zh } },
    lng: savedLang,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });

export default i18n;
```

### 번역 키 구조 (ko.json 기준)

```json
{
  "common": {
    "cancel": "취소",
    "confirm": "확인",
    "delete": "삭제",
    "save": "저장",
    "close": "닫기",
    "next": "다음",
    "back": "뒤로",
    "loading": "로딩 중...",
    "error": "오류가 발생했습니다",
    "success": "완료되었습니다"
  },
  "nav": {
    "create": "생성",
    "files": "파일",
    "certificates": "인증서",
    "settings": "설정"
  },
  "settings": {
    "title": "설정",
    "identity": "내 아이덴티티",
    "language": "언어",
    "languageDesc": "앱 표시 언어를 선택하세요",
    "biometric": "생체 인증 등록 (Touch ID, 지문, Face ID 등)",
    "pin": "PIN 등록 (4~6자리 빠른 잠금 해제)",
    "lock": "잠금 해제",
    "locked": "잠김",
    "unlocked": "잠금 해제됨"
  },
  "certificates": {
    "title": "내 인증서",
    "subtitle": "인증서 상세 정보와 아바타를 확인하세요",
    "active": "활성",
    "expired": "만료",
    "revoked": "폐지",
    "fingerprint": "핑거프린트",
    "issuedAt": "발급일",
    "expiresAt": "만료일",
    "serial": "시리얼",
    "copyPem": "PEM 복사",
    "export": "내보내기",
    "addByQr": "QR로 인증서 추가",
    "scanQr": "QR 코드 스캔"
  },
  "biometric": {
    "title": "생체 인증",
    "register": "생체 인증 등록",
    "authenticate": "생체 인증으로 잠금 해제",
    "notSupported": "이 기기는 생체 인증을 지원하지 않습니다",
    "registerSuccess": "생체 인증이 등록되었습니다",
    "registerFail": "생체 인증 등록에 실패했습니다",
    "authFail": "생체 인증에 실패했습니다"
  },
  "qr": {
    "title": "QR 코드로 인증서 추가",
    "scan": "QR 코드를 스캔하세요",
    "scanning": "스캔 중...",
    "detected": "QR 코드가 감지되었습니다",
    "addFriend": "친구 인증서 추가",
    "friendName": "이름 (선택)",
    "confirmAdd": "이 인증서를 신뢰 목록에 추가하시겠습니까?",
    "addSuccess": "인증서가 추가되었습니다",
    "addFail": "인증서 추가에 실패했습니다",
    "invalidQr": "유효하지 않은 QR 코드입니다",
    "fingerprint": "핑거프린트",
    "verifyFingerprint": "상대방에게 핑거프린트를 확인하세요"
  },
  "mnemonic": {
    "recover": "니모닉으로 복구",
    "word": "단어",
    "enterWords": "니모닉 단어를 입력하세요",
    "invalid": "유효하지 않은 니모닉입니다",
    "success": "키가 성공적으로 복구되었습니다"
  }
}
```

### 컴포넌트 적용 방식

```typescript
// 기존 하드코딩
<button>취소</button>
<h1>내 인증서</h1>

// i18n 적용 후
import { useTranslation } from 'react-i18next';

const { t } = useTranslation();
<button>{t('common.cancel')}</button>
<h1>{t('certificates.title')}</h1>
```

### 설정 페이지 언어 선택 UI

```
[ 언어 / Language ]

  ● 한국어
  ○ English
  ○ 日本語
  ○ 中文(简体)

→ 선택 즉시 앱 전체 언어 변경
→ localStorage 저장
```

### IndexedDB 저장

```typescript
// settings store에 추가
'app_language': string  // 'ko' | 'en' | 'ja' | 'zh'
```

---

## 기능 2 — 지문으로 개인키 접근 (Biometric)

### 배경

```
현재:
  PIN(PBKDF2)으로 개인키 래핑/언래핑

추가:
  WebAuthn PRF Extension으로
  지문/Face ID에서 래핑키 파생
  → 지문 인증 시 개인키 자동 언래핑
```

### 구현 범위

- 수정: `src/lib/biometric.ts` — PRF extension 기반 키 파생 추가
- 신규: `src/lib/biometric-key.ts` — 생체인증 키 등록/해제 로직
- 수정: `src/pages/SettingsPage.tsx` — 생체인증 등록 UI 개선
- 수정: 잠금 해제 화면 — 지문 버튼 추가

### 핵심 원리

```
WebAuthn PRF Extension:
  생체인증 시 → 결정론적 PRF 출력값 생성
  PRF 출력값 → AES-GCM 래핑키로 변환
  래핑키 → 개인키 언래핑

특징:
  생체정보 자체는 전송/저장 안 됨
  PRF 출력값만 사용
  같은 기기 + 같은 생체 = 같은 PRF 출력
```

### biometric-key.ts (신규)

```typescript
// 생체인증 등록 (PRF Extension 포함)
export async function registerBiometricKey(
  userId: string,
  privateKeyEncrypted: Uint8Array
): Promise<boolean>

// 등록 과정:
// 1. WebAuthn credential 생성 (PRF extension 포함)
// 2. PRF 출력값으로 래핑키 생성
// 3. 개인키를 래핑키로 재암호화
// 4. IndexedDB에 저장:
//    biometric_credential_id: string
//    biometric_wrapped_key: Uint8Array
//    biometric_salt: Uint8Array

// 생체인증으로 개인키 언래핑
export async function unlockWithBiometric(): Promise<CryptoKey | null>

// 언래핑 과정:
// 1. WebAuthn assertion (PRF extension 포함)
// 2. PRF 출력값으로 래핑키 복원
// 3. 개인키 언래핑
// 4. 메모리에 CryptoKey 반환 (저장 안 함)

// 생체인증 등록 여부 확인
export async function isBiometricRegistered(): Promise<boolean>

// 생체인증 삭제
export async function removeBiometricKey(): Promise<void>
```

### WebAuthn PRF 구현

```typescript
// 등록
const credential = await navigator.credentials.create({
  publicKey: {
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    rp: { name: 'pkizip', id: window.location.hostname },
    user: {
      id: new TextEncoder().encode(userId),
      name: userId,
      displayName: 'pkizip User'
    },
    pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      userVerification: 'required',
      residentKey: 'preferred'
    },
    extensions: {
      prf: {
        eval: {
          first: await deriveSalt('pkizip-key-wrapping', userId)
        }
      }
    }
  }
});

// PRF 출력값 추출
const prfResult = credential
  .getClientExtensionResults()
  ?.prf?.results?.first;

if (!prfResult) {
  // PRF 미지원 기기 → PIN 방식 유지
  return false;
}

// PRF 출력값 → 래핑키
const wrappingKey = await crypto.subtle.importKey(
  'raw', prfResult,
  { name: 'AES-GCM' },
  false,
  ['wrapKey', 'unwrapKey']
);
```

### 지원 여부 감지

```typescript
export async function checkBiometricSupport(): Promise<{
  supported: boolean;
  prfSupported: boolean;
  reason?: string;
}> {
  // 1. WebAuthn 자체 지원 여부
  if (!window.PublicKeyCredential) {
    return { supported: false, prfSupported: false,
             reason: 'WebAuthn 미지원' };
  }

  // 2. 플랫폼 인증자 지원 여부
  const available = await PublicKeyCredential
    .isUserVerifyingPlatformAuthenticatorAvailable();
  if (!available) {
    return { supported: false, prfSupported: false,
             reason: '생체인증 하드웨어 없음' };
  }

  // 3. PRF Extension 지원 여부 (테스트 credential)
  // macOS Chrome: 저장위치 다이얼로그 → 사용자 안내
  // Android: 지문 프롬프트만
  // iOS Safari: Touch ID만
  return { supported: true, prfSupported: true };
}
```

### 잠금 해제 화면 UI 변경

```
현재:
  [ PIN 입력 ]  [ 취소 ]

변경 후:
  [ 🔑 지문으로 잠금 해제 ]   ← 생체인증 등록 시 표시
  [ PIN으로 잠금 해제 ]
  [ 니모닉으로 복구 ]
```

### 설정 페이지 생체인증 섹션

```
[ 생체 인증 ]

상태: 미등록 / 등록됨

[ 생체 인증 등록 ]
  → Touch ID / 지문 / Face ID 선택 다이얼로그
  → 인증 성공 시 등록 완료

[ 생체 인증 해제 ]  ← 등록된 경우만 표시
```

### IndexedDB 저장 키 추가

```typescript
'biometric_credential_id' : string      // credential ID
'biometric_wrapped_key'   : Uint8Array  // PRF로 래핑된 개인키
'biometric_salt'          : Uint8Array  // PRF 입력 salt
'biometric_iv'            : Uint8Array  // AES-GCM IV
'biometric_enabled'       : boolean     // 등록 여부
```

### macOS Chrome 저장위치 다이얼로그 대응

```typescript
// macOS Chrome에서 다이얼로그가 뜨는 경우
// 사용자 안내 메시지 표시:

if (isMacChrome()) {
  showToast(
    t('biometric.macChromeGuide'),
    // "저장 위치 선택 시 '내 Chrome 프로필'을 선택하세요"
  );
}
```

---

## 기능 3 — QR 코드로 인증서 추가

### 배경

```
현재:
  인증서 URL 직접 입력으로 친구 추가

추가:
  QR 코드 스캔 → 인증서 자동 파싱 → 친구 목록 추가
  QR 코드 생성 → 내 인증서 QR로 공유
```

### 구현 범위

- 신규: `src/lib/qr-scanner.ts` — QR 스캔 로직
- 신규: `src/lib/qr-generator.ts` — QR 생성 로직
- 신규: `src/components/QrScanModal.tsx` — 스캔 UI
- 신규: `src/components/QrDisplayModal.tsx` — 내 QR 표시 UI
- 수정: `src/pages/CertificatesPage.tsx` — QR 추가 버튼

### 라이브러리

```bash
npm install jsQR qrcode
# jsQR: QR 스캔 (카메라 스트림)
# qrcode: QR 이미지 생성
```

### QR 코드 데이터 포맷

```json
{
  "type": "pkizip-cert",
  "version": 1,
  "email": "bbb@company.com",
  "fingerprint": "0x0e732654",
  "url": "https://pkizip.com/cert/bbb-company-com",
  "pubkey": "-----BEGIN PUBLIC KEY-----\nMFkw...\n-----END PUBLIC KEY-----"
}
```

```
QR에 포함:
  type: pkizip 인증서 QR임을 식별
  version: 포맷 버전 (호환성)
  email: 인증서 소유자 이메일
  fingerprint: 빠른 검증용
  url: 인증서 URL (갱신 구독용)
  pubkey: 현재 공개키 PEM (오프라인 추가용)

보안:
  공개키만 포함 (개인키 절대 불포함)
  QR 크기 최적화를 위해 pubkey는 선택적
```

### qr-generator.ts (신규)

```typescript
import QRCode from 'qrcode';

export async function generateCertQr(
  email: string,
  fingerprint: string,
  certUrl: string,
  publicKeyPem: string
): Promise<string> {  // base64 PNG 반환

  const data = JSON.stringify({
    type: 'pkizip-cert',
    version: 1,
    email,
    fingerprint,
    url: certUrl,
    pubkey: publicKeyPem
  });

  return await QRCode.toDataURL(data, {
    errorCorrectionLevel: 'M',
    width: 300,
    margin: 2,
    color: {
      dark: '#000000',
      light: '#FFFFFF'
    }
  });
}
```

### qr-scanner.ts (신규)

```typescript
import jsQR from 'jsqr';

export interface QrScanResult {
  valid: boolean;
  data?: {
    email: string;
    fingerprint: string;
    url: string;
    pubkey: string;
  };
  error?: string;
}

// 카메라 스트림에서 QR 스캔
export async function startQrScan(
  videoElement: HTMLVideoElement,
  onDetected: (result: QrScanResult) => void
): Promise<() => void>  // cleanup 함수 반환

// 구현:
// 1. navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }})
// 2. canvas에 프레임 그리기
// 3. jsQR로 QR 감지
// 4. JSON 파싱 → pkizip-cert 타입 확인
// 5. onDetected 콜백 호출

// 단일 이미지에서 QR 스캔
export function scanQrFromImage(imageData: ImageData): QrScanResult
```

### QrScanModal.tsx (신규)

```
UI 구성:

┌────────────────────────────┐
│  QR 코드로 인증서 추가     │  ← 헤더
├────────────────────────────┤
│                            │
│   [ 카메라 뷰파인더 ]      │  ← 카메라 스트림
│   스캔 중...               │
│                            │
├────────────────────────────┤
│  감지됨:                   │
│  bbb@company.com           │  ← 스캔 결과
│  핑거프린트: 0x0e732654    │
├────────────────────────────┤
│  이름 (선택):              │
│  [ 홍길동              ]   │  ← 메모 입력
├────────────────────────────┤
│  ⚠️ 상대방에게 핑거프린트  │
│     확인을 권장합니다      │
├────────────────────────────┤
│  [ 취소 ]  [ 신뢰 추가 ]  │
└────────────────────────────┘
```

### QrDisplayModal.tsx (신규)

```
UI 구성:

┌────────────────────────────┐
│  내 인증서 QR 코드         │  ← 헤더
├────────────────────────────┤
│                            │
│      [ QR 이미지 ]         │  ← 300x300 QR
│                            │
├────────────────────────────┤
│  bbb@company.com           │
│  핑거프린트: 0x0e732654    │
├────────────────────────────┤
│  [ QR 저장 ]  [ 공유 ]    │
└────────────────────────────┘
```

### CertificatesPage 수정

```typescript
// 기존 버튼에 추가
<button onClick={() => setShowQrScan(true)}>
  {t('certificates.addByQr')}
</button>

// 내 인증서 카드에 QR 표시 버튼 추가
<button onClick={() => setShowMyQr(cert)}>
  QR 보기
</button>
```

### QR 스캔 후 처리 흐름

```
QR 스캔 성공
    ↓
pkizip-cert 타입 확인
    ↓
이미 추가된 인증서인지 확인
  → 중복 시: "이미 등록된 인증서입니다"
    ↓
핑거프린트 표시 + 확인 UI
    ↓
사용자 "신뢰 추가" 클릭
    ↓
IndexedDB friends 저장:
  {
    email: string,
    fingerprint: string,
    cert_url: string,
    cert_pem_cache: string,
    memo: string,
    trusted_since: Date,
    last_fetched_at: Date
  }
    ↓
"인증서가 추가되었습니다" 토스트
```

### 카메라 권한 처리

```typescript
// 권한 거부 시 안내
if (error.name === 'NotAllowedError') {
  showError(t('qr.cameraPermissionDenied'));
  // "카메라 권한이 필요합니다. 브라우저 설정에서 허용해주세요."
}

// 카메라 없는 기기
if (error.name === 'NotFoundError') {
  showError(t('qr.noCameraFound'));
  // "카메라를 찾을 수 없습니다."
}
```

---

## 구현 순서 (권장)

```
1. 다국어 (기능 1)
   i18n 설정 → ko/en 번역 파일
   → 전체 컴포넌트 적용
   → ja/zh 번역 파일 추가
   → 설정 UI 언어 선택기

2. 지문 인증 (기능 2)
   checkBiometricSupport()
   → biometric-key.ts 구현
   → 잠금 해제 화면 UI 수정
   → 설정 페이지 등록 UI
   → IndexedDB 키 추가

3. QR 코드 (기능 3)
   qr-generator.ts
   → qr-scanner.ts
   → QrDisplayModal.tsx
   → QrScanModal.tsx
   → CertificatesPage 버튼 추가
```

---

## 주의사항

### 기능 1 (다국어)
- 기존 한국어 텍스트가 많으므로 ko.json 완성 후 en.json 번역
- 날짜 포맷도 로케일별 처리 필요 (ko: YYYY년 MM월 DD일, en: MM/DD/YYYY)
- RTL 언어 추후 추가 시 CSS 방향 고려

### 기능 2 (지문)
- macOS Chrome = 저장위치 다이얼로그 → 안내 메시지 표시
- PRF Extension 미지원 기기 → PIN 방식으로 자동 폴백
- 생체인증 등록 실패 시 에러 메시지 i18n 키 사용

### 기능 3 (QR)
- QR 데이터에 공개키 포함 시 크기가 커짐 → url만 포함하는 경량 모드 옵션
- iOS Safari = 카메라 접근 HTTPS 필요 (localhost 예외)
- jsQR = 실시간 스캔 성능 확인 필요 (저사양 기기)
