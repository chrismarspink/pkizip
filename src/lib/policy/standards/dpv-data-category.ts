/**
 * DPV (W3C Data Privacy Vocabulary v2) — 데이터 카테고리 매핑.
 *
 * PKIZIP 의 PII 분류기 entityType (KR_RRN, EMAIL_ADDRESS 등) 을
 * DPV 의 글로벌 IRI 로 변환한다.
 *
 * Phase 1 — data_categories 만 매핑. 처리 목적·법적 근거·활동·조치는
 * Phase 2~3 에서 추가.
 *
 * 참조: https://w3id.org/dpv/v2
 */

export const DPV_CONTEXT_URL = 'https://w3id.org/dpv/v2';

/**
 * PII 분류기의 entityType → DPV IRI 매핑.
 * 알 수 없는 entityType 은 매핑에서 제외 (undefined).
 *
 * 매핑 근거:
 *   KR_* 한국 PII → 의미상 가장 가까운 DPV 코어 클래스
 *   글로벌 PII → DPV 코어 그대로
 *   NER (PERSON/LOCATION/ORGANIZATION) → DPV 코어 매핑
 *   AWS/API key → dpv:Authenticating (자격증명 카테고리)
 *   INTERNAL_PROJECTS / URL → 매핑 X (개인정보 아님)
 */
export const ENTITY_TYPE_TO_DPV: Record<string, string> = {
  // 한국형 PII
  KR_RRN:              'dpv:NationalIdentifier',
  KR_PASSPORT:         'dpv:Passport',
  KR_BIZ_NO:           'dpv:OrganisationalIdentifier',
  KR_PHONE:            'dpv:TelephoneNumber',
  KR_ARC:              'dpv:NationalIdentifier',
  KR_DRIVERS_LICENSE:  'dpv:DriversLicense',
  KR_HEALTH_INSURANCE: 'dpv:HealthCareInsurance',
  KR_CAR_PLATE:        'dpv:VehicleIdentifier',
  KR_CORP_REG_NUMBER:  'dpv:OrganisationalIdentifier',

  // 글로벌 PII
  CREDIT_CARD:         'dpv:CreditCardNumber',
  EMAIL_ADDRESS:       'dpv:EmailAddress',
  PHONE_NUMBER:        'dpv:TelephoneNumber',
  IP_ADDRESS:          'dpv:IPAddress',

  // NER 결과
  PERSON:              'dpv:Name',
  LOCATION:            'dpv:Address',
  ORGANIZATION:        'dpv:Organisation',

  // 자격증명
  AWS_ACCESS_KEY:      'dpv:Authenticating',
  GENERIC_API_KEY:     'dpv:Authenticating',

  // 내부 denylist
  VIP_NAMES:           'dpv:Name',
  // INTERNAL_PROJECTS / URL — 개인정보 아니므로 매핑 X
};

/**
 * findingsSummary (entityType → count) 를 DPV IRI 목록으로 변환.
 * 중복 제거 후 정렬된 배열 반환.
 */
export function findingsToDpvCategories(
  findingsSummary: Record<string, number> | undefined,
): string[] {
  if (!findingsSummary) return [];
  const iris = new Set<string>();
  for (const entityType of Object.keys(findingsSummary)) {
    const iri = ENTITY_TYPE_TO_DPV[entityType];
    if (iri) iris.add(iri);
  }
  return [...iris].sort();
}
