/**
 * CMS 빌드 파이프라인 — runProcessing 의 4분기 + PDF 변환 + PQC 로드를
 * 순수 비즈니스 로직으로 분리.
 *
 * CreatePage 는 state orchestration 만 담당하고, 실제 봉투 조립은 여기서.
 * 각 build 함수는 정상 결과를 반환하거나 throw BuildError 로 실패 신호.
 * UI 는 error.recoveryStep 을 보고 적절한 step 으로 되돌린다.
 */
import { serializeEntries } from '../compression/compressor';
import { seal, compressOnly } from '../container/pki-operations';
import { signData } from '../crypto/signing';
import {
  writePkiContainer, arrayBufferToBase64,
  FLAG_COMPRESSED, FLAG_ENCRYPTED, setFlag, serializeSignerInfos,
  type PkiHeader,
} from '../container/pki-format';
import { packInnerPayload } from '../container/inner-payload';
import { encryptWithPassword } from '../crypto/encryption';
import { findingsToDpvCategories } from '../policy/standards/dpv-data-category';
import { deriveDpvMeasures } from '../policy/standards/dpv-applied-measure';
import { convertConvertibleFilesToPdf, type PdfConversionReport, type PdfWatermarkMeta } from '../analysis/text-to-pdf';
import { useAppStore } from '../store/app-store';
import { decisionToSealMeta } from './seal-meta';
import { deriveCmsState, type CmsOptions } from './options';
import type { FileEntry } from '../compression/compressor';
import type { KeyIdentity } from '../crypto/hd-key';
import type { PublicKeyEntry } from '../crypto/key-manager';
import type { AnalysisDecision } from '@/components/dialogs/AnalysisDialog';

export type CryptoMode = 'classic' | 'hybrid' | 'pqc-only';

export interface BuildContext {
  options: CmsOptions;
  files: FileEntry[];
  cryptoMode: CryptoMode;
  password: string;
  recipients: Set<string>;
  recipientEntries: PublicKeyEntry[];
  analysisDecision: AnalysisDecision | null;
  pdfConvertEnabled: boolean;
  keyIdentity: KeyIdentity | null;
}

export interface BuildResult {
  pkiData: Uint8Array;
  finalName: string;
  info: string;
  algos: string[];
  /** PDF 변환 적용된 파일 — 변환이 일어났으면 CreatePage 가 setFiles 해야 함 */
  workingFiles: FileEntry[];
  pdfReports: PdfConversionReport[];
  pdfSkipped: { filename: string; reason: string }[];
}

/** 빌드 실패 — UI 가 어느 step 으로 되돌릴지 결정 */
export class BuildError extends Error {
  constructor(message: string, public recoveryStep: 'options' | 'details') {
    super(message);
    this.name = 'BuildError';
  }
}

function loadPqcForSeal(cryptoMode: CryptoMode): { shield?: any; signer?: any; mode: string } | undefined {
  if (cryptoMode === 'classic') return undefined;
  const { pqcShield, pqcSigner } = useAppStore.getState();
  if (!pqcShield && !pqcSigner) {
    throw new Error('PQC 키가 로드되지 않았습니다.\n키를 잠금 해제한 후 다시 시도하세요.');
  }
  return { shield: pqcShield ?? undefined, signer: pqcSigner ?? undefined, mode: cryptoMode };
}

/**
 * PDF 변환 + DPV 워터마크. 텍스트 기반 파일만 변환, 그 외는 원본 유지.
 */
async function applyPdfConversion(ctx: BuildContext): Promise<{
  files: FileEntry[];
  reports: PdfConversionReport[];
  skipped: { filename: string; reason: string }[];
}> {
  if (!ctx.pdfConvertEnabled || !ctx.analysisDecision) {
    return { files: ctx.files, reports: [], skipped: [] };
  }
  const cmsState = deriveCmsState(ctx.options);
  const c = ctx.analysisDecision.result.classification;
  const findingsSummary: Record<string, number> = {};
  for (const f of ctx.analysisDecision.originalFindings) {
    findingsSummary[f.entityType] = (findingsSummary[f.entityType] || 0) + 1;
  }
  const a = ctx.analysisDecision.result.anonymization;
  const watermarkMeta: PdfWatermarkMeta = {
    grade: c.grade,
    dataCategories: findingsToDpvCategories(findingsSummary),
    appliedMeasures: deriveDpvMeasures({
      encrypted: cmsState.willEncrypt,
      pqcProtected: ctx.cryptoMode !== 'classic' && cmsState.willSign,
      signed: cmsState.willSign,
      timestamped: false,
      pseudonymization: a && ctx.analysisDecision.anonymizationAction !== 'skip'
        ? { applied: true, isReversible: a.result.isReversible }
        : undefined,
    }),
    purpose: ctx.analysisDecision.intent.purpose,
    classifierVersion: c.version,
  };
  const r = await convertConvertibleFilesToPdf(ctx.files, watermarkMeta);
  return { files: r.files, reports: r.reports, skipped: r.skipped };
}

async function buildEncrypted(workingFiles: FileEntry[], ctx: BuildContext) {
  const algos: string[] = [];
  const compressed = serializeEntries(workingFiles);
  const fileInfos = workingFiles.map(f => ({
    name: f.name, originalSize: f.size, compressedSize: 0, hash: '', type: f.type, lastModified: f.lastModified,
  }));

  let innerData: Uint8Array;
  let info: string;
  if (ctx.options.sign && ctx.keyIdentity) {
    const signerInfo = await signData(
      compressed,
      ctx.keyIdentity.signingKey.privateKey,
      ctx.keyIdentity.signingKey.publicKey,
      ctx.keyIdentity.signingKey.fingerprint,
    );
    const sigs = serializeSignerInfos([signerInfo]);
    innerData = packInnerPayload(compressed, sigs ?? undefined);
    info = 'EncryptedMessage (서명 포함)';
    algos.push('AES-256-GCM (비밀번호)', 'ECDSA P-256 (서명)');
  } else {
    innerData = packInnerPayload(compressed);
    info = 'EncryptedMessage';
    algos.push('AES-256-GCM (비밀번호)');
  }

  const flags = setFlag(setFlag(0, FLAG_COMPRESSED), FLAG_ENCRYPTED);
  const { ciphertext, iv, salt } = await encryptWithPassword(innerData, ctx.password);
  const header: PkiHeader = {
    version: 1, flags, createdAt: Date.now(), files: fileInfos,
    encryption: {
      algorithm: 'AES-256-GCM',
      iv: arrayBufferToBase64(iv),
      recipients: [{
        fingerprint: 'password',
        wrappedKey: arrayBufferToBase64(salt),
        ephemeralPublicKey: '',
        label: '비밀번호 암호화',
      }],
    },
  };
  const pkiData = writePkiContainer({ header, payload: new Uint8Array(ciphertext) });
  return { pkiData, suffix: 'encrypted', info, algos };
}

async function buildEnveloped(workingFiles: FileEntry[], ctx: BuildContext) {
  const currentKey = useAppStore.getState().keyIdentity;
  if (!currentKey) throw new BuildError('키가 활성화되지 않았습니다.', 'options');

  const { importPublicKeyFromJWK, exportPublicKeyJWK } = await import('@/lib/crypto/hd-key');
  const { addToKeyRing } = await import('@/lib/crypto/key-manager');
  const recipientInfos: import('@/lib/crypto/encryption').RecipientInfo[] = [];
  const skipped: string[] = [];

  for (const e of ctx.recipientEntries) {
    if (!ctx.recipients.has(e.fingerprint)) continue;
    let jwk = e.encryptionKeyJWK as JsonWebKey;
    if ((!jwk || !jwk.kty) && e.fingerprint === currentKey.signingKey.fingerprint) {
      jwk = await exportPublicKeyJWK(currentKey.encryptionKey.publicKey);
      await addToKeyRing({
        ...e,
        encryptionKeyJWK: jwk,
        signingKeyJWK: await exportPublicKeyJWK(currentKey.signingKey.publicKey),
        type: 'local',
      });
      console.log('[PKIZIP] 로컬 keyring 엔트리 복구:', e.fingerprint);
    }
    if (!jwk || !jwk.kty) {
      skipped.push(e.label || e.fingerprint);
      continue;
    }
    const pubKey = await importPublicKeyFromJWK(jwk, 'encrypt');
    recipientInfos.push({ fingerprint: e.fingerprint, encryptionPublicKey: pubKey, label: e.label });
  }

  if (recipientInfos.length === 0) {
    throw new BuildError('유효한 수신자가 없습니다 (암호화 공개키 필요)', 'details');
  }

  const pqcOpts = loadPqcForSeal(ctx.cryptoMode);
  const analysisMeta = ctx.analysisDecision
    ? decisionToSealMeta(ctx.analysisDecision, currentKey.signingKey.fingerprint)
    : undefined;
  const result = await seal({
    files: workingFiles, compress: true,
    encrypt: { recipients: recipientInfos },
    sign: {
      privateKey: currentKey.signingKey.privateKey,
      publicKey: currentKey.signingKey.publicKey,
      fingerprint: currentKey.signingKey.fingerprint,
    },
    pqc: pqcOpts,
    analysisMeta,
  });

  const algos: string[] = [];
  if (ctx.cryptoMode !== 'pqc-only') algos.push('ECDH P-256 (암호화)', 'AES-256-GCM', 'ECDSA P-256 (서명)');
  if (result.stats.pqcKem) algos.push('ML-KEM-1024 (양자 암호화)');
  if (result.stats.pqcDsa) algos.push('ML-DSA-87 (양자 서명)');
  if (result.stats.timestamp?.method === 'tst') algos.push(`TSA (${result.stats.timestamp.tsaName})`);
  else if (result.stats.timestamp?.method === 'signingTime') algos.push('signingTime (로컬)');

  return {
    pkiData: result.pkiData,
    suffix: 'enveloped',
    info: `EnvelopedMessage (${recipientInfos.length}명 수신자)`,
    algos,
    skippedRecipients: skipped,
  };
}

async function buildSigned(workingFiles: FileEntry[], ctx: BuildContext) {
  const currentKey = useAppStore.getState().keyIdentity;
  if (!currentKey) throw new BuildError('키가 활성화되지 않았습니다.', 'options');

  const pqcOpts = loadPqcForSeal(ctx.cryptoMode);
  const analysisMeta = ctx.analysisDecision
    ? decisionToSealMeta(ctx.analysisDecision, currentKey.signingKey.fingerprint)
    : undefined;
  const result = await seal({
    files: workingFiles, compress: true,
    sign: {
      privateKey: currentKey.signingKey.privateKey,
      publicKey: currentKey.signingKey.publicKey,
      fingerprint: currentKey.signingKey.fingerprint,
    },
    pqc: pqcOpts,
    analysisMeta,
  });

  const algos: string[] = [];
  if (ctx.cryptoMode !== 'pqc-only') algos.push('ECDSA P-256 (서명)');
  if (result.stats.pqcDsa) algos.push('ML-DSA-87 (양자 서명)');
  if (result.stats.timestamp?.method === 'tst') algos.push(`TSA (${result.stats.timestamp.tsaName})`);
  else if (result.stats.timestamp?.method === 'signingTime') algos.push('signingTime (로컬)');

  return {
    pkiData: result.pkiData,
    suffix: 'signed',
    info: `SignedMessage (0x${currentKey.signingKey.fingerprint})`,
    algos,
  };
}

async function buildCompressed(workingFiles: FileEntry[]) {
  const result = await compressOnly(workingFiles);
  return {
    pkiData: result.pkiData,
    suffix: 'compressed',
    info: 'CompressedMessage',
    algos: ['ZLIB/ZIP (압축)'],
  };
}

/**
 * 메인 엔트리 — CmsOptions 에 따라 적절한 빌더 디스패치.
 *
 * 호출 측은 try/catch 로 BuildError 를 받아 recoveryStep 으로 setStep,
 * 그 외 Error 는 toast 로 표시.
 */
export async function buildCms(ctx: BuildContext): Promise<BuildResult & { skippedRecipients?: string[] }> {
  const pdfResult = await applyPdfConversion(ctx);
  const workingFiles = pdfResult.files;

  let built: { pkiData: Uint8Array; suffix: string; info: string; algos: string[]; skippedRecipients?: string[] };
  if (ctx.options.encrypted) {
    built = await buildEncrypted(workingFiles, ctx);
  } else if (ctx.options.enveloped) {
    built = await buildEnveloped(workingFiles, ctx);
  } else if (ctx.options.sign) {
    built = await buildSigned(workingFiles, ctx);
  } else {
    built = await buildCompressed(workingFiles);
  }

  const baseName = ctx.files.length === 1
    ? ctx.files[0].name.replace(/\.[^.]+$/, '')
    : 'archive';
  const finalName = `${baseName}.${built.suffix}.pki`;

  return {
    pkiData: built.pkiData,
    finalName,
    info: built.info,
    algos: built.algos,
    workingFiles,
    pdfReports: pdfResult.reports,
    pdfSkipped: pdfResult.skipped,
    skippedRecipients: built.skippedRecipients,
  };
}
