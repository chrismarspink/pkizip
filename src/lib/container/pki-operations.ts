/**
 * PKI Operations - 고수준 통합 API
 *
 * 압축 + 암호화(ECDH + ML-KEM 하이브리드) + 서명(ECDSA + ML-DSA 하이브리드)
 * CMS RFC 5652, RFC 9936 (ML-KEM CMS), RFC 9882 (ML-DSA CMS), RFC 3161 (TSA) 준거
 */
import { compress, decompress } from '../compression/compressor';
import { getTimestampToken, type TimestampResult } from '../tsa-client';
import { verifyTimestampToken, type TstVerifyResult } from '../tsa-verify';
import type { FileEntry } from '../compression/compressor';
import { toInputFiles, toFileEntries } from '../compression/compression-types';
import {
  encryptForRecipients,
  decryptAsRecipient,
  type RecipientInfo,
  type EncryptedPackage,
} from '../crypto/encryption';
import {
  signData,
  verifyAllSignatures,
  computeHash,
  type SignerInfo,
  type SignedPackage,
  type VerificationResult,
} from '../crypto/signing';
import {
  writePkiContainer,
  readPkiContainer,
  isPkiFile,
  type PkiContainer,
  type PkiHeader,
  type PkiFileInfo,
  FLAG_COMPRESSED,
  FLAG_ENCRYPTED,
  FLAG_SIGNED,
  FLAG_MULTI_FILE,
  setFlag,
  hasFlag,
  arrayBufferToBase64,
  base64ToArrayBuffer,
  serializeSignerInfos,
  deserializeSignerInfos,
  serializeRecipients,
  deserializeRecipients,
} from './pki-format';

export interface SealOptions {
  files: FileEntry[];
  compress?: boolean;
  encrypt?: {
    recipients: RecipientInfo[];
  };
  sign?: {
    privateKey: CryptoKey;
    publicKey: CryptoKey;
    fingerprint: string;
    label?: string;
  };
  /** PQC 하이브리드 옵션 — PQCShield/PQCSigner 인스턴스 전달 */
  pqc?: {
    shield?: { encapsulateCEK: (cek: Uint8Array) => Promise<PqcKemResult>; pqcKeyId: string };
    signer?: { sign: (data: Uint8Array) => Promise<PqcSignResult> };
    mode?: string;
  };
}

/** PQCShield.encapsulateCEK 반환 타입 */
interface PqcKemResult {
  type: string;
  rid: { pqcKeyId: string };
  kemCiphertext: Uint8Array;
  encryptedKey: Uint8Array;
  iv: Uint8Array;
  salt: Uint8Array;
  kemPublicKey: Uint8Array;
}

/** PQCSigner.sign 반환 타입 */
interface PqcSignResult {
  algorithm: string;
  signature: Uint8Array;
  dsaPublicKey: Uint8Array;
  signedAt: string;
}

export interface SealResult {
  pkiData: Uint8Array;
  header: PkiHeader;
  stats: {
    originalSize: number;
    compressedSize: number;
    fileCount: number;
    isEncrypted: boolean;
    isSigned: boolean;
    signatureCount: number;
    recipientCount: number;
    pqcKem: boolean;
    pqcDsa: boolean;
    timestamp?: TimestampResult;
  };
}

export interface OpenResult {
  files: FileEntry[];
  header: PkiHeader;
  verification: VerificationResult[];
  pqcVerification?: { valid: boolean; algorithm: string; signedAt?: string };
  timestampVerification?: TstVerifyResult;
  isEncrypted: boolean;
  isSigned: boolean;
}

/**
 * 봉인 (Seal) — 압축 + 암호화(ECDH + ML-KEM) + 서명(ECDSA + ML-DSA)
 */
export async function seal(options: SealOptions): Promise<SealResult> {
  const { files, compress: doCompress = true, encrypt, sign, pqc } = options;

  if (files.length === 0) {
    throw new Error('최소 1개의 파일이 필요합니다.');
  }

  let flags = 0;
  if (files.length > 1) flags = setFlag(flags, FLAG_MULTI_FILE);

  // 1. 압축
  const originalSize = files.reduce((sum, f) => sum + f.size, 0);
  const inputFiles = toInputFiles(files);
  const compressResult = compress(inputFiles);
  let payload = compressResult.data;

  if (doCompress) flags = setFlag(flags, FLAG_COMPRESSED);

  // 2. 파일 정보 헤더
  const fileInfos: PkiFileInfo[] = files.map(f => ({
    name: f.name,
    originalSize: f.size,
    compressedSize: 0,
    hash: uint8ArrayToHex(computeHash(f.data)),
    type: f.type,
    lastModified: f.lastModified,
  }));

  const header: PkiHeader = {
    version: 1,
    flags,
    createdAt: Date.now(),
    files: fileInfos,
    compression: {
      method: compressResult.method,
      oid: compressResult.algorithmOID,
      entries: compressResult.fileCount,
      originalSize: compressResult.originalSize,
    },
  };

  let pqcKemDone = false;
  let pqcDsaDone = false;

  // 3. 암호화
  //    Classic:  ECDH → CEK 래핑 → AES-GCM
  //    Hybrid:   ECDH → CEK 래핑 + ML-KEM → 동일 CEK 캡슐화
  //    PQC Only: ML-KEM → CEK 캡슐화 → AES-GCM (ECDH 미사용)
  const pqcMode = pqc?.mode || 'hybrid';
  let encryptedPkg: EncryptedPackage | null = null;

  if (encrypt && encrypt.recipients.length > 0) {
    if (pqcMode === 'pqc-only' && pqc?.shield) {
      // === PQC Only: ML-KEM만으로 암호화 ===
      const cekRaw = crypto.getRandomValues(new Uint8Array(32));
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const aesKey = await crypto.subtle.importKey('raw', cekRaw as unknown as BufferSource, { name: 'AES-GCM' }, false, ['encrypt']);
      const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv as unknown as BufferSource, tagLength: 128 }, aesKey, payload as unknown as BufferSource,
      );

      const kemResult = await pqc.shield.encapsulateCEK(cekRaw);
      header.pqcKemRecipientInfo = {
        type: kemResult.type,
        pqcKeyId: kemResult.rid.pqcKeyId,
        kemCiphertext: arrayBufferToBase64(kemResult.kemCiphertext),
        encryptedKey: arrayBufferToBase64(kemResult.encryptedKey),
        iv: arrayBufferToBase64(kemResult.iv),
        salt: arrayBufferToBase64(kemResult.salt),
        kemPublicKey: arrayBufferToBase64(kemResult.kemPublicKey),
      };
      pqcKemDone = true;

      payload = new Uint8Array(ciphertext);
      flags = setFlag(flags, FLAG_ENCRYPTED);
      // ECDH recipients는 빈 배열 (PQC Only)
      header.encryption = {
        algorithm: 'AES-256-GCM',
        iv: arrayBufferToBase64(iv),
        recipients: [],
      };
      console.log('[PKIZIP] PQC Only: ML-KEM-1024 암호화 완료 (ECDH 미사용)');
    } else {
      // === Classic 또는 Hybrid: ECDH로 암호화 ===
      encryptedPkg = await encryptForRecipients(payload, encrypt.recipients);

      // Hybrid: 동일 CEK를 ML-KEM으로도 캡슐화
      if (pqc?.shield && pqcMode === 'hybrid') {
        try {
          if (!encryptedPkg.rawCEK) throw new Error('CEK를 추출할 수 없습니다');
          const kemResult = await pqc.shield.encapsulateCEK(encryptedPkg.rawCEK);
          header.pqcKemRecipientInfo = {
            type: kemResult.type,
            pqcKeyId: kemResult.rid.pqcKeyId,
            kemCiphertext: arrayBufferToBase64(kemResult.kemCiphertext),
            encryptedKey: arrayBufferToBase64(kemResult.encryptedKey),
            iv: arrayBufferToBase64(kemResult.iv),
            salt: arrayBufferToBase64(kemResult.salt),
            kemPublicKey: arrayBufferToBase64(kemResult.kemPublicKey),
          };
          pqcKemDone = true;
          console.log('[PKIZIP] Hybrid: ECDH + ML-KEM-1024 CEK 래핑 완료');
        } catch (err) {
          throw new Error(`ML-KEM-1024 암호화 실패: ${err instanceof Error ? err.message : err}`);
        }
      }

      payload = new Uint8Array(encryptedPkg.ciphertext);
      flags = setFlag(flags, FLAG_ENCRYPTED);
      header.encryption = {
        algorithm: 'AES-256-GCM',
        iv: arrayBufferToBase64(encryptedPkg.iv),
        recipients: serializeRecipients(encryptedPkg.recipients),
      };
    }
  }

  // 4. 서명
  //    Classic:  ECDSA P-256만
  //    Hybrid:   ECDSA P-256 + ML-DSA-87 둘 다
  //    PQC Only: ML-DSA-87만 (ECDSA 미사용)
  const signerInfos: SignerInfo[] = [];
  if (sign) {
    if (pqcMode !== 'pqc-only') {
      // Classic 또는 Hybrid: ECDSA 서명
      const signerInfo = await signData(
        payload, sign.privateKey, sign.publicKey, sign.fingerprint, sign.label
      );
      signerInfos.push(signerInfo);
      header.signatures = serializeSignerInfos(signerInfos);
    }
    flags = setFlag(flags, FLAG_SIGNED);
    header.creatorFingerprint = sign.fingerprint;

    // Hybrid 또는 PQC Only: ML-DSA-87 서명
    if (pqc?.signer && pqcMode !== 'classic') {
      try {
        const pqcSig = await pqc.signer.sign(payload);
        header.pqcSignerInfo = {
          algorithm: pqcSig.algorithm,
          signature: arrayBufferToBase64(pqcSig.signature),
          dsaPublicKey: arrayBufferToBase64(pqcSig.dsaPublicKey),
          signedAt: pqcSig.signedAt,
        };
        pqcDsaDone = true;
        console.log('[PKIZIP] ML-DSA-87 서명 완료');
      } catch (err) {
        throw new Error(`ML-DSA-87 서명 실패: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  // PQC 헤더
  if (pqcKemDone || pqcDsaDone) {
    header.pqcHeader = {
      pqcProtected: true,
      mode: pqc?.mode || 'hybrid',
      kemAlgorithm: pqcKemDone ? 'ML-KEM-1024' : undefined,
      dsaAlgorithm: pqcDsaDone ? 'ML-DSA-87' : undefined,
      kemKeyId: pqc?.shield?.pqcKeyId,
    };
  }

  // 5. 타임스탬프 (TSA — 서명이 있을 때만)
  let tsResult: TimestampResult | undefined;
  if (hasFlag(flags, FLAG_SIGNED) && payload.length > 0) {
    try {
      tsResult = await getTimestampToken(payload);
      if (tsResult.method === 'tst' && tsResult.timestampToken) {
        // TST를 헤더에 저장 (unsignedAttrs 대용)
        header.timestamp = {
          method: 'tst',
          tsaName: tsResult.tsaName,
          token: arrayBufferToBase64(tsResult.timestampToken),
        };
        console.log(`[PKIZIP] TSA 타임스탬프: ${tsResult.tsaName}`);
      } else if (tsResult.method === 'signingTime') {
        header.timestamp = {
          method: 'signingTime',
          signingTime: (tsResult.signingTime ?? new Date()).toISOString(),
        };
        console.log('[PKIZIP] TSA 폴백: signingTime');
      }
    } catch (err) {
      console.warn('[PKIZIP] TSA 실패:', err);
    }
  }

  header.flags = flags;

  // 6. 컨테이너 패킹
  const container: PkiContainer = { header, payload };
  const pkiData = writePkiContainer(container);

  const avgRatio = compressResult.compressedSize / compressResult.originalSize;
  header.files.forEach(f => {
    f.compressedSize = Math.round(f.originalSize * avgRatio);
  });

  return {
    pkiData,
    header,
    stats: {
      originalSize,
      compressedSize: pkiData.length,
      fileCount: files.length,
      isEncrypted: hasFlag(flags, FLAG_ENCRYPTED),
      isSigned: hasFlag(flags, FLAG_SIGNED),
      signatureCount: signerInfos.length,
      recipientCount: encrypt?.recipients.length ?? 0,
      pqcKem: pqcKemDone,
      pqcDsa: pqcDsaDone,
      timestamp: tsResult,
    },
  };
}

/**
 * 열기 (Open) — 복호화(ECDH + ML-KEM) + 검증(ECDSA + ML-DSA)
 */
export async function open(
  pkiData: Uint8Array,
  decryptionKey?: CryptoKey,
  myFingerprint?: string,
  pqc?: {
    shield?: { decapsulateCEK: (ri: any) => Promise<Uint8Array>; isMyRecipientInfo: (ri: any) => boolean };
    signer?: { verify: (data: Uint8Array, pqcSig: any) => Promise<{ valid: boolean; algorithm: string; signedAt: string }> };
  }
): Promise<OpenResult> {
  if (!isPkiFile(pkiData)) {
    throw new Error('유효한 .pki 파일이 아닙니다.');
  }

  const container = readPkiContainer(pkiData);
  const { header } = container;
  let { payload } = container;
  // TSA는 seal 시점의 (암호화/서명 직전이 아닌, 컨테이너 저장 직전) payload에 대해 발급되므로
  // 복호화·압축해제로 payload가 변형되기 전 원본을 보관한다.
  const onDiskPayload = new Uint8Array(payload);

  const isEncrypted = hasFlag(header.flags, FLAG_ENCRYPTED);
  const isSigned = hasFlag(header.flags, FLAG_SIGNED);

  // 1. Classic 서명 검증 (ECDSA)
  let verification: VerificationResult[] = [];
  if (isSigned && header.signatures) {
    const signerInfos = deserializeSignerInfos(header.signatures);
    const signedPackage: SignedPackage = {
      contentHash: computeHash(payload),
      signerInfos,
      digestAlgorithm: 'SHA-256',
    };
    verification = await verifyAllSignatures(payload, signedPackage);
  }

  // 2. ML-DSA 서명 검증
  let pqcVerification: OpenResult['pqcVerification'];
  if (header.pqcSignerInfo && pqc?.signer) {
    try {
      const pqcSig = {
        signature: new Uint8Array(base64ToArrayBuffer(header.pqcSignerInfo.signature)),
        dsaPublicKey: new Uint8Array(base64ToArrayBuffer(header.pqcSignerInfo.dsaPublicKey)),
        signedAt: header.pqcSignerInfo.signedAt,
      };
      pqcVerification = await pqc.signer.verify(payload, pqcSig);
      console.log('[PKIZIP] ML-DSA 검증:', pqcVerification.valid ? '✓ 유효' : '✗ 무효');
    } catch (err) {
      console.error('[PKIZIP] ML-DSA 검증 실패:', err);
      pqcVerification = { valid: false, algorithm: 'ML-DSA-87', signedAt: header.pqcSignerInfo.signedAt };
    }
  }

  // 3. 복호화
  if (isEncrypted && header.encryption) {
    const hasEcdhKey = !!decryptionKey && !!myFingerprint;
    const hasPqcShield = !!pqc?.shield && !!header.pqcKemRecipientInfo;

    // ECDH 키도 PQC shield도 없으면 복호화 불가
    if (!hasEcdhKey && !hasPqcShield) {
      return {
        files: header.files.map(f => ({
          name: f.name, data: new Uint8Array(0), size: f.originalSize,
          lastModified: f.lastModified, type: f.type,
        })),
        header, verification, pqcVerification, isEncrypted: true, isSigned,
      };
    }

    const payloadCopy = new ArrayBuffer(payload.byteLength);
    new Uint8Array(payloadCopy).set(payload);
    const iv = new Uint8Array(base64ToArrayBuffer(header.encryption.iv));

    let decrypted = false;

    // 경로 1: ECDH classic 복호화 (키가 있고 수신자가 있을 때만)
    if (!decrypted && hasEcdhKey && header.encryption.recipients.length > 0) {
      try {
        const encryptedPkg: EncryptedPackage = {
          ciphertext: payloadCopy,
          iv,
          tag: new Uint8Array(0),
          recipients: deserializeRecipients(header.encryption.recipients),
          algorithm: 'AES-256-GCM',
        };
        const result = await decryptAsRecipient(encryptedPkg, decryptionKey!, myFingerprint!);
        payload = result.plaintext;
        decrypted = true;
        console.log('[PKIZIP] ECDH 복호화 성공');
      } catch {
        console.log('[PKIZIP] ECDH 복호화 실패 — ML-KEM 경로 시도');
      }
    }

    // 경로 2: ML-KEM 복호화 (ECDH 실패 시 또는 PQC Only)
    if (!decrypted && header.pqcKemRecipientInfo && pqc?.shield) {
      try {
        const ri = {
          kemCiphertext: new Uint8Array(base64ToArrayBuffer(header.pqcKemRecipientInfo.kemCiphertext)),
          encryptedKey: new Uint8Array(base64ToArrayBuffer(header.pqcKemRecipientInfo.encryptedKey)),
          iv: new Uint8Array(base64ToArrayBuffer(header.pqcKemRecipientInfo.iv)),
          salt: new Uint8Array(base64ToArrayBuffer(header.pqcKemRecipientInfo.salt)),
        };
        const pqcCek = await pqc.shield.decapsulateCEK(ri);
        // CEK로 직접 AES-GCM 복호화
        const aesKey = await crypto.subtle.importKey('raw', pqcCek as unknown as BufferSource, { name: 'AES-GCM' }, false, ['decrypt']);
        const plainBuf = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: iv as unknown as BufferSource, tagLength: 128 },
          aesKey,
          payloadCopy,
        );
        payload = new Uint8Array(plainBuf);
        decrypted = true;
        console.log('[PKIZIP] ML-KEM 복호화 성공');
      } catch (err) {
        console.warn('[PKIZIP] ML-KEM 복호화 실패:', err);
      }
    }

    // Hybrid: ECDH로 이미 성공했어도 ML-KEM 역캡슐화 검증
    if (decrypted && header.pqcKemRecipientInfo && pqc?.shield) {
      try {
        const ri = {
          kemCiphertext: new Uint8Array(base64ToArrayBuffer(header.pqcKemRecipientInfo.kemCiphertext)),
          encryptedKey: new Uint8Array(base64ToArrayBuffer(header.pqcKemRecipientInfo.encryptedKey)),
          iv: new Uint8Array(base64ToArrayBuffer(header.pqcKemRecipientInfo.iv)),
          salt: new Uint8Array(base64ToArrayBuffer(header.pqcKemRecipientInfo.salt)),
        };
        await pqc.shield.decapsulateCEK(ri);
        console.log('[PKIZIP] ML-KEM CEK 검증 성공');
      } catch {
        console.warn('[PKIZIP] ML-KEM CEK 검증 실패 (ECDH로 복호화됨)');
      }
    }

    if (!decrypted) {
      throw new Error('복호화 실패 — ECDH/ML-KEM 모두 실패');
    }
  }

  // 4. 압축 해제
  const fallbackName = header.files[0]?.name ?? 'file';
  const decompressed = decompress(payload, fallbackName);
  let files = toFileEntries(decompressed.files);

  if (decompressed.method === 'zlib' && files.length === 1 && header.files.length >= 1) {
    const meta = header.files[0];
    files[0].name = meta.name;
    files[0].type = meta.type || files[0].type;
    files[0].lastModified = meta.lastModified || files[0].lastModified;
  }
  if (files.length > 1 && header.files.length === files.length) {
    files = files.map((f, i) => ({
      ...f,
      name: header.files[i]?.name ?? f.name,
      type: header.files[i]?.type ?? f.type,
      lastModified: header.files[i]?.lastModified ?? f.lastModified,
    }));
  }

  // TST 검증 (헤더에 타임스탬프가 있을 때)
  let timestampVerification: TstVerifyResult | undefined;
  if (header.timestamp?.method === 'tst' && header.timestamp.token) {
    try {
      const tstDer = new Uint8Array(
        atob(header.timestamp.token).split('').map(c => c.charCodeAt(0))
      );
      // seal()은 암호화 후 payload로 TST 발급 → 검증도 같은 raw payload여야 함
      timestampVerification = await verifyTimestampToken(tstDer, onDiskPayload);
      console.log('[PKIZIP] TST 검증:', timestampVerification.valid ? '유효' : '무효');
    } catch (err) {
      console.warn('[PKIZIP] TST 검증 실패:', err);
      timestampVerification = {
        valid: false, method: 'tst', errors: [{ step: 'tst_parse', message: String(err), fatal: true }], warnings: [],
      };
    }
  } else if (header.timestamp?.method === 'signingTime') {
    timestampVerification = {
      valid: true,
      genTime: header.timestamp.signingTime ? new Date(header.timestamp.signingTime) : undefined,
      method: 'signingTime',
      errors: [],
      warnings: ['TST 없음. signingTime은 서명자 주장 시각으로 신뢰도가 낮습니다.'],
    };
  }

  return { files, header, verification, pqcVerification, timestampVerification, isEncrypted, isSigned };
}

/**
 * .pki 파일에 서명 추가 (다중 서명)
 */
export async function addSignatureToContainer(
  pkiData: Uint8Array, privateKey: CryptoKey, publicKey: CryptoKey,
  fingerprint: string, label?: string
): Promise<Uint8Array> {
  const container = readPkiContainer(pkiData);
  const { header, payload } = container;

  const signerInfo = await signData(payload, privateKey, publicKey, fingerprint, label);

  const existingSignatures = header.signatures ?? [];
  if (existingSignatures.some(s => s.fingerprint === fingerprint)) {
    throw new Error('이미 이 키로 서명되어 있습니다.');
  }

  header.signatures = [...existingSignatures, ...(serializeSignerInfos([signerInfo]) ?? [])];
  header.flags = setFlag(header.flags, FLAG_SIGNED);

  return writePkiContainer({ header, payload });
}

export function peekHeader(pkiData: Uint8Array): PkiHeader {
  if (!isPkiFile(pkiData)) throw new Error('유효한 .pki 파일이 아닙니다.');
  return readPkiContainer(pkiData).header;
}

export async function compressOnly(files: FileEntry[]): Promise<SealResult> {
  return seal({ files, compress: true });
}

function uint8ArrayToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

