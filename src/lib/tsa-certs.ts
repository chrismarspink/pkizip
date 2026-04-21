/**
 * TSA 인증서 기본 데이터 — DigiCert, Sectigo, GlobalSign, FreeTSA
 * 초기 등록용 (사용자 로그인 시 서버에 자동 저장)
 */
import { addThirdPartyCert, listTsaCerts } from './supabase/third-party-certs';

const TSA_CERTS = [
  {
    issuer_name: 'DigiCert',
    subject_name: 'DigiCert Timestamp 2023',
    source_url: 'https://timestamp.digicert.com',
    fingerprint: 'digicert-tsa-2023',
    cert_pem: `-----BEGIN CERTIFICATE-----
DigiCert SHA2 Assured ID Timestamping CA
(실제 인증서는 DigiCert TSA 응답에서 추출하거나 digicert.com에서 다운로드)
-----END CERTIFICATE-----`,
  },
  {
    issuer_name: 'Sectigo',
    subject_name: 'Sectigo RSA Time Stamping Signer',
    source_url: 'https://timestamp.sectigo.com',
    fingerprint: 'sectigo-tsa-signer',
    cert_pem: `-----BEGIN CERTIFICATE-----
Sectigo RSA Time Stamping CA
(실제 인증서는 Sectigo TSA 응답에서 추출)
-----END CERTIFICATE-----`,
  },
  {
    issuer_name: 'GlobalSign',
    subject_name: 'GlobalSign TSA for Advanced - G4',
    source_url: 'http://timestamp.globalsign.com/tsa/r6advanced1',
    fingerprint: 'globalsign-tsa-g4',
    cert_pem: `-----BEGIN CERTIFICATE-----
GlobalSign TSA for Advanced
(실제 인증서는 GlobalSign TSA 응답에서 추출)
-----END CERTIFICATE-----`,
  },
  {
    issuer_name: 'FreeTSA',
    subject_name: 'FreeTSA.org',
    source_url: 'https://freetsa.org/tsr',
    fingerprint: 'freetsa-org',
    cert_pem: `-----BEGIN CERTIFICATE-----
FreeTSA.org Time Stamping Authority
(실제 인증서는 https://freetsa.org/files/tsa.crt 에서 다운로드)
-----END CERTIFICATE-----`,
  },
];

/**
 * 로그인 사용자의 TSA 인증서가 없으면 기본 데이터 등록
 */
export async function ensureTsaCerts(userId: string): Promise<void> {
  const existing = await listTsaCerts(userId);
  if (existing.length > 0) return; // 이미 등록됨

  for (const cert of TSA_CERTS) {
    try {
      await addThirdPartyCert(userId, {
        cert_type: 'tsa',
        issuer_name: cert.issuer_name,
        subject_name: cert.subject_name,
        cert_pem: cert.cert_pem,
        fingerprint: cert.fingerprint,
        source_url: cert.source_url,
      });
    } catch (err) {
      console.warn(`[PKIZIP] TSA cert 등록 실패 (${cert.issuer_name}):`, err);
    }
  }
  console.log('[PKIZIP] TSA 기본 인증서 등록 완료');
}
