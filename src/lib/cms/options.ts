/**
 * CMS 옵션 상태머신.
 *
 * 4가지 메시지 타입 (Compressed/Signed/Enveloped/Encrypted) 간 전이 규칙과
 * 파생 상태를 한 곳에 모은다. CreatePage 의 토글/플로우/이벤트 emit 이
 * 같은 진실 소스를 공유하도록.
 *
 * 전이 규칙 (RFC 5652 + pkizip 봉투 정책):
 *   - enveloped ON  → sign=true, encrypted=false (서명 없는 봉투 금지)
 *   - encrypted ON  → enveloped=false, sign=false (비밀번호 암호화는 독립 경로)
 *   - sign OFF + enveloped ON → enveloped 도 함께 OFF
 *   - 그 외 sign 토글은 항상 허용
 */
export interface CmsOptions {
  compress: boolean;
  sign: boolean;
  enveloped: boolean;
  encrypted: boolean;
}

export type CmsType = 'Compressed' | 'Signed' | 'Enveloped' | 'Encrypted';

export interface CmsState {
  cmsType: CmsType;
  /** 서명 동작이 일어남 (Signed 또는 Enveloped) */
  willSign: boolean;
  /** 암호화 동작이 일어남 (Enveloped 또는 Encrypted) */
  willEncrypt: boolean;
  /** 키 자격(개인키) 필요 — sign/enveloped 시 */
  needsKey: boolean;
  /** 비밀번호 입력 필요 — encrypted (수신자 봉투 제외) */
  needsPassword: boolean;
  /** 수신자 선택 필요 — enveloped */
  needsRecipientSelection: boolean;
}

export function deriveCmsState(o: CmsOptions): CmsState {
  const cmsType: CmsType =
    o.encrypted ? 'Encrypted' :
    o.enveloped ? 'Enveloped' :
    o.sign      ? 'Signed'    : 'Compressed';
  const willSign = o.sign || o.enveloped;
  const willEncrypt = o.encrypted || o.enveloped;
  return {
    cmsType,
    willSign,
    willEncrypt,
    needsKey: willSign,
    needsPassword: o.encrypted && !o.enveloped,
    needsRecipientSelection: o.enveloped,
  };
}

/**
 * 토글 전이 — 한 키를 누르면 다른 플래그가 어떻게 따라가는지 규칙 일원화.
 * UI 의 setOptions(prev => applyToggle(prev, key)) 형태로 호출.
 */
export function applyToggle(prev: CmsOptions, key: keyof CmsOptions): CmsOptions {
  const next = { ...prev };
  if (key === 'enveloped') {
    next.enveloped = !prev.enveloped;
    if (next.enveloped) { next.encrypted = false; next.sign = true; }
  } else if (key === 'encrypted') {
    next.encrypted = !prev.encrypted;
    if (next.encrypted) { next.enveloped = false; next.sign = false; }
  } else if (key === 'sign') {
    next.sign = !prev.sign;
    // enveloped 안의 서명을 끄면 봉투 자체도 의도 상실 → 함께 해제
    if (!next.sign && prev.enveloped) next.enveloped = false;
  } else {
    next[key] = !prev[key];
  }
  return next;
}

export const DEFAULT_CMS_OPTIONS: CmsOptions = {
  compress: true,
  sign: false,
  enveloped: false,
  encrypted: false,
};
