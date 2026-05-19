/**
 * 4관할 컴플라이언스 통합 API.
 *
 * UI (또는 다른 모듈) 은 jurisdiction code 만 넘기면 적절한 모듈로 라우팅.
 * 개별 compliance-{kr,us,jp,eu}.ts 가 풀스택 — 본 파일은 dispatcher.
 */
import type { Finding } from './types';
import { evaluateKrCompliance, buildKrBreachDraft } from './compliance-kr';
import type { KrComplianceResult, KrBreachDraft } from './compliance-kr';
import { evaluateUsCompliance, buildUsBreachDraft } from './compliance-us';
import type { UsComplianceResult, UsBreachDraft } from './compliance-us';
import { evaluateJpCompliance, buildJpBreachDraft } from './compliance-jp';
import type { JpComplianceResult, JpBreachDraft } from './compliance-jp';
import { evaluateEuCompliance, buildEuBreachDraft } from './compliance-eu';
import type { EuComplianceResult, EuBreachDraft } from './compliance-eu';

export type Jurisdiction = 'kr' | 'us' | 'jp' | 'eu';

export type ComplianceResult =
  | KrComplianceResult
  | UsComplianceResult
  | JpComplianceResult
  | EuComplianceResult;

export type BreachDraft =
  | KrBreachDraft
  | UsBreachDraft
  | JpBreachDraft
  | EuBreachDraft;

export interface JurisdictionMeta {
  code: Jurisdiction;
  name: string;
  flag: string;
  regulator: string;
  regulatorUrl: string;
  primaryLaw: string;
  lawUrl: string;
}

export const JURISDICTIONS: JurisdictionMeta[] = [
  {
    code: 'kr',
    name: '대한민국 (PIPA)',
    flag: '🇰🇷',
    regulator: '개인정보보호위원회 (PIPC)',
    regulatorUrl: 'https://www.pipc.go.kr/',
    primaryLaw: '개인정보보호법 (2011 / 2020 개정)',
    lawUrl: 'https://www.law.go.kr/법령/개인정보보호법',
  },
  {
    code: 'us',
    name: 'United States (HIPAA · CCPA · GLBA)',
    flag: '🇺🇸',
    regulator: 'HHS · FTC · State Agencies',
    regulatorUrl: 'https://www.hhs.gov/hipaa/',
    primaryLaw: 'HIPAA Safe Harbor + CCPA/CPRA + GLBA',
    lawUrl: 'https://www.hhs.gov/hipaa/for-professionals/privacy/',
  },
  {
    code: 'jp',
    name: '日本 (APPI)',
    flag: '🇯🇵',
    regulator: '個人情報保護委員会 (PPC)',
    regulatorUrl: 'https://www.ppc.go.jp/',
    primaryLaw: '個人情報保護法 (2003 / 2022 개정) + マイナンバー법',
    lawUrl: 'https://elaws.e-gov.go.jp/document?lawid=415AC0000000057',
  },
  {
    code: 'eu',
    name: 'European Union (GDPR)',
    flag: '🇪🇺',
    regulator: 'EDPB + 각 회원국 DPA',
    regulatorUrl: 'https://edpb.europa.eu/',
    primaryLaw: 'GDPR (Regulation 2016/679) + ePrivacy Directive',
    lawUrl: 'https://gdpr-info.eu/',
  },
];

export interface EvaluateOptions {
  /** KR §34 — 영향받은 정보주체 수 */
  affectedSubjects?: number;
  /** US — affected individuals */
  affectedIndividuals?: number;
  /** 적용된 익명화 method (entityType → method) */
  appliedMethods?: Record<string, string>;
}

/**
 * 단일 관할 평가.
 */
export function evaluate(
  jur: Jurisdiction,
  findings: Finding[],
  opts: EvaluateOptions = {}
): ComplianceResult {
  switch (jur) {
    case 'kr':
      return evaluateKrCompliance(findings, {
        affectedSubjects: opts.affectedSubjects,
        appliedMethods: opts.appliedMethods,
      });
    case 'us':
      return evaluateUsCompliance(findings);
    case 'jp':
      return evaluateJpCompliance(findings, opts.appliedMethods);
    case 'eu':
      return evaluateEuCompliance(findings);
  }
}

/**
 * 4관할 동시 평가 — Cross-border 시나리오 (한·일·미·EU 동시 운영 기업).
 */
export function evaluateAll(
  findings: Finding[],
  opts: EvaluateOptions = {}
): Record<Jurisdiction, ComplianceResult> {
  return {
    kr: evaluate('kr', findings, opts),
    us: evaluate('us', findings, opts),
    jp: evaluate('jp', findings, opts),
    eu: evaluate('eu', findings, opts),
  };
}

/**
 * 관할별 유출신고 양식.
 */
export interface BreachDraftOptions {
  classification?: { grade?: string; score?: number };
  affectedSubjects?: number;
  affectedIndividuals?: number;
  memo?: string;
}

export function buildBreachDraft(
  jur: Jurisdiction,
  filename: string,
  findings: Finding[],
  opts: BreachDraftOptions = {}
): BreachDraft {
  switch (jur) {
    case 'kr':
      return buildKrBreachDraft(filename, findings, opts.classification, {
        affectedSubjects: opts.affectedSubjects,
        memo: opts.memo,
      });
    case 'us':
      return buildUsBreachDraft(filename, findings, opts.classification, {
        affectedIndividuals: opts.affectedIndividuals,
        memo: opts.memo,
      });
    case 'jp':
      return buildJpBreachDraft(filename, findings, opts.classification, opts.memo);
    case 'eu':
      return buildEuBreachDraft(filename, findings, opts.classification, {
        memo: opts.memo,
      });
  }
}
