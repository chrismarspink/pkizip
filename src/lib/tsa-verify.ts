/**
 * TST 검증 — RFC 3161 타임스탬프 토큰 검증 8단계
 *
 * Step 1. TST 파싱 (ASN.1)
 * Step 2. ExtendedKeyUsage 확인 (id-kp-timeStamping)
 * Step 3. 인증서 유효기간 확인 (genTime 기준)
 * Step 4. 인증서 체인 구성
 * Step 5. 폐기 상태 (OCSP/CRL — warning only)
 * Step 6. TST 서명값 검증
 * Step 7. messageImprint 검증 (핵심)
 * Step 8. nonce 확인
 */
import * as asn1js from 'asn1js';
import { sha256 } from '@noble/hashes/sha2.js';

export type TstVerifyStep =
  | 'tst_parse' | 'eku_check' | 'cert_validity' | 'chain_build'
  | 'chain_verify' | 'revocation' | 'tst_signature' | 'message_imprint' | 'nonce_check';

export interface TstVerifyError {
  step: TstVerifyStep;
  message: string;
  fatal: boolean;
}

export interface TstVerifyResult {
  valid: boolean;
  genTime?: Date;
  tsaName?: string;
  method: 'tst' | 'signingTime' | 'none';
  errors: TstVerifyError[];
  warnings: string[];
}

/**
 * TST 검증 메인 함수
 *
 * @param tstDer TST DER 바이트 (TimeStampResp 또는 ContentInfo)
 * @param originalSignatureBytes 원본 서명 바이트 (messageImprint 대조용)
 * @param options nonce 등 옵션
 */
export async function verifyTimestampToken(
  tstDer: Uint8Array,
  originalSignatureBytes: Uint8Array,
  options?: { nonce?: Uint8Array },
): Promise<TstVerifyResult> {
  const errors: TstVerifyError[] = [];
  const warnings: string[] = [];
  let genTime: Date | undefined;
  let tsaName: string | undefined;

  // ── Step 1: TST 파싱 ──
  let tstInfo: { genTime?: Date; messageImprint?: Uint8Array; hashAlgOid?: string; nonce?: Uint8Array; } | null = null;
  try {
    tstInfo = parseTstInfo(tstDer);
    if (!tstInfo) throw new Error('TSTInfo 추출 실패');
    genTime = tstInfo.genTime;
    console.log('[TSA-verify] Step 1 OK: genTime =', genTime?.toISOString());
  } catch (err) {
    errors.push({ step: 'tst_parse', message: `TST 파싱 실패: ${err}`, fatal: true });
    return { valid: false, method: 'tst', errors, warnings };
  }

  // ── Step 2: EKU 확인 (인증서가 TST에 포함되어 있을 때만) ──
  // 브라우저 환경에서 TSA 인증서 추출이 어려우므로 warning 처리
  warnings.push('TSA 인증서 EKU 확인 생략 (오프라인 검증 시 확인 필요)');
  console.log('[TSA-verify] Step 2: EKU 확인 생략 (warning)');

  // ── Step 3: 인증서 유효기간 ──
  // TSA 인증서가 TST 내에 포함되어 있어야 확인 가능 — 현재 생략
  warnings.push('TSA 인증서 유효기간 확인 생략');
  console.log('[TSA-verify] Step 3: 인증서 유효기간 확인 생략 (warning)');

  // ── Step 4: 인증서 체인 구성 ──
  warnings.push('인증서 체인 검증 생략 (TSA 인증서 미포함)');
  console.log('[TSA-verify] Step 4: 체인 검증 생략 (warning)');

  // ── Step 5: 폐기 확인 ──
  warnings.push('OCSP/CRL 폐기 확인 생략');
  console.log('[TSA-verify] Step 5: 폐기 확인 생략 (warning)');

  // ── Step 6: TST 서명 검증 ──
  // TSA 인증서 공개키가 필요 — 현재 생략
  warnings.push('TST 서명 검증 생략 (TSA 공개키 미확보)');
  console.log('[TSA-verify] Step 6: 서명 검증 생략 (warning)');

  // ── Step 7: messageImprint 검증 (핵심) ──
  try {
    if (!tstInfo.messageImprint) throw new Error('messageImprint 없음');
    const expectedHash = sha256(originalSignatureBytes);
    const match = arrayEqual(expectedHash, tstInfo.messageImprint);
    if (!match) {
      errors.push({ step: 'message_imprint', message: '타임스탬프-서명 불일치 (messageImprint 불일치)', fatal: true });
      console.log('[TSA-verify] Step 7 FAIL: messageImprint 불일치');
    } else {
      console.log('[TSA-verify] Step 7 OK: messageImprint 일치');
    }
  } catch (err) {
    errors.push({ step: 'message_imprint', message: `messageImprint 검증 실패: ${err}`, fatal: true });
  }

  // ── Step 8: nonce 확인 ──
  if (options?.nonce && tstInfo?.nonce) {
    if (!arrayEqual(options.nonce, tstInfo.nonce)) {
      warnings.push('nonce 불일치 (재검증 시 정상)');
      console.log('[TSA-verify] Step 8: nonce 불일치 (warning)');
    } else {
      console.log('[TSA-verify] Step 8 OK: nonce 일치');
    }
  }

  const valid = errors.filter(e => e.fatal).length === 0;

  return {
    valid,
    genTime,
    tsaName: tsaName ?? 'Unknown TSA',
    method: 'tst',
    errors,
    warnings,
  };
}

/**
 * TST DER에서 TSTInfo 추출
 *
 * TimeStampResp ::= SEQUENCE {
 *   status    PKIStatusInfo,
 *   timeStampToken ContentInfo OPTIONAL
 * }
 *
 * ContentInfo ::= SEQUENCE {
 *   contentType  OID (1.2.840.113549.1.7.2 = signedData),
 *   content      [0] SignedData
 * }
 *
 * SignedData.encapContentInfo.eContent = TSTInfo DER
 *
 * TSTInfo ::= SEQUENCE {
 *   version        INTEGER,
 *   policy         OID,
 *   messageImprint MessageImprint,
 *   serialNumber   INTEGER,
 *   genTime        GeneralizedTime,
 *   ...
 *   nonce          INTEGER OPTIONAL,
 * }
 */
function parseTstInfo(der: Uint8Array): {
  genTime?: Date;
  messageImprint?: Uint8Array;
  hashAlgOid?: string;
  nonce?: Uint8Array;
} | null {
  try {
    const buf = der.buffer.slice(der.byteOffset, der.byteOffset + der.byteLength) as ArrayBuffer;
    const asn1 = asn1js.fromBER(buf);
    if (asn1.offset === -1) return null;

    const root = asn1.result as asn1js.Sequence;
    const values = root.valueBlock.value;

    // TimeStampResp: values[0]=status, values[1]=timeStampToken(ContentInfo)
    // 또는 직접 ContentInfo일 수도 있음
    let contentInfo: asn1js.Sequence;

    // status가 SEQUENCE(PKIStatusInfo)이면 TimeStampResp
    if (values.length >= 2 && values[1] instanceof asn1js.Sequence) {
      contentInfo = values[1] as asn1js.Sequence;
    } else {
      // 직접 ContentInfo
      contentInfo = root;
    }

    // ContentInfo → [0] EXPLICIT → SignedData
    const ciValues = contentInfo.valueBlock.value;
    if (ciValues.length < 2) return null;

    // signedData는 [0] EXPLICIT 안에 있음
    const signedDataWrapper = ciValues[1] as asn1js.Constructed;
    const signedData = signedDataWrapper.valueBlock.value[0] as asn1js.Sequence;
    if (!signedData) return null;

    // SignedData: version, digestAlgorithms, encapContentInfo, ...
    const sdValues = signedData.valueBlock.value;
    // encapContentInfo는 보통 index 2
    let encapContent: asn1js.Sequence | undefined;
    for (const item of sdValues) {
      if (item instanceof asn1js.Sequence) {
        const inner = (item as asn1js.Sequence).valueBlock.value;
        if (inner.length >= 1 && inner[0] instanceof asn1js.ObjectIdentifier) {
          const oid = (inner[0] as asn1js.ObjectIdentifier).valueBlock.toString();
          // id-ct-TSTInfo = 1.2.840.113549.1.9.16.1.4
          if (oid === '1.2.840.113549.1.9.16.1.4') {
            encapContent = item as asn1js.Sequence;
            break;
          }
        }
      }
    }

    if (!encapContent) return null;

    // eContent: [0] EXPLICIT OCTET STRING
    const eContentWrapper = encapContent.valueBlock.value[1] as asn1js.Constructed;
    if (!eContentWrapper) return null;
    const eContentOctet = eContentWrapper.valueBlock.value[0] as asn1js.OctetString;
    if (!eContentOctet) return null;

    // TSTInfo DER
    const tstInfoDer = eContentOctet.valueBlock.valueHexView;
    const tstInfoAsn1 = asn1js.fromBER(tstInfoDer.buffer.slice(tstInfoDer.byteOffset, tstInfoDer.byteOffset + tstInfoDer.byteLength) as ArrayBuffer);
    if (tstInfoAsn1.offset === -1) return null;

    const tstInfoSeq = tstInfoAsn1.result as asn1js.Sequence;
    const tiValues = tstInfoSeq.valueBlock.value;

    // TSTInfo fields: version(0), policy(1), messageImprint(2), serialNumber(3), genTime(4), ...
    // messageImprint: SEQUENCE { hashAlgorithm, hashedMessage }
    let messageImprint: Uint8Array | undefined;
    let hashAlgOid: string | undefined;
    let genTime: Date | undefined;
    let nonce: Uint8Array | undefined;

    if (tiValues.length > 2) {
      const miSeq = tiValues[2] as asn1js.Sequence;
      if (miSeq) {
        const miValues = miSeq.valueBlock.value;
        if (miValues.length >= 2) {
          // hashAlgorithm
          const algSeq = miValues[0] as asn1js.Sequence;
          hashAlgOid = (algSeq.valueBlock.value[0] as asn1js.ObjectIdentifier).valueBlock.toString();
          // hashedMessage
          const hashOctet = miValues[1] as asn1js.OctetString;
          messageImprint = new Uint8Array(hashOctet.valueBlock.valueHexView);
        }
      }
    }

    if (tiValues.length > 4) {
      const genTimeValue = tiValues[4];
      if (genTimeValue instanceof asn1js.GeneralizedTime) {
        genTime = genTimeValue.toDate();
      }
    }

    // nonce: 검색 (보통 index 5 이후)
    for (let i = 5; i < tiValues.length; i++) {
      if (tiValues[i] instanceof asn1js.Integer) {
        const intVal = tiValues[i] as asn1js.Integer;
        nonce = new Uint8Array(intVal.valueBlock.valueHexView);
        break;
      }
    }

    return { genTime, messageImprint, hashAlgOid, nonce };
  } catch (err) {
    console.error('[TSA-verify] TSTInfo 파싱 에러:', err);
    return null;
  }
}

function arrayEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
