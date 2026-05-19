# OCR 테스트 샘플 이미지

PKIZIP의 이미지 → OCR → PII 검출 → 등급 분류 파이프라인 검증용.

## 구조

```
samples-images/
├── ko/    한국어 (Apple SD Gothic Neo)   sample_01..03.png
├── en/    영어   (Helvetica)              sample_01..03.png
├── ja/    일본어 (Hiragino Kaku Gothic)   sample_01..03.png
└── zh/    중국어 (Heiti SC Light)         sample_01..03.png
```

각 이미지는 회원가입 영수증·상담 메모·근로계약서 발췌 등 짧은 문서를
시뮬레이트하며, **언어별 대표 PII**를 의도적으로 포함합니다.

| 언어 | 대표 PII |
|---|---|
| ko | 주민등록번호, 휴대전화, 이메일, 주소, 카드 끝 4자리, 계좌번호 |
| en | SSN, Phone, Email, Address, Card last-4, Insurance Member ID, MRN |
| ja | マイナンバー, 電話, メール, 住所, 口座番号, 生年月日 |
| zh | 身份证号, 手机, 邮箱, 住址, 银行账号 |

PII 데이터는 모두 **가상**입니다. 패턴을 충족하지만 실제 인물·계좌·증서와 무관합니다.

## 재생성

```bash
node scripts/gen-ocr-samples.mjs
```

macOS 시스템 폰트 + ImageMagick 7 이 필요합니다. 다른 OS 에서는 폰트 경로 수정 필요
(`scripts/gen-ocr-samples.mjs` 상단 `FONTS`).

## 검증 흐름

1. PKIZIP 앱 → "생성" → 파일 추가에 이미지 드래그/선택.
2. 분석 단계에서 OCR 진행률 바 표시 (첫 실행은 모델 다운로드 ~10–30MB).
3. OCR 텍스트가 분류기·PII 검출에 그대로 전달 → 등급(C/S/O) + 검출된 entity 목록.
4. 봉투 메타에 `ocrApplied: true`, `ocrEngine: 'tesseract.js'`, `ocrConfidence` 기록.

## 등급 기대값

전 샘플이 SSN/주민등록번호/マイナンバー/身份证号 같은 강한 식별자를 포함 →
**C 등급(기밀)** 으로 판정되어야 정상입니다. 만약 O/S 로 떨어진다면 OCR
정확도가 부족했거나 (텍스트 깨짐) PII 패턴이 인식 텍스트와 불일치한 것입니다.
