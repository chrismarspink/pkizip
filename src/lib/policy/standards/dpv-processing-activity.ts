/**
 * DPV 처리 활동 (dpv:Processing) 매핑.
 *
 * 봉투 작업으로부터 자동 도출 — 사용자 입력 X.
 *   - 봉투 생성/저장 = dpv:Storage
 *   - intent.purpose === 'external' = dpv:Transfer 추가
 *   - pseudonymization.applied (가역) = dpv:Pseudonymise 추가
 *   - pseudonymization.applied (비가역) = dpv:Anonymise 추가
 *   - 암호화 적용 = dpv:Encrypt 추가
 *   - 서명 적용 = (활동이라기보다 조치 영역으로 — applied_measures 에 매핑)
 */

export interface ProcessingActivitySource {
  intent?: { purpose?: 'internal' | 'external' };
  encrypted?: boolean;
  pseudonymization?: { applied?: boolean; isReversible?: boolean };
}

/** 헤더 정보로부터 처리 활동 IRI 목록 도출. */
export function deriveDpvProcessing(src: ProcessingActivitySource): string[] {
  const out = new Set<string>();
  // 봉투 자체가 디지털 보관
  out.add('dpv:Storage');
  // 외부 전송 의도가 명시되면
  if (src.intent?.purpose === 'external') {
    out.add('dpv:Transfer');
  }
  // 암호화 적용
  if (src.encrypted) {
    out.add('dpv:Encrypt');
  }
  // 가명/익명화
  if (src.pseudonymization?.applied) {
    if (src.pseudonymization.isReversible) {
      out.add('dpv:Pseudonymise');
    } else {
      out.add('dpv:Anonymise');
    }
  }
  return [...out].sort();
}
