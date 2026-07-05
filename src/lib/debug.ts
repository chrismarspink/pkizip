/**
 * DEV 전용 로거 — 프로덕션 빌드에서는 침묵한다.
 *
 * 암호 연산 메타데이터(알고리즘 선택, TSA 서버명, 서명/타임스탬프 검증 결과 등)가
 * 프로덕션 콘솔에 노출되지 않도록 게이트한다. 개발 중에는 기존 console 과 동일하게 출력.
 */
const DEV = import.meta.env.DEV;

export const debug = {
  log: (...args: unknown[]): void => {
    if (DEV) console.log(...args);
  },
  warn: (...args: unknown[]): void => {
    if (DEV) console.warn(...args);
  },
  error: (...args: unknown[]): void => {
    if (DEV) console.error(...args);
  },
};
