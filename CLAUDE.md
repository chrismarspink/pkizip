# pkizip PWA — 프로젝트 컨텍스트

## 서비스 개요

CMS(Cryptographic Message Syntax) 포맷 기반 전자서명·암호화 PWA.
주 사용 환경은 **PC 브라우저** (문서 서명, 파일 처리는 PC 작업).
모바일은 동일 코드베이스의 반응형 전환으로 지원.

---

## 기술 스택

| 역할 | 라이브러리 |
|------|-----------|
| 프레임워크 | React + TypeScript + Vite |
| 스타일 | Tailwind CSS (반응형 유틸리티) |
| 카드·애니메이션 | Framer Motion (드래그, 스프링, layoutId) |
| 헤드리스 UI | Radix UI (Dialog, Tabs, DropdownMenu) |
| 바텀시트 | vaul (모바일 전용, shadcn/ui 통합) |
| 가상 스크롤 | TanStack Virtual (파일 리스트 수천 개 대응) |
| PWA | vite-plugin-pwa (manifest + service worker 자동 생성) |
| 반응형 훅 | useMediaQuery (네비게이션·오버레이 전환 판단) |

---

## 코어 라이브러리 (변경 금지)

- `@scure/bip39`, `@scure/bip32` — BIP39/BIP32 니모닉 키 파생
- `@noble/curves/nist.js` — P-256 곡선 연산 (import 시 `.js` 확장자 필수)
- `@noble/hashes/sha2.js` — SHA-256 (import 시 `.js` 확장자 필수)
- `pkijs`, `asn1js` — X.509 인증서 생성/파싱
- `fflate` — gzip 압축/해제
- `zustand` — 클라이언트 상태 관리
- `idb` — IndexedDB 래퍼 (키/인증서 영구 저장)

---

## 레이아웃 전략 (PC 우선)

pkizip은 파일 서명·암호화 도구이므로 **PC가 1등 시민**이다.
카카오페이·토스처럼 모바일 쉘을 PC 중앙에 띄우는 방식을 쓰지 않는다.
넓은 화면을 적극 활용하고, 동일 컴포넌트가 뷰포트에 따라 형태를 바꾼다.

### 브레이크포인트 3단계

```
~640px      모바일       풀스크린 앱
641~1024px  태블릿       사이드바(아이콘) + 메인 풀폭
1025px~     데스크탑     3컬럼: 사이드바 + 파일리스트 + 상세패널
```

### 모바일 (~640px)
- 풀스크린, `100dvh`
- **하단 탭바** (thumb zone 준수)
- 오버레이 = **바텀시트** (vaul, y축 드래그)
- 카드 풀폭, 인증서 월렛 스택 카드

### 태블릿 (641~1024px)
- **좌측 아이콘 사이드바** (48px 고정폭, 툴팁 레이블)
- 메인 콘텐츠 영역 풀폭 사용
- 오버레이 = 중앙 모달 (Radix Dialog)
- `max-width` 제한 없음

### 데스크탑 (1025px~)
- **3컬럼 레이아웃** (Notion·Figma·VS Code 패턴 참고)
  - 좌측: 아이콘 사이드바 (60px)
  - 중앙: 파일 리스트 패널 (280px 고정)
  - 우측: 선택 파일 상세 + 서명·암호화 액션 (나머지 폭)
- 키보드 단축키 지원 (Cmd+S 서명, Cmd+E 암호화 등)
- 드래그앤드롭 파일 추가
- 오버레이 = 중앙 모달

---

## 컴포넌트 전환 규칙

### 네비게이션
```tsx
const isMobile = useMediaQuery('(max-width: 640px)');
return isMobile ? <BottomTabBar /> : <SidebarNav />;
```

### 오버레이 (인증서 선택, 서명 확인 등)
```tsx
const isMobile = useMediaQuery('(max-width: 640px)');
return isMobile ? <Drawer.Root> : <Dialog.Root>;
```

### 파일 리스트
- 모바일: 풀폭 카드 리스트 (세로 스크롤)
- 태블릿: 풀폭 카드 리스트
- 데스크탑: 좌측 280px 고정 패널 내 리스트
- 공통: TanStack Virtual 가상 스크롤 적용

---

## UI 원칙

### 인증서 (카드 패턴)
- 신용카드 비율 (85.6 × 53.98mm 기준)
- 모바일: Apple Wallet 스타일 세로 스택 (탭하면 펼침)
- 데스크탑: 가로 스크롤 카드 선택 또는 드롭다운

### 파일 선택
- 카드형 리스트 (파일 아이콘 + 이름 + 메타 + 체크)
- 선택 시 `border` 강조 + 체크 애니메이션 (Framer Motion)
- 다중 선택 지원

### 인증 이력
- 시간순 피드 리스트
- 상태 도트 (성공 green / 실패 red)

### 색상 체계
```css
--brand-primary: #1DC078;   /* pkizip 그린 */
--cert-yellow:   #FFE500;   /* 카카오 인증서 */
--cert-navy:     #1A3C5E;   /* 외부 인증서 */
```

---

## CMS 메시지 타입 (4가지)

1. **CompressedMessage** — tar.gz 압축만 (키 불필요)
2. **SignedMessage** — 압축 + ECDSA P-256 서명 (키 필요)
3. **EnvelopedMessage** — 압축 + 서명 + ECDH 공개키 암호화 (키 필요)
4. **EncryptedMessage** — 압축 + AES-256-GCM 비밀번호 암호화 (키 불필요, 선택적 서명 가능)

---

## 보안 설계 원칙

- 서명은 암호화 내부에 포함 (복호화해야만 서명 확인 가능)
- 개인키는 절대 서버에 전송하지 않음 (IndexedDB + PBKDF2 래핑)
- 다중 아이덴티티: 이름 붙여서 여러 니모닉 관리, 전환 가능
- inner-payload 포맷: `[flags][sig-length][signatures-json][compressed-data]`

---

## 도메인 지식

### 인증서 종류
- 카카오 인증서 (외부, 2028년까지)
- pkizip 자체서명 인증서 (기본 키, 10년)
- 한국산업인력공단 자격확인서 (89일 남음)
- 기타 외부 인증서 (PKCS#12 가져오기)

### CMS 포맷 작업 흐름
```
파일 선택 → 인증서 선택 → 옵션(서명/암호화/둘다) → 처리 → 다운로드
```

### 지원 파일 형식
- 입력: 모든 파일 형식
- 출력: `.p7s` (서명), `.p7m` (암호화), `.p7` (서명+암호화)

---

## PWA 설정

```json
{
  "name": "pkizip",
  "short_name": "pkizip",
  "display": "standalone",
  "theme_color": "#1DC078",
  "background_color": "#ffffff"
}
```

- PC 브라우저에서 설치 배너 노출 (`beforeinstallprompt`)
- `display: standalone` 설치 후 독립 창 동작
- 오프라인: 인증서 목록·이력 캐시 (IndexedDB)

---

## Node.js 호환 주의사항

- Node 23+에서 `Uint8Array` → `BufferSource` 타입 불호환
- `buf()` 헬퍼 사용: `const buf = (data: Uint8Array): BufferSource => data as unknown as BufferSource`
- `@scure/bip39/wordlists/english.js` — `.js` 확장자 필수

---

## 개발 시 주의사항

- `max-width` 제한으로 모바일 쉘을 PC 중앙에 띄우는 패턴 금지
- 하단 탭바는 모바일 전용 (`max-width: 640px` 미디어 쿼리)
- 바텀시트(vaul)는 모바일 전용 — PC에서는 반드시 Dialog로 대체
- 파일 경로·이름은 한글 포함 가능, 인코딩 처리 필수
- 인증서 민감정보(개인키)는 절대 로컬스토리지 저장 금지 → IndexedDB + 암호화
