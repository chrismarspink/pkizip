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
  // 이미지 크기를 최종 방어선에서 강제 제한 (64KB 이하 JPEG)
  if (logotype) {
    try {
      const safeBytes = await enforceLogotypeSize(logotype, 64 * 1024);
      if (safeBytes && safeBytes.length > 0) {
        certificate.extensions.push(
          new pkijs.Extension({
            extnID: '1.3.6.1.5.5.7.1.12',
            critical: false,
            extnValue: new asn1js.OctetString({
              valueHex: safeBytes.buffer.slice(safeBytes.byteOffset, safeBytes.byteOffset + safeBytes.byteLength) as ArrayBuffer,
            }).toBER(false),
          })
        );
      }
    } catch (err) {
      console.warn('[PKIZIP] logotype 임베딩 스킵:', err);
      // 실패해도 인증서 생성은 계속
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

/**
 * Logotype 이미지 크기를 강제 제한 — 최종 방어선
 *
 * 이미 압축된 data URL이 들어와도 크기 초과 시 Canvas로 재로드하여
 * JPEG로 재인코딩. 64KB 이하가 될 때까지 치수/품질을 단계적 축소.
 *
 * @returns 64KB 이하 JPEG 바이트. 실패 시 null.
 */
async function enforceLogotypeSize(
  dataUrl: string,
  maxBytes: number
): Promise<Uint8Array | null> {
  // 1) 먼저 현재 이미지 크기 확인
  const base64 = dataUrl.replace(/^data:image\/[^;]+;base64,/, '');
  const currentBytes = Math.floor((base64.length * 3) / 4);

  console.log(`[PKIZIP] logotype 입력 크기: ${Math.round(currentBytes / 1024)}KB`);

  // 이미 충분히 작으면 그대로 사용
  if (currentBytes <= maxBytes) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  // 2) 크면 Canvas로 재로드 → JPEG 재인코딩
  const img = await loadImageFromDataUrl(dataUrl);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const MAX_DIMS = [128, 96, 72, 56, 40, 32, 24];
  const QUALITIES = [0.7, 0.5, 0.35, 0.2];

  let best: Uint8Array | null = null;
  let bestSize = Infinity;

  for (const maxDim of MAX_DIMS) {
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));

    canvas.width = w;
    canvas.height = h;
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // 흰색 배경 (투명 알파 → 흰색)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);

    for (const q of QUALITIES) {
      const jpegDataUrl = canvas.toDataURL('image/jpeg', q);
      const jpegBase64 = jpegDataUrl.split(',')[1] ?? '';
      const padding = jpegBase64.endsWith('==') ? 2 : jpegBase64.endsWith('=') ? 1 : 0;
      const size = Math.floor((jpegBase64.length * 3) / 4) - padding;

      if (size < bestSize) {
        bestSize = size;
        const bin = atob(jpegBase64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        best = bytes;
      }

      if (size <= maxBytes) {
        console.log(`[PKIZIP] logotype 재압축: ${w}x${h} JPEG q=${q} → ${Math.round(size / 1024)}KB`);
        return best;
      }
    }
  }

  console.warn(`[PKIZIP] logotype 재압축 한계: ${Math.round(bestSize / 1024)}KB (목표 ${Math.round(maxBytes / 1024)}KB)`);
  return best;
}

function loadImageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('이미지 로드 실패'));
    img.src = dataUrl;
  });
}
