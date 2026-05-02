/**
 * Microsoft Information Protection (MIP) Sensitivity Label 생성기
 *
 * PKIZIP 봉투 외부에 평문으로 들어가는 라벨로, MS Defender / Office DLP /
 * Purview Information Protection 같은 외부 시스템이 같은 형식을 인식할 수 있게
 * 설계 — 봉투 자체를 못 풀어도 등급 라벨을 읽을 수 있다.
 *
 * 참고:
 *   - https://learn.microsoft.com/microsoft-365/compliance/sensitivity-labels-office-apps
 *   - schemas.microsoft.com/office/2020/mipLabelMetadata XML namespace
 *
 * 라벨은 두 형태로 직렬화 가능:
 *   - JSON (PkiHeader.mipLabel — 빠른 파싱)
 *   - XML  (LABEL.mip.xml — Office/Defender 호환)
 *
 * 둘 다 ML-DSA 서명 대상에 포함되어 변조 시 검증 실패.
 */
import type { PkiHeader } from '../container/pki-format';

export type Grade = 'C' | 'S' | 'O';

/** MS Purview 호환 sensitivity 척도 — 0..10 */
const SENSITIVITY_VALUE: Record<Grade, number> = {
  C: 9,
  S: 5,
  O: 0,
};

const LABEL_NAME: Record<Grade, string> = {
  C: 'Critical',
  S: 'Sensitive',
  O: 'Open',
};

const TOOLTIP: Record<Grade, string> = {
  C: '이 문서는 PKIZIP 분류 결과 위험(Critical) 등급입니다. 외부 유출 금지.',
  S: '이 문서는 PKIZIP 분류 결과 민감(Sensitive) 등급입니다. 사내 한정.',
  O: '이 문서는 PKIZIP 분류 결과 공개(Open) 등급입니다.',
};

/**
 * 등급별 GUID — 조직마다 고유하게 발급. 여기선 PKIZIP 기본값.
 * 실서비스 도입 시 organisation/tenant guid로 대체 권장.
 */
export const PKIZIP_LABEL_GUIDS: Record<Grade, string> = {
  C: 'a8c3e0f1-4b6d-4e2c-9f8a-1b2c3d4e5f60',
  S: 'b7d2c1e0-3a5b-4d7e-8f9b-2c3d4e5f6071',
  O: 'c6e1d2a3-2b4c-4d6e-7f8a-3d4e5f607182',
};

const DEFAULT_SITE_ID = 'pkizip-default';

export interface MipLabelInput {
  grade: Grade;
  /** 조직/테넌트 GUID — 없으면 'pkizip-default' */
  siteId?: string;
  /** 라벨 적용 주체 (송신자 fingerprint 등) */
  appliedBy?: string;
  /** 적용 시각 — 기본 now */
  setDate?: string;
  /** Privileged label = 사용자가 명시적 강등 가능 */
  privileged?: boolean;
}

export type MipLabel = NonNullable<PkiHeader['mipLabel']>;

/**
 * MIP 라벨 객체 생성 — PkiHeader.mipLabel 에 그대로 대입 가능.
 */
export function createMipLabel(input: MipLabelInput): MipLabel {
  const grade = input.grade;
  return {
    siteId: input.siteId || DEFAULT_SITE_ID,
    enabled: true,
    method: input.privileged ? 'Privileged' : 'Standard',
    contentBits: 0,
    setDate: input.setDate || new Date().toISOString(),
    labelId: PKIZIP_LABEL_GUIDS[grade],
    labelName: LABEL_NAME[grade],
    sensitivityValue: SENSITIVITY_VALUE[grade],
    tooltip: TOOLTIP[grade],
    appliedBy: input.appliedBy,
  };
}

/**
 * MS Office customXmlPart 호환 XML 직렬화.
 * 봉투 안에 LABEL.mip.xml 로 동봉하거나, Office 파일 자체에 삽입 시 사용.
 *
 * 네임스페이스 ns=http://schemas.microsoft.com/office/2020/mipLabelMetadata
 * 는 MS 공식 ns 와 동일 — Office/Defender/Purview 가 인식.
 */
export function serializeMipLabelXml(label: MipLabel): string {
  const e = (s: string) => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<MIPLabel xmlns="http://schemas.microsoft.com/office/2020/mipLabelMetadata">
  <SiteId>${e(label.siteId)}</SiteId>
  <Enabled>${label.enabled}</Enabled>
  <Method>${e(label.method)}</Method>
  <ContentBits>${label.contentBits}</ContentBits>
  <SetDate>${e(label.setDate)}</SetDate>
  <LabelId>${e(label.labelId)}</LabelId>
  <LabelName>${e(label.labelName)}</LabelName>
  <SensitivityValue>${label.sensitivityValue}</SensitivityValue>
  <Tooltip>${e(label.tooltip)}</Tooltip>${label.appliedBy ? `
  <AppliedBy>${e(label.appliedBy)}</AppliedBy>` : ''}
</MIPLabel>`;
}

/**
 * XML → MIP 라벨 — 외부에서 만든 XML 검증/파싱.
 * 간단한 정규식 기반 파서 (DOMParser 가용성 확보 안 됨 환경 대비).
 */
export function parseMipLabelXml(xml: string): MipLabel | null {
  const pick = (tag: string): string | undefined => {
    const m = new RegExp(`<${tag}>(.*?)</${tag}>`, 's').exec(xml);
    return m ? m[1].trim() : undefined;
  };
  const labelId = pick('LabelId');
  const labelName = pick('LabelName');
  if (!labelId || !labelName) return null;
  return {
    siteId: pick('SiteId') || DEFAULT_SITE_ID,
    enabled: pick('Enabled') === 'true',
    method: (pick('Method') as MipLabel['method']) || 'Standard',
    contentBits: Number(pick('ContentBits') ?? 0),
    setDate: pick('SetDate') || new Date().toISOString(),
    labelId,
    labelName,
    sensitivityValue: Number(pick('SensitivityValue') ?? 0),
    tooltip: pick('Tooltip') || '',
    appliedBy: pick('AppliedBy'),
  };
}

/**
 * 라벨 검증 — labelId 가 PKIZIP 기본 GUID 와 일치하는지.
 * 외부 조직 라벨은 별도 검증 정책 필요.
 */
export function isPkizipLabel(label: MipLabel): boolean {
  return Object.values(PKIZIP_LABEL_GUIDS).includes(label.labelId);
}

/** 라벨에서 등급 도출 */
export function gradeFromLabel(label: MipLabel): Grade | null {
  for (const [g, id] of Object.entries(PKIZIP_LABEL_GUIDS)) {
    if (label.labelId === id) return g as Grade;
  }
  // sensitivity value 기반 fallback
  if (label.sensitivityValue >= 8) return 'C';
  if (label.sensitivityValue >= 4) return 'S';
  return 'O';
}
