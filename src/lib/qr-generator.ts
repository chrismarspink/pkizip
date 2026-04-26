/**
 * QR 코드 생성 — pkizip 인증서 공유 (슬림 포맷)
 *
 * QR에는 식별·표시용 메타만 포함하고, 실제 인증서 PEM/JWK는 서버
 * 디렉토리(cert_bundles)에서 username 기준으로 fetch한다.
 *
 * 페이로드 ≈ 200~300 bytes → QR version 8~10, 어느 환경에서도 안정 스캔.
 */
import QRCode from 'qrcode';

export interface CertQrPayload {
  type: 'pkizip-cert';
  version: 1;
  /** 인증서 핑거프린트 (필수) */
  fingerprint: string;
  /** 서버 디렉토리 username — 스캔 측이 이걸로 PEM/JWK fetch */
  username?: string;
  /** 표시명 */
  name?: string;
  /** 이메일 (확인용) */
  email?: string;
  /** 인증서 배포 URL (옵션, 사용자 안내용) */
  url?: string;
}

/**
 * QR data URL 생성.
 * pubkey/enc_jwk는 의도적으로 제외 — QR 용량 한계 초과 방지.
 */
export async function generateCertQr(payload: Omit<CertQrPayload, 'type' | 'version'>): Promise<string> {
  const data: CertQrPayload = { type: 'pkizip-cert', version: 1, ...payload };
  return await QRCode.toDataURL(JSON.stringify(data), {
    errorCorrectionLevel: 'M',
    width: 320,
    margin: 2,
    color: { dark: '#000000', light: '#FFFFFF' },
  });
}
