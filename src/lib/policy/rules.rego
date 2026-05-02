package pkizip.policy

# PKIZIP 송신/처리 정책 — 등급 × 암호화 × 익명화 매트릭스.
#
# 입력 (input):
#   {
#     intent: { purpose: "internal" | "external", crypto_kind: "classic" | "hybrid" | "pqc-only" | "pqc-he" },
#     classification: { grade: "C" | "S" | "O", score: number, confidence: number },
#     pseudonymization: { applied: bool, is_reversible: bool, final_grade: "C"|"S"|"O" },
#     language: { detected: "ko" | "en" | ... },
#     ocr: { applied: bool }
#   }
#
# 출력 (data 가 아닌 rule 들):
#   - allow                — bool, 송신 허용 여부
#   - require_watermark    — bool
#   - require_anonymization — bool
#   - require_pqc          — bool, PQC 강제 (단순 암호로는 송신 불가)
#   - deny_reasons         — set[string], 거부 사유들
#   - recommended_actions  — set[string], 권고 액션들

# 기본값 — 모든 출력은 false 또는 빈 set 으로 시작
default allow = false
default require_watermark = false
default require_anonymization = false
default require_pqc = false

# ─────────────────────────────────────────────────────
# 거부 사유 (deny_reasons)
# ─────────────────────────────────────────────────────

# C 등급 + 외부 전송 + 단순 암호 → 차단 (PQC 강제)
deny_reasons[reason] {
  input.classification.grade == "C"
  input.intent.purpose == "external"
  input.intent.crypto_kind == "classic"
  reason := "C_GRADE_REQUIRES_PQC_FOR_EXTERNAL"
}

# C 등급 + 외부 전송 + 가명/익명 미적용 → 차단
deny_reasons[reason] {
  input.classification.grade == "C"
  input.intent.purpose == "external"
  not input.pseudonymization.applied
  reason := "C_GRADE_REQUIRES_ANONYMIZATION_FOR_EXTERNAL"
}

# 비한국어 문서 + O 등급 + 외부 전송 (등급 우회 의심)
deny_reasons[reason] {
  input.language.detected != "ko"
  input.language.detected != "und"
  input.classification.grade == "O"
  input.intent.purpose == "external"
  not input.pseudonymization.applied
  reason := "LANGUAGE_DOWNGRADE_BLOCKED"
}

# OCR 적용 + C 등급 → 추가 검토 필요 (이미지 우회 의심)
deny_reasons[reason] {
  input.ocr.applied
  input.classification.grade == "C"
  not input.pseudonymization.applied
  reason := "OCR_C_GRADE_REQUIRES_REVIEW"
}

# ─────────────────────────────────────────────────────
# 강제 액션
# ─────────────────────────────────────────────────────

# S 등급 → 워터마크 강제 (외부 전송 시)
require_watermark {
  input.classification.grade == "S"
  input.intent.purpose == "external"
}

require_watermark {
  input.classification.grade == "C"
  input.intent.purpose == "external"
}

# C 등급 → 가명/익명화 강제
require_anonymization {
  input.classification.grade == "C"
  not input.pseudonymization.applied
}

# 외부 전송 시 PQC 강제 (S 또는 C)
require_pqc {
  input.intent.purpose == "external"
  input.classification.grade != "O"
}

# ─────────────────────────────────────────────────────
# 권고
# ─────────────────────────────────────────────────────

recommended_actions[a] {
  input.classification.grade == "C"
  not input.pseudonymization.applied
  a := "ANONYMIZE_BEFORE_SEND"
}

recommended_actions[a] {
  input.classification.grade == "C"
  input.intent.crypto_kind != "pqc-only"
  input.intent.crypto_kind != "pqc-he"
  a := "USE_PQC_FOR_C_GRADE"
}

recommended_actions[a] {
  input.classification.grade == "S"
  input.intent.purpose == "external"
  not input.pseudonymization.applied
  a := "CONSIDER_PSEUDONYMIZATION"
}

recommended_actions[a] {
  input.ocr.applied
  a := "OCR_APPLIED_VERIFY_ACCURACY"
}

# ─────────────────────────────────────────────────────
# 최종 허용
# ─────────────────────────────────────────────────────

# 거부 사유가 하나도 없으면 allow
allow {
  count(deny_reasons) == 0
}
