/**
 * QR 코드 스캐너 — 카메라 스트림 + jsQR
 */
import jsQR from 'jsqr';
import type { CertQrPayload } from './qr-generator';

export interface QrScanResult {
  valid: boolean;
  data?: CertQrPayload;
  raw?: string;
  error?: string;
}

/**
 * 비디오 엘리먼트에서 QR 스캔 시작.
 * onDetected에 결과 전달, cleanup 함수 반환.
 */
export async function startQrScan(
  videoElement: HTMLVideoElement,
  onDetected: (result: QrScanResult) => void,
): Promise<() => void> {
  let stream: MediaStream | null = null;
  let raf = 0;
  let stopped = false;

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
  } catch (err) {
    const e = err as DOMException;
    onDetected({
      valid: false,
      error: e.name === 'NotAllowedError' ? 'permission_denied'
           : e.name === 'NotFoundError' ? 'no_camera'
           : `camera_error:${e.message}`,
    });
    return () => {};
  }

  videoElement.srcObject = stream;
  videoElement.setAttribute('playsinline', 'true');
  await videoElement.play().catch(() => {});

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

  const tick = () => {
    if (stopped) return;
    if (videoElement.readyState === videoElement.HAVE_ENOUGH_DATA) {
      canvas.width = videoElement.videoWidth;
      canvas.height = videoElement.videoHeight;
      ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'attemptBoth',
      });
      if (code?.data) {
        const result = parseQrData(code.data);
        if (result.valid) {
          onDetected(result);
          // 발견 후 자동 정지 — 호출자가 제어
        } else {
          // 유효 포맷 아니면 계속 스캔
        }
      }
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
    }
    videoElement.srcObject = null;
  };
}

/** raw 텍스트를 pkizip-cert QR로 파싱 */
export function parseQrData(raw: string): QrScanResult {
  try {
    const obj = JSON.parse(raw);
    if (obj?.type !== 'pkizip-cert') {
      return { valid: false, raw, error: 'not_pkizip_cert' };
    }
    if (!obj.fingerprint) return { valid: false, raw, error: 'missing_fingerprint' };
    return { valid: true, raw, data: obj as CertQrPayload };
  } catch {
    return { valid: false, raw, error: 'invalid_json' };
  }
}
