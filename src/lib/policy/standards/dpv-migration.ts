/**
 * DPV 버전 마이그레이션 — v2 → 미래 버전 시 IRI alias 매핑.
 *
 * DPV 는 W3C CG Report 라 버전 업그레이드 시 일부 IRI 가 deprecated 또는 rename 될 수 있음.
 * 장기 보존 봉투 (5~10년) 의 후방 호환성 확보를 위해 alias 테이블 + 자동 변환.
 *
 * 현재 v2 → v3 미공개. 본 모듈은 인프라만 마련, 실제 매핑은 v3 출시 시 채움.
 */

/** 폐기된 IRI → 신 IRI 매핑. v3 출시 시 실제 항목 추가. */
export const DPV_IRI_MIGRATIONS: Record<string, string> = {
  // 예시 (v3 출시 시 실제 매핑으로 교체):
  // 'dpv:OldEmail':       'dpv:EmailAddress',  // v2 deprecated
  // 'dpv:OldNationalID':  'dpv:NationalIdentifier',
};

/** 단일 IRI 마이그레이션 — alias 가 있으면 신 IRI, 없으면 그대로. */
export function migrateIri(iri: string): string {
  return DPV_IRI_MIGRATIONS[iri] ?? iri;
}

/** IRI 배열 일괄 마이그레이션. 결과 중복 제거 + 정렬. */
export function migrateIris(iris: string[] | undefined): string[] {
  if (!iris) return [];
  return [...new Set(iris.map(migrateIri))].sort();
}

/** 봉투의 dpv 메타 전체를 신 버전으로 마이그레이션. 변경 사항 보고. */
export interface DpvMigrationReport {
  changed: boolean;
  migratedCount: number;
  changes: Array<{ field: string; from: string; to: string }>;
}

export function migrateDpvMeta(
  dpv: { '@context': string; data_categories: string[]; processing_activities?: string[]; applied_measures?: string[] },
): { dpv: typeof dpv; report: DpvMigrationReport } {
  const changes: DpvMigrationReport['changes'] = [];

  const migrate = (field: string, list: string[] | undefined): string[] | undefined => {
    if (!list) return undefined;
    const out = list.map(iri => {
      const m = migrateIri(iri);
      if (m !== iri) changes.push({ field, from: iri, to: m });
      return m;
    });
    return [...new Set(out)].sort();
  };

  const newDpv = {
    '@context': dpv['@context'],
    data_categories: migrate('data_categories', dpv.data_categories) ?? [],
    processing_activities: migrate('processing_activities', dpv.processing_activities),
    applied_measures: migrate('applied_measures', dpv.applied_measures),
  };

  return {
    dpv: newDpv,
    report: {
      changed: changes.length > 0,
      migratedCount: changes.length,
      changes,
    },
  };
}
