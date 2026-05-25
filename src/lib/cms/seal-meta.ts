/**
 * AnalysisDecision → seal() analysisMeta 매핑.
 *
 * CreatePage 에서 분석 다이얼로그 결과를 봉투 헤더 메타로 변환할 때 사용.
 * 가명화 후 finding 이 비어있는 경우에도 원본 PII 정보가 보존되도록
 * `d.originalFindings` 기반으로 findingsSummary 를 구축한다.
 */
import { createMipLabel } from '@/lib/mip/mip-label';
import type { seal } from '@/lib/container/pki-operations';
import type { AnalysisDecision } from '@/components/dialogs/AnalysisDialog';

export type SealAnalysisMeta = NonNullable<Parameters<typeof seal>[0]['analysisMeta']>;

export function decisionToSealMeta(d: AnalysisDecision, fingerprint?: string): SealAnalysisMeta {
  const c = d.result.classification;
  const meta: SealAnalysisMeta = {
    classification: {
      grade: c.grade,
      score: c.score,
      confidence: c.confidence,
      classifierVersion: c.version,
      explanation: d.result.explanation?.summary,
      findingsSummary: Object.fromEntries(
        d.originalFindings.reduce((m, f) => m.set(f.entityType, (m.get(f.entityType) || 0) + 1), new Map<string, number>())
      ),
    },
    mipLabel: createMipLabel({ grade: c.grade, appliedBy: fingerprint }),
    language: {
      detected: d.result.language.detected,
      confidence: d.result.language.confidence,
      multilingual: d.result.language.multilingual,
      detectorVersion: d.result.language.detectorVersion,
    },
    intent: {
      purpose: d.intent.purpose,
      cryptoKind: d.intent.cryptoKind,
      requestedBy: fingerprint,
    },
  };
  if (d.result.ocr?.applied) {
    meta.ocr = {
      applied: true,
      engine: d.result.ocr.engine,
      languages: d.result.ocr.languages,
      confidence: d.result.ocr.confidence,
      pages: d.result.ocr.pages,
    };
  }
  if (d.result.anonymization && d.anonymizationAction !== 'skip') {
    const a = d.result.anonymization;
    meta.pseudonymization = {
      applied: true,
      isReversible: a.result.isReversible,
      policyVersion: a.result.policyVersion,
      methodBreakdown: Object.fromEntries(
        a.result.replacements.reduce((m, r) => m.set(r.method, (m.get(r.method) || 0) + 1), new Map<string, number>())
      ),
      finalGrade: a.finalGrade,
      iterations: a.iterations.length - 1,
      mappingTable: {
        included: false,
        sealedAlgorithm: d.intent.cryptoKind === 'classic' ? 'classic'
                       : d.intent.cryptoKind === 'pqc-only' ? 'pqc-only' : 'hybrid',
      },
    };
  }
  return meta;
}
