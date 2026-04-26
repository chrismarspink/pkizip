/**
 * QR 코드 생성 — pkizip 인증서 공유 포맷
 */
import QRCode from 'qrcode';

export interface CertQrPayload {
  type: 'pkizip-cert';
  version: 1;
  email?: string;
  fingerprint: string;
  url?: string;
  pubkey?: string;
  /** 표시명 (이름) */
  name?: string;
  /** username (서버 디렉토리 ID) */
  username?: string;
  /** ECDH 공개키 JWK */
  enc_jwk?: JsonWebKey;
}

/** PEM/JWK/메타로 QR data URL 생성 */
export async function generateCertQr(payload: Omit<CertQrPayload, 'type' | 'version'>): Promise<string> {
  const data: CertQrPayload = { type: 'pkizip-cert', version: 1, ...payload };
  return await QRCode.toDataURL(JSON.stringify(data), {
    errorCorrectionLevel: 'M',
    width: 320,
    margin: 2,
    color: { dark: '#000000', light: '#FFFFFF' },
  });
}

/** 경량 모드: 인증서 PEM 없이 url+fingerprint만 (작은 QR) */
export async function generateCompactCertQr(p: {
  url: string; fingerprint: string; email?: string; name?: string;
}): Promise<string> {
  return generateCertQr(p);
}
