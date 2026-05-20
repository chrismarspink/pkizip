import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { KeyRound, User, Mail, Eye, EyeOff, Copy, AlertTriangle, ShieldCheck, X, ChevronRight, Check } from 'lucide-react';
import { generateNewMnemonic, recoverFromMnemonic, isValidMnemonic } from '@/lib/crypto/mnemonic';
import { deriveKeyIdentity, exportPublicKeyJWK } from '@/lib/crypto/hd-key';
import { saveIdentity, addToKeyRing, saveCertificate, type PublicKeyEntry, type StoredCertificate } from '@/lib/crypto/key-manager';
import { generateSelfSignedCertificate, type CertificateInfo } from '@/lib/crypto/certificate';
import { useAppStore } from '@/lib/store/app-store';
import { useAuthStore } from '@/lib/supabase/auth-store';
import { backupMnemonic, listBackups, restoreMnemonic, type BackupEntry } from '@/lib/supabase/mnemonic-backup';
import { PQCBundle } from '@/lib/pqc/pqc-bundle.js';
import { PQCKeystore } from '@/lib/pqc/pqc-keystore.js';
import { PQCShield } from '@/lib/pqc/pqc-shield.js';
import { PQCSigner } from '@/lib/pqc/pqc-signer.js';
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
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language?.startsWith('ko') ? 'ko-KR'
    : i18n.language?.startsWith('ja') ? 'ja-JP'
    : i18n.language?.startsWith('zh') ? 'zh-CN'
    : 'en-US';
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

  // 서버 백업 복구
  const [backupList, setBackupList] = useState<BackupEntry[]>([]);
  const [restoreMode, setRestoreMode] = useState<'manual' | 'server'>('manual');
  const [selectedBackupId, setSelectedBackupId] = useState('');
  const [restorePw, setRestorePw] = useState('');
  const [restoring, setRestoring] = useState(false);

  const { setKeyIdentity, setCertificate, setIdentities, setActiveIdentityId } = useAppStore();

  const handleProfileNext = () => {
    if (!identityName.trim()) { setError(t('mnemonicDialog.errIdentityName')); return; }
    if (!commonName.trim()) { setError(t('mnemonicDialog.errCommonName')); return; }
    if (!email.trim() || !email.includes('@')) { setError(t('mnemonicDialog.errEmail')); return; }
    setError('');
    if (mode === 'generate') {
      const result = generateNewMnemonic();
      setMnemonic(result.mnemonic);
      setStep('mnemonic-show');
    } else {
      // 로그인 상태면 서버 백업 목록 로드
      if (authUser) {
        listBackups(authUser.id).then(setBackupList).catch(() => {});
      }
      setStep('mnemonic-input');
    }
  };

  const handleMnemonicInputNext = () => {
    if (!isValidMnemonic(mnemonicInput)) { setError(t('mnemonicDialog.errInvalidMnemonic')); return; }
    setMnemonic(mnemonicInput.trim().toLowerCase());
    setError('');
    setStep('password');
  };

  const handleServerRestore = async () => {
    if (!authUser || !selectedBackupId || !restorePw) return;
    setRestoring(true);
    setError('');
    try {
      const recovered = await restoreMnemonic(restorePw, selectedBackupId, authUser.id);
      if (!isValidMnemonic(recovered)) {
        setError(t('mnemonicDialog.errRestoredInvalid'));
        return;
      }
      setMnemonic(recovered.trim().toLowerCase());
      toast.success(t('mnemonicDialog.toastRestoreOk'));
      setStep('password');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('mnemonicDialog.errRecoverFail'));
    } finally {
      setRestoring(false);
    }
  };

  const handleSaveKey = async () => {
    if (password.length < 8) { setError(t('mnemonicDialog.errPwLength')); return; }
    if (password !== passwordConfirm) { setError(t('mnemonicDialog.errPwMismatch')); return; }
    setLoadingMsg(t('mnemonicDialog.loadingDeriveKey'));
    setLoading(true); setError('');

    try {
      const { seed } = recoverFromMnemonic(mnemonic);
      const identity = await deriveKeyIdentity(seed);

      setLoadingMsg(t('mnemonicDialog.loadingCertGen'));
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
      setLoadingMsg(t('mnemonicDialog.loadingPqcGen'));
      let pqcCerts: { kem?: string; dsa?: string } | undefined;
      let pqcKeyId: string | undefined;
      try {
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
        toast.error(t('mnemonicDialog.toastPqcFail'));
      }

      // 인증서 저장
      setLoadingMsg(t('mnemonicDialog.loadingCertSave'));
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

      setLoadingMsg(t('mnemonicDialog.loadingKeyring'));
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
      setLoadingMsg(t('mnemonicDialog.loadingIdentityRefresh'));
      const { getAllIdentityMetas, getActiveIdentityId, setActiveIdentityId: sai } = await import('@/lib/crypto/key-manager');
      await sai(id);
      setActiveIdentityId(id);
      const metas = await getAllIdentityMetas();
      setIdentities(metas.map(m => ({
        id: m.id, name: m.name, commonName: m.commonName, email: m.email,
        signingFingerprint: m.signingFingerprint, encryptionFingerprint: m.encryptionFingerprint,
        createdAt: m.createdAt,
        category: m.category, isDefault: m.isDefault,
      })));
      console.log('[PKIZIP] 아이덴티티 갱신 완료');

      // 서버 백업 (opt-in, 로그인 시만)
      console.log('[PKIZIP] 백업 조건:', { backupEnabled, hasAuth: !!authUser, hasPw: !!backupPw });
      if (backupEnabled && authUser && backupPw) {
        setLoadingMsg(t('mnemonicDialog.loadingBackup'));
        console.log('[PKIZIP] 백업 시작...');
        if (backupPw !== backupPwConfirm) {
          toast.error(t('mnemonicDialog.toastBackupPwMismatch'));
        } else if (backupPw.length < 8) {
          toast.error(t('mnemonicDialog.toastBackupPwShort'));
        } else {
          try {
            console.log('[PKIZIP] backupMnemonic 호출...');
            await backupMnemonic(mnemonic, backupPw, id, backupHint || undefined, authUser.id);
            console.log('[PKIZIP] 백업 완료');
            toast.success(t('mnemonicDialog.toastBackupSaved'));
          } catch (backupErr) {
            console.error('[PKIZIP] 백업 에러:', backupErr);
            toast.error(t('mnemonicDialog.toastBackupFail', { msg: backupErr instanceof Error ? backupErr.message : t('mnemonicDialog.backupErr') }));
          }
        }
      }

      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('mnemonicDialog.errKeyGenFail'));
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setStep('profile'); setIdentityName(''); setCommonName(''); setEmail('');
    setMnemonic(''); setMnemonicInput(''); setPassword(''); setPasswordConfirm('');
    setError(''); setShowMnemonic(false); setCertInfo(null); setLoadingMsg('');
    setBackupEnabled(false); setBackupPw(''); setBackupPwConfirm(''); setBackupHint('');
    setLogotype(null); setCardColor('navy');
    setRestoreMode('manual'); setSelectedBackupId(''); setRestorePw(''); setBackupList([]);
    onOpenChange(false);
  };

  // 입력 도중 실수로 닫히는 사고 방지:
  //  - onOpenChange 는 새 open 상태(boolean) 를 받는다 — false 일 때만 닫는다.
  //    이전 코드는 `onOpenChange={handleClose}` 라 라이브러리가 어떤 이유로 (true) 를
  //    호출해도 다이얼로그가 그대로 닫혀버렸다.
  //  - mnemonic-show / password / mnemonic-input 단계는 outside click 으로 닫히면
  //    사용자가 작성한 패스워드·니모닉이 사라진다. 명시 액션(X 버튼·ESC·취소·완료) 으로만 닫게.
  const sensitiveStep = step === 'password' || step === 'mnemonic-show' || step === 'mnemonic-input';
  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-white rounded-2xl shadow-2xl w-[90vw] max-w-[480px] max-h-[85vh] overflow-y-auto p-6"
          onPointerDownOutside={(e) => { if (sensitiveStep) e.preventDefault(); }}
          onInteractOutside={(e) => { if (sensitiveStep) e.preventDefault(); }}
        >
          <Dialog.Close className="absolute top-4 right-4 text-zinc-400 hover:text-zinc-800">
            <X className="w-5 h-5" />
          </Dialog.Close>

          <div className="flex items-center gap-2 mb-1">
            <KeyRound className="w-5 h-5 text-[#175DDC]" />
            <Dialog.Title className="text-lg font-bold">
              {mode === 'generate' ? t('mnemonicDialog.titleGenerate') : t('mnemonicDialog.titleRecover')}
            </Dialog.Title>
          </div>
          <Dialog.Description className="text-sm text-zinc-500 mb-5">
            {mode === 'generate' ? t('mnemonicDialog.subGenerate') : t('mnemonicDialog.subRecover')}
          </Dialog.Description>

          <AnimatePresence mode="wait">
            {/* Profile */}
            {step === 'profile' && (
              <motion.div key="profile" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-3">
                <Field icon={<KeyRound className="w-3.5 h-3.5" />} label={t('mnemonicDialog.identityName')} value={identityName} onChange={setIdentityName} placeholder={t('mnemonicDialog.identityNamePh')} autoFocus />
                <Field icon={<User className="w-3.5 h-3.5" />} label={t('mnemonicDialog.cnLabel')} value={commonName} onChange={setCommonName} placeholder={t('mnemonicDialog.cnPh')} />
                <Field icon={<Mail className="w-3.5 h-3.5" />} label={t('mnemonicDialog.emailLabel')} value={email} onChange={setEmail} placeholder={t('mnemonicDialog.emailPh')} type="email" />

                {/* 로고타입 (선택) */}
                <div className="space-y-1.5">
                  <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-700">
                    <ShieldCheck className="w-3.5 h-3.5" /> {t('mnemonicDialog.logoLabel')} <span className="text-zinc-400">{t('mnemonicDialog.logoOptional')}</span>
                  </label>
                  <div className="flex items-center gap-3">
                    <div className="w-14 h-14 rounded-xl border border-zinc-200 bg-zinc-50 flex items-center justify-center overflow-hidden shrink-0">
                      {logotype ? (
                        <img src={logotype} alt="logo" className="max-w-full max-h-full object-contain" />
                      ) : (
                        <span className="text-[9px] text-zinc-400 text-center px-1">{t('mnemonicDialog.identiconBase')}</span>
                      )}
                    </div>
                    <button type="button" onClick={() => setShowLogoCrop(true)}
                      className="flex-1 text-xs border border-zinc-200 rounded-xl py-2.5 px-3 hover:bg-zinc-50 transition-colors text-zinc-600">
                      {logotype ? t('mnemonicDialog.logoChange') : t('mnemonicDialog.logoUpload')}
                    </button>
                    {logotype && (
                      <button type="button" onClick={() => setLogotype(null)}
                        className="text-xs text-zinc-400 hover:text-red-500 px-2">
                        {t('mnemonicDialog.logoRemove')}
                      </button>
                    )}
                  </div>
                  <p className="text-[10px] text-zinc-400">{t('mnemonicDialog.logoFallback')}</p>
                </div>

                {error && <p className="text-sm text-red-500">{error}</p>}
                <div className="flex justify-end pt-2">
                  <Btn onClick={handleProfileNext}>{t('mnemonicDialog.next')} <ChevronRight className="w-4 h-4" /></Btn>
                </div>
              </motion.div>
            )}

            {/* Mnemonic Input (recover) */}
            {step === 'mnemonic-input' && (
              <motion.div key="mninput" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-3">
                {/* 탭: 직접 입력 / 서버 백업 */}
                {authUser && backupList.length > 0 && (
                  <div className="flex gap-1 bg-zinc-100 rounded-lg p-0.5 mb-2">
                    <button onClick={() => setRestoreMode('manual')}
                      className={`flex-1 text-xs py-1.5 rounded-md font-medium transition-colors ${restoreMode === 'manual' ? 'bg-white shadow text-zinc-800' : 'text-zinc-500'}`}>
                      {t('mnemonicDialog.tabManual')}
                    </button>
                    <button onClick={() => setRestoreMode('server')}
                      className={`flex-1 text-xs py-1.5 rounded-md font-medium transition-colors ${restoreMode === 'server' ? 'bg-white shadow text-zinc-800' : 'text-zinc-500'}`}>
                      {t('mnemonicDialog.tabServerBackup', { n: backupList.length })}
                    </button>
                  </div>
                )}

                {restoreMode === 'manual' ? (
                  <>
                    <label className="text-xs font-medium text-zinc-700">{t('mnemonicDialog.mnemonic12Label')}</label>
                    <textarea value={mnemonicInput} onChange={e => { setMnemonicInput(e.target.value); setError(''); }} rows={3} placeholder={t('mnemonicDialog.mnemonicPh')}
                      className="w-full border border-zinc-200 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#175DDC] resize-none" autoFocus />
                  </>
                ) : (
                  <>
                    <label className="text-xs font-medium text-zinc-700">{t('mnemonicDialog.backupSelect')}</label>
                    <div className="space-y-1.5">
                      {backupList.map(b => (
                        <button key={b.identity_id} onClick={() => setSelectedBackupId(b.identity_id)}
                          className={`w-full text-left rounded-lg px-3 py-2.5 border-2 transition-all ${
                            selectedBackupId === b.identity_id ? 'border-[#175DDC] bg-[#175DDC]/5' : 'border-zinc-100 hover:border-zinc-300'
                          }`}>
                          <div className="text-xs font-medium">{b.hint || b.identity_id.slice(0, 8)}</div>
                          <div className="text-[10px] text-zinc-400">{new Date(b.updated_at).toLocaleDateString(dateLocale)}</div>
                        </button>
                      ))}
                    </div>
                    {selectedBackupId && (
                      <input type="password" value={restorePw} onChange={e => setRestorePw(e.target.value)}
                        placeholder={t('mnemonicDialog.backupPwPh')}
                        className="w-full border border-zinc-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#175DDC]"
                        onKeyDown={e => e.key === 'Enter' && handleServerRestore()} />
                    )}
                  </>
                )}

                {error && <p className="text-sm text-red-500">{error}</p>}
                <div className="flex justify-between pt-2">
                  <BtnGhost onClick={() => setStep('profile')}>{t('mnemonicDialog.prev')}</BtnGhost>
                  {restoreMode === 'manual' ? (
                    <Btn onClick={handleMnemonicInputNext}>{t('mnemonicDialog.next')} <ChevronRight className="w-4 h-4" /></Btn>
                  ) : (
                    <Btn onClick={handleServerRestore} disabled={restoring || !selectedBackupId || !restorePw}>
                      {restoring ? t('mnemonicDialog.restoring') : t('mnemonicDialog.restoreFromBackup')}
                    </Btn>
                  )}
                </div>
              </motion.div>
            )}

            {/* Mnemonic Show (generate) */}
            {step === 'mnemonic-show' && (
              <motion.div key="mnshow" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
                <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-medium">{t('mnemonicDialog.mnemonic12Show')}</span>
                    <div className="flex gap-1">
                      <button onClick={() => setShowMnemonic(!showMnemonic)} className="p-1.5 rounded-lg hover:bg-zinc-200">
                        {showMnemonic ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                      <button onClick={() => { navigator.clipboard.writeText(mnemonic); toast.success(t('mnemonicDialog.toastCopied')); }} className="p-1.5 rounded-lg hover:bg-zinc-200">
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
                    <div className="text-center py-8 text-zinc-400 text-sm">{t('mnemonicDialog.eyeHint')}</div>
                  )}
                </div>
                <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-700">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{t('mnemonicDialog.dangerNote')}</span>
                </div>
                <div className="flex justify-end pt-2">
                  <Btn onClick={() => setStep('password')} disabled={!showMnemonic}>{t('mnemonicDialog.savedSafelyBtn')}</Btn>
                </div>
              </motion.div>
            )}

            {/* Password + Backup Option */}
            {step === 'password' && (
              <motion.div key="pw" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-3">
                <p className="text-sm text-zinc-500">{t('mnemonicDialog.pwHint')}</p>
                <input type="password" value={password} onChange={e => { setPassword(e.target.value); setError(''); }} placeholder={t('mnemonicDialog.pwPh')}
                  className="w-full border border-zinc-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#175DDC]" autoFocus />
                <input type="password" value={passwordConfirm} onChange={e => { setPasswordConfirm(e.target.value); setError(''); }} placeholder={t('mnemonicDialog.pwConfirmPh')}
                  className="w-full border border-zinc-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#175DDC]"
                  onKeyDown={e => e.key === 'Enter' && handleSaveKey()} />

                {/* 서버 백업 옵션 */}
                <div className="border-t border-zinc-100 pt-3 mt-2">
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <input type="checkbox" checked={backupEnabled} onChange={e => setBackupEnabled(e.target.value !== '' && e.target.checked)}
                      disabled={!authUser} className="rounded border-zinc-300 accent-[#175DDC]" />
                    <span className={authUser ? 'text-zinc-700' : 'text-zinc-400'}>{t('mnemonicDialog.serverBackupOpt')}</span>
                  </label>
                  {!authUser && <p className="text-[10px] text-zinc-400 mt-1 ml-5">{t('mnemonicDialog.loginRequired')}</p>}

                  {backupEnabled && authUser && (
                    <div className="mt-2 space-y-2 pl-5">
                      <input type="password" value={backupPw} onChange={e => setBackupPw(e.target.value)} placeholder={t('mnemonicDialog.backupPw1Ph')}
                        className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#175DDC]" />
                      <input type="password" value={backupPwConfirm} onChange={e => setBackupPwConfirm(e.target.value)} placeholder={t('mnemonicDialog.backupPw2Ph')}
                        className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#175DDC]" />
                      <input type="text" value={backupHint} onChange={e => setBackupHint(e.target.value)} placeholder={t('mnemonicDialog.backupHintPh')}
                        className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#175DDC]" />
                      <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-[10px] text-amber-700">
                        {t('mnemonicDialog.backupWarn')}
                      </div>
                    </div>
                  )}
                </div>

                {error && <p className="text-sm text-red-500">{error}</p>}
                <div className="flex justify-end pt-2">
                  <Btn onClick={handleSaveKey} disabled={loading}>{loading ? (loadingMsg || t('mnemonicDialog.generating')) : t('mnemonicDialog.saveBtn')}</Btn>
                </div>
              </motion.div>
            )}

            {/* Done */}
            {step === 'done' && certInfo && (
              <motion.div key="done" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="text-center space-y-4">
                <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto">
                  <ShieldCheck className="w-8 h-8 text-green-600" />
                </div>
                <h3 className="text-lg font-bold">{t('mnemonicDialog.doneTitle')}</h3>

                <div className="flex justify-center">
                  <Identicon value={fingerprint} size={64} className="rounded-2xl overflow-hidden" />
                </div>

                <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4 text-sm space-y-1.5 text-left">
                  <div className="flex justify-between"><span className="text-zinc-500">{t('mnemonicDialog.doneName')}</span><span className="font-medium">{certInfo.commonName}</span></div>
                  <div className="flex justify-between"><span className="text-zinc-500">{t('mnemonicDialog.doneEmail')}</span><span>{certInfo.email}</span></div>
                  <div className="flex justify-between"><span className="text-zinc-500">{t('mnemonicDialog.doneFp')}</span><code className="text-xs font-mono">0x{fingerprint}</code></div>
                  <div className="flex justify-between"><span className="text-zinc-500">{t('mnemonicDialog.doneValidity')}</span><span className="text-xs">{certInfo.notBefore.toLocaleDateString(dateLocale)} ~ {certInfo.notAfter.toLocaleDateString(dateLocale)}</span></div>
                </div>

                <Btn onClick={handleClose}>{t('mnemonicDialog.confirm')}</Btn>
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
            <Dialog.Title className="text-lg font-bold mb-1">{t('mnemonicDialog.logoCropTitle')}</Dialog.Title>
            <Dialog.Description className="text-sm text-zinc-500 mb-4">
              {t('mnemonicDialog.logoCropSub')}
            </Dialog.Description>
            <LogoCrop
              onCropComplete={(dataUrl) => setLogotype(dataUrl)}
              cardColor={cardColor as any}
              onCardColorChange={setCardColor}
              previewName={commonName || undefined}
              previewEmail={email || undefined}
            />
            <div className="flex justify-end mt-4 pt-4 border-t border-zinc-100">
              <Btn onClick={() => setShowLogoCrop(false)}>{t('mnemonicDialog.complete')}</Btn>
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
