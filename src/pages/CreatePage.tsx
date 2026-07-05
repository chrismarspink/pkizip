import { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { FilePlus, X, ChevronRight, Check, Loader2, Download, Shield, PenTool, Lock, Package, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { useAppStore } from '@/lib/store/app-store';
import type { FileEntry } from '@/lib/compression/compressor';
import { SigningConsentDialog } from '@/components/dialogs/SigningConsentDialog';
import { CertificateSelectorList } from '@/components/cms/CertificateSelectorList';
import { OptionCard } from '@/components/cms/OptionCard';
import { Stepper, type StepItem } from '@/components/cms/Stepper';
import { AnalysisDialog, type AnalysisDecision } from '@/components/dialogs/AnalysisDialog';
import { analyze as analyzePipeline, analyzeAsync as analyzePipelineAsync } from '@/lib/analysis/pipeline';
import { extractAll } from '@/lib/analysis/text-extractor';
import { anonymizeAllFiles, type FileAnonymizationReport, type PerFileExtract } from '@/lib/analysis/anonymize-files';
import { isConvertibleToPdf, type PdfConversionReport } from '@/lib/analysis/text-to-pdf';
import type { Finding, AnalysisResult } from '@/lib/analysis/types';
import { applyToggle, deriveCmsState, DEFAULT_CMS_OPTIONS, type CmsOptions } from '@/lib/cms/options';
import { buildCms, BuildError, type CryptoMode } from '@/lib/cms/build';

type Step = 'files' | 'analyze' | 'options' | 'details' | 'processing' | 'done';

const STEPS: ReadonlyArray<StepItem<Exclude<Step, 'done'>>> = [
  { key: 'files', label: '파일 선택' },
  { key: 'analyze', label: '분석' },
  { key: 'options', label: '옵션' },
  { key: 'details', label: '상세' },
  { key: 'processing', label: '처리' },
];

export function CreatePage() {
  const { t, i18n } = useTranslation();
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
  /** 입력 소스 — 'files': 파일 추가 / 'text': 클립보드/텍스트 */
  const [inputMode, setInputMode] = useState<'files' | 'text'>('files');
  const [clipText, setClipText] = useState('');
  const TEXT_LIMIT_BYTES = 64 * 1024;
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [options, setOptions] = useState<CmsOptions>(DEFAULT_CMS_OPTIONS);
  const [cryptoMode, setCryptoMode] = useState<CryptoMode>(() => {
    const { pqcConfig: cfg } = useAppStore.getState();
    if (!cfg.kemEnabled && !cfg.dsaEnabled) return 'classic';
    const mode = cfg.kemMode || cfg.dsaMode || 'hybrid';
    if (mode === 'pqc-only') return 'pqc-only';
    if (mode === 'classical') return 'classic';
    return 'hybrid';
  });
  // 암호 방식(Classic/Hybrid/PQC)·포맷 용어는 기본 숨김 — 전문가만 펼침 (제안: 용어 은닉)
  const [showAdvanced, setShowAdvanced] = useState(false);
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
  /** #8-A. 봉투 → PDF 변환 옵션. 외부 + S/C 등급 시 default ON. */
  const [pdfConvertEnabled, setPdfConvertEnabled] = useState(false);
  const [pdfReports, setPdfReports] = useState<PdfConversionReport[]>([]);
  const [pdfSkipped, setPdfSkipped] = useState<{ filename: string; reason: string }[]>([]);
  const [analysisDecision, setAnalysisDecision] = useState<AnalysisDecision | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisSkipped, setAnalysisSkipped] = useState(false);
  const [ocrProgress, setOcrProgress] = useState<{ file: string; progress: number; status: string } | null>(null);
  const [selectedIdentityId, setSelectedIdentityId] = useState<string | null>(null);
  const [resultData, setResultData] = useState<Uint8Array | null>(null);
  const [resultName, setResultName] = useState('');
  const [resultInfo, setResultInfo] = useState('');
  const [resultAlgos, setResultAlgos] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const cmsState = deriveCmsState(options);
  const { cmsType, willSign, willEncrypt, needsKey, needsPassword, needsRecipientSelection } = cmsState;

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
    setOptions(prev => applyToggle(prev, key));
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
    setOcrProgress(null);
    setStep('analyze');   // analyzing 표시 위해 step 먼저 전환
    try {
      const extracted = await extractAll(files, {
        appLanguage: i18n.language,
        onOcrProgress: (info) => setOcrProgress(info),
      });
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
      // 추출 결과 보존 — 가/익명화 sidecar 모드 + 이미지 마스킹에서 재사용
      setPerFileExtract(extracted.perFile.map(p => ({
        filename: p.name, text: p.text, source: p.source, warnings: p.warnings,
        ocrWords: p.ocrWords,
      })));
      // 추출 경로 정보 안내
      const sources = Array.from(new Set(extracted.perFile.map(p => p.source))).join(', ');
      toast(`분석 준비 완료 — 추출 경로: ${sources}${extracted.ocrApplied ? ' (OCR 적용)' : ''}`, {
        icon: '🔍',
      });

      // iframe 임베드 호스트에 분석 결과 자동 전송
      try {
        const { emitToHost } = await import('@/lib/embed/use-embed-host');
        emitToHost({
          type: 'pkizip:classified',
          result: {
            grade: result.classification.grade,
            score: result.classification.score,
            rationale: result.classification.reasons?.map(r => r.label).join(' · '),
            findings: result.findings.map(f => ({
              entityType: f.entityType,
              original: f.text,
              start: f.start,
              end: f.end,
              score: f.score,
            })),
            language: result.language?.detected,
            ocrApplied: extracted.ocrApplied,
          },
        });
      } catch (e) {
        console.debug('embed emit (classified) skipped:', e);
      }
    } catch (e) {
      console.error('analysis failed:', e);
      toast.error(`분석 실패 — ${(e as Error).message || '옵션 단계로 이동'}`);
      setAnalysisSkipped(true);
      setStep('options');
    } finally {
      setAnalyzing(false);
      setOcrProgress(null);
    }
  };

  /** 분석 다이얼로그 onAccept — 의도/등급에 따라 cryptoMode + options 자동 설정 */
  const handleAnalysisAccept = async (decision: AnalysisDecision) => {
    setAnalysisDecision(decision);

    // 1) cryptoMode 매핑
    const ck = decision.intent.cryptoKind;
    setCryptoMode(ck === 'classic' ? 'classic'
                : ck === 'pqc-only' ? 'pqc-only'
                : 'hybrid');                  // hybrid 또는 pqc-he 모두 hybrid 로 (HE는 별도)

    // 2) 등급별 옵션 분기 (사용자 명세 (6))
    //    인증서 없는 사용자(iframe 임베드에서 처음 사용 등) 는 sign/enveloped 불가
    //    → 비밀번호 암호화 또는 압축만 추천.
    const grade = decision.result.classification.grade;
    const isExternal = decision.intent.purpose === 'external';
    if (!hasAnyIdentity) {
      setOptions({ compress: true, sign: false, enveloped: false, encrypted: grade !== 'O' });
    } else if (grade === 'O') {
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
        // 이미지 마스킹용 per-file findings — 이미지(OCR) 파일에 대해서만 file-local 좌표로 재탐지
        const { detect } = await import('@/lib/analysis/pii-detector');
        const findingsByFile = new Map<string, Finding[]>();
        for (const p of perFileExtract) {
          if (p.source === 'ocr' && p.ocrWords && p.ocrWords.length > 0 && p.text) {
            findingsByFile.set(p.filename, detect(p.text, { minScore: 0.3 }));
          }
        }
        const r = await anonymizeAllFiles(files, anon.result.replacements, perFileExtract, {
          findingsByFile,
          imageMaskStyle: 'box',
        });
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

    // #8-A. PDF 변환 default — 외부 전송 + S/C 등급일 때만 자동 ON.
    setPdfConvertEnabled(isExternal && (grade === 'S' || grade === 'C'));
    setPdfReports([]);
    setPdfSkipped([]);

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
      if (needsKey && !isKeyLoaded) {
        const ok = await ensureKey();
        if (!ok) return;
      }
      if (needsRecipientSelection) {
        const { getAllKeyRingEntries } = await import('@/lib/crypto/key-manager');
        const entries = await getAllKeyRingEntries();
        setRecipientEntries(entries);
        setRecipients(new Set(entries.map(e => e.fingerprint)));
      }
      if (needsPassword || needsRecipientSelection) { setStep('details'); return; }
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
    setOptions(DEFAULT_CMS_OPTIONS);
    setResultData(null);
    setAnalysisInitial(null); setAnalysisDecision(null); setAnalysisSkipped(false);
    setPerFileExtract([]); setAnonReports([]);
    setInputMode('files'); setClipText('');
  };

  const runProcessing = async () => {
    if (willSign) {
      const action = options.enveloped ? '봉인 (서명+암호화)'
                   : options.encrypted ? '암호화 + 서명'
                   : '서명';
      const intent = `${files.length}개 파일을 ${action}합니다. 본인 확인이 필요합니다.`;
      const ok = await requestSigningConsent(intent);
      if (!ok) { toast('서명 취소됨'); return; }
    }

    setStep('processing');
    try {
      const built = await buildCms({
        options, files, cryptoMode, password, recipients, recipientEntries,
        analysisDecision, pdfConvertEnabled, keyIdentity,
      });

      // PDF 변환 결과 반영
      if (built.pdfReports.length > 0) {
        setFiles(built.workingFiles);
        setPdfReports(built.pdfReports);
        setPdfSkipped(built.pdfSkipped);
        const totalPages = built.pdfReports.reduce((s, x) => s + x.pages, 0);
        toast.success(`PDF 변환 — ${built.pdfReports.length}개 파일 (${totalPages} 페이지)`, { duration: 4000 });
      }
      // 수신자 누락 경고
      if (built.skippedRecipients && built.skippedRecipients.length > 0) {
        toast.warning(`암호화 공개키가 없어 제외: ${built.skippedRecipients.join(', ')}. 상대방이 인증서를 재공유해야 합니다.`);
      }

      setResultData(built.pkiData);
      setResultName(built.finalName);
      setResultInfo(built.info);
      setResultAlgos(built.algos);
      setStep('done');

      // iframe 임베드 호스트(HE-TEST 등) 에 봉투 결과 자동 전송
      try {
        const { emitToHost } = await import('@/lib/embed/use-embed-host');
        const b64 = btoa(String.fromCharCode(...Array.from(built.pkiData)));
        emitToHost({
          type: 'pkizip:sealed',
          envelope: { name: built.finalName, base64: b64, mime: 'application/octet-stream' },
          meta: {
            fileName: built.finalName,
            fileSize: built.pkiData.byteLength,
            grade: analysisDecision?.result?.classification?.grade,
            algorithm: built.algos.join(' + '),
            pqcApplied: cryptoMode !== 'classic',
            signed: !!options.sign,
            encrypted: !!options.encrypted,
            enveloped: !!options.enveloped,
            createdAt: Date.now(),
          },
        });
      } catch (e) {
        console.debug('embed emit (sealed) skipped:', e);
      }
    } catch (err) {
      if (err instanceof BuildError) {
        toast.error(err.message);
        setStep(err.recoveryStep);
        return;
      }
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

  const stepperCurrent: Exclude<Step, 'done'> = step === 'done' ? 'processing' : step;

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 lg:py-10">
      <h1 className="text-xl font-bold mb-6">{t("create.title")}</h1>

      <Stepper steps={STEPS} current={stepperCurrent} isComplete={step === 'done'} />

      <AnimatePresence mode="wait">
        {/* Step 1: 파일 */}
        {step === 'files' && (
          <motion.div key="files" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
            <h2 className="text-lg font-bold mb-1">{t("create.inputSelect")}</h2>
            <p className="text-sm text-zinc-500 mb-4">{t("create.inputSelectDesc")}</p>

            {/* 입력 모드 토글 */}
            <div className="grid grid-cols-2 gap-2 mb-4">
              <button
                onClick={() => setInputMode('files')}
                className={`px-3 py-2.5 rounded-xl border-2 transition-all ${
                  inputMode === 'files'
                    ? 'border-[#175DDC] bg-[#175DDC]/5 text-[#175DDC]'
                    : 'border-zinc-200 text-zinc-500 hover:border-zinc-300'
                }`}>
                <div className="text-sm font-bold">{t("create.tabFile")}</div>
                <div className="text-[10px] text-zinc-400 mt-0.5">{t("create.tabFileDesc")}</div>
              </button>
              <button
                onClick={() => setInputMode('text')}
                className={`px-3 py-2.5 rounded-xl border-2 transition-all ${
                  inputMode === 'text'
                    ? 'border-[#175DDC] bg-[#175DDC]/5 text-[#175DDC]'
                    : 'border-zinc-200 text-zinc-500 hover:border-zinc-300'
                }`}>
                <div className="text-sm font-bold">{t("create.tabText")}</div>
                <div className="text-[10px] text-zinc-400 mt-0.5">{t("create.tabTextDesc")}</div>
              </button>
            </div>

            {inputMode === 'files' && (
              <>
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
                  <span className="text-sm">{t("create.filePickerHint")}</span>
                </button>
                <input ref={fileInputRef} type="file" multiple className="hidden" onChange={e => { if (e.target.files) handleAddFiles(e.target.files); e.target.value = ''; }} />
              </>
            )}

            {inputMode === 'text' && (
              <div className="bg-white border border-zinc-200 rounded-xl p-3">
                <textarea
                  value={clipText}
                  onChange={e => setClipText(e.target.value)}
                  placeholder={t("create.textPlaceholder")}
                  className="w-full h-64 border border-zinc-200 rounded-lg p-3 text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-[#175DDC]"
                />
                {(() => {
                  const bytes = new TextEncoder().encode(clipText).length;
                  const overLimit = bytes > TEXT_LIMIT_BYTES;
                  return (
                    <div className={`mt-2 flex justify-between items-center text-[11px] ${overLimit ? 'text-red-600' : 'text-zinc-500'}`}>
                      <span>
                        {bytes.toLocaleString()} / {TEXT_LIMIT_BYTES.toLocaleString()} bytes
                        {overLimit && ' — 한도 초과 ⚠'}
                      </span>
                      <button
                        onClick={async () => {
                          try {
                            const t = await navigator.clipboard.readText();
                            setClipText(t.slice(0, TEXT_LIMIT_BYTES));
                          } catch {
                            toast.error('클립보드 권한이 필요합니다.');
                          }
                        }}
                        className="text-[#175DDC] hover:underline">
                        📋 클립보드에서 붙여넣기
                      </button>
                    </div>
                  );
                })()}
              </div>
            )}

            <div className="flex justify-end mt-6">
              <button
                onClick={async () => {
                  if (inputMode === 'text') {
                    const bytes = new TextEncoder().encode(clipText).length;
                    if (bytes === 0) { toast.error('텍스트를 입력하세요.'); return; }
                    if (bytes > TEXT_LIMIT_BYTES) { toast.error('64KB 한도를 초과했습니다.'); return; }
                    // 텍스트를 가상 파일로 변환 — 기존 파일 흐름 그대로 재사용
                    const data = new TextEncoder().encode(clipText);
                    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
                    setFiles([{
                      name: `clipboard_${ts}.txt`,
                      data,
                      size: data.byteLength,
                      lastModified: Date.now(),
                      type: 'text/plain',
                    }]);
                    // setFiles 비동기 — 다음 렌더에서 enterAnalyzeStep 진입 위해 setTimeout
                    setTimeout(() => goNext(), 0);
                  } else {
                    goNext();
                  }
                }}
                disabled={inputMode === 'files' ? files.length === 0 : clipText.length === 0}
                className="flex items-center gap-1.5 bg-[#175DDC] text-white px-5 py-2.5 rounded-xl text-sm font-medium disabled:opacity-30">
                다음 <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}

        {/* Step 1.5: 분석 — 텍스트 추출 + PII + 등급 + 정책 */}
        {step === 'analyze' && (
          <motion.div key="analyze" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
            <h2 className="text-lg font-bold mb-1">{t("create.analysis")}</h2>
            <p className="text-sm text-zinc-500 mb-4">
              파일 내용을 분석해 보안등급(C/S/O)을 판정하고, 사용 의도에 맞는 처리 옵션을 자동 추천합니다.
              <br />분석은 100% 브라우저에서 실행 — 텍스트가 서버로 전송되지 않습니다.
            </p>
            {analyzing && (
              <div className="bg-white border border-zinc-200 rounded-xl p-6">
                <div className="flex items-center gap-3">
                  <Loader2 className="w-5 h-5 animate-spin text-[#175DDC] shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">
                      {ocrProgress ? t('create.ocrRunning', { file: ocrProgress.file }) : t('create.analyzing')}
                    </div>
                    {ocrProgress && (
                      <>
                        <div className="text-[11px] text-zinc-500 mt-1 truncate">
                          {ocrProgress.status} · {Math.round(ocrProgress.progress * 100)}%
                        </div>
                        <div className="mt-1.5 h-1 w-full bg-zinc-100 rounded-full overflow-hidden">
                          <div className="h-full bg-[#175DDC] transition-all"
                            style={{ width: `${Math.round(ocrProgress.progress * 100)}%` }} />
                        </div>
                        <p className="text-[10px] text-zinc-400 mt-1.5">{t('create.ocrFirstRunNote')}</p>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}
            {!analyzing && !analysisInitial && (
              <div className="bg-white border border-zinc-200 rounded-xl p-6">
                <p className="text-sm text-zinc-600 mb-3">{t("create.noAnalysis")}</p>
                <button onClick={() => setStep('files')}
                  className="text-sm bg-zinc-100 px-3 py-1.5 rounded">{t("create.retry")}</button>
              </div>
            )}
            <div className="flex justify-between mt-4">
              <button onClick={() => setStep('files')} className="text-sm text-zinc-500 hover:text-zinc-800">← {t("common.back")}</button>
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
            <h2 className="text-lg font-bold mb-1">{t("create.cmsType")}</h2>
            <p className="text-sm text-zinc-500 mb-4">{t("create.cmsTypeDesc")}</p>

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
                                     : r.method === 'sidecar' ? 'text-[#175DDC] bg-[#175DDC]/10'
                                     :                          'text-amber-700 bg-amber-100';
                    return (
                      <div key={r.filename} className="text-xs flex items-start gap-2">
                        <span>{icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <code className="font-mono text-[11px] truncate">{r.filename}</code>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${labelColor}`}>{label}</span>
                            {r.sidecarFilename && (
                              <code className="text-[10px] text-[#175DDC] truncate">+ {r.sidecarFilename}</code>
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

            {/* 보호 옵션 — 평문 2개(받는 사람만 열람·내가 보냈다는 증명). 나머지는 고급으로 (제안 증분 2). */}
            <div className="space-y-3">
              <OptionCard
                checked={options.enveloped}
                onChange={() => toggleOption('enveloped')}
                icon={<Shield className="w-5 h-5 text-[#175DDC]" />}
                title="받는 사람만 열람"
                desc="지정한 받는 사람만 열 수 있게 암호화합니다"
                disabled={!hasAnyIdentity}
              />
              <OptionCard
                checked={options.sign}
                onChange={() => toggleOption('sign')}
                icon={<PenTool className="w-5 h-5" />}
                title="내가 보냈다는 증명"
                desc={
                  options.enveloped
                    ? '받는 사람만 열람에 포함됨 — 끄면 함께 해제됩니다'
                    : '이 파일을 내가 보냈다는 증명(서명)을 첨부합니다'
                }
                disabled={!hasAnyIdentity}
              />
            </div>

            {willSign && (
              <CertificateSelectorList
                identities={identities}
                selectedId={selectedIdentityId}
                activeId={activeIdentityId}
                onSelect={setSelectedIdentityId}
              />
            )}

            {/* 고급 옵션 — 비밀번호 잠금·PDF 변환·압축·암호 방식 (기본 숨김) */}
            <button onClick={() => setShowAdvanced(v => !v)}
              className="text-xs text-zinc-500 hover:text-[#175DDC] flex items-center gap-1 mt-3 mb-2">
              ⚙ 고급 옵션 (비밀번호·PDF·압축·암호 방식) {showAdvanced ? '▴' : '▾'}
            </button>
            {showAdvanced && (
              <div className="space-y-3">
                <div className="bg-white border border-zinc-200 rounded-xl p-4 space-y-2">
                  <label className="text-xs font-medium text-zinc-700">{t("create.cryptoAlgo")}</label>
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
                <OptionCard checked={options.encrypted} onChange={() => toggleOption('encrypted')} icon={<Lock className="w-5 h-5 text-amber-500" />} title="비밀번호로 잠그기" desc="비밀번호를 아는 사람만 열 수 있습니다" />
                <OptionCard checked={options.compress} onChange={() => toggleOption('compress')} icon={<Package className="w-5 h-5" />} title={t("create.compress")} desc={t("create.compressDesc")} />
                {(() => {
                  const convertibleCount = files.filter(f => isConvertibleToPdf(f.name)).length;
                  return (
                    <OptionCard
                      checked={pdfConvertEnabled}
                      onChange={() => setPdfConvertEnabled(prev => !prev)}
                      icon={<FileText className="w-5 h-5 text-violet-600" />}
                      title={t("create.pdfWatermark")}
                      desc={
                        convertibleCount === 0
                          ? '변환 대상 파일 없음 (xlsx/pptx/이미지/PDF 등은 변환 X)'
                          : `${convertibleCount}개 파일을 PDF 로 변환 — 등급·카테고리 헤더·푸터 워터마크 모든 페이지`
                      }
                      disabled={convertibleCount === 0}
                    />
                  );
                })()}
                <div className="bg-white border border-zinc-200 rounded-xl p-3 text-xs text-zinc-600 flex items-center gap-2 flex-wrap">
                  생성 타입: <span className="font-bold text-zinc-800">{cmsType}Message</span>
                  {willSign && cryptoMode !== 'classic' && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded font-bold bg-violet-600 text-white">Q</span>
                  )}
                  {willSign && (
                    <span className="text-[10px] text-zinc-400">
                      ({cryptoMode === 'hybrid' ? 'Classic + PQC' : cryptoMode === 'pqc-only' ? 'PQC Only' : 'Classic'})
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* 키 잠금 해제 인라인 */}
            {needsUnlock && willSign && !isKeyLoaded && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mt-4 space-y-2">
                <p className="text-xs text-amber-800 font-medium">
                  {hasPinRegistered ? 'PIN(4~6자리) 또는 키 비밀번호를 입력하세요.' : '키 비밀번호를 입력하세요.'}
                </p>
                <div className="flex gap-2">
                  <input type="password" value={unlockPw} onChange={e => setUnlockPw(e.target.value)}
                    placeholder={hasPinRegistered ? 'PIN 또는 비밀번호' : '키 비밀번호'}
                    className="flex-1 border border-amber-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#175DDC]"
                    autoFocus onKeyDown={e => e.key === 'Enter' && goNext()} />
                  <button onClick={goNext} className="bg-[#175DDC] text-white px-4 py-2 rounded-xl text-sm">{t("common.confirm")}</button>
                </div>
              </div>
            )}

            <div className="flex justify-between mt-6">
              <button onClick={() => setStep('files')} className="text-sm text-zinc-500 hover:text-zinc-800">{t("common.back")}</button>
              <button onClick={goNext} className="flex items-center gap-1.5 bg-[#175DDC] text-white px-5 py-2.5 rounded-xl text-sm font-medium">
                {(needsPassword || needsRecipientSelection) ? '다음' : '생성'} <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}

        {/* Step 3: 상세 (비밀번호) */}
        {step === 'details' && (
          <motion.div key="details" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
            {options.encrypted ? (
              <>
                <h2 className="text-lg font-bold mb-1">{t("create.passwordSetup")}</h2>
                <p className="text-sm text-zinc-500 mb-4">{t("create.passwordSetupDesc")}</p>
                <div className="space-y-3 max-w-sm">
                  <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder={t("create.passwordMin4")}
                    className="w-full border border-zinc-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#175DDC]" autoFocus />
                  <input type="password" value={passwordConfirm} onChange={e => setPasswordConfirm(e.target.value)} placeholder={t("create.passwordConfirm")}
                    className="w-full border border-zinc-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#175DDC]"
                    onKeyDown={e => e.key === 'Enter' && goNext()} />
                </div>
              </>
            ) : options.enveloped ? (
              <>
                <h2 className="text-lg font-bold mb-1">{t("create.recipientSelect")}</h2>
                <p className="text-sm text-zinc-500 mb-4">{t("create.recipientSelectDesc")}</p>

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
                            <span className="text-[9px] bg-[#175DDC]/10 text-[#175DDC] px-2 py-0.5 rounded-full font-medium shrink-0">{t("create.me")}</span>
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
              <button onClick={() => setStep('options')} className="text-sm text-zinc-500">{t("common.back")}</button>
              <button onClick={goNext} className="flex items-center gap-1.5 bg-[#175DDC] text-white px-5 py-2.5 rounded-xl text-sm font-medium">
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
            <h2 className="text-lg font-bold mb-1">{t("create.generationDone")}</h2>
            <p className="text-sm text-zinc-500 mb-6">{resultInfo}</p>

            <div className="bg-white border border-zinc-200 rounded-xl p-4 max-w-sm mx-auto text-sm space-y-1.5 text-left mb-6">
              <div className="flex justify-between items-center">
                <span className="text-zinc-500">{t("create.filename")}</span>
                <span className="font-mono text-xs">{resultName}</span>
              </div>
              <div className="flex justify-between"><span className="text-zinc-500">{t("create.size")}</span><span>{formatSize(resultData.length)}</span></div>
              <div className="flex justify-between"><span className="text-zinc-500">{t("create.fileCount")}</span><span>{files.length}개</span></div>
              {resultAlgos.length > 0 && (
                <div className="pt-1.5 border-t border-zinc-100">
                  <span className="text-zinc-500 text-xs">{t("create.appliedAlgo")}</span>
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

            {inputMode === 'text' && files[0] && (() => {
              const enveloped = new TextDecoder().decode(files[0].data);
              const HEAD = 200;
              const TAIL = 100;
              const truncated = enveloped.length > HEAD + TAIL + 20;
              const head = enveloped.slice(0, HEAD);
              const tail = truncated ? enveloped.slice(-TAIL) : '';
              const inputLen = clipText.length;
              const envLen = enveloped.length;
              const diff = envLen - inputLen;
              return (
                <div className="bg-zinc-50 border border-zinc-300 rounded-xl p-4 max-w-2xl mx-auto mb-4 text-left">
                  <div className="text-xs font-semibold text-zinc-700 uppercase mb-2">
                    📄 봉투 내용 미리보기 — 봉투 안에 들어간 텍스트 확인
                  </div>
                  <div className="text-[11px] text-zinc-500 mb-2 flex flex-wrap gap-3">
                    <span>{t('create.inputLen')} <b className="text-zinc-700">{inputLen.toLocaleString()}</b>{t('create.chars')}</span>
                    <span>→</span>
                    <span>{t('create.envLen')} <b className="text-zinc-700">{envLen.toLocaleString()}</b>{t('create.chars')}</span>
                    {diff !== 0 && (
                      <span className={diff < 0 ? 'text-emerald-700' : 'text-amber-700'}>
                        {diff > 0 ? '+' : ''}{diff.toLocaleString()}자
                        {diff < 0 ? ' (가명화로 축소)' : diff > 0 ? ' (가명화로 확장)' : ''}
                      </span>
                    )}
                  </div>
                  <pre className="bg-white border border-zinc-200 rounded p-3 text-xs whitespace-pre-wrap break-words font-mono leading-relaxed max-h-48 overflow-auto">
                    {head}
                    {truncated && (
                      <span className="text-zinc-400 italic block my-1">
                        ⋯ ({(envLen - HEAD - TAIL).toLocaleString()}자 생략) ⋯
                      </span>
                    )}
                    {tail}
                  </pre>
                  <div className="text-[10px] text-zinc-400 mt-1.5">
                    💡 가명화가 의도대로 적용됐는지 확인 — 원본 PII (이메일·주민번호 등) 가
                    placeholder ([EMAIL_1] 등) 로 교체되어 있어야 정상.
                  </div>
                </div>
              );
            })()}

            <div className="flex gap-3 justify-center">
              <button onClick={handleDownload} className="flex items-center gap-2 bg-[#175DDC] text-white px-6 py-2.5 rounded-xl text-sm font-medium">
                <Download className="w-4 h-4" /> 다운로드
              </button>
              <button onClick={resetAll} className="text-sm text-zinc-500 hover:text-zinc-800 px-4 py-2.5">{t('create.newCreate')}</button>
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

