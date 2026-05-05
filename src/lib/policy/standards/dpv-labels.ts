/**
 * DPV IRI → 사용자 표시용 메타 (한국어 라벨, 영어 라벨, 아이콘, 위험 등급).
 *
 * UI 에서 봉투 카드, 분석 다이얼로그, 통계 등에 사용.
 * 메타 자체에는 IRI 만 박히고, 표시할 때 이 매핑을 통해 사람이 읽기 좋은 형태로 변환.
 */
export interface DpvLabel {
  ko: string;
  en: string;
  icon: string;
  /** 위험 등급 — 카테고리 자체의 민감도 (개별 봉투 grade 와는 별개) */
  risk: 'high' | 'medium' | 'low';
}

export const DPV_LABEL: Record<string, DpvLabel> = {
  // ── 데이터 카테고리 (Phase 1) ────────────────────────
  'dpv:EmailAddress':             { ko: '이메일',     en: 'Email',            icon: '📧', risk: 'low' },
  'dpv:NationalIdentifier':       { ko: '주민번호',   en: 'National ID',       icon: '🆔', risk: 'high' },
  'dpv:Passport':                 { ko: '여권번호',   en: 'Passport',          icon: '📘', risk: 'high' },
  'dpv:OrganisationalIdentifier': { ko: '사업자번호',  en: 'Org ID',           icon: '🏢', risk: 'medium' },
  'dpv:TelephoneNumber':          { ko: '전화번호',   en: 'Phone',             icon: '📞', risk: 'medium' },
  'dpv:DriversLicense':           { ko: '운전면허',   en: 'Drivers License',   icon: '🪪', risk: 'high' },
  'dpv:HealthCareInsurance':      { ko: '건강보험',   en: 'Health Insurance',  icon: '🏥', risk: 'high' },
  'dpv:VehicleIdentifier':        { ko: '차량번호',   en: 'Vehicle',           icon: '🚗', risk: 'medium' },
  'dpv:CreditCardNumber':         { ko: '신용카드',   en: 'Credit Card',       icon: '💳', risk: 'high' },
  'dpv:IPAddress':                { ko: 'IP주소',     en: 'IP',               icon: '🌐', risk: 'low' },
  'dpv:Name':                     { ko: '이름',       en: 'Name',              icon: '👤', risk: 'medium' },
  'dpv:Address':                  { ko: '주소',       en: 'Address',           icon: '📍', risk: 'medium' },
  'dpv:Organisation':             { ko: '조직명',     en: 'Organisation',      icon: '🏛',  risk: 'low' },
  'dpv:Authenticating':           { ko: '자격증명',   en: 'Credential',        icon: '🔑', risk: 'high' },
  // ── 처리 활동 (Phase 2) ───────────────────────────────
  'dpv:Storage':                  { ko: '저장',       en: 'Storage',          icon: '💾', risk: 'low' },
  'dpv:Transfer':                 { ko: '외부 전송',  en: 'Transfer',          icon: '📤', risk: 'medium' },
  'dpv:Encrypt':                  { ko: '암호화',     en: 'Encrypt',           icon: '🔐', risk: 'low' },
  'dpv:Pseudonymise':             { ko: '가명처리',   en: 'Pseudonymise',      icon: '🎭', risk: 'low' },
  'dpv:Anonymise':                { ko: '익명화',     en: 'Anonymise',         icon: '🫥', risk: 'low' },
  // ── 적용 조치 (Phase 2) ───────────────────────────────
  'dpv:Encryption':               { ko: '암호화',     en: 'Encryption',         icon: '🔒', risk: 'low' },
  'dpv:DigitalSignature':         { ko: '전자서명',   en: 'Digital Signature',  icon: '✍',  risk: 'low' },
  'dpv:TimestampingService':      { ko: '타임스탬프',  en: 'Timestamping',       icon: '🕒', risk: 'low' },
  'dpv:Pseudonymisation':         { ko: '가명화 처리', en: 'Pseudonymisation',   icon: '🎭', risk: 'low' },
  'dpv:Anonymisation':            { ko: '익명화 처리', en: 'Anonymisation',      icon: '🫥', risk: 'low' },
  'dpv:CryptographicMethods':     { ko: 'PQC 암호',   en: 'PQC',               icon: '🛡',  risk: 'low' },
};

/** IRI 가 매핑되지 않으면 IRI 자체를 fallback 으로 사용. */
export function dpvLabel(iri: string, lang: 'ko' | 'en' = 'ko'): string {
  const m = DPV_LABEL[iri];
  if (!m) return iri.replace(/^dpv:/, '');
  return m[lang];
}

export function dpvIcon(iri: string): string {
  return DPV_LABEL[iri]?.icon ?? '🏷';
}

export function dpvRisk(iri: string): 'high' | 'medium' | 'low' {
  return DPV_LABEL[iri]?.risk ?? 'low';
}

/** 봉투의 data_categories 중 가장 위험한 등급 반환. */
export function dpvWorstRisk(categories: string[] | undefined): 'high' | 'medium' | 'low' | null {
  if (!categories || categories.length === 0) return null;
  const ranks = { high: 3, medium: 2, low: 1 } as const;
  let worst: 'high' | 'medium' | 'low' = 'low';
  for (const c of categories) {
    const r = dpvRisk(c);
    if (ranks[r] > ranks[worst]) worst = r;
  }
  return worst;
}

/** Tailwind CSS 클래스 — 카테고리 칩 스타일 (위험 등급별). */
export function dpvChipClass(risk: 'high' | 'medium' | 'low'): string {
  if (risk === 'high')   return 'bg-red-50 text-red-700 border-red-200';
  if (risk === 'medium') return 'bg-amber-50 text-amber-800 border-amber-200';
  return 'bg-zinc-50 text-zinc-700 border-zinc-200';
}
