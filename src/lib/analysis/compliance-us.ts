/**
 * 미국 컴플라이언스 매핑 — HIPAA · CCPA/CPRA · GLBA.
 *
 * HE-TEST pseudo_framework.py JURISDICTION["US"] + /api/compliance/us/breach-draft.
 *
 * 핵심:
 *   1) entity → HIPAA Safe Harbor 18 식별자 매핑 (45 CFR §164.514(b)(2))
 *   2) PHI 검출 시 60일 내 HHS + Individuals 통지 (45 CFR §164.400-414)
 *   3) ≥500 명 시 미디어 통지 (§164.408(b))
 *   4) State laws — California Civ. §1798.82 등 별도 추가 통지
 */
import type { Finding } from './types';

export interface UsEntityMeta {
  category:
    | 'HIPAA Safe Harbor (Identifier)'
    | 'PHI (Protected Health Info)'
    | 'CCPA Sensitive PI'
    | 'CCPA Personal Info'
    | 'GLBA Nonpublic PI'
    | 'Credentials'
    | '기타';
  /** Safe Harbor 18 식별자 중 번호 */
  safeHarborItem?: number;
  law: string;
  lawUrl: string;
  treatment: string;
}

export const US_ENTITY_META: Record<string, UsEntityMeta> = {
  US_SSN: {
    category: 'HIPAA Safe Harbor (Identifier)',
    safeHarborItem: 2,
    law: 'HIPAA 45 CFR §164.514(b)(2)(i)(B) + CCPA §1798.140(ae)',
    lawUrl: 'https://www.hhs.gov/hipaa/for-professionals/privacy/special-topics/de-identification/',
    treatment: 'tokenize / suppress',
  },
  EMAIL_ADDRESS: {
    category: 'HIPAA Safe Harbor (Identifier)',
    safeHarborItem: 4,
    law: 'HIPAA 45 CFR §164.514(b)(2)(i)(D)',
    lawUrl: 'https://www.hhs.gov/hipaa/for-professionals/privacy/',
    treatment: 'replace / hash',
  },
  PHONE_NUMBER: {
    category: 'HIPAA Safe Harbor (Identifier)',
    safeHarborItem: 5,
    law: 'HIPAA 45 CFR §164.514(b)(2)(i)(E)',
    lawUrl: 'https://www.hhs.gov/hipaa/for-professionals/privacy/',
    treatment: 'mask',
  },
  CREDIT_CARD: {
    category: 'GLBA Nonpublic PI',
    safeHarborItem: 10,
    law: 'GLBA §501 + PCI-DSS Req 3.4 + HIPAA #10 (account numbers)',
    lawUrl: 'https://www.ftc.gov/legal-library/browse/statutes/gramm-leach-bliley-act',
    treatment: 'mask (last 4)',
  },
  IP_ADDRESS: {
    category: 'HIPAA Safe Harbor (Identifier)',
    safeHarborItem: 15,
    law: 'HIPAA 45 CFR §164.514(b)(2)(i)(O)',
    lawUrl: 'https://www.hhs.gov/hipaa/for-professionals/privacy/',
    treatment: 'ip_truncate (/24)',
  },
  URL: {
    category: 'HIPAA Safe Harbor (Identifier)',
    safeHarborItem: 14,
    law: 'HIPAA 45 CFR §164.514(b)(2)(i)(N)',
    lawUrl: 'https://www.hhs.gov/hipaa/for-professionals/privacy/',
    treatment: 'replace ([URL])',
  },
  DATE_TIME: {
    category: 'HIPAA Safe Harbor (Identifier)',
    safeHarborItem: 3,
    law: 'HIPAA 45 CFR §164.514(b)(2)(i)(C)',
    lawUrl: 'https://www.hhs.gov/hipaa/for-professionals/privacy/',
    treatment: 'shift (year only)',
  },
  PERSON: {
    category: 'HIPAA Safe Harbor (Identifier)',
    safeHarborItem: 1,
    law: 'HIPAA 45 CFR §164.514(b)(2)(i)(A)',
    lawUrl: 'https://www.hhs.gov/hipaa/for-professionals/privacy/',
    treatment: 'replace ([PERSON_n])',
  },
  LOCATION: {
    category: 'HIPAA Safe Harbor (Identifier)',
    safeHarborItem: 1,
    law: 'HIPAA 45 CFR §164.514(b)(2)(i)(B) (geographic)',
    lawUrl: 'https://www.hhs.gov/hipaa/for-professionals/privacy/',
    treatment: 'generalize (state level / ZIP3)',
  },
  AWS_ACCESS_KEY: {
    category: 'Credentials',
    law: 'NIST SP 800-63 (Digital Identity Guidelines)',
    lawUrl: 'https://pages.nist.gov/800-63-3/',
    treatment: 'suppress (rotate + remove)',
  },
  GENERIC_API_KEY: {
    category: 'Credentials',
    law: 'NIST SP 800-63',
    lawUrl: 'https://pages.nist.gov/800-63-3/',
    treatment: 'suppress',
  },
};

export type UsVerdict = 'compliant' | 'partial' | 'insufficient';

export interface UsComplianceResult {
  jurisdiction: 'US';
  name: 'United States (HIPAA + CCPA + GLBA)';
  regulator: 'HHS Office for Civil Rights + FTC + State Agencies';
  /** HIPAA Safe Harbor 18 식별자 중 검출된 번호 집합 */
  safeHarborAffected: number[];
  buckets: {
    'HIPAA Safe Harbor (Identifier)': string[];
    'PHI (Protected Health Info)': string[];
    'CCPA Sensitive PI': string[];
    'CCPA Personal Info': string[];
    'GLBA Nonpublic PI': string[];
    'Credentials': string[];
    '기타': string[];
  };
  hasSsn: boolean;
  hasPhi: boolean;
  hasCredentials: boolean;
  verdict: UsVerdict;
  rationale: string;
  requirementsMet: string[];
  requirementsPending: string[];
}

export function evaluateUsCompliance(findings: Finding[]): UsComplianceResult {
  const buckets: UsComplianceResult['buckets'] = {
    'HIPAA Safe Harbor (Identifier)': [],
    'PHI (Protected Health Info)': [],
    'CCPA Sensitive PI': [],
    'CCPA Personal Info': [],
    'GLBA Nonpublic PI': [],
    'Credentials': [],
    '기타': [],
  };
  const safeHarborAffected = new Set<number>();
  let hasSsn = false;
  let hasPhi = false;
  let hasCredentials = false;

  for (const f of findings) {
    const meta = US_ENTITY_META[f.entityType];
    if (!meta) {
      buckets['기타'].push(f.entityType);
      continue;
    }
    buckets[meta.category].push(f.entityType);
    if (meta.safeHarborItem) safeHarborAffected.add(meta.safeHarborItem);
    if (f.entityType === 'US_SSN') hasSsn = true;
    if (meta.category === 'PHI (Protected Health Info)') hasPhi = true;
    if (meta.category === 'Credentials') hasCredentials = true;
  }
  // SSN 또는 다른 HIPAA Safe Harbor 다수 → PHI 의심
  if (hasSsn || safeHarborAffected.size >= 3) hasPhi = true;

  let verdict: UsVerdict;
  let rationale: string;
  const requirementsMet: string[] = ['검출/분류 완료'];
  const requirementsPending: string[] = [];

  if (hasSsn) {
    verdict = 'insufficient';
    rationale = 'SSN 노출 — HIPAA + CCPA Sensitive PI 동시 위반 가능. tokenize 필수.';
    requirementsPending.push(
      'US_SSN 의 method 를 tokenize_random 또는 suppress 로 변경',
      'HIPAA Risk Analysis (45 CFR §164.308(a)(1)) refresh',
      'Workforce sanctions per §164.530(e)'
    );
  } else if (hasPhi || safeHarborAffected.size >= 5) {
    verdict = 'partial';
    rationale =
      `Safe Harbor 18 식별자 中 ${safeHarborAffected.size}종 검출 — Limited Data Set 권장.`;
    requirementsMet.push('1차 분류 완료');
    requirementsPending.push(
      'BAA (Business Associate Agreement) 검증',
      'Encryption (Safe Harbor for future breach)',
      'CCPA opt-out 처리 / Sensitive PI category 별도 보호'
    );
  } else {
    verdict = 'compliant';
    rationale = 'SSN/PHI 부재 또는 모두 변환됨. PoC 휴리스틱.';
    requirementsMet.push('직접·민감·자격증명 모두 변환', 'Safe Harbor 항목 명세화');
    requirementsPending.push(
      'Risk Analysis 갱신 + Encryption 정책 확인',
      'State law thresholds (CA·NY·TX 등)'
    );
  }

  return {
    jurisdiction: 'US',
    name: 'United States (HIPAA + CCPA + GLBA)',
    regulator: 'HHS Office for Civil Rights + FTC + State Agencies',
    safeHarborAffected: Array.from(safeHarborAffected).sort((a, b) => a - b),
    buckets,
    hasSsn,
    hasPhi,
    hasCredentials,
    verdict,
    rationale,
    requirementsMet,
    requirementsPending,
  };
}

/**
 * HIPAA Breach Notification Rule (45 CFR §164.400-414) 자동 초안.
 * 기한: Individuals 60d / HHS 60d / Media (≥500) 60d.
 */
export interface UsBreachDraft {
  reportType: 'HIPAA Breach Notification (45 CFR §164.400-414)';
  reportingTo: string;
  deadline: string;
  '1_incident_overview': string;
  '2_discovery_date': string;
  '3_breach_date': string;
  '4_breach_details': {
    count: number;
    byCategory: Record<string, string[]>;
    samples: Array<{ entityType: string; snippet: string }>;
    safeHarborItemsAffected: number[];
    ssnPresent: boolean;
    phiSuspected: boolean;
    credentialsPresent: boolean;
  };
  '5_root_cause': string;
  '6_secondary_harm_risk': string;
  '7_individual_notification': string;
  '8_substitute_notice': string;
  '9_corrective_action_plan': string[];
  state_law_notes: string;
  /** CCPA opt-out 의무 — 매출 ≥ $25M 또는 IT 데이터 ≥ 50K 거주자 시 */
  ccpa_applicability_note: string;
  severity: 'Severe' | 'High' | 'Moderate' | 'Low';
  memo?: string;
  disclaimer: string;
}

export function buildUsBreachDraft(
  filename: string,
  findings: Finding[],
  classification?: { grade?: string; score?: number },
  opts: { affectedIndividuals?: number; memo?: string } = {}
): UsBreachDraft {
  const compliance = evaluateUsCompliance(findings);
  const samples = findings.slice(0, 10).map(f => ({
    entityType: f.entityType,
    snippet: (f.text || '').slice(0, 20),
  }));
  const n = opts.affectedIndividuals;
  const mediaRequired = n !== undefined && n >= 500;

  const severity: UsBreachDraft['severity'] = compliance.hasSsn
    ? 'Severe'
    : compliance.hasPhi || compliance.hasCredentials
      ? 'High'
      : findings.length > 0 ? 'Moderate' : 'Low';

  const now = new Date().toISOString();
  return {
    reportType: 'HIPAA Breach Notification (45 CFR §164.400-414)',
    reportingTo:
      `HHS OCR + Affected Individuals${mediaRequired ? ' + Media (≥500 명)' : ''}` +
      ' + State Agencies (per state law)',
    deadline: 'Individuals: 60d / HHS: 60d / Media (≥500): 60d / State laws vary (CA·NY·TX 등)',
    '1_incident_overview':
      `File '${filename}' contains ${findings.length} potential PII items. ` +
      `Classification: ${classification?.grade || 'N/A'} (score=${classification?.score ?? '—'}).`,
    '2_discovery_date': now,
    '3_breach_date': '(under investigation)',
    '4_breach_details': {
      count: findings.length,
      byCategory: Object.fromEntries(
        Object.entries(compliance.buckets)
          .filter(([, v]) => v.length > 0)
          .map(([k, v]) => [k, Array.from(new Set(v)).sort()])
      ),
      samples,
      safeHarborItemsAffected: compliance.safeHarborAffected,
      ssnPresent: compliance.hasSsn,
      phiSuspected: compliance.hasPhi,
      credentialsPresent: compliance.hasCredentials,
    },
    '5_root_cause':
      '(under investigation — e.g., unauthorized access / loss / improper disclosure)',
    '6_secondary_harm_risk': compliance.hasSsn
      ? 'SSN exposed — high risk of identity theft / financial fraud.'
      : compliance.hasPhi
        ? 'PHI exposed — HIPAA breach. Risk of medical identity theft.'
        : compliance.hasCredentials
          ? 'Credentials exposed — risk of further system compromise.'
          : 'Limited.',
    '7_individual_notification':
      'First-class mail / email (if pre-authorized) — without unreasonable delay, max 60 days.',
    '8_substitute_notice':
      'If ≥10 individuals contact info insufficient — post on website ≥90 days + media outlet notice.',
    '9_corrective_action_plan': [
      'Risk Analysis (45 CFR §164.308(a)(1)(ii)(A)) refresh',
      'Workforce sanctions per §164.530(e)',
      'Encryption/Access Control improvements (Safe Harbor for future incidents)',
      'Business Associate Agreement (BAA) audit',
      'Training and awareness program',
    ],
    state_law_notes:
      'California (Civ. Code §1798.82) · New York SHIELD Act · Texas BC §521 · ' +
      'Illinois PIPA — separate notification thresholds and timelines.',
    ccpa_applicability_note:
      compliance.buckets['CCPA Sensitive PI'].length > 0
        ? 'Sensitive PI 검출 — Cal. Civ. §1798.140(ae) 별도 카테고리. Right to Limit 의무.'
        : 'CCPA opt-out 권리 검토 (매출 ≥ $25M 또는 50K residents 또는 50% 수익 sale).',
    severity,
    memo: opts.memo,
    disclaimer:
      'PoC auto-generated draft — actual breach reports require legal review and outside counsel.',
  };
}
