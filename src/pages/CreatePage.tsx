import { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FilePlus, X, ChevronRight, Check, Loader2, Download, Shield, PenTool, Lock, Package } from 'lucide-react';
// PqcBadge removed — crypto mode shown inline
import { toast } from 'sonner';
import { useAppStore } from '@/lib/store/app-store';
import { serializeEntries } from '@/lib/compression/compressor';
import { seal, compressOnly } from '@/lib/container/pki-operations';
import { encryptWithPassword } from '@/lib/crypto/encryption';
import { writePkiContainer, arrayBufferToBase64, FLAG_COMPRESSED, FLAG_ENCRYPTED, setFlag, type PkiHeader } from '@/lib/container/pki-format';
import { packInnerPayload } from '@/lib/container/inner-payload';
import { signData } from '@/lib/crypto/signing';
import { serializeSignerInfos } from '@/lib/container/pki-format';
import type { FileEntry } from '@/lib/compression/compressor';
import { SigningConsentDialog } from '@/components/dialogs/SigningConsentDialog';
import { AnalysisDialog, type AnalysisDecision } from '@/components/dialogs/AnalysisDialog';
import { analyze as analyzePipeline, analyzeAsync as analyzePipelineAsync } from '@/lib/analysis/pipeline';
import { extractAll } from '@/lib/analysis/text-extractor';
import { anonymizeAllFiles, type FileAnonymizationReport, type PerFileExtract } from '@/lib/analysis/anonymize-files';
import { createMipLabel } from '@/lib/mip/mip-label';
import type { AnalysisResult } from '@/lib/analysis/types';

type Step = 'files' | 'analyze' | 'options' | 'details' | 'processing' | 'done';

interface CmsOptions {
  compress: boolean;
  sign: boolean;
  enveloped: boolean;
  encrypted: boolean;
}

const STEPS = [
  { key: 'files', label: '파일 선택' },
  { key: 'analyze', label: '분석' },
  { key: 'options', label: '옵션' },
  { key: 'details', label: '상세' },
  { key: 'processing', label: '처리' },
] as const;

/** AnalysisDecision → SealOptions.analysisMeta 매핑 */
function decisionToSealMeta(d: AnalysisDecision, fingerprint?: string) {
  const c = d.result.classification;
  const meta: NonNullable<Parameters<typeof seal>[0]['analysisMeta']> = {
    classification: {
      grade: c.grade,
      score: c.score,
      confidence: c.confidence,
      classifierVersion: c.version,
      explanation: d.result.explanation?.summary,
      // 원본 PII findings 사용 — 가명화 적용 후에도 "어떤 PII 가 있었는지" 정보가 봉투 메타에 남도록.
      // d.result.findings 는 가명화 후 텍스트의 finding 이라 비어있을 수 있음.
      findingsSummary: Object.fromEntries(
        d.originalFindings.reduce((m, f) => m.set(f.entityType, (m.get(f.entityType) || 0) + 1), new Map<string, number>())
      ),
    },
    mipLabel: createMipLabel({ grade: c.grade, appliedBy: fingerprint }),
    language: {
      detected: d.result.language.detected,
      confidence: d.result.language.confidence,
      multilingual: d.result.language.multilingual,
      detectorVersion: d.result.language.detectorVersion,
    },
    intent: {
      purpose: d.intent.purpose,
      cryptoKind: d.intent.cryptoKind,
      requestedBy: fingerprint,
    },
  };
  if (d.result.ocr?.applied) {
    meta.ocr = {
      applied: true,
      engine: d.result.ocr.engine,
      languages: d.result.ocr.languages,
      confidence: d.result.ocr.confidence,
      pages: d.result.ocr.pages,
    };
  }
  if (d.result.anonymization && d.anonymizationAction !== 'skip') {
    const a = d.result.anonymization;
    meta.pseudonymization = {
      applied: true,
      isReversible: a.result.isReversible,
      policyVersion: a.result.policyVersion,
      methodBreakdown: Object.fromEntries(
        a.result.replacements.reduce((m, r) => m.set(r.method, (m.get(r.method) || 0) + 1), new Map<string, number>())
      ),
      finalGrade: a.finalGrade,
      iterations: a.iterations.length - 1,
      mappingTable: {
        included: false,   // 매핑 봉인은 차후 — 현재는 헤더에 포함 안 함
        sealedAlgorithm: d.intent.cryptoKind === 'classic' ? 'classic'
                       : d.intent.cryptoKind === 'pqc-only' ? 'pqc-only' : 'hybrid',
      },
    };
  }
  return meta;
}

export function CreatePage() {
  const { keyIdentity, isKeyLoaded, identities, activeIdentityId, setIdentities, setActiveIdentityId } = useAppStore();
  // IndexedDB에서 아이덴티티 로드
  useEffect(() => {
    (async () => {
      const { getAllIdentityMetas, getActiveIdentityId, getDefaultIdentityId } = await import('@/lib/crypto/key-manager');
      const metas = await getAllIdentityMetas();
      setIdentities(metas.map(m => ({
        id: m.id, name: m.name, commonName: m.commonName, email: m.email,
        signingFingerprint: m.signingFingerprint, encryptionFingerprint: m.encryptionFingerprint,
        createdAt: m.createdAt,
        category: m.category, isDefault: m.isDefault,
      })));
      const activeId = await getActiveIdentityId();
      // 활성 ID 가 없으면 기본 인증서로 자동 선택
      setActiveIdentityId(activeId ?? await getDefaultIdentityId());
    })();
  }, [setIdentities, setActiveIdentityId]);

  const hasAnyIdentity = identities.length > 0;

  const [step, setStep] = useState<Step>('files');
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [options, setOptions] = useState<CmsOptions>({ compress: true, sign: false, enveloped: false, encrypted: false });
  const [cryptoMode, setCryptoMode] = useState<'hybrid' | 'pqc-only' | 'classic'>(() => {
    const { pqcConfig: cfg } = useAppStore.getState();
    if (!cfg.kemEnabled && !cfg.dsaEnabled) return 'classic';
    const mode = cfg.kemMode || cfg.dsaMode || 'hybrid';
    if (mode === 'pqc-only') return 'pqc-only';
    if (mode === 'classical') return 'classic';
    return 'hybrid';
  });
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [recipients, setRecipients] = useState<Set<string>>(new Set());
  const [recipientEntries, setRecipientEntries] = useState<import('@/lib/crypto/key-manager').PublicKeyEntry[]>([]);

  // v2 — AI 분석 결과 + 사용자 결정
  const [analysisInitial, setAnalysisInitial] = useState<AnalysisResult | null>(null);
  /** 텍스트 추출 결과 (가/익명화 적용 시 sidecar 모드에서 재사용) */
  const [perFileExtract, setPerFileExtract] = useState<PerFileExtract[]>([]);
  /** 가/익명화 적용 보고 — 사용자에게 안내 */
  const [anonReports, setAnonReports] = useState<FileAnonymizationReport[]>([]);
  const [analysisDecision, setAnalysisDecision] = useState<AnalysisDecision | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisSkipped, setAnalysisSkipped] = useState(false);
  const [selectedIdentityId, setSelectedIdentityId] = useState<string | null>(null);
  const [resultData, setResultData] = useState<Uint8Array | null>(null);
  const [resultName, setResultName] = useState('');
  const [resultInfo, setResultInfo] = useState('');
  const [resultAlgos, setResultAlgos] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const cmsType = options.encrypted ? 'Encrypted' : options.enveloped ? 'Enveloped' : options.sign ? 'Signed' : 'Compressed';

  const handleAddFiles = useCallback(async (fileList: FileList | File[]) => {
    const entries: FileEntry[] = await Promise.all(
      Array.from(fileList).map(async f => ({
        name: f.name,
        data: new Uint8Array(await f.arrayBuffer()),
        size: f.size,
        lastModified: f.lastModified,
        type: f.type || 'application/octet-stream',
      }))
    );
    // HWP 바이너리 사용자 안내 — 가명화가 직접 적용되지 않으므로 HWPX 변환 권장
    const hwpFiles = entries.filter(e => /\.hwp$/i.test(e.name));
    if (hwpFiles.length > 0) {
      toast(`HWP 바이너리 ${hwpFiles.length}개 — 가명화가 직접 적용 안 됨.\nHWPX 로 저장하시면 가명화가 더 정확히 적용됩니다.`,
        { icon: '⚠', duration: 7000 });
    }
    setFiles(prev => [...prev, ...entries]);
  }, []);

  // Explorer 등 다른 페이지에서 setPendingFile() 로 던진 파일을 마운트 시 자동 추가
  useEffect(() => {
    (async () => {
      const { takePendingFile } = await import('@/lib/store/pending-file');
      const f = takePendingFile();
      if (f) handleAddFiles([f]);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleOption = (key: keyof CmsOptions) => {
    setOptions(prev => {
      const next = { ...prev };
      if (key === 'enveloped') {
        next.enveloped = !prev.enveloped;
        if (next.enveloped) { next.encrypted = false; next.sign = true; }
      } else if (key === 'encrypted') {
        next.encrypted = !prev.encrypted;
        if (next.encrypted) { next.enveloped = false; }
      } else if (key === 'sign') {
        if (prev.enveloped) return prev;
        next.sign = !prev.sign;
      } else {
        next[key] = !prev[key];
      }
      return next;
    });
  };

  const [unlockPw, setUnlockPw] = useState('');
  const [needsUnlock, setNeedsUnlock] = useState(false);
  const [hasPinRegistered, setHasPinRegistered] = useState(false);

  // 서명 동의 게이트
  const [consentOpen, setConsentOpen] = useState(false);
  const [consentIntent, setConsentIntent] = useState('');
  const consentResolverRef = useRef<((ok: boolean) => void) | null>(null);

  const requestSigningConsent = (intent: string): Promise<boolean> => {
    setConsentIntent(intent);
    setConsentOpen(true);
    return new Promise(resolve => { consentResolverRef.current = resolve; });
  };

  // 키 잠금 해제 (생체 인증 → PIN → 비밀번호)
  const ensureKey = async (): Promise<boolean> => {
    if (isKeyLoaded && keyIdentity) return true;
    if (identities.length === 0) { toast.error('설정에서 키를 먼저 생성하세요.'); return false; }

    const { getActiveIdentityId: gai, setActiveIdentityId: sai } = await import('@/lib/crypto/key-manager');
    const { deriveKeyIdentity } = await import('@/lib/crypto/hd-key');
    const tid = selectedIdentityId || (await gai()) || identities[0].id;

    const applyIdentity = async (seed: Uint8Array) => {
      const identity = await deriveKeyIdentity(seed);
      useAppStore.getState().setKeyIdentity(identity);
      useAppStore.getState().setActiveIdentityId(tid);
      await sai(tid);
      setNeedsUnlock(false);
      setUnlockPw('');
    };

    // 1. 생체 인증 시도 (등록된 경우만)
    try {
      const { hasBiometric, unlockWithBiometric } = await import('@/lib/crypto/biometric');
      if (await hasBiometric(tid)) {
        const seed = await unlockWithBiometric(tid);
        await applyIdentity(seed);
        return true;
      }
    } catch {
      toast('생체 인증 취소 — 비밀번호로 진행합니다', { icon: '🔐' });
    }

    // PIN 등록 여부 확인
    const { hasPin, unlockWithPin } = await import('@/lib/crypto/pin');
    const pinExists = await hasPin(tid);
    setHasPinRegistered(pinExists);

    // 2. 입력값이 있으면 PIN(4~6자리 숫자)/비밀번호 판별하여 시도
    if (!unlockPw) { setNeedsUnlock(true); return false; }

    // PIN 포맷이면 PIN 우선 시도
    if (pinExists && /^\d{4,6}$/.test(unlockPw)) {
      try {
        const seed = await unlockWithPin(tid, unlockPw);
        await applyIdentity(seed);
        return true;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'PIN이 틀렸습니다.');
        return false;
      }
    }

    // 3. 비밀번호 fallback
    try {
      const { loadIdentitySeed } = await import('@/lib/crypto/key-manager');
      const seed = await loadIdentitySeed(tid, unlockPw);
      await applyIdentity(seed);

      // 비밀번호로 잠금 해제 성공 → PQC 인스턴스도 초기화
      try {
        const { PQCKeystore } = await import('@/lib/pqc/pqc-keystore.js');
        const { PQCBundle } = await import('@/lib/pqc/pqc-bundle.js');
        const { PQCShield } = await import('@/lib/pqc/pqc-shield.js');
        const { PQCSigner } = await import('@/lib/pqc/pqc-signer.js');
        const bundle = await PQCKeystore.load(unlockPw, 'default', { PQCBundleClass: PQCBundle });
        useAppStore.getState().setPqcInstances(
          PQCShield.fromBundle(bundle.getKEMKeyPair()),
          PQCSigner.fromBundle(bundle.getDSAKeyPair()),
        );
        console.log('[PKIZIP] CreatePage: PQC 인스턴스 초기화 완료');
      } catch (pqcErr) {
        console.warn('[PKIZIP] CreatePage: PQC 초기화 실패:', pqcErr);
        if (cryptoMode !== 'classic') {
          toast.error('PQC 키 로드 실패 — Classic 모드로 전환하거나 니모닉을 재생성하세요.');
        }
      }

      return true;
    } catch {
      toast.error('비밀번호가 틀렸습니다.');
      return false;
    }
  };

  /**
   * 분석 단계 진입 — 다중 포맷 텍스트 추출 + 파이프라인 실행.
   * 지원: txt, pdf, docx, xlsx, pptx, hwp, hwpx, 이미지(OCR).
   */
  const enterAnalyzeStep = async () => {
    setAnalyzing(true);
    setStep('analyze');   // analyzing 표시 위해 step 먼저 전환
    try {
      const extracted = await extractAll(files);
      const text = extracted.text;
      const warningCount = extracted.warnings.length;

      if (!text || text.trim().length < 5) {
        const reasons = extracted.perFile
          .filter(p => p.text.length === 0)
          .map(p => `${p.name} (${p.source})`)
          .join(', ');
        toast(`텍스트 추출 불가 — ${reasons || '바이너리'} · 분석 건너뜀`, { icon: '⏭' });
        if (warningCount > 0) console.warn('extraction warnings:', extracted.warnings);
        setAnalysisSkipped(true);
        setAnalysisInitial(null);
        setStep('options');
        return;
      }

      // 1) 즉시 룰 기반 분석 → 다이얼로그 빠르게 띄움
      const baseResult = analyzePipeline(text, {
        applyLanguageFloor: true,
        ocrApplied: extracted.ocrApplied,
        ocrEngine: extracted.ocrEngine,
        ocrLanguages: extracted.ocrLanguages,
        ocrConfidence: extracted.ocrConfidence,
      });
      // 2) 비동기로 NER 보강 (설정 활성 + 모델 로드된 경우만)
      const result = await analyzePipelineAsync(text, {
        applyLanguageFloor: true,
        ocrApplied: extracted.ocrApplied,
        ocrEngine: extracted.ocrEngine,
        ocrLanguages: extracted.ocrLanguages,
        ocrConfidence: extracted.ocrConfidence,
      }).catch(() => baseResult);
      setAnalysisInitial(result);
      setAnalysisSkipped(false);
      // 추출 결과 보존 — 가/익명화 sidecar 모드에서 재사용
      setPerFileExtract(extracted.perFile.map(p => ({
        filename: p.name, text: p.text, source: p.source, warnings: p.warnings,
      })));
      // 추출 경로 정보 안내
      const sources = Array.from(new Set(extracted.perFile.map(p => p.source))).join(', ');
      toast(`분석 준비 완료 — 추출 경로: ${sources}${extracted.ocrApplied ? ' (OCR 적용)' : ''}`, {
        icon: '🔍',
      });
    } catch (e) {
      console.error('analysis failed:', e);
      toast.error(`분석 실패 — ${(e as Error).message || '옵션 단계로 이동'}`);
      setAnalysisSkipped(true);
      setStep('options');
    } finally {
      setAnalyzing(false);
    }
  };

  /** 분석 다이얼로그 onAccept — 의도/등급에 따라 cryptoMode + options 자동 설정 */
  const handleAnalysisAccept = async (decision: AnalysisDecision) => {
    // [DPV-DEBUG] — 분석 결과가 어떻게 들어오는지 확인.
    console.log('[DPV-DEBUG] CreatePage.handleAnalysisAccept', {
      originalFindingsCount: decision.originalFindings.length,
      originalEntityTypes: [...new Set(decision.originalFindings.map(f => f.entityType))],
      anonymizationAction: decision.anonymizationAction,
      hasAnonymization: !!decision.result.anonymization,
      replacementsCount: decision.result.anonymization?.result.replacements.length ?? 0,
    });
    setAnalysisDecision(decision);

    // 1) cryptoMode 매핑
    const ck = decision.intent.cryptoKind;
    setCryptoMode(ck === 'classic' ? 'classic'
                : ck === 'pqc-only' ? 'pqc-only'
                : 'hybrid');                  // hybrid 또는 pqc-he 모두 hybrid 로 (HE는 별도)

    // 2) 등급별 옵션 분기 (사용자 명세 (6))
    const grade = decision.result.classification.grade;
    const isExternal = decision.intent.purpose === 'external';
    if (grade === 'O') {
      setOptions({ compress: true, sign: true, enveloped: false, encrypted: false });
    } else if (isExternal) {
      // S/C 외부 전송 → enveloped (수신자 지정 암호화 + 서명)
      setOptions({ compress: true, sign: true, enveloped: true, encrypted: false });
    } else {
      // S/C 내부 보관 → encrypted (비밀번호 암호화)
      setOptions({ compress: true, sign: false, enveloped: false, encrypted: true });
    }

    // 3) 가/익명화 실제 적용 (Phase 2a/2b/2c)
    //    분석 결과의 anonymization 이 있고 사용자가 'pseudonymize' / 'anonymize' 선택했으면
    //    실제 파일 내용을 가명화된 내용으로 교체 (또는 sidecar 동봉).
    const anon = decision.result.anonymization;
    if (anon && decision.anonymizationAction !== 'skip' && anon.result.replacements.length > 0) {
      try {
        const r = await anonymizeAllFiles(files, anon.result.replacements, perFileExtract);
        setFiles(r.files);
        setAnonReports(r.reports);
        const inlineCount = r.reports.filter(x => x.method === 'inline').length;
        const sidecarCount = r.reports.filter(x => x.method === 'sidecar').length;
        const unsupportedCount = r.reports.filter(x => x.method === 'unsupported').length;
        const parts: string[] = [];
        if (inlineCount > 0)      parts.push(`${inlineCount}개 직접 적용`);
        if (sidecarCount > 0)     parts.push(`${sidecarCount}개 동봉`);
        if (unsupportedCount > 0) parts.push(`${unsupportedCount}개 미지원`);
        toast.success(`가/익명화 적용 — ${parts.join(' · ') || '없음'}`, { duration: 5000 });
      } catch (err) {
        console.error('anonymize-files failed:', err);
        toast.error(`가/익명화 적용 실패 — ${(err as Error).message}. 원본 그대로 봉투 생성.`);
        setAnonReports([]);
      }
    } else {
      setAnonReports([]);
    }

    setStep('options');
    toast.success(`분석 완료 — ${grade} 등급, 옵션 자동 설정`);
  };

  const goNext = async () => {
    if (step === 'files') {
      if (files.length === 0) { toast.error('파일을 추가하세요.'); return; }
      // v2 — 분석 단계 진입 (자동 텍스트 추출 + 파이프라인)
      await enterAnalyzeStep();
    } else if (step === 'analyze') {
      // analyze 는 dialog onAccept 가 처리. 직접 next는 스킵으로 처리
      setAnalysisSkipped(true);
      setStep('options');
    } else if (step === 'options') {
      // 서명/Enveloped 시 키 필요
      if ((options.sign || options.enveloped) && !isKeyLoaded) {
        const ok = await ensureKey();
        if (!ok) return;
      }
      if (options.enveloped) {
        // 주소록 로드 + 기본 전체 선택
        const { getAllKeyRingEntries } = await import('@/lib/crypto/key-manager');
        const entries = await getAllKeyRingEntries();
        setRecipientEntries(entries);
        setRecipients(new Set(entries.map(e => e.fingerprint)));
      }
      if (options.encrypted || options.enveloped) { setStep('details'); return; }
      await runProcessing();
    } else if (step === 'details') {
      if (options.encrypted) {
        if (!password || password.length < 4) { toast.error('비밀번호 4자 이상'); return; }
        if (password !== passwordConfirm) { toast.error('비밀번호 불일치'); return; }
      }
      if (options.enveloped) {
        if (recipients.size === 0) { toast.error('수신자를 1명 이상 선택하세요.'); return; }
        if (!isKeyLoaded) {
          const ok = await ensureKey();
          if (!ok) return;
        }
      }
      await runProcessing();
    }
  };

  const resetAll = () => {
    setStep('files'); setFiles([]); setPassword(''); setPasswordConfirm('');
    setOptions({ compress: true, sign: false, enveloped: false, encrypted: false });
    setResultData(null);
    setAnalysisInitial(null); setAnalysisDecision(null); setAnalysisSkipped(false);
    setPerFileExtract([]); setAnonReports([]);
  };

  // PQC 인스턴스 (store에서 가져옴 — 잠금 해제 시 초기화됨)
  const loadPqcForSeal = (): { shield?: any; signer?: any; mode: string } | undefined => {
    if (cryptoMode === 'classic') return undefined;
    const { pqcShield, pqcSigner } = useAppStore.getState();
    if (!pqcShield && !pqcSigner) {
      throw new Error('PQC 키가 로드되지 않았습니다.\n키를 잠금 해제한 후 다시 시도하세요.');
    }
    return { shield: pqcShield ?? undefined, signer: pqcSigner ?? undefined, mode: cryptoMode };
  };

  const runProcessing = async () => {
    // 서명/봉인 작업이면 매번 사용자 동의 요구
    if (options.sign || options.enveloped) {
      const action = options.enveloped ? '봉인 (서명+암호화)'
                   : options.encrypted ? '암호화 + 서명'
                   : '서명';
      const intent = `${files.length}개 파일을 ${action}합니다. 본인 확인이 필요합니다.`;
      const ok = await requestSigningConsent(intent);
      if (!ok) { toast('서명 취소됨'); return; }
    }

    setStep('processing');
    try {
      let pkiData: Uint8Array;
      let suffix: string;
      let info: string;
      const algos: string[] = [];

      if (options.encrypted) {
        const compressed = serializeEntries(files);
        const fileInfos = files.map(f => ({ name: f.name, originalSize: f.size, compressedSize: 0, hash: '', type: f.type, lastModified: f.lastModified }));

        let innerData: Uint8Array;
        if (options.sign && keyIdentity) {
          const signerInfo = await signData(compressed, keyIdentity.signingKey.privateKey, keyIdentity.signingKey.publicKey, keyIdentity.signingKey.fingerprint);
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
        const { ciphertext, iv, salt } = await encryptWithPassword(innerData, password);
        const header: PkiHeader = {
          version: 1, flags, createdAt: Date.now(), files: fileInfos,
          encryption: { algorithm: 'AES-256-GCM', iv: arrayBufferToBase64(iv), recipients: [{ fingerprint: 'password', wrappedKey: arrayBufferToBase64(salt), ephemeralPublicKey: '', label: '비밀번호 암호화' }] },
        };
        pkiData = writePkiContainer({ header, payload: new Uint8Array(ciphertext) });
        suffix = 'encrypted';
      } else if (options.enveloped) {
        // EnvelopedMessage: 선택된 수신자만 암호화
        const currentKey = useAppStore.getState().keyIdentity;
        if (!currentKey) { toast.error('키가 활성화되지 않았습니다.'); setStep('options'); return; }
        const { importPublicKeyFromJWK, exportPublicKeyJWK } = await import('@/lib/crypto/hd-key');
        const { addToKeyRing } = await import('@/lib/crypto/key-manager');
        const recipientInfos: import('@/lib/crypto/encryption').RecipientInfo[] = [];
        const skipped: string[] = [];
        for (const e of recipientEntries) {
          if (!recipients.has(e.fingerprint)) continue;
          let jwk = e.encryptionKeyJWK as JsonWebKey;
          // 자기 자신을 수신자로 선택한 경우: 활성 키에서 JWK 복구
          if ((!jwk || !jwk.kty) && e.fingerprint === currentKey.signingKey.fingerprint) {
            jwk = await exportPublicKeyJWK(currentKey.encryptionKey.publicKey);
            // keyring 엔트리 복구
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
        if (skipped.length > 0) {
          toast.warning(`암호화 공개키가 없어 제외: ${skipped.join(', ')}. 상대방이 인증서를 재공유해야 합니다.`);
        }
        if (recipientInfos.length === 0) {
          toast.error('유효한 수신자가 없습니다 (암호화 공개키 필요)'); setStep('details'); return;
        }
        const pqcOpts = loadPqcForSeal();
        const analysisMeta = analysisDecision
          ? decisionToSealMeta(analysisDecision, currentKey.signingKey.fingerprint)
          : undefined;
        console.log('[DPV-DEBUG] seal() 호출 직전 analysisMeta', {
          hasMeta: !!analysisMeta,
          findingsSummary: analysisMeta?.classification?.findingsSummary,
          findingsCount: analysisMeta?.classification?.findingsSummary
            ? Object.keys(analysisMeta.classification.findingsSummary).length : 0,
        });
        const result = await seal({
          files, compress: true,
          encrypt: { recipients: recipientInfos },
          sign: { privateKey: currentKey.signingKey.privateKey, publicKey: currentKey.signingKey.publicKey, fingerprint: currentKey.signingKey.fingerprint },
          pqc: pqcOpts,
          analysisMeta,
        });
        pkiData = result.pkiData;
        suffix = 'enveloped';
        info = `EnvelopedMessage (${recipientInfos.length}명 수신자)`;
        if (cryptoMode !== 'pqc-only') algos.push('ECDH P-256 (암호화)', 'AES-256-GCM', 'ECDSA P-256 (서명)');
        if (result.stats.pqcKem) algos.push('ML-KEM-1024 (양자 암호화)');
        if (result.stats.pqcDsa) algos.push('ML-DSA-87 (양자 서명)');
        if (result.stats.timestamp?.method === 'tst') algos.push(`TSA (${result.stats.timestamp.tsaName})`);
        else if (result.stats.timestamp?.method === 'signingTime') algos.push('signingTime (로컬)');
      } else if (options.sign) {
        // SignedMessage
        const currentKey = useAppStore.getState().keyIdentity;
        if (!currentKey) { toast.error('키가 활성화되지 않았습니다.'); setStep('options'); return; }
        const pqcOpts = loadPqcForSeal();
        const analysisMeta = analysisDecision
          ? decisionToSealMeta(analysisDecision, currentKey.signingKey.fingerprint)
          : undefined;
        console.log('[DPV-DEBUG] seal() 호출 직전 analysisMeta', {
          hasMeta: !!analysisMeta,
          findingsSummary: analysisMeta?.classification?.findingsSummary,
          findingsCount: analysisMeta?.classification?.findingsSummary
            ? Object.keys(analysisMeta.classification.findingsSummary).length : 0,
        });
        const result = await seal({
          files, compress: true,
          sign: { privateKey: currentKey.signingKey.privateKey, publicKey: currentKey.signingKey.publicKey, fingerprint: currentKey.signingKey.fingerprint },
          pqc: pqcOpts,
          analysisMeta,
        });
        pkiData = result.pkiData;
        suffix = 'signed';
        info = `SignedMessage (0x${currentKey.signingKey.fingerprint})`;
        if (cryptoMode !== 'pqc-only') algos.push('ECDSA P-256 (서명)');
        if (result.stats.pqcDsa) algos.push('ML-DSA-87 (양자 서명)');
        if (result.stats.timestamp?.method === 'tst') algos.push(`TSA (${result.stats.timestamp.tsaName})`);
        else if (result.stats.timestamp?.method === 'signingTime') algos.push('signingTime (로컬)');
      } else {
        const result = await compressOnly(files);
        pkiData = result.pkiData;
        suffix = 'compressed';
        info = 'CompressedMessage';
        algos.push('ZLIB/ZIP (압축)');
      }

      const baseName = files.length === 1 ? files[0].name.replace(/\.[^.]+$/, '') : 'archive';
      setResultData(pkiData);
      setResultName(`${baseName}.${suffix}.pki`);
      setResultInfo(info);
      setResultAlgos(algos);
      setStep('done');
    } catch (err) {
      toast.error(`실패: ${err instanceof Error ? err.message : '오류'}`);
      setStep('options');
    }
  };

  const handleDownload = () => {
    if (!resultData) return;
    const blob = new Blob([resultData.slice()], { type: 'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = resultName;
    a.click();
  };

  const formatSize = (b: number) => {
    if (b === 0) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(b) / Math.log(1024));
    return `${(b / 1024 ** i).toFixed(1)} ${u[i]}`;
  };

  const stepIdx = STEPS.findIndex(s => s.key === step);

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 lg:py-10">
      {/* 페이지 타이틀 */}
      <h1 className="text-xl font-bold mb-6">PKIZIP 파일 생성</h1>

      {/* 진행 바 — 모바일에서도 라벨 표시 */}
      <div className="flex items-center mb-8">
        {STEPS.map((s, i) => {
          const done = i < stepIdx || step === 'done';
          const active = s.key === step;
          return (
            <div key={s.key} className="flex items-center flex-1 min-w-0">
              <div className="flex flex-col items-center gap-0.5 shrink-0">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 ${
                  done ? 'bg-[#175DDC] border-[#175DDC] text-white' : active ? 'border-zinc-800 text-zinc-800' : 'border-zinc-300 text-zinc-400'
                }`}>
                  {done ? <Check className="w-4 h-4" /> : i + 1}
                </div>
                <span className={`text-[10px] font-medium leading-tight ${
                  done ? 'text-[#175DDC]' : active ? 'text-zinc-800' : 'text-zinc-400'
                }`}>{s.label}</span>
              </div>
              {i < STEPS.length - 1 && <div className={`flex-1 h-0.5 mx-1.5 mt-[-12px] rounded ${done ? 'bg-[#175DDC]' : 'bg-zinc-200'}`} />}
            </div>
          );
        })}
      </div>

      <AnimatePresence mode="wait">
        {/* Step 1: 파일 */}
        {step === 'files' && (
          <motion.div key="files" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
            <h2 className="text-lg font-bold mb-1">파일 선택</h2>
            <p className="text-sm text-zinc-500 mb-4">CMS 컨테이너에 포함할 파일을 추가하세요.</p>

            {files.map(f => (
              <div key={f.name} className="flex items-center justify-between bg-white border border-zinc-200 rounded-xl px-4 py-3 mb-2">
                <span className="truncate flex-1 text-sm">{f.name}</span>
                <span className="text-xs text-zinc-400 mx-2">{formatSize(f.size)}</span>
                <button onClick={() => setFiles(prev => prev.filter(x => x.name !== f.name))} className="text-zinc-400 hover:text-red-500">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}

            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full border-2 border-dashed border-zinc-200 rounded-xl py-8 text-center text-zinc-400 hover:border-[#175DDC] hover:text-[#175DDC] transition-colors mt-2"
            >
              <FilePlus className="w-8 h-8 mx-auto mb-2" />
              <span className="text-sm">파일 선택 또는 드래그</span>
            </button>
            <input ref={fileInputRef} type="file" multiple className="hidden" onChange={e => { if (e.target.files) handleAddFiles(e.target.files); e.target.value = ''; }} />

            <div className="flex justify-end mt-6">
              <button onClick={goNext} disabled={files.length === 0} className="flex items-center gap-1.5 bg-zinc-900 text-white px-5 py-2.5 rounded-xl text-sm font-medium disabled:opacity-30">
                다음 <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}

        {/* Step 1.5: 분석 — 텍스트 추출 + PII + 등급 + 정책 */}
        {step === 'analyze' && (
          <motion.div key="analyze" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
            <h2 className="text-lg font-bold mb-1">📊 문서 분석</h2>
            <p className="text-sm text-zinc-500 mb-4">
              파일 내용을 분석해 보안등급(C/S/O)을 판정하고, 사용 의도에 맞는 처리 옵션을 자동 추천합니다.
              <br />분석은 100% 브라우저에서 실행 — 텍스트가 서버로 전송되지 않습니다.
            </p>
            {analyzing && (
              <div className="bg-white border border-zinc-200 rounded-xl p-6 flex items-center gap-3">
                <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
                <span className="text-sm">분석 중…</span>
              </div>
            )}
            {!analyzing && !analysisInitial && (
              <div className="bg-white border border-zinc-200 rounded-xl p-6">
                <p className="text-sm text-zinc-600 mb-3">분석 결과가 없습니다.</p>
                <button onClick={() => setStep('files')}
                  className="text-sm bg-zinc-100 px-3 py-1.5 rounded">파일 다시 선택</button>
              </div>
            )}
            <div className="flex justify-between mt-4">
              <button onClick={() => setStep('files')} className="text-sm text-zinc-500 hover:text-zinc-800">← 이전</button>
              <button onClick={goNext}
                className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800">
                분석 건너뛰기 →
              </button>
            </div>
          </motion.div>
        )}

        {/* Step 2: 옵션 */}
        {step === 'options' && (
          <motion.div key="options" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
            <h2 className="text-lg font-bold mb-1">CMS 타입 선택</h2>
            <p className="text-sm text-zinc-500 mb-4">파일 보호 옵션을 선택하세요.</p>

            {anonReports.length > 0 && (
              <div className="bg-violet-50 border border-violet-200 rounded-xl p-3 mb-3">
                <div className="text-xs font-semibold text-violet-700 uppercase mb-2">
                  가/익명화 적용 결과 — 봉투에 들어갈 파일 상태
                </div>
                <div className="space-y-1.5">
                  {anonReports.map(r => {
                    const icon = r.method === 'inline'      ? '✅'
                               : r.method === 'sidecar'     ? '📎'
                               :                              '⚠';
                    const label = r.method === 'inline'      ? '직접 적용'
                                : r.method === 'sidecar'     ? '동봉'
                                :                              '미지원';
                    const labelColor = r.method === 'inline'  ? 'text-emerald-700 bg-emerald-100'
                                     : r.method === 'sidecar' ? 'text-blue-700 bg-blue-100'
                                     :                          'text-amber-700 bg-amber-100';
                    return (
                      <div key={r.filename} className="text-xs flex items-start gap-2">
                        <span>{icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <code className="font-mono text-[11px] truncate">{r.filename}</code>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${labelColor}`}>{label}</span>
                            {r.sidecarFilename && (
                              <code className="text-[10px] text-blue-600 truncate">+ {r.sidecarFilename}</code>
                            )}
                          </div>
                          {r.note && <div className="text-[11px] text-zinc-600 mt-0.5">{r.note}</div>}
                          {r.suggestion && (
                            <div className="text-[11px] text-amber-700 mt-0.5">💡 {r.suggestion}</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 암호 모드 선택 (최상단) */}
            <div className="bg-white border border-zinc-200 rounded-xl p-4 mb-3 space-y-2">
              <label className="text-xs font-medium text-zinc-700">암호 알고리즘</label>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { value: 'classic', label: 'Classic', desc: 'ECDSA / ECDH', color: 'zinc' },
                  { value: 'hybrid', label: 'Hybrid', desc: 'Classic + PQC', color: 'green' },
                  { value: 'pqc-only', label: 'PQC Only', desc: 'ML-KEM / ML-DSA', color: 'violet' },
                ] as const).map(m => {
                  const selected = cryptoMode === m.value;
                  return (
                    <button key={m.value} onClick={() => setCryptoMode(m.value)}
                      className={`text-left rounded-lg px-3 py-2.5 border-2 transition-all ${
                        selected
                          ? m.color === 'violet' ? 'border-violet-500 bg-violet-50'
                          : m.color === 'green' ? 'border-[#175DDC] bg-[#175DDC]/5'
                          : 'border-zinc-800 bg-zinc-50'
                          : 'border-zinc-100 hover:border-zinc-300'
                      }`}>
                      <div className={`text-xs font-bold ${selected
                        ? m.color === 'violet' ? 'text-violet-700' : m.color === 'green' ? 'text-[#175DDC]' : 'text-zinc-800'
                        : 'text-zinc-500'
                      }`}>{m.label}</div>
                      <div className="text-[10px] text-zinc-400 mt-0.5">{m.desc}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-3">
              <OptionCard checked={options.compress} onChange={() => toggleOption('compress')} icon={<Package className="w-5 h-5" />} title="압축" desc="ZLIB/ZIP 압축" />
              <OptionCard checked={options.sign} onChange={() => toggleOption('sign')} icon={<PenTool className="w-5 h-5" />} title="서명 (Signed)" desc={cryptoMode === 'pqc-only' ? 'ML-DSA-87 전자서명' : cryptoMode === 'hybrid' ? 'ECDSA + ML-DSA 하이브리드 서명' : 'ECDSA P-256 전자서명'} disabled={!hasAnyIdentity} />
              <OptionCard checked={options.enveloped} onChange={() => toggleOption('enveloped')} icon={<Shield className="w-5 h-5 text-[#175DDC]" />} title="공개키 암호화 (Enveloped)" desc={cryptoMode === 'pqc-only' ? 'ML-KEM-1024 + ML-DSA-87' : cryptoMode === 'hybrid' ? 'ECDH + ML-KEM 하이브리드' : 'ECDH P-256 + ECDSA'} disabled={!hasAnyIdentity} />
              <OptionCard checked={options.encrypted} onChange={() => toggleOption('encrypted')} icon={<Lock className="w-5 h-5 text-amber-500" />} title="비밀번호 암호화 (Encrypted)" desc="AES-256-GCM 비밀번호" />
            </div>

            {/* 서명 인증서 선택 */}
            {(options.sign || options.enveloped) && identities.length > 0 && (
              <div className="bg-white border border-zinc-200 rounded-xl p-4 mt-3 space-y-2">
                <label className="text-xs font-medium text-zinc-700">서명에 사용할 인증서</label>
                <div className="space-y-1.5">
                  {identities.map(id => {
                    const isSelected = (selectedIdentityId || activeIdentityId || identities[0]?.id) === id.id;
                    return (
                      <button key={id.id} onClick={() => setSelectedIdentityId(id.id)}
                        className={`w-full text-left rounded-lg px-3 py-2.5 border-2 transition-all flex items-center gap-3 ${
                          isSelected ? 'border-[#175DDC] bg-[#175DDC]/5' : 'border-zinc-100 hover:border-zinc-300'
                        }`}>
                        <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                          isSelected ? 'border-[#175DDC] bg-[#175DDC]' : 'border-zinc-300'
                        }`}>
                          {isSelected && <Check className="w-2.5 h-2.5 text-white" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium">{id.name}</div>
                          <div className="text-[10px] text-zinc-500">{id.commonName} &lt;{id.email}&gt;</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="bg-white border border-zinc-200 rounded-xl p-3 mt-3 text-xs text-zinc-600 flex items-center gap-2 flex-wrap">
              생성 타입: <span className="font-bold text-zinc-800">{cmsType}Message</span>
              {(options.sign || options.enveloped) && cryptoMode !== 'classic' && (
                <span className="text-[9px] px-1.5 py-0.5 rounded font-bold bg-violet-600 text-white">Q</span>
              )}
              {(options.sign || options.enveloped) && (
                <span className="text-[10px] text-zinc-400">
                  ({cryptoMode === 'hybrid' ? 'Classic + PQC' : cryptoMode === 'pqc-only' ? 'PQC Only' : 'Classic'})
                </span>
              )}
            </div>

            {/* 키 잠금 해제 인라인 */}
            {needsUnlock && (options.sign || options.enveloped) && !isKeyLoaded && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mt-4 space-y-2">
                <p className="text-xs text-amber-800 font-medium">
                  {hasPinRegistered ? 'PIN(4~6자리) 또는 키 비밀번호를 입력하세요.' : '키 비밀번호를 입력하세요.'}
                </p>
                <div className="flex gap-2">
                  <input type="password" value={unlockPw} onChange={e => setUnlockPw(e.target.value)}
                    placeholder={hasPinRegistered ? 'PIN 또는 비밀번호' : '키 비밀번호'}
                    className="flex-1 border border-amber-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#175DDC]"
                    autoFocus onKeyDown={e => e.key === 'Enter' && goNext()} />
                  <button onClick={goNext} className="bg-zinc-900 text-white px-4 py-2 rounded-lg text-sm">확인</button>
                </div>
              </div>
            )}

            <div className="flex justify-between mt-6">
              <button onClick={() => setStep('files')} className="text-sm text-zinc-500 hover:text-zinc-800">이전</button>
              <button onClick={goNext} className="flex items-center gap-1.5 bg-zinc-900 text-white px-5 py-2.5 rounded-xl text-sm font-medium">
                {(options.encrypted || options.enveloped) ? '다음' : '생성'} <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}

        {/* Step 3: 상세 (비밀번호) */}
        {step === 'details' && (
          <motion.div key="details" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
            {options.encrypted ? (
              <>
                <h2 className="text-lg font-bold mb-1">비밀번호 설정</h2>
                <p className="text-sm text-zinc-500 mb-4">수신자에게 비밀번호를 별도 전달하세요.</p>
                <div className="space-y-3 max-w-sm">
                  <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="비밀번호 (4자 이상)"
                    className="w-full border border-zinc-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#175DDC]" autoFocus />
                  <input type="password" value={passwordConfirm} onChange={e => setPasswordConfirm(e.target.value)} placeholder="비밀번호 확인"
                    className="w-full border border-zinc-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#175DDC]"
                    onKeyDown={e => e.key === 'Enter' && goNext()} />
                </div>
              </>
            ) : options.enveloped ? (
              <>
                <h2 className="text-lg font-bold mb-1">수신자 선택</h2>
                <p className="text-sm text-zinc-500 mb-4">암호화된 파일을 열 수 있는 수신자를 선택하세요. 본인도 선택해야 복호화 가능합니다.</p>

                {recipientEntries.length === 0 ? (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
                    주소록에 등록된 인증서가 없습니다. 설정에서 키를 먼저 생성하세요.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {recipientEntries.map(entry => {
                      const selected = recipients.has(entry.fingerprint);
                      return (
                        <button key={entry.fingerprint}
                          onClick={() => setRecipients(prev => {
                            const next = new Set(prev);
                            selected ? next.delete(entry.fingerprint) : next.add(entry.fingerprint);
                            return next;
                          })}
                          className={`w-full text-left rounded-xl p-4 border-2 transition-all flex items-center gap-3 ${
                            selected ? 'bg-[#175DDC]/5 border-[#175DDC]' : 'border-zinc-200 bg-white hover:border-zinc-400'
                          }`}
                        >
                          <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 ${
                            selected ? 'bg-[#175DDC] border-[#175DDC]' : 'border-zinc-300'
                          }`}>
                            {selected && <Check className="w-3 h-3 text-white" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate">{entry.label}</div>
                            <div className="text-[10px] font-mono text-zinc-400 truncate">0x{entry.fingerprint}</div>
                          </div>
                          {entry.type === 'local' && (
                            <span className="text-[9px] bg-[#175DDC]/10 text-[#175DDC] px-2 py-0.5 rounded-full font-medium shrink-0">나</span>
                          )}
                        </button>
                      );
                    })}
                    <p className="text-[10px] text-zinc-400">선택: {recipients.size}명</p>
                  </div>
                )}
              </>
            ) : null}
            <div className="flex justify-between mt-6">
              <button onClick={() => setStep('options')} className="text-sm text-zinc-500">이전</button>
              <button onClick={goNext} className="flex items-center gap-1.5 bg-zinc-900 text-white px-5 py-2.5 rounded-xl text-sm font-medium">
                생성 <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}

        {/* Processing */}
        {step === 'processing' && (
          <motion.div key="proc" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center py-20">
            <Loader2 className="w-10 h-10 animate-spin text-[#175DDC] mb-4" />
            <p className="text-sm text-zinc-500">{cmsType}Message 생성 중...</p>
          </motion.div>
        )}

        {/* Done */}
        {step === 'done' && resultData && (
          <motion.div key="done" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="text-center py-10">
            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
              <Check className="w-8 h-8 text-green-600" />
            </div>
            <h2 className="text-lg font-bold mb-1">생성 완료</h2>
            <p className="text-sm text-zinc-500 mb-6">{resultInfo}</p>

            <div className="bg-white border border-zinc-200 rounded-xl p-4 max-w-sm mx-auto text-sm space-y-1.5 text-left mb-6">
              <div className="flex justify-between items-center">
                <span className="text-zinc-500">파일명</span>
                <span className="font-mono text-xs">{resultName}</span>
              </div>
              <div className="flex justify-between"><span className="text-zinc-500">크기</span><span>{formatSize(resultData.length)}</span></div>
              <div className="flex justify-between"><span className="text-zinc-500">파일 수</span><span>{files.length}개</span></div>
              {resultAlgos.length > 0 && (
                <div className="pt-1.5 border-t border-zinc-100">
                  <span className="text-zinc-500 text-xs">적용 알고리즘</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {resultAlgos.map((a, i) => (
                      <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                        a.includes('ML-') ? 'bg-violet-100 text-violet-700' : 'bg-zinc-100 text-zinc-600'
                      }`}>{a}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-3 justify-center">
              <button onClick={handleDownload} className="flex items-center gap-2 bg-[#175DDC] text-white px-6 py-2.5 rounded-xl text-sm font-medium">
                <Download className="w-4 h-4" /> 다운로드
              </button>
              <button onClick={resetAll} className="text-sm text-zinc-500 hover:text-zinc-800 px-4 py-2.5">새로 만들기</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 서명 동의 다이얼로그 */}
      <SigningConsentDialog
        open={consentOpen}
        intent={consentIntent}
        onResolve={() => {
          setConsentOpen(false);
          consentResolverRef.current?.(true);
          consentResolverRef.current = null;
        }}
        onCancel={() => {
          setConsentOpen(false);
          consentResolverRef.current?.(false);
          consentResolverRef.current = null;
        }}
      />

      {/* v2 — 분석 결과 + 사용자 결정 다이얼로그 */}
      {step === 'analyze' && analysisInitial && (
        <AnalysisDialog
          open={true}
          initialResult={analysisInitial}
          onClose={() => { setAnalysisSkipped(true); setStep('options'); }}
          onAccept={handleAnalysisAccept}
        />
      )}
    </div>
  );
}

function OptionCard({ checked, onChange, icon, title, desc, disabled }: {
  checked: boolean; onChange: () => void; icon: React.ReactNode; title: string; desc: string; disabled?: boolean;
}) {
  return (
    <motion.button
      onClick={disabled ? undefined : onChange}
      disabled={disabled}
      className={`w-full text-left rounded-xl p-4 border-2 transition-all ${
        checked ? 'bg-[#175DDC]/5 border-[#175DDC]' : disabled ? 'opacity-40 border-zinc-200 bg-zinc-50' : 'border-zinc-200 bg-white hover:border-zinc-400'
      }`}
      whileTap={disabled ? undefined : { scale: 0.98 }}
    >
      <div className="flex items-center gap-3">
        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 ${checked ? 'bg-[#175DDC] border-[#175DDC]' : 'border-zinc-300'}`}>
          {checked && <Check className="w-3 h-3 text-white" />}
        </div>
        {icon}
        <div>
          <div className="text-sm font-medium">{title}</div>
          <div className="text-xs text-zinc-500">{desc}</div>
        </div>
      </div>
    </motion.button>
  );
}
