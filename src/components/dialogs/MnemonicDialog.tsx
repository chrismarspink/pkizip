import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { motion, AnimatePresence } from 'framer-motion';
import { KeyRound, User, Mail, Eye, EyeOff, Copy, AlertTriangle, ShieldCheck, X, ChevronRight, Check } from 'lucide-react';
import { generateNewMnemonic, recoverFromMnemonic, isValidMnemonic } from '@/lib/crypto/mnemonic';
import { deriveKeyIdentity, exportPublicKeyJWK } from '@/lib/crypto/hd-key';
import { saveIdentity, addToKeyRing, saveCertificate, type PublicKeyEntry, type StoredCertificate } from '@/lib/crypto/key-manager';
import { generateSelfSignedCertificate, type CertificateInfo } from '@/lib/crypto/certificate';
import { useAppStore } from '@/lib/store/app-store';
import { useAuthStore } from '@/lib/supabase/auth-store';
import { Identicon } from '@/components/cert/Identicon';
import { LogoCrop } from '@/components/LogoCrop';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'generate' | 'recover';
}

type Step = 'profile' | 'mnemonic-input' | 'mnemonic-show' | 'password' | 'done';

export function MnemonicDialog({ open, onOpenChange, mode }: Props) {
  const [step, setStep] = useState<Step>('profile');
  const [identityName, setIdentityName] = useState('');
  const [commonName, setCommonName] = useState('');
  const [email, setEmail] = useState('');
  const [logotype, setLogotype] = useState<string | null>(null);
  const [cardColor, setCardColor] = useState<string>('navy');
  const [showLogoCrop, setShowLogoCrop] = useState(false);
  const [mnemonic, setMnemonic] = useState('');
  const [mnemonicInput, setMnemonicInput] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [showMnemonic, setShowMnemonic] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [certInfo, setCertInfo] = useState<CertificateInfo | null>(null);
  const [fingerprint, setFingerprint] = useState('');

  // 서버 백업 옵션
  const authUser = useAuthStore(s => s.user);
  const [backupEnabled, setBackupEnabled] = useState(false);
  const [backupPw, setBackupPw] = useState('');
  const [backupPwConfirm, setBackupPwConfirm] = useState('');
  const [backupHint, setBackupHint] = useState('');

  const { setKeyIdentity, setCertificate, setIdentities, setActiveIdentityId } = useAppStore();

  const handleProfileNext = () => {
    if (!identityName.trim()) { setError('아이덴티티 이름을 입력하세요.'); return; }
    if (!commonName.trim()) { setError('이름을 입력하세요.'); return; }
    if (!email.trim() || !email.includes('@')) { setError('유효한 이메일을 입력하세요.'); return; }
    setError('');
    if (mode === 'generate') {
      const result = generateNewMnemonic();
      setMnemonic(result.mnemonic);
      setStep('mnemonic-show');
    } else {
      setStep('mnemonic-input');
    }
  };

  const handleMnemonicInputNext = () => {
    if (!isValidMnemonic(mnemonicInput)) { setError('유효하지 않은 니모닉입니다.'); return; }
    setMnemonic(mnemonicInput.trim().toLowerCase());
    setError('');
    setStep('password');
  };

  const handleSaveKey = async () => {
    if (password.length < 8) { setError('비밀번호는 8자 이상'); return; }
    if (password !== passwordConfirm) { setError('비밀번호 불일치'); return; }
    setLoadingMsg('키 파생 중...');
    setLoading(true); setError('');

    try {
      const { seed } = recoverFromMnemonic(mnemonic);
      const identity = await deriveKeyIdentity(seed);

      setLoadingMsg('인증서 생성 중...');
      const cert = await generateSelfSignedCertificate({
        commonName: commonName.trim(), email: email.trim(),
        signingPrivateKey: identity.signingKey.privateKey,
        signingPublicKey: identity.signingKey.publicKey,
        encryptionPublicKey: identity.encryptionKey.publicKey,
        fingerprint: identity.signingKey.fingerprint,
        logotype: logotype ?? undefined,
      });

      const id = await saveIdentity(seed, password, identityName.trim(), {
        master: identity.masterFingerprint,
        signing: identity.signingKey.fingerprint,
        encryption: identity.encryptionKey.fingerprint,
      }, { commonName: commonName.trim(), email: email.trim() });

      // PQC 번들 항상 생성
      setLoadingMsg('PQC 키 생성 중...');
      let pqcCerts: { kem?: string; dsa?: string } | undefined;
      let pqcKeyId: string | undefined;
      try {
        const { PQCBundle } = await import('@/lib/pqc/pqc-bundle.js');
        const { PQCKeystore } = await import('@/lib/pqc/pqc-keystore.js');
        const pqcBundle = await PQCBundle.create({
          mnemonic, password,
          subject: { name: commonName.trim(), email: email.trim() },
          mode: 'full',
        });
        pqcCerts = pqcBundle.data.certificates;
        pqcKeyId = pqcBundle.getPqcKeyId() ?? undefined;
        console.log('[PKIZIP] PQC 인증서 생성:', Object.keys(pqcCerts || {}));

        // PQC 개인키 저장 (암호화 운용시 필요)
        await PQCKeystore.save(pqcBundle, password, 'default');
        console.log('[PKIZIP] PQC 키 저장 완료. KeyId:', pqcKeyId?.slice(0, 16));

        // PQC 런타임 인스턴스 초기화 (seal/open에서 사용)
        const { PQCShield } = await import('@/lib/pqc/pqc-shield.js');
        const { PQCSigner } = await import('@/lib/pqc/pqc-signer.js');
        useAppStore.getState().setPqcInstances(
          PQCShield.fromBundle(pqcBundle.getKEMKeyPair()),
          PQCSigner.fromBundle(pqcBundle.getDSAKeyPair()),
        );
        console.log('[PKIZIP] PQC 인스턴스 초기화 완료');
        console.log('[PKIZIP] PQC certs preview:', {
          kemLen: pqcCerts?.kem?.length ?? 0,
          dsaLen: pqcCerts?.dsa?.length ?? 0,
          kemStart: pqcCerts?.kem?.slice(0, 50),
          dsaStart: pqcCerts?.dsa?.slice(0, 50),
        });
      } catch (pqcErr) {
        console.error('[PKIZIP] PQC 생성 실패:', pqcErr);
        toast.error('PQC 인증서/키 생성 실패 — classic 인증서만 생성되었습니다.');
      }

      // 인증서 저장
      setLoadingMsg('인증서 저장 중...');
      console.log('[PKIZIP] 인증서 저장 시작');
      const storedCert: StoredCertificate = {
        fingerprint: identity.signingKey.fingerprint,
        commonName: commonName.trim(), email: email.trim(),
        serialNumber: cert.serialNumber,
        notBefore: cert.notBefore.getTime(), notAfter: cert.notAfter.getTime(),
        pemCertificate: cert.pemCertificate, createdAt: Date.now(),
        logotype: logotype ?? undefined,
        cardColor,
        pqcCertificates: pqcCerts,
        pqcKeyId,
      };
      await saveCertificate(storedCert);
      console.log('[PKIZIP] 인증서 저장 완료');

      setLoadingMsg('키링 등록 중...');
      const signingJWK = await exportPublicKeyJWK(identity.signingKey.publicKey);
      const encryptionJWK = await exportPublicKeyJWK(identity.encryptionKey.publicKey);
      await addToKeyRing({
        fingerprint: identity.signingKey.fingerprint,
        label: `${commonName.trim()} <${email.trim()}>`,
        signingKeyJWK: signingJWK, encryptionKeyJWK: encryptionJWK,
        createdAt: Date.now(), type: 'local',
      });
      console.log('[PKIZIP] 키링 등록 완료');

      setKeyIdentity(identity);
      setCertificate(cert);
      setFingerprint(identity.signingKey.fingerprint);
      setCertInfo(cert);

      // 아이덴티티 목록 갱신
      setLoadingMsg('아이덴티티 갱신 중...');
      const { getAllIdentityMetas, getActiveIdentityId, setActiveIdentityId: sai } = await import('@/lib/crypto/key-manager');
      await sai(id);
      setActiveIdentityId(id);
      const metas = await getAllIdentityMetas();
      setIdentities(metas.map(m => ({
        id: m.id, name: m.name, commonName: m.commonName, email: m.email,
        signingFingerprint: m.signingFingerprint, encryptionFingerprint: m.encryptionFingerprint,
        createdAt: m.createdAt,
      })));
      console.log('[PKIZIP] 아이덴티티 갱신 완료');

      // 서버 백업 (opt-in, 로그인 시만)
      if (backupEnabled && authUser && backupPw) {
        setLoadingMsg('서버 백업 암호화 중...');
        if (backupPw !== backupPwConfirm) {
          toast.error('백업 패스워드가 일치하지 않습니다.');
        } else if (backupPw.length < 8) {
          toast.error('백업 패스워드는 8자 이상이어야 합니다.');
        } else {
          try {
            const { backupMnemonic } = await import('@/lib/supabase/mnemonic-backup');
            await backupMnemonic(mnemonic, backupPw, id, backupHint || undefined);
            toast.success('니모닉 암호화 백업 저장 완료');
          } catch (backupErr) {
            toast.error(`백업 실패: ${backupErr instanceof Error ? backupErr.message : '오류'}`);
          }
        }
      }

      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : '키 생성 실패');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setStep('profile'); setIdentityName(''); setCommonName(''); setEmail('');
    setMnemonic(''); setMnemonicInput(''); setPassword(''); setPasswordConfirm('');
    setError(''); setShowMnemonic(false); setCertInfo(null);
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={handleClose}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-white rounded-2xl shadow-2xl w-[90vw] max-w-[480px] max-h-[85vh] overflow-y-auto p-6">
          <Dialog.Close className="absolute top-4 right-4 text-zinc-400 hover:text-zinc-800">
            <X className="w-5 h-5" />
          </Dialog.Close>

          <div className="flex items-center gap-2 mb-1">
            <KeyRound className="w-5 h-5 text-[#175DDC]" />
            <Dialog.Title className="text-lg font-bold">
              {mode === 'generate' ? '새 키 및 인증서 생성' : '기존 니모닉으로 복구'}
            </Dialog.Title>
          </div>
          <Dialog.Description className="text-sm text-zinc-500 mb-5">
            {mode === 'generate' ? '이름/이메일로 자체서명 인증서를 발급합니다.' : '12단어 니모닉과 이름/이메일로 복구합니다.'}
          </Dialog.Description>

          <AnimatePresence mode="wait">
            {/* Profile */}
            {step === 'profile' && (
              <motion.div key="profile" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-3">
                <Field icon={<KeyRound className="w-3.5 h-3.5" />} label="아이덴티티 이름" value={identityName} onChange={setIdentityName} placeholder="개인 키, 회사 키 등" autoFocus />
                <Field icon={<User className="w-3.5 h-3.5" />} label="이름 (CN)" value={commonName} onChange={setCommonName} placeholder="홍길동" />
                <Field icon={<Mail className="w-3.5 h-3.5" />} label="이메일" value={email} onChange={setEmail} placeholder="user@example.com" type="email" />

                {/* 로고타입 (선택) */}
                <div className="space-y-1.5">
                  <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-700">
                    <ShieldCheck className="w-3.5 h-3.5" /> 로고 이미지 <span className="text-zinc-400">(선택)</span>
                  </label>
                  <div className="flex items-center gap-3">
                    <div className="w-14 h-14 rounded-xl border border-zinc-200 bg-zinc-50 flex items-center justify-center overflow-hidden shrink-0">
                      {logotype ? (
                        <img src={logotype} alt="logo" className="max-w-full max-h-full object-contain" />
                      ) : (
                        <span className="text-[9px] text-zinc-400">Identicon<br />(기본)</span>
                      )}
                    </div>
                    <button type="button" onClick={() => setShowLogoCrop(true)}
                      className="flex-1 text-xs border border-zinc-200 rounded-xl py-2.5 px-3 hover:bg-zinc-50 transition-colors text-zinc-600">
                      {logotype ? '로고 변경' : '로고 업로드 및 크롭'}
                    </button>
                    {logotype && (
                      <button type="button" onClick={() => setLogotype(null)}
                        className="text-xs text-zinc-400 hover:text-red-500 px-2">
                        제거
                      </button>
                    )}
                  </div>
                  <p className="text-[10px] text-zinc-400">로고가 없으면 핑거프린트 기반 Identicon이 표시됩니다.</p>
                </div>

                {error && <p className="text-sm text-red-500">{error}</p>}
                <div className="flex justify-end pt-2">
                  <Btn onClick={handleProfileNext}>다음 <ChevronRight className="w-4 h-4" /></Btn>
                </div>
              </motion.div>
            )}

            {/* Mnemonic Input (recover) */}
            {step === 'mnemonic-input' && (
              <motion.div key="mninput" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-3">
                <label className="text-xs font-medium text-zinc-700">기존 니모닉 12단어</label>
                <textarea value={mnemonicInput} onChange={e => { setMnemonicInput(e.target.value); setError(''); }} rows={3} placeholder="word1 word2 ... word12"
                  className="w-full border border-zinc-200 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#175DDC] resize-none" autoFocus />
                {error && <p className="text-sm text-red-500">{error}</p>}
                <div className="flex justify-between pt-2">
                  <BtnGhost onClick={() => setStep('profile')}>이전</BtnGhost>
                  <Btn onClick={handleMnemonicInputNext}>다음 <ChevronRight className="w-4 h-4" /></Btn>
                </div>
              </motion.div>
            )}

            {/* Mnemonic Show (generate) */}
            {step === 'mnemonic-show' && (
              <motion.div key="mnshow" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
                <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-medium">니모닉 12단어</span>
                    <div className="flex gap-1">
                      <button onClick={() => setShowMnemonic(!showMnemonic)} className="p-1.5 rounded-lg hover:bg-zinc-200">
                        {showMnemonic ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                      <button onClick={() => { navigator.clipboard.writeText(mnemonic); toast.success('복사됨'); }} className="p-1.5 rounded-lg hover:bg-zinc-200">
                        <Copy className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  {showMnemonic ? (
                    <div className="grid grid-cols-3 gap-2">
                      {mnemonic.split(' ').map((w, i) => (
                        <div key={i} className="bg-white rounded-lg px-2 py-1.5 text-sm font-mono flex items-center gap-1.5">
                          <span className="text-zinc-400 text-[10px] w-4">{i + 1}.</span> {w}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-zinc-400 text-sm">눈 아이콘을 클릭하여 확인</div>
                  )}
                </div>
                <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-700">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>이 12단어를 안전한 곳에 보관하세요. 분실 시 복구 불가.</span>
                </div>
                <div className="flex justify-end pt-2">
                  <Btn onClick={() => setStep('password')} disabled={!showMnemonic}>안전하게 보관했습니다</Btn>
                </div>
              </motion.div>
            )}

            {/* Password + Backup Option */}
            {step === 'password' && (
              <motion.div key="pw" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-3">
                <p className="text-sm text-zinc-500">키를 안전하게 저장할 비밀번호를 설정하세요.</p>
                <input type="password" value={password} onChange={e => { setPassword(e.target.value); setError(''); }} placeholder="비밀번호 (8자 이상)"
                  className="w-full border border-zinc-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#175DDC]" autoFocus />
                <input type="password" value={passwordConfirm} onChange={e => { setPasswordConfirm(e.target.value); setError(''); }} placeholder="비밀번호 확인"
                  className="w-full border border-zinc-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#175DDC]"
                  onKeyDown={e => e.key === 'Enter' && handleSaveKey()} />

                {/* 서버 백업 옵션 */}
                <div className="border-t border-zinc-100 pt-3 mt-2">
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <input type="checkbox" checked={backupEnabled} onChange={e => setBackupEnabled(e.target.value !== '' && e.target.checked)}
                      disabled={!authUser} className="rounded border-zinc-300 accent-[#175DDC]" />
                    <span className={authUser ? 'text-zinc-700' : 'text-zinc-400'}>서버에 암호화 백업 저장</span>
                  </label>
                  {!authUser && <p className="text-[10px] text-zinc-400 mt-1 ml-5">로그인 후 사용 가능합니다</p>}

                  {backupEnabled && authUser && (
                    <div className="mt-2 space-y-2 pl-5">
                      <input type="password" value={backupPw} onChange={e => setBackupPw(e.target.value)} placeholder="백업 패스워드 (키 패스워드와 다른 것 권장)"
                        className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#175DDC]" />
                      <input type="password" value={backupPwConfirm} onChange={e => setBackupPwConfirm(e.target.value)} placeholder="백업 패스워드 확인"
                        className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#175DDC]" />
                      <input type="text" value={backupHint} onChange={e => setBackupHint(e.target.value)} placeholder="힌트 (선택, 패스워드 자체 입력 금지)"
                        className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#175DDC]" />
                      <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-[10px] text-amber-700">
                        백업 패스워드를 잊으면 복구 불가. 서버에는 암호화된 데이터만 저장됩니다.
                      </div>
                    </div>
                  )}
                </div>

                {error && <p className="text-sm text-red-500">{error}</p>}
                <div className="flex justify-end pt-2">
                  <Btn onClick={handleSaveKey} disabled={loading}>{loading ? (loadingMsg || '생성 중...') : '키 저장 및 인증서 발급'}</Btn>
                </div>
              </motion.div>
            )}

            {/* Done */}
            {step === 'done' && certInfo && (
              <motion.div key="done" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="text-center space-y-4">
                <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto">
                  <ShieldCheck className="w-8 h-8 text-green-600" />
                </div>
                <h3 className="text-lg font-bold">키 및 인증서 생성 완료</h3>

                <div className="flex justify-center">
                  <Identicon value={fingerprint} size={64} className="rounded-2xl overflow-hidden" />
                </div>

                <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4 text-sm space-y-1.5 text-left">
                  <div className="flex justify-between"><span className="text-zinc-500">이름</span><span className="font-medium">{certInfo.commonName}</span></div>
                  <div className="flex justify-between"><span className="text-zinc-500">이메일</span><span>{certInfo.email}</span></div>
                  <div className="flex justify-between"><span className="text-zinc-500">핑거프린트</span><code className="text-xs font-mono">0x{fingerprint}</code></div>
                  <div className="flex justify-between"><span className="text-zinc-500">유효기간</span><span className="text-xs">{certInfo.notBefore.toLocaleDateString('ko-KR')} ~ {certInfo.notAfter.toLocaleDateString('ko-KR')}</span></div>
                </div>

                <Btn onClick={handleClose}>확인</Btn>
              </motion.div>
            )}
          </AnimatePresence>
        </Dialog.Content>
      </Dialog.Portal>

      {/* 로고 크롭 다이얼로그 */}
      <Dialog.Root open={showLogoCrop} onOpenChange={setShowLogoCrop}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/60 z-[60]" />
          <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[60] bg-white rounded-2xl shadow-2xl w-[92vw] max-w-[560px] max-h-[90vh] overflow-y-auto p-6">
            <Dialog.Close className="absolute top-4 right-4 text-zinc-400 hover:text-zinc-800 z-10">
              <X className="w-5 h-5" />
            </Dialog.Close>
            <Dialog.Title className="text-lg font-bold mb-1">로고 이미지 크롭</Dialog.Title>
            <Dialog.Description className="text-sm text-zinc-500 mb-4">
              인증서에 사용할 이미지를 업로드하고 영역을 선택하세요.
            </Dialog.Description>
            <LogoCrop
              onCropComplete={(dataUrl) => setLogotype(dataUrl)}
              cardColor={cardColor as any}
              onCardColorChange={setCardColor}
              previewName={commonName || undefined}
              previewEmail={email || undefined}
            />
            <div className="flex justify-end mt-4 pt-4 border-t border-zinc-100">
              <Btn onClick={() => setShowLogoCrop(false)}>완료</Btn>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </Dialog.Root>
  );
}

// --- Small components ---

function Field({ icon, label, value, onChange, placeholder, type, autoFocus }: {
  icon: React.ReactNode; label: string; value: string; onChange: (v: string) => void; placeholder: string; type?: string; autoFocus?: boolean;
}) {
  return (
    <div className="space-y-1">
      <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-700">{icon} {label}</label>
      <input type={type || 'text'} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} autoFocus={autoFocus}
        className="w-full border border-zinc-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#175DDC]" />
    </div>
  );
}

function Btn({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="flex items-center gap-1.5 bg-zinc-900 text-white px-5 py-2.5 rounded-xl text-sm font-medium disabled:opacity-30 hover:bg-zinc-800 transition-colors">
      {children}
    </button>
  );
}

function BtnGhost({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} className="text-sm text-zinc-500 hover:text-zinc-800">{children}</button>;
}
