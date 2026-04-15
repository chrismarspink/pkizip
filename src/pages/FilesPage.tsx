import { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FolderOpen, FileArchive, Package, PenTool, Shield, Lock,
  CheckCircle, XCircle, Download, Unlock, ChevronRight,
  Trash2, Check, File as FileIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  isPkiFile, readPkiContainer, hasFlag,
  FLAG_COMPRESSED, FLAG_ENCRYPTED, FLAG_SIGNED,
  deserializeSignerInfos, base64ToArrayBuffer,
  type PkiHeader,
} from '@/lib/container/pki-format';
import { open as openPki } from '@/lib/container/pki-operations';
import { decryptWithPassword } from '@/lib/crypto/encryption';
import { verifyAllSignatures, computeHash, type SignedPackage, type VerificationResult } from '@/lib/crypto/signing';
import { deserializeEntries } from '@/lib/compression/compressor';
import { unpackInnerPayload } from '@/lib/container/inner-payload';
import { useAppStore } from '@/lib/store/app-store';

// === Types ===

interface AnalysisStep {
  type: 'encrypted' | 'enveloped' | 'signed' | 'compressed' | 'files';
  label: string;
  status: 'pending' | 'active' | 'done' | 'error';
  detail?: string;
  verification?: VerificationResult[];
}

interface PkiRecord {
  id: string;
  name: string;
  size: number;
  rawData: Uint8Array;
  header: PkiHeader;
  cmsType: string;
  steps: AnalysisStep[];
  extractedFiles: { name: string; data: Uint8Array; size: number; type: string }[] | null;
  signatureWarning?: string;
}

// === Helpers ===

const fmt = (b: number) => {
  if (b === 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(b) / Math.log(1024));
  return `${(b / 1024 ** i).toFixed(1)} ${u[i]}`;
};

const STEP_ICONS: Record<string, React.ReactNode> = {
  encrypted: <Lock className="w-3.5 h-3.5" />,
  enveloped: <Shield className="w-3.5 h-3.5" />,
  signed: <PenTool className="w-3.5 h-3.5" />,
  compressed: <Package className="w-3.5 h-3.5" />,
  files: <FileIcon className="w-3.5 h-3.5" />,
};

const CMS_COLORS: Record<string, string> = {
  Compressed: 'bg-zinc-100 text-zinc-700',
  Signed: 'bg-blue-100 text-blue-700',
  Enveloped: 'bg-emerald-100 text-emerald-700',
  Encrypted: 'bg-amber-100 text-amber-700',
};

// === Component ===

export function FilesPage() {
  const { keyIdentity, isKeyLoaded, identities, activeIdentityId } = useAppStore();
  const [records, setRecords] = useState<PkiRecord[]>([]);
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  const [unlockPws, setUnlockPws] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  // === 분석 ===
  const analyze = useCallback((name: string, raw: Uint8Array): PkiRecord | null => {
    if (!isPkiFile(raw)) return null;
    const c = readPkiContainer(raw);
    const h = c.header;
    const isEnc = hasFlag(h.flags, FLAG_ENCRYPTED);
    const isSig = hasFlag(h.flags, FLAG_SIGNED);
    const isComp = hasFlag(h.flags, FLAG_COMPRESSED);
    const isPw = isEnc && h.encryption?.recipients[0]?.fingerprint === 'password';

    let cmsType = 'Compressed';
    if (isPw) cmsType = 'Encrypted';
    else if (isEnc) cmsType = 'Enveloped';
    else if (isSig) cmsType = 'Signed';

    const steps: AnalysisStep[] = [];
    if (isPw) {
      steps.push({ type: 'encrypted', label: '비밀번호 복호화', status: 'active', detail: 'AES-256-GCM' });
      steps.push({ type: 'compressed', label: '압축 해제', status: 'pending' });
      steps.push({ type: 'files', label: '파일 추출', status: 'pending' });
    } else if (isEnc) {
      const rcp = h.encryption?.recipients.map(r => r.label || `0x${r.fingerprint.slice(0, 8)}`).join(', ') ?? '';
      steps.push({ type: 'enveloped', label: '공개키 복호화', status: 'active', detail: `수신자: ${rcp}` });
      steps.push({ type: 'compressed', label: '압축 해제', status: 'pending' });
      steps.push({ type: 'files', label: '파일 추출', status: 'pending' });
    } else {
      if (isSig) {
        const sigLabels = h.signatures?.map(s => s.label || `0x${s.fingerprint}`).join(', ') ?? '';
        steps.push({ type: 'signed', label: '서명 검증', status: 'active', detail: `서명자: ${sigLabels}` });
      }
      if (isComp) steps.push({ type: 'compressed', label: '압축 해제', status: isSig ? 'pending' : 'active' });
      steps.push({ type: 'files', label: '파일 추출', status: 'pending' });
    }

    return { id: crypto.randomUUID(), name, size: raw.length, rawData: raw, header: h, cmsType, steps, extractedFiles: null };
  }, []);

  const handleOpen = useCallback(async (fl: FileList) => {
    for (const f of Array.from(fl)) {
      const d = new Uint8Array(await f.arrayBuffer());
      const r = analyze(f.name, d);
      if (r) setRecords(prev => [...prev, r]);
      else toast.error(`${f.name}: 유효하지 않은 .pki`);
    }
  }, [analyze]);

  // === 비밀번호 복호화 ===
  const decryptPw = useCallback(async (id: string) => {
    const rec = records.find(r => r.id === id);
    const pw = passwords[id];
    if (!rec || !pw || !rec.header.encryption) return;

    try {
      const c = readPkiContainer(rec.rawData);
      const iv = new Uint8Array(base64ToArrayBuffer(rec.header.encryption.iv));
      const salt = new Uint8Array(base64ToArrayBuffer(rec.header.encryption.recipients[0]?.wrappedKey || ''));
      const buf = new ArrayBuffer(c.payload.byteLength);
      new Uint8Array(buf).set(c.payload);
      const dec = await decryptWithPassword(buf, pw, iv, salt);

      // inner payload 파싱 → 서명 발견
      let compData: Uint8Array;
      let verification: VerificationResult[] | undefined;
      let signers: string[] = [];
      let sigWarn: string | undefined;

      try {
        const inner = unpackInnerPayload(dec);
        compData = inner.data;
        if (inner.signatures?.length) {
          signers = inner.signatures.map(s => s.label || `0x${s.fingerprint}`);
          try {
            const si = deserializeSignerInfos(inner.signatures);
            const ch = computeHash(inner.data);
            const sp: SignedPackage = { contentHash: ch, signerInfos: si, digestAlgorithm: 'SHA-256' };
            verification = await verifyAllSignatures(inner.data, sp);
          } catch { sigWarn = '서명 검증 실패 — 인증서 없음 또는 손상'; }
        }
      } catch { compData = dec; }

      const files = deserializeEntries(compData);

      setRecords(prev => prev.map(r => {
        if (r.id !== id) return r;
        const newSteps: AnalysisStep[] = [
          { type: 'encrypted', label: '비밀번호 복호화', status: 'done' },
        ];
        if (signers.length > 0) {
          newSteps.push({ type: 'signed', label: '서명 검증', status: 'done', detail: sigWarn || `서명자: ${signers.join(', ')}`, verification });
        }
        newSteps.push({ type: 'compressed', label: '압축 해제', status: 'done' });
        newSteps.push({ type: 'files', label: '파일 추출', status: 'active', detail: `${files.length}개 파일` });
        return { ...r, steps: newSteps, extractedFiles: files.map(f => ({ name: f.name, data: f.data, size: f.size, type: f.type })), signatureWarning: sigWarn };
      }));
      setPasswords(prev => { const n = { ...prev }; delete n[id]; return n; });
      toast.success('복호화 완료');
    } catch {
      toast.error('비밀번호가 틀렸습니다.');
    }
  }, [records, passwords]);

  // === 공개키 복호화 (생체 인증 우선) ===
  const decryptEnv = useCallback(async (id: string, unlockPw?: string) => {
    let key = keyIdentity;

    if (!key && identities.length > 0) {
      const tid = activeIdentityId || identities[0].id;
      const { deriveKeyIdentity } = await import('@/lib/crypto/hd-key');
      const { setActiveIdentityId: ssa } = await import('@/lib/crypto/key-manager');

      // 1. 생체 인증 시도
      try {
        const { hasBiometric, unlockWithBiometric } = await import('@/lib/crypto/biometric');
        if (await hasBiometric(tid)) {
          const seed = await unlockWithBiometric(tid);
          const identity = await deriveKeyIdentity(seed);
          useAppStore.getState().setKeyIdentity(identity);
          useAppStore.getState().setActiveIdentityId(tid);
          await ssa(tid);
          key = identity;
        }
      } catch (err) {
        console.warn('Biometric unlock failed:', err);
      }

      // 2. 비밀번호 fallback
      if (!key && unlockPw) {
        try {
          const { loadIdentitySeed } = await import('@/lib/crypto/key-manager');
          const seed = await loadIdentitySeed(tid, unlockPw);
          const identity = await deriveKeyIdentity(seed);
          useAppStore.getState().setKeyIdentity(identity);
          useAppStore.getState().setActiveIdentityId(tid);
          await ssa(tid);
          key = identity;
        } catch { toast.error('비밀번호가 틀렸습니다.'); return; }
      }
    }

    if (!key) { setUnlockPws(prev => ({ ...prev, [id]: prev[id] ?? '' })); return; }

    const rec = records.find(r => r.id === id);
    if (!rec) return;

    try {
      const result = await openPki(rec.rawData, key.encryptionKey.privateKey, key.encryptionKey.fingerprint);
      setRecords(prev => prev.map(r => {
        if (r.id !== id) return r;
        const newSteps: AnalysisStep[] = [
          { type: 'enveloped', label: '공개키 복호화', status: 'done' },
        ];
        if (result.verification.length > 0) {
          newSteps.push({ type: 'signed', label: '서명 검증', status: 'done', verification: result.verification,
            detail: `서명자: ${result.verification.map(v => v.label || v.fingerprint).join(', ')}` });
        }
        newSteps.push({ type: 'compressed', label: '압축 해제', status: 'done' });
        newSteps.push({ type: 'files', label: '파일 추출', status: 'active', detail: `${result.files.length}개 파일` });
        return { ...r, steps: newSteps, extractedFiles: result.files.map(f => ({ name: f.name, data: f.data, size: f.size, type: f.type })) };
      }));
      setUnlockPws(prev => { const n = { ...prev }; delete n[id]; return n; });
      toast.success('복호화 완료');
    } catch (err) {
      toast.error(`복호화 실패: ${err instanceof Error ? err.message : '키 불일치'}`);
    }
  }, [records, keyIdentity, identities, activeIdentityId]);

  // === Signed/Compressed 바로 추출 ===
  const verifyAndExtract = useCallback(async (id: string) => {
    const rec = records.find(r => r.id === id);
    if (!rec) return;
    try {
      const c = readPkiContainer(rec.rawData);
      let verification: VerificationResult[] | undefined;
      if (rec.header.signatures?.length) {
        const si = deserializeSignerInfos(rec.header.signatures);
        const ch = computeHash(c.payload);
        verification = await verifyAllSignatures(c.payload, { contentHash: ch, signerInfos: si, digestAlgorithm: 'SHA-256' });
      }
      const files = deserializeEntries(c.payload);
      setRecords(prev => prev.map(r => {
        if (r.id !== id) return r;
        const newSteps = r.steps.map(s => {
          if (s.type === 'signed') return { ...s, status: 'done' as const, verification };
          if (s.type === 'compressed') return { ...s, status: 'done' as const };
          if (s.type === 'files') return { ...s, status: 'active' as const, detail: `${files.length}개 파일` };
          return s;
        });
        const sigWarn = verification?.some(v => !v.valid) ? '서명 검증 실패' : undefined;
        return { ...r, steps: newSteps, extractedFiles: files.map(f => ({ name: f.name, data: f.data, size: f.size, type: f.type })), signatureWarning: sigWarn };
      }));
    } catch (err) { toast.error(`실패: ${err instanceof Error ? err.message : '오류'}`); }
  }, [records]);

  const decompress = useCallback(async (id: string) => {
    const rec = records.find(r => r.id === id);
    if (!rec) return;
    try {
      const result = await openPki(rec.rawData);
      setRecords(prev => prev.map(r => {
        if (r.id !== id) return r;
        return {
          ...r,
          steps: r.steps.map(s =>
            s.type === 'compressed' ? { ...s, status: 'done' as const } :
            s.type === 'files' ? { ...s, status: 'active' as const, detail: `${result.files.length}개 파일` } : s
          ),
          extractedFiles: result.files.map(f => ({ name: f.name, data: f.data, size: f.size, type: f.type })),
        };
      }));
    } catch (err) { toast.error(`실패: ${err instanceof Error ? err.message : '오류'}`); }
  }, [records]);

  const extractFile = (f: { name: string; data: Uint8Array; type: string }) => {
    const blob = new Blob([f.data.slice()], { type: f.type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = f.name;
    a.click();
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 lg:py-10">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">파일 리스트</h1>
          <p className="text-sm text-zinc-500">.pki 파일을 열어 단계별로 분석합니다.</p>
        </div>
        <button onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-2 border border-zinc-200 rounded-xl px-4 py-2 text-sm hover:bg-zinc-50 transition-colors">
          <FolderOpen className="w-4 h-4" /> .pki 열기
        </button>
      </div>

      <input ref={fileInputRef} type="file" multiple accept=".pki" className="hidden"
        onChange={e => { if (e.target.files) handleOpen(e.target.files); e.target.value = ''; }} />

      {records.length === 0 ? (
        <div className="text-center py-20">
          <FileArchive className="w-16 h-16 mx-auto mb-4 text-zinc-200" />
          <p className="text-zinc-400">.pki 파일을 열어 분석하세요</p>
        </div>
      ) : (
        <div className="space-y-4">
          <AnimatePresence>
            {records.map(rec => (
              <motion.div
                key={rec.id}
                layout
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="rounded-2xl border border-zinc-200 overflow-hidden"
              >
                {/* 헤더 */}
                <div className="flex items-center justify-between px-4 py-3 bg-zinc-100">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileArchive className="w-5 h-5 text-zinc-400 shrink-0" />
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate">{rec.name}</div>
                      <div className="text-[10px] text-zinc-400">{fmt(rec.size)}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${CMS_COLORS[rec.cmsType] || ''}`}>{rec.cmsType}</span>
                    <button onClick={() => setRecords(prev => prev.filter(r => r.id !== rec.id))} className="text-zinc-300 hover:text-red-400">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* 프로그레스 바 */}
                <div className="px-4 py-3 flex items-center gap-1 border-b border-zinc-100">
                  {rec.steps.map((s, i) => (
                    <div key={i} className="flex items-center">
                      <div className={`flex items-center gap-1 ${
                        s.status === 'done' ? 'text-[#1DC078]' : s.status === 'active' ? 'text-zinc-800' : s.status === 'error' ? 'text-red-500' : 'text-zinc-400'
                      }`}>
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center border-2 ${
                          s.status === 'done' ? 'bg-[#1DC078] border-[#1DC078] text-white' :
                          s.status === 'active' ? 'border-zinc-800' :
                          s.status === 'error' ? 'border-red-500' : 'border-zinc-300'
                        }`}>
                          {s.status === 'done' ? <Check className="w-3 h-3" /> : STEP_ICONS[s.type]}
                        </div>
                        <span className="text-[10px] font-medium hidden sm:inline">{s.label}</span>
                      </div>
                      {i < rec.steps.length - 1 && <ChevronRight className={`w-3 h-3 mx-1 ${s.status === 'done' ? 'text-[#1DC078]/50' : 'text-zinc-200'}`} />}
                    </div>
                  ))}
                </div>

                {/* 단계별 콘텐츠 */}
                <div className="px-4 py-4 space-y-3">
                  {rec.steps.map((s, i) => {
                    // 완료된 서명 결과
                    if (s.type === 'signed' && s.status === 'done' && s.verification) {
                      return (
                        <div key={i} className="space-y-1">
                          {s.verification.map((v, vi) => (
                            <div key={vi} className={`flex items-center gap-1.5 text-xs ${v.valid ? 'text-[#1DC078]' : 'text-red-500'}`}>
                              {v.valid ? <CheckCircle className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                              서명 {vi + 1}: {v.valid ? '유효' : '무효'} ({v.label || v.fingerprint})
                            </div>
                          ))}
                        </div>
                      );
                    }

                    if (s.status !== 'active' && s.status !== 'error') return null;

                    // 비밀번호 복호화
                    if (s.type === 'encrypted') {
                      return (
                        <div key={i} className="space-y-2">
                          <p className="text-xs text-zinc-500">{s.detail}</p>
                          <div className="flex gap-2 max-w-md">
                            <input type="password" value={passwords[rec.id] || ''} onChange={e => setPasswords(prev => ({ ...prev, [rec.id]: e.target.value }))}
                              placeholder="비밀번호 입력" className="flex-1 border border-zinc-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1DC078]"
                              autoFocus onKeyDown={e => e.key === 'Enter' && decryptPw(rec.id)} />
                            <button onClick={() => decryptPw(rec.id)} className="flex items-center gap-1.5 bg-zinc-900 text-white px-4 py-2 rounded-xl text-sm">
                              <Unlock className="w-3.5 h-3.5" /> 복호화
                            </button>
                          </div>
                        </div>
                      );
                    }

                    // 공개키 복호화
                    if (s.type === 'enveloped') {
                      return (
                        <div key={i} className="space-y-2">
                          <p className="text-xs text-zinc-500">{s.detail}</p>
                          {isKeyLoaded ? (
                            <button onClick={() => decryptEnv(rec.id)} className="flex items-center gap-1.5 bg-zinc-900 text-white px-4 py-2 rounded-xl text-sm">
                              <Unlock className="w-3.5 h-3.5" /> 공개키로 복호화
                            </button>
                          ) : identities.length > 0 ? (
                            <div className="space-y-2 max-w-md">
                              <p className="text-xs text-amber-600">키 비밀번호를 입력하여 잠금 해제 후 복호화합니다.</p>
                              <div className="flex gap-2">
                                <input type="password" value={unlockPws[rec.id] || ''} onChange={e => setUnlockPws(prev => ({ ...prev, [rec.id]: e.target.value }))}
                                  placeholder="키 비밀번호" className="flex-1 border border-zinc-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1DC078]"
                                  onKeyDown={e => e.key === 'Enter' && decryptEnv(rec.id, unlockPws[rec.id])} />
                                <button onClick={() => decryptEnv(rec.id, unlockPws[rec.id])} className="flex items-center gap-1.5 bg-zinc-900 text-white px-4 py-2 rounded-xl text-sm">
                                  <Unlock className="w-3.5 h-3.5" /> 복호화
                                </button>
                              </div>
                            </div>
                          ) : (
                            <p className="text-xs text-red-500">설정에서 키를 먼저 생성하세요.</p>
                          )}
                        </div>
                      );
                    }

                    // 서명 검증
                    if (s.type === 'signed') {
                      return (
                        <div key={i} className="space-y-2">
                          <p className="text-xs text-zinc-500">{s.detail}</p>
                          <button onClick={() => verifyAndExtract(rec.id)} className="flex items-center gap-1.5 bg-zinc-900 text-white px-4 py-2 rounded-xl text-sm">
                            <PenTool className="w-3.5 h-3.5" /> 서명 검증 및 추출
                          </button>
                        </div>
                      );
                    }

                    // 압축 해제
                    if (s.type === 'compressed') {
                      return (
                        <div key={i}>
                          <button onClick={() => decompress(rec.id)} className="flex items-center gap-1.5 bg-zinc-900 text-white px-4 py-2 rounded-xl text-sm">
                            <Package className="w-3.5 h-3.5" /> 압축 해제
                          </button>
                        </div>
                      );
                    }

                    // 파일 목록
                    if (s.type === 'files' && rec.extractedFiles) {
                      const hasBadSig = rec.steps.find(st => st.type === 'signed')?.verification?.some(v => !v.valid);
                      const warn = hasBadSig || !!rec.signatureWarning;
                      return (
                        <div key={i} className="space-y-2">
                          {warn && (
                            <div className="flex items-start gap-2 bg-red-50 rounded-xl p-3 text-xs text-red-700">
                              <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
                              <div>
                                <p className="font-medium">서명 검증 경고</p>
                                <p>{rec.signatureWarning || '서명이 유효하지 않습니다. 파일이 변조되었을 수 있습니다.'}</p>
                              </div>
                            </div>
                          )}
                          <p className="text-xs font-medium text-zinc-700">{rec.extractedFiles.length}개 파일</p>
                          {rec.extractedFiles.map(f => (
                            <div key={f.name} className="flex items-center justify-between bg-white border border-zinc-200 rounded-xl px-4 py-2.5">
                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                <FileIcon className="w-4 h-4 text-zinc-400 shrink-0" />
                                <span className="text-sm truncate">{f.name}</span>
                                <span className="text-[10px] text-zinc-400 shrink-0">{fmt(f.size)}</span>
                              </div>
                              <button onClick={() => {
                                if (warn && !confirm('서명 검증 실패. 파일이 변조되었을 수 있습니다.\n그래도 추출하시겠습니까?')) return;
                                extractFile(f);
                              }} className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg ${
                                warn ? 'text-amber-600 border border-amber-300' : 'text-zinc-600 hover:bg-zinc-100'
                              }`}>
                                <Download className="w-3 h-3" /> 추출
                              </button>
                            </div>
                          ))}
                        </div>
                      );
                    }

                    return null;
                  })}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
