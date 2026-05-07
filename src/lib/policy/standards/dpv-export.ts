/**
 * DPV 메타 외부 export — JSON-LD 형식.
 *
 * OneTrust / Ethyca / TrustArc 등 외부 GDPR 컴플라이언스 도구로 봉투 메타 전달.
 * W3C JSON-LD 1.1 표준 그대로 — 외부 시스템이 별도 매핑 없이 의미 자동 인식.
 */
import type { PkiHeader } from '../../container/pki-format';

export interface DpvExportPayload {
  '@context': string;
  '@type': string;
  '@id': string;
  data_categories: string[];
  processing_activities: string[];
  applied_measures: string[];
  envelope: {
    filename: string;
    created_at: string;
    grade?: string;
    classifier_version?: string;
    creator_fingerprint?: string;
  };
  generated_by: string;
}

/** 봉투 헤더로부터 JSON-LD payload 생성. dpv 메타가 없으면 null. */
export function buildDpvExport(
  filename: string, header: PkiHeader,
): DpvExportPayload | null {
  if (!header.dpv) return null;
  return {
    '@context': header.dpv['@context'],
    '@type': 'PersonalDataHandling',
    '@id': `urn:pkizip:envelope:${filename}`,
    data_categories: header.dpv.data_categories,
    processing_activities: header.dpv.processing_activities ?? [],
    applied_measures: header.dpv.applied_measures ?? [],
    envelope: {
      filename,
      created_at: new Date(header.createdAt).toISOString(),
      grade: header.classification?.grade,
      classifier_version: header.classification?.classifierVersion,
      creator_fingerprint: header.creatorFingerprint,
    },
    generated_by: 'PKIZIP DPV Export v1',
  };
}

/** payload → 다운로드 트리거. 파일명: {envelope}.dpv.jsonld */
export function downloadDpvExport(filename: string, header: PkiHeader): boolean {
  const payload = buildDpvExport(filename, header);
  if (!payload) return false;
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/ld+json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename.replace(/\.(pki|pkizip|pqcz)$/i, '')}.dpv.jsonld`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return true;
}
