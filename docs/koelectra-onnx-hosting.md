# KoELECTRA ONNX 호스팅 가이드 (Python 측 작업)

`src/lib/analysis/ko-ner.ts` 의 `MODEL_CANDIDATES` 첫줄에 추가할 한국어 전용
NER 모델을 직접 변환·호스팅하는 절차. PKIZIP TypeScript 만으로는 불가하며,
Python + HuggingFace 계정이 필요한 **infrastructure 작업**이라 별도 트랙.

---

## 목표

| 항목 | 값 |
|---|---|
| 원본 모델 | `Leo97/KoELECTRA-small-v3-modu-ner` (HuggingFace) |
| 크기 | ~50MB (현재 fallback `Xenova/bert-base-multilingual-cased-ner-hrl` 의 1/5.6) |
| 정확도 | Korean F1 ≥ 0.9 (modu 코퍼스 기준) |
| 호스팅 위치 | `Innotium/KoELECTRA-small-v3-modu-ner-onnx` (예시) |
| 라벨 스킴 | 모두의말뭉치 PS / LC / OG / DT — `ko-ner.ts` `mapKoLabel()` 이 이미 처리 |

---

## 단계

### 1. 환경 준비 (Python 3.10+)

```bash
pip install optimum[exporters] transformers torch onnxruntime
huggingface-cli login   # HF 토큰 입력
```

### 2. ONNX 변환

```bash
optimum-cli export onnx \
  --model Leo97/KoELECTRA-small-v3-modu-ner \
  --task token-classification \
  --opset 14 \
  ./koelectra-modu-ner-onnx/
```

산출물:
- `model.onnx` (~50MB, FP32)
- `model_quantized.onnx` (~13MB, INT8 — 양자화 시)
- `tokenizer.json` · `tokenizer_config.json` · `special_tokens_map.json`
- `config.json`

### 3. INT8 양자화 (선택, 권장)

브라우저 로딩 시간을 줄이려면 양자화 필수:

```bash
python -m optimum.onnxruntime.quantization \
  --onnx_model_path ./koelectra-modu-ner-onnx/model.onnx \
  --output ./koelectra-modu-ner-onnx/model_quantized.onnx
```

### 4. 변환 검증

```python
from optimum.onnxruntime import ORTModelForTokenClassification
from transformers import pipeline, AutoTokenizer

model = ORTModelForTokenClassification.from_pretrained('./koelectra-modu-ner-onnx')
tok = AutoTokenizer.from_pretrained('./koelectra-modu-ner-onnx')
ner = pipeline('ner', model=model, tokenizer=tok, aggregation_strategy='simple')

text = "이노티움 김성완 부사장이 2026년 5월에 입사했습니다."
print(ner(text))
# 예상 출력:
# [{'entity_group': 'OG', 'score': 0.99, 'word': '이노티움', ...},
#  {'entity_group': 'PS', 'score': 0.98, 'word': '김성완', ...}, ...]
```

### 5. HuggingFace Hub 업로드

```bash
# Innotium 조직 또는 개인 계정에 업로드
huggingface-cli repo create KoELECTRA-small-v3-modu-ner-onnx --type=model
cd koelectra-modu-ner-onnx/
git init && git add . && git commit -m "init"
git remote add origin https://huggingface.co/Innotium/KoELECTRA-small-v3-modu-ner-onnx
git push -u origin main
```

**중요**: 디렉토리 구조가 Xenova 스타일을 따라야 transformers.js 가 인식:

```
KoELECTRA-small-v3-modu-ner-onnx/
├── config.json
├── tokenizer.json
├── tokenizer_config.json
├── special_tokens_map.json
├── onnx/
│   ├── model.onnx           (FP32)
│   └── model_quantized.onnx (INT8, 권장)
└── README.md
```

### 6. ko-ner.ts 활성화

```typescript
// src/lib/analysis/ko-ner.ts
const MODEL_CANDIDATES = [
  'Innotium/KoELECTRA-small-v3-modu-ner-onnx',  // ← 신규 (1줄 추가)
  'Xenova/bert-base-multilingual-cased-ner-hrl',  // fallback
];
```

`ko-ner.ts` 의 `load()` 가 자동으로 첫 모델 시도, 실패 시 fallback.

---

## 라이선스 확인

- `Leo97/KoELECTRA-small-v3-modu-ner` — Apache 2.0 (재배포 가능)
- 모두의말뭉치 학습 데이터 — 국립국어원 약관 별도 확인 권장
- 재배포 시 원저자 (`Leo97`) credit 명시 필수

---

## 정확도 검증 절차

`samples/ko/sample_*.txt` 50건으로 비교:

```bash
# PKIZIP/scripts/compare-ko-ner.mjs 작성 (미구현)
npx tsx scripts/compare-ko-ner.mjs
```

기대 결과:
- PERSON Recall: 0.7 (multilingual) → 0.9 (KoELECTRA)
- LOCATION Recall: 0.65 → 0.85
- 모델 다운로드: 280MB → 50MB (또는 13MB INT8)

---

## 추정 작업 시간

| 단계 | 시간 |
|---|---|
| 환경 준비 + 변환 | 0.5일 |
| 양자화 + 검증 | 0.5일 |
| HF Hub 업로드 + 디렉토리 정리 | 0.5일 |
| samples 50건 정확도 측정 | 0.5일 |
| `ko-ner.ts` 활성화 + 회귀 테스트 | 0.5일 |
| **총** | **~2.5일** |

원래 추정 (1주) 보다 단순 — 핵심 위험은 모델이 transformers.js 호환되는지
변환 검증 단계.

---

## TODO (Python 작업자)

- [ ] optimum 환경 구축 + 변환 실행
- [ ] INT8 양자화 시 정확도 손실 측정 (F1 -3% 이상이면 FP32 유지)
- [ ] HF Hub 업로드 + README 작성
- [ ] `ko-ner.ts` MODEL_CANDIDATES 첫줄 추가 + PR
- [ ] samples 50건 회귀 테스트 통과
