# PII 테스트 코퍼스 (200 files)

PII Scanner / 익명화 / 컴플라이언스 평가용 테스트 데이터. **모든 PII 값은 fake** —
이름·주민번호·신용카드·API 키 등 모두 가공 또는 공개된 dummy 값.

## 구성

| 폴더 | 언어 | 파일 수 | 주요 PII |
|---|---|---|---|
| [ko/](ko/) | 한국어 | 50 | KR_RRN, KR_PHONE, KR_BIZ_NO, KR_ADDRESS, PERSON, CREDIT_CARD |
| [ja/](ja/) | 일본어 | 50 | JP_MY_NUMBER, JP_PHONE, JP_POSTAL_CODE, JP_PASSPORT, JP_DRIVERS_LICENSE, JP_CORPORATE_NUMBER, JP_BANK_ACCOUNT, JP_ADDRESS |
| [en/](en/) | 영어 | 50 | US_SSN, PHONE_NUMBER, EMAIL_ADDRESS, CREDIT_CARD, LOCATION |
| [mixed/](mixed/) | 한·일·영 혼용 | 50 | 위 3개 언어 PII 전부 (월경 이전·국제 회의·다국가 채용 시나리오) |

각 폴더당 12종 문서 양식 × 5회 변주:
회의록 / 고객카드 / 인사파일 / 보안사고 보고 / 영업제안 / 경비결의 / 휴가신청
/ 이력서 / 명함OCR / 출장보고 / 채용평가 / 컴플레인 처리.

## 재생성

```bash
python samples/generate.py
```

`generate.py` 의 `SEED = 20260515` 고정으로 항상 동일한 200개 생성.
값 변경 또는 파일 추가 시 generator 만 수정하면 됨.

## 사용 예시 (PII Scanner)

```bash
# 4개 언어에서 검출 통계 비교
for lang in ko ja en mixed; do
  for f in samples/$lang/sample_*.txt; do
    curl -s -F "file=@$f" -F "language=auto" -F "score_threshold=0.3" \
         http://127.0.0.1:5000/api/analyze | jq -r '.summary'
  done
done
```

UI 에서는 **파일 분석** 탭 드롭존에 임의 파일을 드래그하면 됨.
**🇯🇵 일본 컴플라이언스** 탭 → "📥 파일 분석 탭의 최신 결과로 생성" 으로
PPC 漏洩等報告 양식 초안까지 확인 가능.
