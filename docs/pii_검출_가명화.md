# PKIZIP — PII 검출·가명화·등급 분류

> 본 문서는 PKIZIP 봉투 생성 단계에 추가된 **클라이언트 측 PII 분석 + 등급 분류 + 가명/익명화 + 사용자 최종 결정 학습 루프**의 설계와 구현을 다룹니다. 모든 처리는 브라우저 안에서 수행되며, 본문은 PKIZIP 외부로 전송되지 않습니다.
>
> 마지막 갱신: 2026-05-02

---

## 0. 워크플로 한눈에

```
파일 선택
  └─▶ 텍스트 추출 (PDF/DOCX/XLSX/PPTX/HWP/HWPX/이미지 OCR)
        └─▶ 언어 감지 (franc-min)
              └─▶ PII 탐지 (정규식 + denylist + ─선택─ 신경망 NER)
                    └─▶ rule-v1.2 분류기 → C/S/O 등급 + 점수 + 신뢰도
                          └─▶ AnalysisDialog (이번 작업의 중심)
                                ├─ 사용 의도 (internal/external × classic/hybrid/pqc-only/pqc-he)
                                ├─ 등급 카드 + 자연어 설명
                                ├─ 본문 하이라이트 (PII = 빨강 / 등급 키워드 = 호박)
                                ├─ 판정 근거 표 ★
                                ├─ 분류 모델 설명 ★
                                ├─ 사용자 최종 분류 picker ★ → IndexedDB
                                ├─ 전체 findings 표 ★
                                ├─ 가명/익명화 (자동 적용 → O 등급 강등 사이클)
                                └─ OPA 정책 평가 → 통과 시 봉투 생성
```

★ = 2026-05-02 추가분.

---

## 1. 텍스트 추출 — 다중 포맷

[`pkizip/src/lib/analysis/text-extractor.ts`](../src/lib/analysis/text-extractor.ts)

| 포맷 | 라이브러리 | 비고 |
|------|------------|------|
| **PDF** | pdfjs-dist | Vite `?url` worker import + unpkg CDN 폴백, "Invalid workerSrc" 회피 |
| **DOCX** | mammoth | extractRawText |
| **XLSX** | SheetJS | sheet 별 `sheet_to_csv` |
| **PPTX** | fflate + 정규식 | `<a:t>` 태그 파싱 |
| **HWPX** | fflate + 정규식 | `<hp:t>` 태그 파싱 (한글 워드프로세서 ZIP 컨테이너) |
| **HWP** | hwp.js | `cfb.read(input, { type: 'array' })` 옵션 — `input.replace` 에러 회피 |
| **이미지** | tesseract.js | kor + eng 워커 |
| 인코딩 | UTF-8 → cp949 → euc-kr 폴백 | 디코딩 실패 시 다음 후보 |

호출 측에서는 `extractText(file)` 한 함수로 모든 포맷을 흡수합니다. 추출 실패 시 `{ ok: false, reason }` 반환 (분석 건너뜀).

---

## 2. PII 탐지

[`pkizip/src/lib/analysis/pii-detector.ts`](../src/lib/analysis/pii-detector.ts) · [`ner-filter.ts`](../src/lib/analysis/ner-filter.ts) · [`neural-ner.ts`](../src/lib/analysis/neural-ner.ts)

### 2.1 정규식 + denylist
- 한국 RRN, 사업자번호, 여권, 면허, 외국인등록, 건강보험, 자동차번호, 법인등록
- 글로벌: SSN, 신용카드, IBAN, AWS Access Key, 일반 API 키, IP, 이메일, 전화, URL, 날짜
- **GENERIC_API_KEY** 는 prefix 한정 패턴 (`sk-…`, `ghp_…`, `gho_…`, `xoxb-…`, `glpat-…`)
- **IP_ADDRESS** 는 옥텟 검증 + 버전 번호(예: `1.0.0`) 거부

### 2.2 신경망 NER (옵트인)
[`prefs.neural`](../src/lib/store/preferences.ts) → `nerEnabled` / `nerAutoLoad` / `nerMinScore`. transformers.js INT8 + WebGPU/WASM, 모델 후보 `Xenova/bert-base-multilingual-cased-ner-hrl`. BIO 그룹화로 `B-PER + I-PER` 단일 엔티티 결합.

### 2.3 NER 휴리스틱 필터 (★ 한국어 false positive 차단)
[`ner-filter.ts`](../src/lib/analysis/ner-filter.ts) — HE-TEST `ner_filter.py` 포팅.

- `source === 'koner'` 또는 `recognizer.includes('neural-ner')` 인 PERSON/LOCATION/ORG 만 검사 (정규식·denylist 출처는 그대로 통과)
- **PERSON** — 길이 2~4 + 순한글 + 첫글자가 KR 성씨 30종 + 메타 접두어/조사 끝맺음 X
- **LOCATION** — 길이 2~8 + 순한글 + 메타 접두어/조사 끝맺음 X
- **ORGANIZATION** — 길이 2~14 + 다국어 허용 + 조사 끝맺음 X
- 거부된 항목은 `dropStats()` 로 사유별 집계 (debug)

`pipeline.analyzeAsync` 가 NER findings 를 필터링한 뒤 정규식 결과와 `mergeFindings()` (start|end|entityType 키 dedup, 최고 점수 보존)로 합칩니다.

---

## 3. 분류기 — rule-v1.2

[`pkizip/src/lib/analysis/classifier.ts`](../src/lib/analysis/classifier.ts)

### 3.1 점수식

```
score = Σ(entity_weight × count) + Σ(keyword_weight × decayedCount × lengthNorm)

decayedCount  = min( min(effectiveCount, KW_COUNT_CAP=3), 1 + ln(effectiveCount) )
effectiveCount = Σ contextWeight(occurrence)
lengthNorm    = min(1, 2000 / max(textLen, 2000))
keywordScore  = entityScore > 0 ? raw : raw × 0.5      // 키워드 단독 감쇠
```

### 3.2 임계값
| 등급 | 조건 |
|------|------|
| **C — 위험** | score ≥ 5.0 |
| **S — 민감** | score ≥ 3.0 (HE-TEST 의 2.0 → 3.0 상향, 메타 문서 false positive 차단) |
| **O — 공개** | score < 3.0 |

비한국어 문서는 `applyLanguageFloor()` 가 O → S 로 상향 (탐지 정확도 보정).

### 3.3 컨텍스트 가중치 [`contextWeight()`](../src/lib/analysis/classifier.ts)

같은 키워드라도 본문에서 어떻게 쓰였는지에 따라 신호 강도 보정:

| 패턴 | 가중치 |
|------|--------|
| 부정문 (`X 가 아닙니다`, `not X`, `X 없음`) | 0.0 |
| 표 헤더 / 마크다운 셀 (`\| X \|`) | 0.0 |
| 코드 블록 / 따옴표 / 백틱 | 0.3 |
| 라벨 정의 (`예: X`, `label = X`) | 0.2 |
| 점수 설명 (`X (가중치 N)`) | 0.3 |
| 사전 항목 (`• X`) | 0.4 |
| MIP 명세 인용 (`sensitivity: X`) | 0.2 |
| 일반 평서문 | **1.0** |

이 보정 덕분에 PII 보호 제안서 같은 메타 문서가 등급 키워드만으로 S/C 로 잘못 분류되지 않습니다.

### 3.4 신뢰도
`confidence = 0.55 + 0.4 × tanh(margin/2)` — 임계값에서 멀어질수록 ↑.

### 3.5 강등 사이클
[`pipeline.downgradeToTarget()`](../src/lib/analysis/pipeline.ts) — `apply → analyze → if grade > target: again` 를 `policy.maxIterations` 까지. **키워드 마스킹 2nd pass** ([`anonymizer.applyKeywordMasking`](../src/lib/analysis/anonymizer.ts)) 가 추가되어, findings 에 잡히지 않는 등급 키워드도 마스킹 → C 등급 deadlock 해결.

---

## 4. 가명/익명화

[`pkizip/src/lib/analysis/anonymizer.ts`](../src/lib/analysis/anonymizer.ts)

6가지 method — `mask` / `remove` / `replace` / `generalize` / `shift` / `round`. policy 단위로 entity 별 method + parameter 지정. `isReversible` 플래그로 가명(true) / 익명(false) 구분.

UI 측면에서는:
- 다이얼로그 진입 시 **자동 적용** — `defaultAction !== 'skip'` 이고 등급 ≠ O 면 즉시 실행 (사용자 클릭 없이 권장 처리 완료)
- 적용 전 → 후 등급, replacements 건수, 매핑 키 개수, 가역성 표시

---

## 5. AnalysisDialog UI — 2026-05-02 추가분 ★

[`pkizip/src/components/dialogs/AnalysisDialog.tsx`](../src/components/dialogs/AnalysisDialog.tsx)

HE-TEST 의 PII Scanner 화면이 명확히 보여주던 **(a) 판정 근거 표 (b) 분류 모델 설명 (c) 사용자 최종 분류 picker (d) 전체 findings 표** 를 PKIZIP 다이얼로그에 동등 추가.

### 5.1 판정 근거 표
- 컬럼: 종류 / 신호 / 개수 / 가중치 / 기여도 + 막대 그래프
- 막대 색상: entity=빨강 / keyword=호박 / language=파랑
- `count → effective` 표기로 컨텍스트 가중치 + log decay 결과 가시화
- 합계점수·신호 수 헤더 표시

### 5.2 분류 모델 설명 (접이식)
rule-v1.2 의 점수식 / 임계값 / 컨텍스트 가중치 / 키워드 단독 감쇠 / 비한국어 하한 / NER 휴리스틱 필터 / 신뢰도 공식. "이 결정 저장 → IndexedDB → 학습 사이클" 흐름 안내.

### 5.3 사용자 최종 분류 picker
- C / S / O 3개 버튼 (AI 추천 등급에 ✦ 마크)
- 결정 사유 메모 textarea (선택)
- AI ↔ 사용자 등급 **gap** 표시 (0 = 동의, 1/2 = 한/두 단계 차이)
- "이 결정 저장" 버튼 → `decisionStore.saveDecision()` → IndexedDB

### 5.4 전체 findings 표 (접이식)
- 컬럼: # / Entity / 매칭 / Start / End / Score / Recognizer
- 매칭 텍스트 truncate + title hover, sticky header, max-h 스크롤

### 5.5 본문 하이라이트
PII findings (빨강 mark) + 등급 키워드 occurrences (호박 mark) 위치 기반 정렬 → 겹침 제거 → 최대 4000자 truncate. hover 시 entityType / 키워드 가중치 tooltip.

---

## 6. 사용자 결정 저장소 — 학습 루프의 입력

[`pkizip/src/lib/learning/decision-store.ts`](../src/lib/learning/decision-store.ts) (★ 신규)

HE-TEST 의 `user_decisions.jsonl` 동등 기능을 IndexedDB 로 구현.

### 6.1 스키마

```ts
interface Decision {
  id: string;             // ULID (timestamp prefix → 시간순 정렬)
  ts: number;
  textHash: string;       // SHA-256 앞 16바이트 hex
  textLength: number;
  ai: { grade, score, confidence, version, reasons };
  user: { grade, gap, memo? };
  signedDelta: -2 | -1 | 0 | 1 | 2;     // 학습 신호: 양수 = AI 가 너무 낮음, 음수 = 너무 높음
  findings: Pick<Finding, 'entityType'|'text'|'score'|'recognizer'>[];
  language?: string;
}
```

### 6.2 인덱스
- `by-textHash` — 같은 문서 재방문 식별
- `by-time` — 최근 결정 N개

### 6.3 API
- `saveDecision(input)` — AnalysisDialog 의 picker 가 호출
- `listDecisions(limit)` — 최근 순
- `findByTextHash(hash)` — 같은 문서 이전 결정 조회
- `decisionStats()` — total / agreements / disagreements / signedDelta 분포
- `deleteDecision(id)` / `clearAll()`

### 6.4 사생활 보호
모든 데이터는 브라우저 IndexedDB (`pkizip-learning` DB) 에 저장됩니다. **외부 전송 없음**. 본문은 저장하지 않고 SHA-256 hash + findings 메타만 보관.

---

## 7. SHAP 토큰 기여도 (occlusion 기반)

[`pkizip/src/lib/analysis/shap-attribution.ts`](../src/lib/analysis/shap-attribution.ts)

HE-TEST 의 SHAP PartitionExplainer 동등 가치를 가벼운 알고리즘으로 제공:

1. 텍스트를 토큰 (공백 단위) 으로 분리
2. 각 토큰을 같은 길이 공백으로 마스킹 → 재분류
3. `scoreDelta = baseScore - maskedScore`
4. 양수 = 등급 상승 기여 / 음수 = 하락 기여
5. `fraction = scoreDelta / maxAbs` 로 정규화

`buildAttributionHtml()` 이 빨강 (positive) / 초록 (negative) mark 를 강도별 alpha 로 렌더링. SHAP Python 라이브러리 ~5-30s vs occlusion ~수백 ms — 시연 가능한 수준의 응답성.

> 다이얼로그 UI 통합은 Batch 2-UI 로 보류 중. 모듈은 사용 준비 완료.

---

## 8. OPA 정책 평가

[`pkizip/src/lib/policy/opa-engine.ts`](../src/lib/policy/opa-engine.ts) · [`rules.rego`](../src/lib/policy/rules.rego)

intent (purpose × cryptoKind) × classification (grade × confidence) × pseudonymization (applied × is_reversible × final_grade) × language × ocr 매트릭스 평가. WASM Rego (1차) + TS 폴백 (2차).

출력:
- `allow: boolean`
- `denyReasons[]` — 차단 사유 코드 (REASON_MESSAGES 매핑)
- `recommendedActions[]` — 권장 조치 (ACTION_MESSAGES 매핑)
- `requireWatermark` / `requirePqc` 플래그
- `engine: 'wasm' | 'ts-fallback'`

다이얼로그 푸터의 "이 결과로 봉투 만들기" 버튼은 `policy.allow === true` 일 때만 활성화.

---

## 9. PkiHeader v2 — 봉투 메타에 매핑

[`pkizip/src/lib/container/pki-format.ts`](../src/lib/container/pki-format.ts)

분석 결과는 봉투 헤더에 다음 필드로 매핑됩니다 (decrypt-free 헤더 파싱 가능):

```ts
interface PkiHeader {
  // ... v1 필드
  classification?: { grade, score, confidence, version };
  mipLabel?: { id, displayName, sensitivity };       // PKIZIP_LABEL_GUIDS 사용
  ocr?: OcrResult;
  language?: LanguageDetection;
  pseudonymization?: { applied, isReversible, finalGrade, mapKeys };
  searchKey?: { algorithm, keyId };                   // HE 검색키 (Phase 1)
  intent?: { purpose, cryptoKind };
}
```

`readPkiHeader()` (decrypt 없이 헤더만 파싱) + `deriveBadge()` 가 ExplorerPage 카드 그리드의 등급 배지를 만듭니다.

---

## 10. 미구현 / 다음 단계

| 항목 | 상태 |
|------|------|
| Batch 4 — `trainer.ts` (gradient 계산 + 가중치 hot-swap + 모델 버전 레지스트리) | pending |
| Batch 5 — `LearningPage` (사이드바 nav + 결정 통계 + 모델 버전 이력) | pending |
| SHAP attribution UI 통합 (모듈은 완성) | 보류 |
| HE 검색키 (BFV/CKKS via node-seal) Phase 1 통합 | 진행 중 |

---

## 11. 변경 이력 (요약)

- **2026-05-02** — `decision-store.ts` (IndexedDB) + AnalysisDialog 4개 신규 섹션 (판정 근거 표 / 분류 모델 설명 / 사용자 최종 분류 picker / 전체 findings 표) 추가. 본 문서 작성.
- 이전 — rule-v1.2 (S 임계 3.0 / 컨텍스트 가중치 / 키워드 단독 감쇠 / 길이 정규화), NER 휴리스틱 필터, occlusion-기반 SHAP 모듈, 키워드 마스킹 2nd pass, 다중 포맷 텍스트 추출, 본문 하이라이트, 자동 익명화 적용.
