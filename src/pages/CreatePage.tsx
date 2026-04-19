import { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FilePlus, X, ChevronRight, Check, Loader2, Download, Shield, PenTool, Lock, Package } from 'lucide-react';
import { PqcBadge } from '@/components/PqcBadge';
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

type Step = 'files' | 'options' | 'details' | 'processing' | 'done';

interface CmsOptions {
  compress: boolean;
  sign: boolean;
  enveloped: boolean;
  encrypted: boolean;
}

const STEPS = [
  { key: 'files', label: '파일 선택' },
  { key: 'options', label: '옵션' },
  { key: 'details', label: '상세' },
  { key: 'processing', label: '처리' },
] as const;

export function CreatePage() {
  const { keyIdentity, isKeyLoaded, identities, activeIdentityId, setIdentities, setActiveIdentityId, pqcConfig } = useAppStore();
  // IndexedDB에서 아이덴티티 로드
  useEffect(() => {
    (async () => {
      const { getAllIdentityMetas, getActiveIdentityId } = await import('@/lib/crypto/key-manager');
      const metas = await getAllIdentityMetas();
      setIdentities(metas.map(m => ({
        id: m.id, name: m.name, commonName: m.commonName, email: m.email,
        signingFingerprint: m.signingFingerprint, encryptionFingerprint: m.encryptionFingerprint,
        createdAt: m.createdAt,
      })));
      const activeId = await getActiveIdentityId();
      setActiveIdentityId(activeId);
    })();
  }, [setIdentities, setActiveIdentityId]);

  const hasAnyIdentity = identities.length > 0;

  const [step, setStep] = useState<Step>('files');
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [options, setOptions] = useState<CmsOptions>({ compress: true, sign: false, enveloped: false, encrypted: false });
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [recipients, setRecipients] = useState<Set<string>>(new Set());
  const [recipientEntries, setRecipientEntries] = useState<import('@/lib/crypto/key-manager').PublicKeyEntry[]>([]);
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
    setFiles(prev => [...prev, ...entries]);
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
    } catch (err) {
      console.warn('Biometric unlock failed:', err);
      // 생체 인증 취소/실패 → PIN 또는 비밀번호로 fallback
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
      return true;
    } catch {
      toast.error('비밀번호가 틀렸습니다.');
      return false;
    }
  };

  const goNext = async () => {
    if (step === 'files') {
      if (files.length === 0) { toast.error('파일을 추가하세요.'); return; }
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
  };

  // PQC 인스턴스 (store에서 가져옴 — 잠금 해제 시 초기화됨)
  const loadPqcForSeal = () => {
    const { pqcConfig: cfg, pqcShield, pqcSigner } = useAppStore.getState();
    if (!cfg.kemEnabled && !cfg.dsaEnabled) return undefined;
    if (!pqcShield && !pqcSigner) {
      console.warn('[PKIZIP] PQC 인스턴스 없음 — 잠금 해제 시 초기화 필요');
      return undefined;
    }
    return {
      shield: cfg.kemEnabled ? pqcShield : undefined,
      signer: cfg.dsaEnabled ? pqcSigner : undefined,
      mode: cfg.kemMode || 'hybrid',
    };
  };

  const runProcessing = async () => {
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
        const { importPublicKeyFromJWK } = await import('@/lib/crypto/hd-key');
        const recipientInfos: import('@/lib/crypto/encryption').RecipientInfo[] = [];
        for (const e of recipientEntries) {
          if (!recipients.has(e.fingerprint)) continue;
          const pubKey = await importPublicKeyFromJWK(e.encryptionKeyJWK, 'encrypt');
          recipientInfos.push({ fingerprint: e.fingerprint, encryptionPublicKey: pubKey, label: e.label });
        }
        if (recipientInfos.length === 0) { toast.error('수신자가 없습니다.'); setStep('details'); return; }
        const pqcOpts = loadPqcForSeal();
        const result = await seal({
          files, compress: true,
          encrypt: { recipients: recipientInfos },
          sign: { privateKey: currentKey.signingKey.privateKey, publicKey: currentKey.signingKey.publicKey, fingerprint: currentKey.signingKey.fingerprint },
          pqc: pqcOpts,
        });
        pkiData = result.pkiData;
        suffix = 'enveloped';
        info = `EnvelopedMessage (${recipientInfos.length}명 수신자)`;
        algos.push('ECDH P-256 (암호화)', 'AES-256-GCM', 'ECDSA P-256 (서명)');
        if (result.stats.pqcKem) algos.push('ML-KEM-1024 (양자 암호화)');
        if (result.stats.pqcDsa) algos.push('ML-DSA-87 (양자 서명)');
      } else if (options.sign) {
        // SignedMessage
        const currentKey = useAppStore.getState().keyIdentity;
        if (!currentKey) { toast.error('키가 활성화되지 않았습니다.'); setStep('options'); return; }
        const pqcOpts = loadPqcForSeal();
        const result = await seal({
          files, compress: true,
          sign: { privateKey: currentKey.signingKey.privateKey, publicKey: currentKey.signingKey.publicKey, fingerprint: currentKey.signingKey.fingerprint },
          pqc: pqcOpts,
        });
        pkiData = result.pkiData;
        suffix = 'signed';
        info = `SignedMessage (0x${currentKey.signingKey.fingerprint})`;
        algos.push('ECDSA P-256 (서명)');
        if (result.stats.pqcDsa) algos.push('ML-DSA-87 (양자 서명)');
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
                  done ? 'bg-[#1DC078] border-[#1DC078] text-white' : active ? 'border-zinc-800 text-zinc-800' : 'border-zinc-300 text-zinc-400'
                }`}>
                  {done ? <Check className="w-4 h-4" /> : i + 1}
                </div>
                <span className={`text-[10px] font-medium leading-tight ${
                  done ? 'text-[#1DC078]' : active ? 'text-zinc-800' : 'text-zinc-400'
                }`}>{s.label}</span>
              </div>
              {i < STEPS.length - 1 && <div className={`flex-1 h-0.5 mx-1.5 mt-[-12px] rounded ${done ? 'bg-[#1DC078]' : 'bg-zinc-200'}`} />}
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
              className="w-full border-2 border-dashed border-zinc-200 rounded-xl py-8 text-center text-zinc-400 hover:border-[#1DC078] hover:text-[#1DC078] transition-colors mt-2"
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

        {/* Step 2: 옵션 */}
        {step === 'options' && (
          <motion.div key="options" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
            <h2 className="text-lg font-bold mb-1">CMS 타입 선택</h2>
            <p className="text-sm text-zinc-500 mb-4">파일 보호 옵션을 선택하세요.</p>

            <div className="space-y-3">
              <OptionCard checked={options.compress} onChange={() => toggleOption('compress')} icon={<Package className="w-5 h-5" />} title="압축" desc="tar.gz 압축" />
              <OptionCard checked={options.sign} onChange={() => toggleOption('sign')} icon={<PenTool className="w-5 h-5" />} title="서명 (Signed)" desc="ECDSA P-256 전자서명" disabled={!hasAnyIdentity} />
              <OptionCard checked={options.enveloped} onChange={() => toggleOption('enveloped')} icon={<Shield className="w-5 h-5 text-[#1DC078]" />} title="공개키 암호화 (Enveloped)" desc="수신자 공개키 + 서명" disabled={!hasAnyIdentity} />
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
                          isSelected ? 'border-[#1DC078] bg-[#1DC078]/5' : 'border-zinc-100 hover:border-zinc-300'
                        }`}>
                        <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                          isSelected ? 'border-[#1DC078] bg-[#1DC078]' : 'border-zinc-300'
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

            <div className="bg-white border border-zinc-200 rounded-xl p-3 mt-3 text-xs text-zinc-600">
              생성 타입: <span className="font-bold text-zinc-800">{cmsType}Message</span>
              {(options.sign || options.enveloped) && <PqcBadge pqc={pqcConfig.kemEnabled || pqcConfig.dsaEnabled} size="sm" />}
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
                    className="flex-1 border border-amber-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1DC078]"
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
                    className="w-full border border-zinc-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1DC078]" autoFocus />
                  <input type="password" value={passwordConfirm} onChange={e => setPasswordConfirm(e.target.value)} placeholder="비밀번호 확인"
                    className="w-full border border-zinc-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1DC078]"
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
                            selected ? 'bg-[#1DC078]/5 border-[#1DC078]' : 'border-zinc-200 bg-white hover:border-zinc-400'
                          }`}
                        >
                          <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 ${
                            selected ? 'bg-[#1DC078] border-[#1DC078]' : 'border-zinc-300'
                          }`}>
                            {selected && <Check className="w-3 h-3 text-white" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate">{entry.label}</div>
                            <div className="text-[10px] font-mono text-zinc-400 truncate">0x{entry.fingerprint}</div>
                          </div>
                          {entry.type === 'local' && (
                            <span className="text-[9px] bg-[#1DC078]/10 text-[#1DC078] px-2 py-0.5 rounded-full font-medium shrink-0">나</span>
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
            <Loader2 className="w-10 h-10 animate-spin text-[#1DC078] mb-4" />
            <p className="text-sm text-zinc-500">{cmsType}Message 생성 중...</p>
          </motion.div>
        )}

        {/* Done */}
        {step === 'done' && resultData && (
          <motion.div key="done" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="text-center py-10">
            <div className="w-16 h-16 rounded-full bg-[#1DC078]/10 flex items-center justify-center mx-auto mb-4">
              <Check className="w-8 h-8 text-[#1DC078]" />
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
              <button onClick={handleDownload} className="flex items-center gap-2 bg-[#1DC078] text-white px-6 py-2.5 rounded-xl text-sm font-medium">
                <Download className="w-4 h-4" /> 다운로드
              </button>
              <button onClick={resetAll} className="text-sm text-zinc-500 hover:text-zinc-800 px-4 py-2.5">새로 만들기</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
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
        checked ? 'bg-[#1DC078]/5 border-[#1DC078]' : disabled ? 'opacity-40 border-zinc-200 bg-zinc-50' : 'border-zinc-200 bg-white hover:border-zinc-400'
      }`}
      whileTap={disabled ? undefined : { scale: 0.98 }}
    >
      <div className="flex items-center gap-3">
        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 ${checked ? 'bg-[#1DC078] border-[#1DC078]' : 'border-zinc-300'}`}>
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
