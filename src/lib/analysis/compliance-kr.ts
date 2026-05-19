/**
 * 한국 컴플라이언스 매핑 — PIPA · 신용정보법 · 분야 가이드라인.
 *
 * HE-TEST pseudo_framework.py JURISDICTION["KR"] + /api/compliance/kr/breach-draft
 * 의 클라이언트 포팅. compliance-jp.ts 와 동일 구조.
 *
 * 핵심:
 *   1) entity → PIPA 카테고리 (고유식별정보 §24 · 민감정보 §23 · 일반)
 *   2) §24-2 주민등록번호 처리제한 자동 판정
 *   3) §34 유출신고 트리거 — 1,000명 이상 / 민감정보 / 자격증명 → 72시간 내 신고
 */
import type { Finding } from './types';

export interface KrEntityMeta {
  pipaCategory: '고유식별정보' | '민감정보' | '개인정보' | '신용정보' | '법인정보' | '기타';
  law: string;
  lawUrl: string;
  treatment: string;
  /** 주민등록번호 §24-2 처리제한 — 법령 근거 없으면 처리 불가 */
  rrnRestriction?: boolean;
}

export const KR_ENTITY_META: Record<string, KrEntityMeta> = {
  KR_RRN: {
    pipaCategory: '고유식별정보',
    law: '개인정보보호법 §24·§24-2',
    lawUrl: 'https://www.law.go.kr/법령/개인정보보호법',
    treatment: 'mask + 가명화 시 비가역 토큰',
    rrnRestriction: true,
  },
  KR_PASSPORT: {
    pipaCategory: '고유식별정보',
    law: '개인정보보호법 §24',
    lawUrl: 'https://www.law.go.kr/법령/개인정보보호법',
    treatment: 'mask / tokenize',
  },
  KR_DRIVERS_LICENSE: {
    pipaCategory: '고유식별정보',
    law: '개인정보보호법 §24',
    lawUrl: 'https://www.law.go.kr/법령/개인정보보호법',
    treatment: 'mask / tokenize',
  },
  KR_ARC: {
    pipaCategory: '고유식별정보',
    law: '개인정보보호법 §24 (외국인등록번호)',
    lawUrl: 'https://www.law.go.kr/법령/개인정보보호법',
    treatment: 'mask',
  },
  KR_HEALTH_INSURANCE: {
    pipaCategory: '민감정보',
    law: '개인정보보호법 §23 (건강정보)',
    lawUrl: 'https://www.law.go.kr/법령/개인정보보호법',
    treatment: 'remove + 별도 동의 검증',
  },
  KR_PHONE: {
    pipaCategory: '개인정보',
    law: '개인정보보호법 §2',
    lawUrl: 'https://www.law.go.kr/법령/개인정보보호법',
    treatment: 'mask (뒤 4자리 유지)',
  },
  KR_LANDLINE: {
    pipaCategory: '개인정보',
    law: '개인정보보호법 §2',
    lawUrl: 'https://www.law.go.kr/법령/개인정보보호법',
    treatment: 'mask',
  },
  KR_ADDRESS: {
    pipaCategory: '개인정보',
    law: '개인정보보호법 §2',
    lawUrl: 'https://www.law.go.kr/법령/개인정보보호법',
    treatment: 'generalize (시·도 단위)',
  },
  KR_BIZ_NO: {
    pipaCategory: '법인정보',
    law: '개인정보보호법 §2 (개인사업자 시 개인정보)',
    lawUrl: 'https://www.law.go.kr/법령/개인정보보호법',
    treatment: 'mask (선택)',
  },
  KR_CORP_REG_NUMBER: {
    pipaCategory: '법인정보',
    law: '상법 (법인등기번호)',
    lawUrl: 'https://www.law.go.kr/법령/상법',
    treatment: 'identity (보존 가능)',
  },
  KR_CAR_PLATE: {
    pipaCategory: '개인정보',
    law: '개인정보보호법 §2',
    lawUrl: 'https://www.law.go.kr/법령/개인정보보호법',
    treatment: 'mask',
  },
  EMAIL_ADDRESS: {
    pipaCategory: '개인정보',
    law: '개인정보보호법 §2',
    lawUrl: 'https://www.law.go.kr/법령/개인정보보호법',
    treatment: 'replace (해시 / pseudonym)',
  },
  CREDIT_CARD: {
    pipaCategory: '신용정보',
    law: '신용정보의 이용 및 보호에 관한 법률 §32 + PCI-DSS Req 3.4',
    lawUrl: 'https://www.law.go.kr/법령/신용정보의이용및보호에관한법률',
    treatment: 'mask (앞 6 + 뒤 4 유지)',
  },
};

export type KrVerdict = 'compliant' | 'partial' | 'insufficient';

export interface KrComplianceResult {
  jurisdiction: 'KR';
  name: '대한민국 (PIPA)';
  regulator: '개인정보보호위원회 (PIPC) + KISA';
  buckets: {
    고유식별정보: string[];
    민감정보: string[];
    개인정보: string[];
    신용정보: string[];
    법인정보: string[];
    기타: string[];
  };
  hasRrn: boolean;
  rrnRestrictionViolations: string[];
  verdict: KrVerdict;
  rationale: string;
  requirementsMet: string[];
  requirementsPending: string[];
  /** §34 유출신고 트리거 여부 — 1,000명 이상 / 민감정보 / 자격증명 */
  breachReportRequired: boolean;
  breachTriggers: string[];
}

/**
 * PIPA 카테고리 분류 + verdict.
 */
export function evaluateKrCompliance(
  findings: Finding[],
  opts: {
    /** 영향받은 정보주체 수 — §34 1,000명 기준 */
    affectedSubjects?: number;
    /** 익명화 적용 method (entityType → method) */
    appliedMethods?: Record<string, string>;
  } = {}
): KrComplianceResult {
  const { affectedSubjects = 0, appliedMethods } = opts;
  const buckets: KrComplianceResult['buckets'] = {
    고유식별정보: [],
    민감정보: [],
    개인정보: [],
    신용정보: [],
    법인정보: [],
    기타: [],
  };
  let hasRrn = false;
  const rrnRestrictionViolations: string[] = [];
  const breachTriggers: string[] = [];

  for (const f of findings) {
    const meta = KR_ENTITY_META[f.entityType];
    if (!meta) {
      buckets.기타.push(f.entityType);
      // 자격증명 (AWS Key, Generic API key) — §34 트리거
      if (f.entityType === 'AWS_ACCESS_KEY' || f.entityType === 'GENERIC_API_KEY') {
        breachTriggers.push(`${f.entityType} (자격증명 유출)`);
      }
      continue;
    }
    buckets[meta.pipaCategory].push(f.entityType);
    if (meta.rrnRestriction) {
      hasRrn = true;
      // 주민등록번호 §24-2 — 법령 근거 없이 처리 시 위반. mask 만으론 부족, remove 권장
      const m = appliedMethods?.[f.entityType];
      if (m && m !== 'remove' && m !== 'tokenize_random' && m !== 'suppress') {
        rrnRestrictionViolations.push(f.entityType);
      }
    }
  }

  // §34 유출신고 트리거 — 3개 조건 중 하나라도 만족
  if (affectedSubjects >= 1000) breachTriggers.push(`정보주체 ${affectedSubjects}명 ≥ 1,000명`);
  if (buckets.민감정보.length > 0) breachTriggers.push(`민감정보 (§23) ${buckets.민감정보.length}건`);
  // 고유식별정보 (특히 RRN) 유출도 사실상 신고 대상
  if (hasRrn) breachTriggers.push('주민등록번호 (§24-2)');

  let verdict: KrVerdict;
  let rationale: string;
  const requirementsMet: string[] = ['검출/분류 완료'];
  const requirementsPending: string[] = [];

  if (rrnRestrictionViolations.length > 0) {
    verdict = 'insufficient';
    rationale =
      `§24-2 주민등록번호 처리제한 위반: ${[...new Set(rrnRestrictionViolations)].join(', ')} — ` +
      '법령 근거 없이 mask 처리 불가, 가명화 시 비가역 토큰 필수.';
    requirementsPending.push(
      'KR_RRN 의 method 를 remove 또는 tokenize_random 으로 변경',
      '§29 안전성 확보조치 — 암호화·접근통제·접근기록 보관',
      '§24-2 위반 시 5년 이하 징역 / 5천만원 벌금'
    );
  } else if (buckets.민감정보.length > 0) {
    verdict = 'partial';
    rationale =
      `민감정보 (§23) ${buckets.민감정보.length}건 — 별도 동의 또는 법령 근거 필요.`;
    requirementsMet.push('1차 카테고리 분류 완료');
    requirementsPending.push(
      '§23 ② 별도 동의 증빙 (옵트인)',
      '안전성 확보조치 (§29) 이행',
      '가명정보 §28-2~7 가이드라인 적정성 검토위원회'
    );
  } else {
    verdict = 'compliant';
    rationale = '고유식별·민감정보 모두 정책 변환됨 또는 부재. PoC 휴리스틱.';
    requirementsMet.push('고유식별·민감정보 모두 변환', '카테고리 분류 명세화');
    requirementsPending.push(
      '추가정보 (매핑) 별도 보관 (KMS) 또는 폐기',
      '§29 안전성 확보조치 8개 항목 이행 증빙',
      'ISMS-P 인증 통제 영역 매핑'
    );
  }

  return {
    jurisdiction: 'KR',
    name: '대한민국 (PIPA)',
    regulator: '개인정보보호위원회 (PIPC) + KISA',
    buckets,
    hasRrn,
    rrnRestrictionViolations,
    verdict,
    rationale,
    requirementsMet,
    requirementsPending,
    breachReportRequired: breachTriggers.length > 0,
    breachTriggers,
  };
}

/**
 * PIPA §34 유출신고서 자동 초안.
 * 신고처: PIPC + KISA, 기한: 72시간 (시행령 §40).
 */
export interface KrBreachDraft {
  보고서종류: '개인정보 유출 신고서';
  신고처: '개인정보보호위원회 (PIPC) + 한국인터넷진흥원 (KISA)';
  신고기한: string;
  '1_사고_개요': string;
  '2_발견_일시': string;
  '3_유출_일시': string;
  '4_유출_내용': {
    건수: number;
    카테고리별: Record<string, string[]>;
    샘플: Array<{ entityType: string; snippet: string }>;
    주민등록번호_포함: boolean;
    고유식별정보_포함: boolean;
    민감정보_포함: boolean;
    자격증명_포함: boolean;
  };
  '5_유출_원인': string;
  '6_2차_피해_가능성': string;
  '7_본인_통지': string;
  '8_홈페이지_공표': string;
  '9_재발방지_대책': string[];
  '10_트리거': string[];
  severity: '심각' | '높음' | '보통' | '낮음';
  memo?: string;
  disclaimer: string;
}

export function buildKrBreachDraft(
  filename: string,
  findings: Finding[],
  classification?: { grade?: string; score?: number },
  opts: { affectedSubjects?: number; memo?: string } = {}
): KrBreachDraft {
  const compliance = evaluateKrCompliance(findings, { affectedSubjects: opts.affectedSubjects });
  const samples = findings.slice(0, 10).map(f => ({
    entityType: f.entityType,
    snippet: (f.text || '').slice(0, 20),
  }));
  const hasUnique = compliance.buckets.고유식별정보.length > 0;
  const hasSensitive = compliance.buckets.민감정보.length > 0;
  const hasCred = findings.some(f =>
    f.entityType === 'AWS_ACCESS_KEY' || f.entityType === 'GENERIC_API_KEY'
  );

  const severity: KrBreachDraft['severity'] = compliance.hasRrn
    ? '심각'
    : hasUnique || hasSensitive || hasCred
      ? '높음'
      : findings.length > 0 ? '보통' : '낮음';

  const now = new Date().toISOString();
  return {
    보고서종류: '개인정보 유출 신고서',
    신고처: '개인정보보호위원회 (PIPC) + 한국인터넷진흥원 (KISA)',
    신고기한:
      '72시간 이내 (시행령 §40) — 1,000명 이상 / 민감정보 / 자격증명 유출 시 의무',
    '1_사고_개요':
      `파일 『${filename}』 에서 개인정보 ${findings.length}건 검출. ` +
      `분류 등급: ${classification?.grade || '미판정'} (score=${classification?.score ?? '—'}).`,
    '2_발견_일시': now,
    '3_유출_일시': '(미확인 — 조사 필요)',
    '4_유출_내용': {
      건수: findings.length,
      카테고리별: Object.fromEntries(
        Object.entries(compliance.buckets)
          .filter(([, v]) => v.length > 0)
          .map(([k, v]) => [k, Array.from(new Set(v)).sort()])
      ),
      샘플: samples,
      주민등록번호_포함: compliance.hasRrn,
      고유식별정보_포함: hasUnique,
      민감정보_포함: hasSensitive,
      자격증명_포함: hasCred,
    },
    '5_유출_원인': '(조사 중 — 예: 오발송 · 부정 접근 · 분실 · 내부자 유출)',
    '6_2차_피해_가능성': compliance.hasRrn
      ? '주민등록번호 유출 — §24-2 처리제한 위반 가능성. 명의도용·금융사기 위험 매우 높음.'
      : hasUnique
        ? '고유식별정보 포함 — 신원 도용 / 금융 사기 가능성.'
        : hasSensitive
          ? '민감정보 포함 — 차별·인권침해 가능성.'
          : hasCred
            ? '자격증명 유출 — 추가 시스템 침해 가능성.'
            : '제한적.',
    '7_본인_통지': '지체없이 — 통지 방법: 서면·전자우편·SMS 등 중 1개 (§34 ②).',
    '8_홈페이지_공표': '30일 이상 게시 — 1,000명 이상 시 의무.',
    '9_재발방지_대책': [
      '기술적 안전조치 — 암호화·접근통제·접근기록 보관 (§29 · 시행령 §30)',
      '관리적 안전조치 — 내부관리계획 수립·정기 점검',
      '물리적 안전조치 — 출입통제·전산실 보호',
      '개인정보 영향평가 (CPIA, 공공기관 의무)',
      'ISMS-P 인증 갱신 + 통제 영역 보완',
    ],
    '10_트리거': compliance.breachTriggers,
    severity,
    memo: opts.memo,
    disclaimer:
      '본 양식은 PoC 자동 생성 초안 — 실 신고 시 법무·DPO 검토 필수.',
  };
}
