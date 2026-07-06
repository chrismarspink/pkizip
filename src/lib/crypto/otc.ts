/**
 * OTC (One-Time Code) — 안전 링크 발송의 복호화 비밀.
 *
 * 설계:
 *   - 64비트 랜덤(8바이트) → Crockford Base32 13자 + 체크섬 1자 = 14자.
 *   - 표시는 4자 그룹: `K7QP-9F3M-2XTB-VH`. 전화·대면 구술과 필사가 쉬움.
 *   - 체크섬 1자로 오타를 즉시 감지(무의미한 PBKDF2 시도 방지).
 *   - **비밀(secret)** 은 앞 13자(데이터)뿐. 체크섬은 검증용이며 비밀이 아니다.
 *   - secret 문자열을 그대로 encryptWithPassword/decryptWithPassword 의 비밀번호로 사용
 *     (그쪽이 랜덤 salt + PBKDF2 600k 를 담당하므로 별도 KDF 불필요).
 *
 * 위협: 링크(암호문)가 유출되면 오프라인 무차별 대입 가능 → 방어는 엔트로피(64비트)
 *       + PBKDF2 워크팩터 + 노출 창 축소(1회 다운로드·짧은 만료).
 *
 * 서버는 OTC 를 절대 보지 못한다(복호화는 클라이언트에서만).
 */

// Crockford Base32 — I, L, O, U 제외(혼동·외설 방지)
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const DATA_CHARS = 13;   // 13 * 5 = 65비트 ≥ 64비트
const OTC_BYTES = 8;     // 64비트

/** 8바이트 → Crockford Base32 13자 (big-endian 비트 패킹) */
function encodeBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(value >>> bits) & 0x1f];
    }
  }
  if (bits > 0) {
    out += ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return out.slice(0, DATA_CHARS);
}

/** 데이터 13자 → 체크섬 1자 (위치 가중합 mod 32 — 치환·전치 오타 감지) */
function checksumChar(data: string): string {
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += ALPHABET.indexOf(data[i]) * (i + 1);
  }
  return ALPHABET[((sum % 32) + 32) % 32];
}

/** 4자 그룹으로 하이픈 삽입 (표시용) */
function group(s: string): string {
  return s.match(/.{1,4}/g)?.join('-') ?? s;
}

export interface GeneratedOtc {
  /** 사용자 표시용 그룹 문자열 (`K7QP-9F3M-2XTB-VH`) */
  display: string;
  /** 암호화 비밀번호로 쓰는 canonical 데이터 문자열 (앞 13자, 체크섬·하이픈 제외) */
  secret: string;
}

/** 새 OTC 생성 (64비트 랜덤) */
export function generateOtc(): GeneratedOtc {
  const bytes = crypto.getRandomValues(new Uint8Array(OTC_BYTES));
  const data = encodeBase32(bytes);
  const full = data + checksumChar(data);
  return { display: group(full), secret: data };
}

/**
 * 사용자 입력 정규화 — 하이픈·공백 제거, 대문자화, Crockford 치환(I/L→1, O→0),
 * 알파벳 외 문자 제거.
 */
export function normalizeOtc(input: string): string {
  return input
    .toUpperCase()
    .replace(/[ILO]/g, c => (c === 'O' ? '0' : '1'))
    .replace(/[^0-9A-Z]/g, '')
    .split('')
    .filter(c => ALPHABET.includes(c))
    .join('');
}

/**
 * 입력 OTC 검증 + secret 추출.
 * @returns 유효하면 secret(13자), 형식·체크섬 불일치면 null.
 */
export function parseOtc(input: string): string | null {
  const norm = normalizeOtc(input);
  if (norm.length !== DATA_CHARS + 1) return null;
  const data = norm.slice(0, DATA_CHARS);
  const check = norm[DATA_CHARS];
  if (checksumChar(data) !== check) return null;
  return data;
}

/** 입력이 완전한(체크섬 통과) OTC 인지 — UI 활성화 판단용 */
export function isValidOtc(input: string): boolean {
  return parseOtc(input) !== null;
}
