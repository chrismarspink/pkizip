# PKIZIP

전자서명 · 암호화 · 압축 PWA

> **Live:** https://chrismarspink.github.io/pkizip/

## 기능

- **파일 압축** — tar.gz 아카이브
- **전자서명** — 파일에 서명 추가
- **공개키 암호화** — 수신자 지정 암호화 + 서명
- **비밀번호 암호화** — 비밀번호만으로 파일 잠금
- **인증서 관리** — 자체서명 인증서 발급, 로고 이미지 포함
- **다중 키 관리** — 여러 키를 이름으로 관리
- **오프라인 동작** — 네트워크 불필요

## 시작하기

```bash
npm install --legacy-peer-deps
npm run dev
```

## v2.0 — AI 분류 + 가명/익명화 + MIP 라벨 통합

`v2.0` 부터 봉투 생성 전에 **PII 분석 + C/S/O 등급 분류 + 가명/익명화 + 정책 검사**가 포함된다. 모든 분석은 **100% 클라이언트** 에서 실행되며, 텍스트가 서버로 전송되지 않는다.

### 0. 지원 파일 포맷

분석 단계에서 자동 텍스트 추출 (모두 클라이언트 lazy-load):

| 포맷 | 라이브러리 | 비고 |
| --- | --- | --- |
| `.txt .md .csv .json .xml .html .log .yaml .tsv` | `TextDecoder` (네이티브) | UTF-8/cp949/euc-kr 폴백 |
| `.pdf` | `pdfjs-dist@5` (Mozilla) | 텍스트 PDF — 스캔 PDF 는 OCR 권장 |
| `.docx` | `mammoth@1` | Word 문서 |
| `.xlsx .xls` | `xlsx@0.18` (SheetJS) | 엑셀 — 시트별 CSV 변환 후 분석 |
| `.pptx` | `fflate` + XML 직접 파싱 | `<a:t>` 태그 추출 |
| `.hwpx` | `fflate` + XML 직접 파싱 | 한컴 신 포맷 (ZIP+XML) — `<hp:t>` 태그 |
| `.hwp` (바이너리) | `hwp.js@0.0.3` | OLE2 바이너리 — 한계 있음. HWPX 변환 권장 |
| `.jpg .png .gif .bmp .tiff .webp` | Tesseract.js (lazy) | 이미지 OCR — 첫 호출 시 ~30MB 모델 다운로드 |

> ⚠ **HWP 바이너리 한계**: pyhwp 는 Python 전용이라 브라우저 PKIZIP 에선 사용 불가. `hwp.js` 가 대체이지만 복잡한 문서는 추출 실패 가능. **HWPX (한컴오피스 2014+ 신 포맷) 사용 권장** — ZIP+XML 구조라 100% 추출.

### 1. 워크플로 (6단계)

```
[파일 선택]
   ↓
[1] 사용 의도 입력
   • 보관 위치: 내부보관 / 외부전송
   • 암호 방식: classic / hybrid / pqc-only / pqc-he
   ↓
[2] PII 분석 + 등급 분류 (rule-v1)
   • 정규식 + KoELECTRA-NER (옵션) → C / S / O
   • SHAP 토큰 기여도 (옵션, 신경망 통합 시)
   ↓
[3] 가명처리 동의 (디폴트 = 이전 선택)
   ↓
[4] 강등 사이클 — O 등급 도달까지 자동 반복
   ↓
[5] 처리 옵션 표시 + 사용자 결정 디폴트 저장
   ↓
[6] 등급별 분기
   • O → ML-DSA 서명만
   • S → 암호화 (사용자 선택: classic / hybrid / pqc-only)
   • C → 외부 전송 시 PQC 강제 + 가명/익명화 강제
```

### 2. 가명처리 vs 익명화

GDPR Art. 4(5) / 개인정보보호법 정의에 정합:

| 구분 | 정의 | 6 method 매핑 | 매핑 보유 시 복원 |
| --- | --- | --- | --- |
| **가명처리** | 추가정보 없이는 식별 불가, 매핑 별도 보관 | `replace(consistent=true)`, `mask(preserve_last>0)` | ✅ |
| **익명화** | 어떤 수단으로도 식별 불가, 비가역 | `remove`, `replace(consistent=false)`, `generalize`, `shift`, `round`, `mask(전체)` | ❌ |

**매핑 테이블 동봉 정책**: 봉투의 `RECIPIENT_KEYS` 와 동일한 알고리즘(legacy / hybrid / pqc-only) 으로 매핑 테이블을 봉인하여 봉투에 포함. 송신자만 매핑 키 보유 → 가명처리도 안전하게 송신.

### 3. MIP (Microsoft Information Protection) 호환 라벨

봉투 외부에 평문으로 들어가는 라벨 — **복호화 없이 등급 + 암호화 여부 확인 가능**. MS Defender / Office DLP / Purview Information Protection 같은 외부 시스템이 같은 형식 인식.

#### 3.1 봉투 구조

```
.pkizip 봉투
├─ META.json              ← 평문, 누구나 읽음
├─ LABEL.mip.xml          ← MIP 호환 sensitivity label
├─ PAYLOAD.enc            ← 암호화된 본문 (S/C) 또는 평문 (O)
├─ RECIPIENT_KEYS.json    ← ML-KEM 으로 봉인된 CEK 들
├─ MAPPING.sealed (옵션)  ← 가명처리 매핑 테이블 (봉인됨)
├─ SEARCH.bfv (옵션)      ← node-seal BFV 검색키 인덱스
└─ SIGNATURE.mldsa         ← 송신자 ML-DSA 서명 (META + LABEL + PAYLOAD 무결성)
```

#### 3.2 MIP 라벨 XML (LABEL.mip.xml)

```xml
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<MIPLabel xmlns="http://schemas.microsoft.com/office/2020/mipLabelMetadata">
  <SiteId>pkizip-default</SiteId>
  <Enabled>true</Enabled>
  <Method>Standard</Method>
  <ContentBits>0</ContentBits>
  <SetDate>2026-05-02T10:30:00Z</SetDate>
  <LabelId>a8c3e0f1-4b6d-4e2c-9f8a-1b2c3d4e5f60</LabelId>
  <LabelName>Critical</LabelName>
  <SensitivityValue>9</SensitivityValue>
  <Tooltip>이 문서는 PKIZIP 분류 결과 위험(Critical) 등급입니다. 외부 유출 금지.</Tooltip>
</MIPLabel>
```

| 필드 | PKIZIP 매핑 |
| --- | --- |
| `LabelId` | C/S/O 별 [고정 GUID](src/lib/mip/mip-label.ts) |
| `LabelName` | `Critical` / `Sensitive` / `Open` |
| `SensitivityValue` | C=9, S=5, O=0 (MS Purview 호환 0~10) |
| `Method` | `Standard`(강등 가능) / `Privileged`(강등 불가) |
| `SiteId` | 기본 `pkizip-default`, 조직 도입 시 테넌트 GUID |

#### 3.3 META.json (PKIZIP 자체 평문 메타)

```json
{
  "format": "pkizip/v1",
  "grade": "S",
  "encryption": { "kind": "PQC", "kem": "ML-KEM-1024" },
  "doc_meta": { "language": "ko", "ocr_applied": false, "char_count": 1842 },
  "findings_summary": { "KR_RRN": 0, "KR_BIZ_NO": 1 },
  "anonymization": { "applied": true, "is_reversible": true, "mapping_included": true },
  "classifier": { "version": "rule-v1", "confidence": 0.81 },
  "signed_at": "2026-05-02T10:30:00Z"
}
```

#### 3.4 변조 방지

`META.json + LABEL.mip.xml + PAYLOAD.enc` 모두 **ML-DSA-87 서명 대상**에 포함. 등급 외부 변경 시 검증 실패.

#### 3.5 외부 시스템 호환성

- **MS Defender / Purview** — `LABEL.mip.xml` 의 `LabelId` + `SensitivityValue` 인식
- **DLP 게이트웨이** — `META.json` 의 `grade` 만 읽어 송신 차단/허용 결정
- **Office 365** — Office 파일을 봉투 안에 넣되, 같은 라벨을 Office `customXmlPart` 에도 삽입하면 더블 라벨링

### 4. 정책 엔진 (OPA)

- **위치**: 클라이언트 WASM (`public/policy.wasm`) → 서버 호출 0
- **fallback**: TypeScript 직접 평가 — [`src/lib/policy/opa-engine.ts`](src/lib/policy/opa-engine.ts)
- **규칙**: [`src/lib/policy/rules.rego`](src/lib/policy/rules.rego)

주요 거부 사유:
- `C_GRADE_REQUIRES_PQC_FOR_EXTERNAL` — C 등급 외부 전송 시 PQC 강제
- `C_GRADE_REQUIRES_ANONYMIZATION_FOR_EXTERNAL` — C 등급 가명/익명화 강제
- `LANGUAGE_DOWNGRADE_BLOCKED` — 비한국어 + O 등급 외부 전송 차단
- `OCR_C_GRADE_REQUIRES_REVIEW` — OCR + C 등급 수동 검토

### 5. 동형암호 검색키 (옵션)

- **현재 백엔드**: node-seal (Microsoft SEAL WASM)
- **미래 마이그레이션**: openFHE — [`HEEngine`](src/lib/he/he-engine.ts) 인터페이스 추상화
- **활성**: `cryptoKind = pqc-he` 선택 시 `SEARCH.bfv` 봉투에 동봉

### 6. 파일 탐색기 (`/explorer`)

PKIZIP 으로 만든 파일만 표시 — `.pki` / `.pkizip` 확장자만 인식.

- 전체 화면 카드 그리드 (220px+ 너비)
- 등급별 색상 + 아이콘 (C 빨강 / S 노랑 / O 녹색)
- 추가 뱃지: PQC / HE / 서명
- **복호화 없이** 메타 표시 — `readPkiHeader()` 가 첫 ~10KB 만 읽음
- 호버 시 상세 패널 슬라이드 — 분류기 버전, 언어, OCR, findings, MIP 라벨

### 7. 사용자 디폴트 (localStorage 우선)

[`src/lib/store/preferences.ts`](src/lib/store/preferences.ts) — 사용자가 선택한 옵션 자동 기억:

| 키 | 내용 |
| --- | --- |
| `pkizip.prefs.workflow` | 사용 의도 (purpose / cryptoKind) |
| `pkizip.prefs.anonymization` | 가명처리 디폴트 (action / target / 매핑 정책) |
| `pkizip.prefs.policy` | OPA 강제 여부 |
| `pkizip.prefs.explorer` | 탐색기 레이아웃 / 정렬 / 필터 |

### 8. 신규 모듈 한눈에

```
src/lib/
├─ analysis/           ← 분석 파이프라인
│  ├─ types.ts         ← Finding, Classification 등 공통 타입
│  ├─ pii-detector.ts  ← 정규식 + 한국형 PII 8종 + deny-list
│  ├─ classifier.ts    ← rule-v1 (HE-TEST 포팅)
│  ├─ anonymizer.ts    ← 6 method (mask/replace/remove/generalize/shift/round)
│  ├─ anonymization-policy.ts  ← localStorage 영속 정책
│  ├─ ocr.ts           ← Tesseract.js (lazy load)
│  ├─ lang-detect.ts   ← franc-min
│  ├─ explainer.ts     ← 자연어 설명 (rule-explainer-v1)
│  └─ pipeline.ts      ← analyze + downgradeToTarget + anonymizeOnce
├─ policy/             ← 정책 엔진
│  ├─ rules.rego       ← Rego 규칙
│  └─ opa-engine.ts    ← WASM 우선, TS fallback
├─ he/                 ← 동형암호
│  └─ he-engine.ts     ← node-seal 어댑터 + openFHE 자리
├─ mip/                ← MIP 라벨
│  └─ mip-label.ts     ← XML 직렬화 + GUID 매핑
└─ store/
   └─ preferences.ts   ← localStorage 사용자 디폴트
```

---

## 라이선스

이 프로젝트는 [AGPL-3.0](LICENSE) 라이선스로 배포됩니다.

- **오픈소스 사용**: AGPL-3.0 조건에 따라 자유롭게 사용 가능
- **상업적 사용**: 별도 라이선스 문의 — jkkim7202@gmail.com
