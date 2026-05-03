/**
 * 페이지 간 단일 파일 핸드오프 — Explorer → FilesTempPage 등.
 *
 * React Router state 는 직렬화 강제라 File 객체 전달이 까다로움.
 * 모듈 레벨 변수 + take() 패턴으로 한 번 소비되면 비워짐.
 */
let _pending: File | null = null;

export function setPendingFile(f: File | null) {
  _pending = f;
}

export function takePendingFile(): File | null {
  const f = _pending;
  _pending = null;
  return f;
}

export function hasPendingFile(): boolean {
  return _pending !== null;
}
