/**
 * Self-Signed Certificate Generation using pkijs
 *
 * 니모닉 키 생성 시 이름+이메일 기반의 자체서명 X.509 인증서를 생성한다.
 * CA 없이 사용자 스스로 발급하는 "자기 증명" 인증서.
 */
import * as pkijs from 'pkijs';
import * as asn1js from 'asn1js';

export interface CertificateInfo {
  commonName: string;       // 이름
  email: string;            // 이메일
  fingerprint: string;      // 키 핑거프린트
  serialNumber: string;     // 인증서 시리얼
  notBefore: Date;
  notAfter: Date;
  pemCertificate: string;   // PEM 형식 인증서
  derCertificate: ArrayBuffer; // DER 바이너리
  logotype?: string;        // data URL (PNG) — 카드에 표시될 로고
}

export interface CertificateGenerationParams {
  commonName: string;
  email: string;
  signingPrivateKey: CryptoKey;
  signingPublicKey: CryptoKey;
  encryptionPublicKey: CryptoKey;
  fingerprint: string;
  validityYears?: number;   // 기본 10년
  logotype?: string;        // data URL (PNG)
}

/**
 * 자체서명 X.509 인증서 생성
 *
 * Subject: CN={이름}, E={이메일}
 * KeyUsage: digitalSignature, keyEncipherment
 * Validity: 10년
 */
export async function generateSelfSignedCertificate(
  params: CertificateGenerationParams
): Promise<CertificateInfo> {
  const {
    commonName,
    email,
    signingPrivateKey,
    signingPublicKey,
    fingerprint,
    validityYears = 10,
    logotype,
  } = params;

  // pkijs 암호 엔진 설정
  const cryptoEngine = new pkijs.CryptoEngine({
    name: 'webcrypto',
    crypto: crypto,
  });
  pkijs.setEngine('pkizip', crypto, cryptoEngine);

  const certificate = new pkijs.Certificate();

  // 버전 3 (v3)
  certificate.version = 2;

  // 시리얼 넘버 (랜덤 16바이트)
  const serialBytes = crypto.getRandomValues(new Uint8Array(16));
  serialBytes[0] = serialBytes[0] & 0x7F; // 양수 보장
  certificate.serialNumber = new asn1js.Integer({
    valueHex: serialBytes.buffer as ArrayBuffer,
  });

  // Subject DN: CN + E(emailAddress)
  certificate.subject.typesAndValues.push(
    new pkijs.AttributeTypeAndValue({
      type: '2.5.4.3', // CN (Common Name)
      value: new asn1js.Utf8String({ value: commonName }),
    })
  );
  certificate.subject.typesAndValues.push(
    new pkijs.AttributeTypeAndValue({
      type: '1.2.840.113549.1.9.1', // emailAddress
      value: new asn1js.IA5String({ value: email }),
    })
  );

  // Issuer = Subject (자체서명)
  certificate.issuer.typesAndValues.push(
    new pkijs.AttributeTypeAndValue({
      type: '2.5.4.3',
      value: new asn1js.Utf8String({ value: commonName }),
    })
  );
  certificate.issuer.typesAndValues.push(
    new pkijs.AttributeTypeAndValue({
      type: '1.2.840.113549.1.9.1',
      value: new asn1js.IA5String({ value: email }),
    })
  );

  // Validity (유효 기간)
  const notBefore = new Date();
  const notAfter = new Date();
  notAfter.setFullYear(notAfter.getFullYear() + validityYears);

  certificate.notBefore.value = notBefore;
  certificate.notAfter.value = notAfter;

  // 공개키 설정
  await certificate.subjectPublicKeyInfo.importKey(signingPublicKey);

  // Extensions
  certificate.extensions = [];

  // BasicConstraints: CA=false
  const basicConstraints = new pkijs.BasicConstraints({ cA: false });
  certificate.extensions.push(
    new pkijs.Extension({
      extnID: '2.5.29.19',
      critical: true,
      extnValue: basicConstraints.toSchema().toBER(false),
    })
  );

  // KeyUsage: digitalSignature (0) + keyEncipherment (2)
  const keyUsageBits = new ArrayBuffer(1);
  const keyUsageView = new Uint8Array(keyUsageBits);
  keyUsageView[0] = 0x05; // bit 0 (digitalSignature) + bit 2 (keyEncipherment) = 0b10100000 reversed = 0x05
  certificate.extensions.push(
    new pkijs.Extension({
      extnID: '2.5.29.15',
      critical: true,
      extnValue: new asn1js.BitString({
        valueHex: keyUsageBits,
        unusedBits: 5,
      }).toBER(false),
    })
  );

  // SubjectAltName: email
  const altNames = new pkijs.GeneralNames({
    names: [
      new pkijs.GeneralName({
        type: 1, // rfc822Name
        value: email,
      }),
    ],
  });
  certificate.extensions.push(
    new pkijs.Extension({
      extnID: '2.5.29.17',
      critical: false,
      extnValue: altNames.toSchema().toBER(false),
    })
  );

  // Logotype Extension (RFC 3709) — OID 1.3.6.1.5.5.7.1.12
  // 간단히 PNG 바이트를 OCTET STRING으로 저장 (data URL → base64 디코드)
  if (logotype) {
    try {
      const base64 = logotype.replace(/^data:image\/[^;]+;base64,/, '');
      const binary = atob(base64);
      const logoBytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) logoBytes[i] = binary.charCodeAt(i);

      certificate.extensions.push(
        new pkijs.Extension({
          extnID: '1.3.6.1.5.5.7.1.12',
          critical: false,
          extnValue: new asn1js.OctetString({
            valueHex: logoBytes.buffer as ArrayBuffer,
          }).toBER(false),
        })
      );
    } catch {
      // 로고 임베딩 실패 시 무시 (인증서 생성은 계속)
    }
  }

  // 서명 (자체서명)
  await certificate.sign(signingPrivateKey, 'SHA-256');

  // DER 인코딩
  const derCertificate = certificate.toSchema(true).toBER(false);

  // PEM 인코딩
  const pemCertificate = derToPem(derCertificate, 'CERTIFICATE');

  // 시리얼 넘버 hex
  const serialNumber = Array.from(serialBytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join(':');

  return {
    commonName,
    email,
    fingerprint,
    serialNumber,
    notBefore,
    notAfter,
    pemCertificate,
    derCertificate,
    logotype,
  };
}

/**
 * PEM 인증서 파싱
 */
export function parsePemCertificate(pem: string): CertificateInfo | null {
  try {
    const der = pemToDer(pem);
    const asn1 = asn1js.fromBER(der);
    if (asn1.offset === -1) return null;

    const cert = new pkijs.Certificate({ schema: asn1.result });

    const cn = cert.subject.typesAndValues
      .find(tv => tv.type === '2.5.4.3')?.value.valueBlock.value ?? '';
    const email = cert.subject.typesAndValues
      .find(tv => tv.type === '1.2.840.113549.1.9.1')?.value.valueBlock.value ?? '';

    const serialBytes = new Uint8Array(cert.serialNumber.valueBlock.valueHexView);
    const serialNumber = Array.from(serialBytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join(':');

    return {
      commonName: cn,
      email,
      fingerprint: '',
      serialNumber,
      notBefore: cert.notBefore.value,
      notAfter: cert.notAfter.value,
      pemCertificate: pem,
      derCertificate: der,
    };
  } catch {
    return null;
  }
}

/**
 * DER → PEM 변환
 */
function derToPem(der: ArrayBuffer, label: string): string {
  const bytes = new Uint8Array(der);
  // chunk 단위로 처리하여 stack overflow 방지
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  const base64 = btoa(binary);
  const lines = base64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----`;
}

/**
 * PEM → DER 변환
 */
function pemToDer(pem: string): ArrayBuffer {
  const base64 = pem
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s/g, '');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer as ArrayBuffer;
}
