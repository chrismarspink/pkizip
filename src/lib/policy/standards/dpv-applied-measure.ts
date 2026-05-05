/**
 * DPV 적용 조치 (dpv:TechnicalMeasure / dpv:OrganisationalMeasure) 매핑.
 *
 * PKIZIP 의 봉투 작업 결과로부터 자동 도출:
 *   - encryption / pqcKemRecipientInfo → dpv:Encryption
 *   - pqcHeader.pqcProtected → dpv:CryptographicMethods (PQC 표시 보강)
 *   - signatures / pqcSignerInfo → dpv:DigitalSignature
 *   - timestamp.token (TSA) → dpv:TimestampingService
 *   - pseudonymization (가역)  → dpv:Pseudonymisation
 *   - pseudonymization (비가역) → dpv:Anonymisation
 */

export interface AppliedMeasureSource {
  encrypted?: boolean;
  pqcProtected?: boolean;
  signed?: boolean;
  timestamped?: boolean;
  pseudonymization?: { applied?: boolean; isReversible?: boolean };
}

/** 헤더 정보로부터 적용 조치 IRI 목록 도출. */
export function deriveDpvMeasures(src: AppliedMeasureSource): string[] {
  const out = new Set<string>();
  if (src.encrypted) {
    out.add('dpv:Encryption');
  }
  if (src.pqcProtected) {
    // PQC 사용 시 양자내성 암호 표기.
    // DPV v2 에 직접 IRI 없어 dpv:CryptographicMethods 로 일반화 + 자체 식별자 보강.
    out.add('dpv:CryptographicMethods');
  }
  if (src.signed) {
    out.add('dpv:DigitalSignature');
  }
  if (src.timestamped) {
    out.add('dpv:TimestampingService');
  }
  if (src.pseudonymization?.applied) {
    if (src.pseudonymization.isReversible) {
      out.add('dpv:Pseudonymisation');
    } else {
      out.add('dpv:Anonymisation');
    }
  }
  return [...out].sort();
}
