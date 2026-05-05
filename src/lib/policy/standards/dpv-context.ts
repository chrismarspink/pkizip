/**
 * DPV 메타 빌더 — JSON-LD 컨텍스트 + 카테고리·활동·조치.
 *
 * Phase 1: data_categories
 * Phase 2: processing_activities + applied_measures (이번 단계)
 * Phase 3 예정: processing_purposes + legal_basis (사용자 입력 의존)
 */
import { DPV_CONTEXT_URL, findingsToDpvCategories } from './dpv-data-category';
import { deriveDpvProcessing, type ProcessingActivitySource } from './dpv-processing-activity';
import { deriveDpvMeasures, type AppliedMeasureSource } from './dpv-applied-measure';

export interface DpvMeta {
  '@context': string;
  data_categories: string[];
  processing_activities?: string[];
  applied_measures?: string[];
}

export interface DpvSource extends ProcessingActivitySource, AppliedMeasureSource {
  findingsSummary?: Record<string, number>;
}

/**
 * 헤더 정보로부터 DPV 메타 자동 생성.
 * 매핑 가능한 정보가 하나도 없으면 undefined.
 */
export function buildDpvMeta(src: DpvSource): DpvMeta | undefined {
  const categories = findingsToDpvCategories(src.findingsSummary);
  const activities = deriveDpvProcessing(src);
  const measures   = deriveDpvMeasures(src);

  // 카테고리·활동·조치 모두 비어있으면 메타 자체 생략
  if (categories.length === 0 && activities.length === 0 && measures.length === 0) {
    return undefined;
  }

  const out: DpvMeta = {
    '@context': DPV_CONTEXT_URL,
    data_categories: categories,
  };
  if (activities.length > 0) out.processing_activities = activities;
  if (measures.length > 0)   out.applied_measures      = measures;
  return out;
}
