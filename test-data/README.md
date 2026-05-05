# PKIZIP DPV 검증 테스트 데이터

[../docs/dpv-test-checklist.md](../docs/dpv-test-checklist.md) 의 시나리오 검증용 샘플 파일.

모두 **가짜 데이터** — 실제 개인정보 없음. 안심하고 봉투 만들기 테스트 가능.

---

## 그대로 사용 (변환 X)

13개 파일 중 **8개는 .txt / .csv / .json** 그대로 검증 가능:

| 파일 | 시나리오 | 검증 내용 |
|---|---|---|
| `test_email.txt` | 1.1, 3.1 | 평문 이메일·전화 — 직접 교체 확인 |
| `test_no_pii.txt` | 1.2 | PII 없음 — DPV 메타 미부착 확인 |
| `test_credentials.txt` | 5.1 | AWS_ACCESS_KEY — 자격증명 외부 전송 차단 |
| `test_external_pii.txt` | 5.2 | 주민번호 + 외부 전송 차단 |
| `test_lang_downgrade.txt` | 5.3 | 영어 + 주민번호 — 등급 재검토 권고 |
| `test_business_card.txt` | (추가) | 사업자번호 — dpv:OrganisationalIdentifier 매핑 |
| `test_data.csv` | (카테고리 A) | CSV — 평문과 동일하게 직접 교체 |
| `test_config.json` | (카테고리 A) | JSON — 평문과 동일하게 직접 교체 |

---

## 변환이 필요한 파일 (사용자가 직접 변환)

5개 파일은 **다른 포맷으로 변환 후 사용**:

| 원본 (.txt) | 변환할 포맷 | 변환 도구 추천 | 시나리오 | 검증 내용 |
|---|---|---|---|---|
| `test_payroll.txt` | **.xlsx** | Excel·LibreOffice·구글 시트 | 2.1, 3.2 | 셀 단위 PII 교체 (SheetJS write) |
| `test_meeting.txt` | **.pptx** | PowerPoint·Keynote·구글 슬라이드 | 3.3 | 슬라이드 텍스트 노드 `<a:t>` 교체 |
| `test_report.txt` | **.hwpx** | 한컴오피스 2014+ | 3.3 | HWPX section `<hp:t>`/`<hp:char>` 교체 |
| `test_proposal.txt` | **.docx** | Word·LibreOffice·구글 독스 | 3.4 | DOCX 텍스트 노드 `<w:t>` 교체 |
| `test_contract.txt` | **.pdf** | Word→PDF, 인쇄→PDF, 또는 LibreOffice | 3.5 | sidecar 동봉 ("DOCX 변환 권장" 안내) |
| `test_namecard.txt` | **.jpg** 또는 **.png** | Canva·Figma·PowerPoint export | 3.6 | OCR + sidecar 동봉 |
| `test_legacy.txt` | **.hwp** (구 바이너리) | 한컴오피스 → "한글 97-2007 문서" 로 저장 | 3.7 | HWP 안내 토스트 + sidecar |

### 변환 가이드

#### test_payroll.txt → test_payroll.xlsx
1. Excel 열기
2. test_payroll.txt 의 표를 셀 단위로 입력 (또는 텍스트 가져오기)
3. .xlsx 로 저장

#### test_meeting.txt → test_meeting.pptx
1. PowerPoint 열기
2. `=== Slide N ===` 마다 새 슬라이드 추가
3. 각 슬라이드에 해당 텍스트 입력
4. .pptx 로 저장

#### test_report.txt → test_report.hwpx
1. 한컴오피스 (2014 이후) 열기
2. test_report.txt 내용 그대로 입력
3. **저장 시 "한글 문서 (.hwpx)" 선택**

#### test_proposal.txt → test_proposal.docx
1. Word 열기
2. test_proposal.txt 내용 그대로 입력
3. .docx 로 저장 (구 .doc 가 아닌 신 OOXML 포맷)

#### test_contract.txt → test_contract.pdf
1. Word 또는 LibreOffice 에 텍스트 입력
2. "PDF 로 내보내기" 또는 "인쇄 → PDF 저장"
3. (스캔 PDF 가 아닌 텍스트 PDF — pdfjs 가 추출 가능해야 함)

#### test_namecard.txt → test_namecard.jpg
1. Canva·Figma·PowerPoint 등에서 명함 디자인
2. test_namecard.txt 의 텍스트 그대로 입력
3. JPG 또는 PNG 로 export
4. 또는 실제 명함 사진 사용 (단, 가짜 정보로 만든 것)

#### test_legacy.txt → test_legacy.hwp (구 바이너리)
1. 한컴오피스 열기
2. test_legacy.txt 내용 입력
3. **저장 시 "한글 97-2007 문서 (.hwp)" 선택** (.hwpx 가 아닌 구 바이너리)

---

## 변환 체크리스트

변환 후 test-data/ 디렉토리에 추가될 파일:

- [ ] `test_payroll.xlsx`
- [ ] `test_meeting.pptx`
- [ ] `test_report.hwpx`
- [ ] `test_proposal.docx`
- [ ] `test_contract.pdf`
- [ ] `test_namecard.jpg` (또는 .png)
- [ ] `test_legacy.hwp`

---

## 사용법

1. 변환 가능한 파일은 위 가이드대로 변환
2. PKIZIP dev 서버 실행:
   ```bash
   cd /Users/chris/HE/pkizip
   npx vite
   ```
3. 봉투 만들기 페이지에서 test-data/ 의 파일을 추가
4. [docs/dpv-test-checklist.md](../docs/dpv-test-checklist.md) 의 시나리오 따라 확인

---

## 알려진 한계

- **PDF 변환**: 텍스트 PDF (글자 추출 가능) 와 스캔 PDF (이미지) 가 다름. 텍스트 PDF 로 변환 권장 (Word→PDF 가 가장 안전).
- **이미지 OCR**: 한국어 명함은 Tesseract.js (한국어 모델) 로 추출. 가독성 낮으면 인식 실패 가능.
- **HWP 바이너리**: hwp.js 라이브러리가 일부 구버전 형식만 지원. 추출 실패해도 sidecar 모드로 동작.

---

## 가짜 데이터 명세

검증 효율을 위해 의도적으로 인식 패턴을 충족시키는 가짜 값 사용:

| 항목 | 패턴 | 예시 값 |
|---|---|---|
| 주민등록번호 | `\d{6}-[1-4]\d{6}` | `800101-1234567` (6자리 생년월일 + 7자리) |
| 여권번호 | `[MOSGRD]\d{8}` | `M12345678` |
| 사업자등록번호 | `\d{3}-\d{2}-\d{5}` | `123-45-67890` |
| 운전면허 | `\d{2}-\d{2}-\d{6}-\d{2}` | `11-12-345678-90` |
| 건강보험증 | `[1-9]-\d{10}` | `1-1234567890` |
| 신용카드 | `\d{4}-\d{4}-\d{4}-\d{4}` | `4111-1111-1111-1111` (Visa 테스트 카드) |
| AWS Access Key | `(AKIA|ASIA|AROA)[0-9A-Z]{16}` | `AKIA1234567890ABCDEF` |
| 이메일 | 일반 | `name@example.com` (RFC 2606 예약 도메인) |
| 전화번호 | 한국 | `010-1234-5678` |

모두 **사용 불가능한 가짜 값** — 실제 개인 식별 X.
