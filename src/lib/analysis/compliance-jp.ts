/**
 * 일본 컴플라이언스 매핑 — APPI · マイナンバー法 · 분야 가이드라인.
 *
 * HE-TEST pseudo_framework.py JURISDICTION["JP"] 의 클라이언트 포팅.
 * Finding[] 을 받아 다음을 계산:
 *   1) entity → APPI 카테고리 (個人識別符号 · 要配慮 · 個人情報 · 法人정보)
 *   2) マイナンバー法 §19 위반 자동 판정 (verdict='insufficient')
 *   3) PPC §26 漏洩等報告 5W1H 9항목 자동 초안
 *
 * UI 미사용 — 분석 결과 다이얼로그·CMS 봉투에 dpvMetadata 와 함께 부착.
 */
import type { Finding } from './types';

export interface JpEntityMeta {
  appiCategory:
    | '個人識別符号'
    | '要配慮個人情報'
    | '個人情報'
    | '個人関連情報'
    | '法人情報'
    | '機密';
  law: string;
  lawUrl: string;
  treatment: string;
  /** マイナンバー法 §19 별도 적용 — true 면 verdict insufficient 자동 */
  myNumberAct?: boolean;
}

export const JP_ENTITY_META: Record<string, JpEntityMeta> = {
  JP_MY_NUMBER: {
    appiCategory: '個人識別符号',
    law: 'マイナンバー法 §2·§19',
    lawUrl: 'https://elaws.e-gov.go.jp/document?lawid=425AC0000000027',
    treatment: 'remove (suppress) — 利用目的外保管禁止',
    myNumberAct: true,
  },
  JP_PASSPORT: {
    appiCategory: '個人識別符号',
    law: 'APPI §2(1)·政令 §1',
    lawUrl: 'https://www.ppc.go.jp/personalinfo/legal/',
    treatment: 'mask / tokenize',
  },
  JP_DRIVERS_LICENSE: {
    appiCategory: '個人識別符号',
    law: 'APPI §2(1)·政令 §1',
    lawUrl: 'https://www.ppc.go.jp/personalinfo/legal/',
    treatment: 'mask / tokenize',
  },
  JP_PHONE: {
    appiCategory: '個人情報',
    law: 'APPI §2(1)',
    lawUrl: 'https://www.ppc.go.jp/personalinfo/legal/',
    treatment: 'mask (preserve last 4)',
  },
  JP_POSTAL_CODE: {
    appiCategory: '個人関連情報',
    law: 'APPI §2·§31',
    lawUrl: 'https://www.ppc.go.jp/personalinfo/legal/',
    treatment: 'generalize (앞 3자리)',
  },
  JP_ADDRESS: {
    appiCategory: '個人情報',
    law: 'APPI §2(1)',
    lawUrl: 'https://www.ppc.go.jp/personalinfo/legal/',
    treatment: 'generalize (都道府県·市区町村까지)',
  },
  JP_CORPORATE_NUMBER: {
    appiCategory: '法人情報',
    law: '法人番号公表サイト (国税庁) — 개인정보 아님',
    lawUrl: 'https://www.houjin-bangou.nta.go.jp/',
    treatment: 'identity (보존 가능)',
  },
  JP_BANK_ACCOUNT: {
    appiCategory: '個人情報',
    law: 'APPI §2 + 金融分野 가이드라인 (FSA)',
    lawUrl: 'https://www.fsa.go.jp/news/r3/sonota/20220331-1.html',
    treatment: 'mask (末尾 4자리 유지)',
  },
};

export type JpVerdict = 'compliant' | 'partial' | 'insufficient';

export interface JpComplianceResult {
  jurisdiction: 'JP';
  name: '日本 (APPI)';
  regulator: '個人情報保護委員会 (PPC)';
  buckets: {
    個人識別符号: string[];
    要配慮個人情報: string[];
    個人情報: string[];
    個人関連情報: string[];
    法人情報: string[];
    機密: string[];
    其他: string[];
  };
  hasMyNumber: boolean;
  myNumberActViolations: string[];
  verdict: JpVerdict;
  rationale: string;
  requirementsMet: string[];
  requirementsPending: string[];
}

/**
 * Findings 를 APPI 카테고리로 분류 + verdict 판정.
 * @param findings 검출된 PII
 * @param appliedMethods 익명화 적용 method (entityType → method 매핑). 없으면 verdict insufficient 우선.
 */
export function evaluateJpCompliance(
  findings: Finding[],
  appliedMethods?: Record<string, string>
): JpComplianceResult {
  const buckets: JpComplianceResult['buckets'] = {
    個人識別符号: [],
    要配慮個人情報: [],
    個人情報: [],
    個人関連情報: [],
    法人情報: [],
    機密: [],
    其他: [],
  };
  let hasMyNumber = false;
  const myNumberActViolations: string[] = [];

  for (const f of findings) {
    const meta = JP_ENTITY_META[f.entityType];
    if (!meta) {
      buckets.其他.push(f.entityType);
      continue;
    }
    buckets[meta.appiCategory].push(f.entityType);
    if (meta.myNumberAct) {
      hasMyNumber = true;
      // appliedMethods 가 있고 'remove' 또는 'suppress' 가 아니면 위반
      const method = appliedMethods?.[f.entityType];
      if (method && method !== 'remove' && method !== 'suppress') {
        myNumberActViolations.push(f.entityType);
      }
    }
  }

  // 위반 우선 판정
  let verdict: JpVerdict;
  let rationale: string;
  const requirementsMet: string[] = ['검출/분류 완료'];
  const requirementsPending: string[] = [];

  if (myNumberActViolations.length > 0) {
    verdict = 'insufficient';
    rationale =
      `マイナンバー法 §19 위반: ${Array.from(new Set(myNumberActViolations)).join(', ')} — ` +
      '利用目的外保管禁止. 마스킹·토큰화 不可, suppress 필수.';
    requirementsPending.push(
      'JP_MY_NUMBER 의 method 를 suppress 로 변경 (완전 제거)',
      'マイナンバー法 §12 安全管理措置 — 暗号化·접근통제 증빙',
      '目的外利用·提供禁止 (法 §20)'
    );
  } else {
    const totalSensitive =
      buckets.個人識別符号.length + buckets.要配慮個人情報.length;
    if (totalSensitive >= 2) {
      verdict = 'partial';
      rationale =
        `個人識別符号 ${buckets.個人識別符号.length}건 + 要配慮 ${buckets.要配慮個人情報.length}건 — ` +
        'k-익명성·동의 검증 필요.';
      requirementsMet.push('1차 분류 완료');
      requirementsPending.push(
        '추가정보 별도 보관 (KMS/HSM)',
        '안전관리조치 (APPI §35-2) 증빙',
        '要配慮個人情報 사전 옵트인 동의 (APPI §20)'
      );
    } else {
      verdict = 'compliant';
      rationale = '個人識別符号/要配慮 모두 정책 변환됨 또는 부재. PoC 휴리스틱 판정.';
      requirementsMet.push('직접·민감 모두 변환', 'カテゴリ 분류 명세화');
      requirementsPending.push(
        '추가정보 (매핑) 폐기 또는 분리 폐기 증빙',
        '통계적 재식별 위험 평가 보고서'
      );
    }
  }

  return {
    jurisdiction: 'JP',
    name: '日本 (APPI)',
    regulator: '個人情報保護委員会 (PPC)',
    buckets,
    hasMyNumber,
    myNumberActViolations,
    verdict,
    rationale,
    requirementsMet,
    requirementsPending,
  };
}

/**
 * PPC §26 漏洩等報告 5W1H 9항목 자동 초안.
 */
export interface JpBreachDraft {
  /** APPI §26 + 施行規則 §8 */
  reportType: '個人情報の漏えい等の報告';
  reportingTo: '個人情報保護委員会 (PPC) + 本人通知';
  deadline: string;
  /** 1_概要 — 사고 요약 */
  summary: string;
  /** 2_発覚日時 — ISO timestamp */
  discoveredAt: string;
  /** 3_漏えい等の発生日時 */
  occurredAt: string;
  /** 4_漏えい等の状況 */
  details: {
    count: number;
    byCategory: Record<string, string[]>;
    hasMyNumber: boolean;
    samples: Array<{ entityType: string; snippet: string }>;
  };
  /** 5_原因 */
  cause: string;
  /** 6_二次被害·おそれの有無 */
  secondaryRisk: string;
  /** 7_本人への対応 */
  individualNotification: string;
  /** 8_公表 */
  publicDisclosure: string;
  /** 9_再発防止策 */
  preventionMeasures: string[];
  severity: '高 (重大)' | '中' | '低';
  memo?: string;
  disclaimer: string;
}

export function buildJpBreachDraft(
  filename: string,
  findings: Finding[],
  classification?: { grade?: string; score?: number },
  memo?: string
): JpBreachDraft {
  const compliance = evaluateJpCompliance(findings);
  const samples = findings.slice(0, 10).map(f => ({
    entityType: f.entityType,
    snippet: (f.text || '').slice(0, 20),
  }));
  const hasKojin = compliance.buckets.個人識別符号.length > 0;
  const severity: JpBreachDraft['severity'] = compliance.hasMyNumber
    ? '高 (重大)'
    : hasKojin
    ? '中'
    : '低';
  const now = new Date().toISOString();
  return {
    reportType: '個人情報の漏えい等の報告',
    reportingTo: '個人情報保護委員会 (PPC) + 本人通知',
    deadline: '速報: 概ね 3~5日 / 確報: 30日 (要配慮·財産的被害 60日)',
    summary:
      `ファイル『${filename}』内で個人情報 ${findings.length}件を検出. ` +
      `分類等級: ${classification?.grade || '未判定'} (score=${classification?.score ?? '—'}).`,
    discoveredAt: now,
    occurredAt: '(未確認 — 事業者調査必要)',
    details: {
      count: findings.length,
      byCategory: Object.fromEntries(
        Object.entries(compliance.buckets)
          .filter(([, v]) => v.length > 0)
          .map(([k, v]) => [k, Array.from(new Set(v)).sort()])
      ),
      hasMyNumber: compliance.hasMyNumber,
      samples,
    },
    cause: '(調査中 — 例: 誤送信·不正アクセス·紛失·内部不正)',
    secondaryRisk: compliance.hasMyNumber
      ? 'マイナンバー含有 — マイナンバー法 §51 不正取得罪該当の可能性. 重大事案.'
      : hasKojin
      ? '個人識別符号含有 — 二次被害 (なりすまし等) 可能性あり.'
      : '現時点では限定的.',
    individualNotification:
      '本人通知 + 問合せ窓口設置 + 必要に応じて謝罪·補償.',
    publicDisclosure:
      'ウェブサイト等で公表予定 (要配慮·財産的被害·1,000人超 の場合は義務).',
    preventionMeasures: [
      '技術的安全管理措置 — アクセス制御·暗号化·監査ログ強化 (PPC ガイドライン §10)',
      '組織的安全管理措置 — 担当者教育·インシデント対応手順整備',
      '人的安全管理措置 — 守秘義務契約·定期研修',
      '物理的安全管理措置 — 保管区域·端末紛失防止',
    ],
    severity,
    memo,
    disclaimer:
      '本書類は PoC 自動生成下書きです — 実際の報告には法務·コンプライアンス部門の確認が必須.',
  };
}
