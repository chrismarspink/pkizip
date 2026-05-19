/**
 * EU 컴플라이언스 매핑 — GDPR + ePrivacy Directive.
 *
 * HE-TEST pseudo_framework.py JURISDICTION["EU"] + /api/compliance/eu/breach-draft.
 *
 * 핵심:
 *   1) entity → GDPR Article 4 카테고리 (Personal Data · Special Category Art 9 · Criminal Art 10)
 *   2) Special Category (Art 9) 검출 시 Art 9(2) 예외 검증 필요
 *   3) Art 33 (Supervisory Authority, 72시간) + Art 34 (Data Subjects, "without undue delay" if high risk)
 *   4) IP 주소 = Personal Data (CJEU Breyer C-582/14 판결)
 */
import type { Finding } from './types';

export interface EuEntityMeta {
  category:
    | 'Personal Data (Art 4(1))'
    | 'Special Category (Art 9)'
    | 'Criminal Data (Art 10)'
    | 'Pseudonymised (Art 4(5))'
    | 'Credentials'
    | '기타';
  law: string;
  lawUrl: string;
  treatment: string;
  /** Lawful basis (Art 6) 필요 여부 */
  lawfulBasisRequired?: boolean;
}

export const EU_ENTITY_META: Record<string, EuEntityMeta> = {
  EMAIL_ADDRESS: {
    category: 'Personal Data (Art 4(1))',
    law: 'GDPR Art 4(1) · Art 6',
    lawUrl: 'https://gdpr-info.eu/art-4-gdpr/',
    treatment: 'pseudonymise (hash local + keep domain)',
    lawfulBasisRequired: true,
  },
  PHONE_NUMBER: {
    category: 'Personal Data (Art 4(1))',
    law: 'GDPR Art 4(1)',
    lawUrl: 'https://gdpr-info.eu/art-4-gdpr/',
    treatment: 'mask (preserve last 4)',
    lawfulBasisRequired: true,
  },
  IP_ADDRESS: {
    category: 'Personal Data (Art 4(1))',
    law: 'GDPR Art 4(1) + CJEU Breyer C-582/14',
    lawUrl: 'https://curia.europa.eu/juris/document/document.jsf?docid=184668',
    treatment: 'ip_truncate (/24)',
    lawfulBasisRequired: true,
  },
  CREDIT_CARD: {
    category: 'Personal Data (Art 4(1))',
    law: 'GDPR Art 6 + PCI-DSS Req 3.4',
    lawUrl: 'https://gdpr-info.eu/art-6-gdpr/',
    treatment: 'mask',
    lawfulBasisRequired: true,
  },
  PERSON: {
    category: 'Personal Data (Art 4(1))',
    law: 'GDPR Art 4(1)',
    lawUrl: 'https://gdpr-info.eu/art-4-gdpr/',
    treatment: 'pseudonymise (consistent token)',
    lawfulBasisRequired: true,
  },
  LOCATION: {
    category: 'Personal Data (Art 4(1))',
    law: 'GDPR Art 4(1)',
    lawUrl: 'https://gdpr-info.eu/art-4-gdpr/',
    treatment: 'generalize',
    lawfulBasisRequired: true,
  },
  // 직접식별 외 ID — KR_RRN/JP_MY_NUMBER 등은 EU 관점에서 모두 Personal Data
  KR_RRN: {
    category: 'Personal Data (Art 4(1))',
    law: 'GDPR Art 4(1)',
    lawUrl: 'https://gdpr-info.eu/art-4-gdpr/',
    treatment: 'tokenize / pseudonymise',
    lawfulBasisRequired: true,
  },
  KR_PASSPORT: {
    category: 'Personal Data (Art 4(1))',
    law: 'GDPR Art 4(1)',
    lawUrl: 'https://gdpr-info.eu/art-4-gdpr/',
    treatment: 'tokenize',
    lawfulBasisRequired: true,
  },
  JP_MY_NUMBER: {
    category: 'Personal Data (Art 4(1))',
    law: 'GDPR Art 4(1) + (JP 본국법 마이넘버법 우선)',
    lawUrl: 'https://gdpr-info.eu/art-4-gdpr/',
    treatment: 'tokenize / remove',
    lawfulBasisRequired: true,
  },
  AWS_ACCESS_KEY: {
    category: 'Credentials',
    law: 'GDPR Art 32 (Security of processing)',
    lawUrl: 'https://gdpr-info.eu/art-32-gdpr/',
    treatment: 'suppress',
  },
  GENERIC_API_KEY: {
    category: 'Credentials',
    law: 'GDPR Art 32',
    lawUrl: 'https://gdpr-info.eu/art-32-gdpr/',
    treatment: 'suppress',
  },
};

export type EuVerdict = 'compliant' | 'partial' | 'insufficient';

export interface EuComplianceResult {
  jurisdiction: 'EU';
  name: 'European Union (GDPR)';
  regulator: 'European Data Protection Board (EDPB) + 각 회원국 DPA';
  buckets: {
    'Personal Data (Art 4(1))': string[];
    'Special Category (Art 9)': string[];
    'Criminal Data (Art 10)': string[];
    'Pseudonymised (Art 4(5))': string[];
    'Credentials': string[];
    '기타': string[];
  };
  hasSpecialCategory: boolean;
  hasCriminalData: boolean;
  hasPersonalData: boolean;
  /** Art 33 신고 의무 여부 — Personal Data 1건 이상 + 권리침해 우려 */
  art33Required: boolean;
  /** Art 34 본인 통지 의무 — high risk 시 */
  art34Required: boolean;
  verdict: EuVerdict;
  rationale: string;
  requirementsMet: string[];
  requirementsPending: string[];
  /** 잠재 과징금 상한 — Art 83 */
  maxPenalty: string;
}

export function evaluateEuCompliance(findings: Finding[]): EuComplianceResult {
  const buckets: EuComplianceResult['buckets'] = {
    'Personal Data (Art 4(1))': [],
    'Special Category (Art 9)': [],
    'Criminal Data (Art 10)': [],
    'Pseudonymised (Art 4(5))': [],
    'Credentials': [],
    '기타': [],
  };
  let hasSpecialCategory = false;
  let hasCriminalData = false;
  let hasPersonalData = false;
  let hasCredentials = false;

  for (const f of findings) {
    const meta = EU_ENTITY_META[f.entityType];
    if (!meta) {
      buckets['기타'].push(f.entityType);
      continue;
    }
    buckets[meta.category].push(f.entityType);
    if (meta.category === 'Special Category (Art 9)') hasSpecialCategory = true;
    if (meta.category === 'Criminal Data (Art 10)') hasCriminalData = true;
    if (meta.category === 'Personal Data (Art 4(1))') hasPersonalData = true;
    if (meta.category === 'Credentials') hasCredentials = true;
  }

  // Art 33 / Art 34 트리거 판정
  const art33Required = hasPersonalData || hasSpecialCategory || hasCriminalData;
  // Art 34 — high risk 시: special category 또는 credentials
  const art34Required = hasSpecialCategory || hasCriminalData || hasCredentials;

  let verdict: EuVerdict;
  let rationale: string;
  const requirementsMet: string[] = ['검출/분류 완료'];
  const requirementsPending: string[] = [];

  if (hasSpecialCategory) {
    verdict = 'insufficient';
    rationale =
      `Art 9 Special Categories 검출 — Art 9(1) 처리 금지 원칙. ` +
      `Art 9(2) 예외 (명시 동의 등) 검증 필수.`;
    requirementsPending.push(
      'Art 9(2)(a)-(j) 예외 적용 검증 (명시 동의 / 의료 / 법적 의무 등)',
      'DPIA (Art 35) 의무 — 모든 Special Category 처리',
      'Art 22 자동의사결정 거부권 보장'
    );
  } else if (hasCriminalData) {
    verdict = 'partial';
    rationale = 'Art 10 Criminal Data — 공식기관 또는 회원국 법령 근거 필요.';
    requirementsPending.push(
      'Art 10 법령 근거 확인',
      'DPIA 의무',
      'Records of processing (Art 30)'
    );
  } else if (hasPersonalData) {
    verdict = 'partial';
    rationale = `Personal Data ${buckets['Personal Data (Art 4(1))'].length}건 — ` +
      'Art 6 lawful basis 필요 + Art 5 7대 원칙 준수.';
    requirementsMet.push('1차 분류 완료');
    requirementsPending.push(
      'Art 6 lawful basis 확정 (consent / contract / legitimate interest 등)',
      'Records of processing activities (Art 30)',
      'DPO 지정 검토 (Art 37) — 대규모 처리 시 의무',
      'Cross-border transfer 검증 (Chapter V — adequacy / SCC / BCR)'
    );
  } else {
    verdict = 'compliant';
    rationale = 'Personal Data 부재 또는 모두 변환됨. PoC 휴리스틱.';
    requirementsMet.push('Personal Data 모두 변환', 'Pseudonymisation (Art 4(5)) 적용');
    requirementsPending.push(
      'Records of processing (Art 30) 유지',
      'Art 32 보안조치 — 암호화·resilience·복원'
    );
  }

  // Art 83 과징금 — Special Category 또는 Art 5/6/9 위반 시 €20M/4% 글로벌 매출
  const maxPenalty = hasSpecialCategory || hasCriminalData
    ? '€20M 또는 글로벌 매출 4% (Art 83(5))'
    : hasPersonalData
      ? '€10M 또는 글로벌 매출 2% (Art 83(4))'
      : '해당 없음 (Personal Data 부재)';

  return {
    jurisdiction: 'EU',
    name: 'European Union (GDPR)',
    regulator: 'European Data Protection Board (EDPB) + 각 회원국 DPA',
    buckets,
    hasSpecialCategory,
    hasCriminalData,
    hasPersonalData,
    art33Required,
    art34Required,
    verdict,
    rationale,
    requirementsMet,
    requirementsPending,
    maxPenalty,
  };
}

/**
 * GDPR Article 33 (Supervisory Authority) + Article 34 (Data Subjects) 신고 초안.
 * 기한: Art 33: 72 hours / Art 34: without undue delay if high risk.
 */
export interface EuBreachDraft {
  reportType: 'GDPR Article 33 (Supervisory Authority) + Article 34 (Data Subjects)';
  reportingTo: string;
  deadline: string;
  '1_nature_of_breach': string;
  '2_awareness_time': string;
  '3_occurrence_time': string;
  '4_categories_and_approximate_numbers': {
    dataSubjectsAffected: string;
    recordsAffected: number;
    byCategory: Record<string, string[]>;
    samples: Array<{ entityType: string; snippet: string }>;
    specialCategoriesArt9Affected: boolean;
    criminalDataArt10Affected: boolean;
    credentialsAffected: boolean;
  };
  '5_likely_consequences': string;
  '6_measures_taken_or_proposed': string[];
  '7_DPO_contact': string;
  '8_data_subject_communication': string;
  '9_remedial_actions': string[];
  lawful_basis_review: string;
  cross_border_implications: string;
  penalty_exposure: string;
  severity: 'High (likely high risk)' | 'Medium' | 'Low';
  memo?: string;
  disclaimer: string;
}

export function buildEuBreachDraft(
  filename: string,
  findings: Finding[],
  classification?: { grade?: string; score?: number },
  opts: { memo?: string } = {}
): EuBreachDraft {
  const compliance = evaluateEuCompliance(findings);
  const samples = findings.slice(0, 10).map(f => ({
    entityType: f.entityType,
    snippet: (f.text || '').slice(0, 20),
  }));

  const severity: EuBreachDraft['severity'] =
    compliance.hasSpecialCategory || compliance.hasCriminalData
      ? 'High (likely high risk)'
      : compliance.hasPersonalData || compliance.buckets['Credentials'].length > 0
        ? 'Medium' : 'Low';

  const now = new Date().toISOString();
  return {
    reportType: 'GDPR Article 33 (Supervisory Authority) + Article 34 (Data Subjects)',
    reportingTo:
      'Lead Supervisory Authority (one-stop-shop) ' +
      (compliance.art34Required ? '+ affected data subjects (Art 34)' : ''),
    deadline:
      'Art 33: 72 hours after becoming aware / Art 34: without undue delay if high risk',
    '1_nature_of_breach':
      `File '${filename}': ${findings.length} personal data items detected. ` +
      `Classification: ${classification?.grade || 'N/A'} (score=${classification?.score ?? '—'}). ` +
      'Confidentiality breach (likely) — unauthorized disclosure pending verification.',
    '2_awareness_time': now,
    '3_occurrence_time': '(under investigation)',
    '4_categories_and_approximate_numbers': {
      dataSubjectsAffected: 'TBD (정보주체 수 확인 필요)',
      recordsAffected: findings.length,
      byCategory: Object.fromEntries(
        Object.entries(compliance.buckets)
          .filter(([, v]) => v.length > 0)
          .map(([k, v]) => [k, Array.from(new Set(v)).sort()])
      ),
      samples,
      specialCategoriesArt9Affected: compliance.hasSpecialCategory,
      criminalDataArt10Affected: compliance.hasCriminalData,
      credentialsAffected: compliance.buckets['Credentials'].length > 0,
    },
    '5_likely_consequences': compliance.hasSpecialCategory
      ? 'High risk — Art 9 special categories breach. Discrimination, identity theft risk.'
      : compliance.hasCriminalData
        ? 'High risk — Art 10 criminal data. Reputational and legal harm.'
        : compliance.hasPersonalData
          ? 'Medium — personal data loss of confidentiality.'
          : 'Low.',
    '6_measures_taken_or_proposed': [
      'Containment — system isolation / credential rotation',
      'Forensic investigation — log review (Art 32 evidence)',
      'Affected data subjects identification',
      'Coordination with DPO + legal counsel',
    ],
    '7_DPO_contact': '(Data Protection Officer 정보 — 필수 입력)',
    '8_data_subject_communication': compliance.art34Required
      ? 'REQUIRED (Art 34) — clear and plain language, including DPO contact, ' +
        'likely consequences, measures taken.'
      : 'Consider voluntary notification — high transparency expectations.',
    '9_remedial_actions': [
      'Pseudonymisation / encryption upgrade (Art 32(1)(a))',
      'Resilience and integrity testing (Art 32(1)(b)(c))',
      'Restore availability and access (Art 32(1)(c))',
      'Regular DPIA (Art 35) for high-risk processing',
      'Staff training — Art 39 DPO responsibility',
    ],
    lawful_basis_review:
      'Re-evaluate Art 6 basis. ' +
      (compliance.hasSpecialCategory ? 'For Art 9 data — verify Art 9(2) exception.' : ''),
    cross_border_implications:
      'If transfer outside EEA — review SCC (Commission Decision 2021/914) / adequacy decision / BCR validity.',
    penalty_exposure: `Up to ${compliance.maxPenalty}.`,
    severity,
    memo: opts.memo,
    disclaimer:
      'PoC auto-generated draft — actual notifications require DPO review and DPA coordination.',
  };
}
