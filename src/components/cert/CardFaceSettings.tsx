/**
 * CardFaceSettings — 인증서 카드 뒷면 2 (면 2)
 * 생체/PIN/삭제 + PQC 번들 생성
 */
import { useState } from 'react';
import { Key, Fingerprint, Download, Trash2, Shield } from 'lucide-react';
import { toast } from 'sonner';

interface CardFaceSettingsProps {
  identityId: string;
  identityName: string;
  signingFingerprint: string;
  isActive: boolean;
  biometricSupported: boolean;
  hasBiometric: boolean;
  hasPin: boolean;
  pqcEnabled: boolean;
  hasPqcBundle: boolean;
  onRegisterBiometric: (pw: string) => void;
  onRemoveBiometric: () => void;
  onRegisterPin: (pw: string, pin: string) => void;
  onRemovePin: () => void;
  onUnlock: (pw: string) => void;
  onExportCert: () => void;
  onDelete: () => void;
  onPqcBundleCreated: () => void;
}

export function CardFaceSettings({
  identityId,
  identityName,
  signingFingerprint,
  isActive,
  biometricSupported,
  hasBiometric,
  hasPin,
  pqcEnabled,
  hasPqcBundle,
  onRegisterBiometric,
  onRemoveBiometric,
  onRegisterPin,
  onRemovePin,
  onUnlock,
  onExportCert,
  onDelete,
  onPqcBundleCreated,
}: CardFaceSettingsProps) {
  const [unlockPw, setUnlockPw] = useState('');
  const [showUnlock, setShowUnlock] = useState(false);
  const [bioRegPw, setBioRegPw] = useState('');
  const [showBioReg, setShowBioReg] = useState(false);
  const [bioRegistering, setBioRegistering] = useState(false);
  const [pinRegPw, setPinRegPw] = useState('');
  const [pinValue, setPinValue] = useState('');
  const [showPinReg, setShowPinReg] = useState(false);
  const [pinRegistering, setPinRegistering] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  // PQC 번들 생성
  const [showPqcForm, setShowPqcForm] = useState(false);
  const [pqcMnemonic, setPqcMnemonic] = useState('');
  const [pqcPassword, setPqcPassword] = useState('');
  const [pqcCreating, setPqcCreating] = useState(false);

  const handleBioSubmit = async () => {
    setBioRegistering(true);
    try { await onRegisterBiometric(bioRegPw); setShowBioReg(false); setBioRegPw(''); }
    finally { setBioRegistering(false); }
  };

  const handlePinSubmit = async () => {
    setPinRegistering(true);
    try { await onRegisterPin(pinRegPw, pinValue); setShowPinReg(false); setPinRegPw(''); setPinValue(''); }
    finally { setPinRegistering(false); }
  };

  const handleCreatePqcBundle = async () => {
    const words = pqcMnemonic.trim().toLowerCase().split(/\s+/);
    if (words.length !== 12) { toast.error('니모닉은 12단어'); return; }
    if (pqcPassword.length < 8) { toast.error('비밀번호 8자 이상'); return; }
    setPqcCreating(true);
    try {
      const { PQCBundle } = await import('@/lib/pqc/pqc-bundle.js');
      const { PQCKeystore } = await import('@/lib/pqc/pqc-keystore.js');
      const bundle = await PQCBundle.create({
        mnemonic: pqcMnemonic.trim().toLowerCase(),
        password: pqcPassword,
        subject: { name: identityName, email: '' },
        mode: 'full',
      });
      await PQCKeystore.save(bundle, pqcPassword, 'default');
      const verify = await PQCKeystore.getInfo('default');
      if (verify?.certificates) {
        toast.success('PQC 번들 생성 완료 (ML-KEM + ML-DSA + secp256k1)');
        setShowPqcForm(false);
        setPqcMnemonic(''); setPqcPassword('');
        onPqcBundleCreated();
      } else {
        toast.error('PQC 번들 저장 실패');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'PQC 번들 생성 실패');
      console.error('[PKIZIP] PQC 번들 수동 생성 실패:', err);
    } finally {
      setPqcCreating(false);
    }
  };

  return (
    <div className="bg-white px-5 py-4 h-full flex flex-col">
      <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
        <Key className="w-3.5 h-3.5" /> 잠금 해제 방법
      </h3>

      {/* 잠금 해제 */}
      {!isActive && (
        <div className="mb-3">
          {showUnlock ? (
            <div className="flex gap-2 items-center">
              <input type="password" value={unlockPw} onChange={e => setUnlockPw(e.target.value)} placeholder="비밀번호"
                className="flex-1 border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1DC078]"
                autoFocus onKeyDown={e => { if (e.key === 'Enter') { onUnlock(unlockPw); setUnlockPw(''); setShowUnlock(false); } }} />
              <button onClick={() => { onUnlock(unlockPw); setUnlockPw(''); setShowUnlock(false); }} className="bg-zinc-900 text-white text-xs px-3 py-2 rounded-lg">확인</button>
              <button onClick={() => { setShowUnlock(false); setUnlockPw(''); }} className="text-xs text-zinc-400">취소</button>
            </div>
          ) : (
            <button onClick={() => setShowUnlock(true)}
              className="w-full flex items-center justify-center gap-1.5 text-xs text-zinc-600 hover:text-[#1DC078] border border-zinc-200 rounded-lg px-3 py-2 transition-colors">
              <Key className="w-3.5 h-3.5" /> 잠금 해제
            </button>
          )}
        </div>
      )}

      {/* 생체 인증 */}
      <div className="py-2 border-t border-zinc-100">
        {!biometricSupported ? (
          <p className="text-[10px] text-zinc-400 flex items-center gap-1">
            <Fingerprint className="w-3 h-3" /> 이 브라우저는 생체 인증을 지원하지 않습니다
          </p>
        ) : showBioReg ? (
          <div className="space-y-2">
            <p className="text-[10px] text-zinc-600">키 비밀번호를 입력하면 생체 인증을 등록합니다.</p>
            <div className="flex gap-2 items-center">
              <input type="password" value={bioRegPw} onChange={e => setBioRegPw(e.target.value)} placeholder="키 비밀번호"
                className="flex-1 border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1DC078]"
                autoFocus onKeyDown={e => e.key === 'Enter' && handleBioSubmit()} />
              <button onClick={handleBioSubmit} disabled={bioRegistering} className="bg-zinc-900 text-white text-xs px-3 py-2 rounded-lg disabled:opacity-50">
                {bioRegistering ? '...' : '등록'}
              </button>
              <button onClick={() => { setShowBioReg(false); setBioRegPw(''); }} className="text-xs text-zinc-400">취소</button>
            </div>
          </div>
        ) : hasBiometric ? (
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs text-[#1DC078] font-medium"><Fingerprint className="w-3.5 h-3.5" /> 생체 인증 활성</span>
            <button onClick={onRemoveBiometric} className="text-[10px] text-zinc-400 hover:text-red-500">해제</button>
          </div>
        ) : (
          <button onClick={() => setShowBioReg(true)} className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-[#1DC078] transition-colors">
            <Fingerprint className="w-3.5 h-3.5" /> 생체 인증 등록 (Touch ID, 지문, Face ID 등)
          </button>
        )}
      </div>

      {/* PIN */}
      <div className="py-2 border-t border-zinc-50">
        {showPinReg ? (
          <div className="space-y-2">
            <p className="text-[10px] text-zinc-600">키 비밀번호 + 새 PIN(4~6자리)을 입력하세요.</p>
            <div className="flex flex-col gap-2">
              <input type="password" value={pinRegPw} onChange={e => setPinRegPw(e.target.value)} placeholder="키 비밀번호"
                className="border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1DC078]" autoFocus />
              <div className="flex gap-2">
                <input type="password" inputMode="numeric" pattern="[0-9]*" maxLength={6} value={pinValue}
                  onChange={e => setPinValue(e.target.value.replace(/\D/g, ''))} placeholder="PIN (4~6자리)"
                  className="flex-1 border border-zinc-200 rounded-lg px-3 py-2 text-sm font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-[#1DC078]"
                  onKeyDown={e => e.key === 'Enter' && handlePinSubmit()} />
                <button onClick={handlePinSubmit} disabled={pinRegistering} className="bg-zinc-900 text-white text-xs px-3 py-2 rounded-lg disabled:opacity-50">
                  {pinRegistering ? '...' : '등록'}
                </button>
                <button onClick={() => { setShowPinReg(false); setPinRegPw(''); setPinValue(''); }} className="text-xs text-zinc-400">취소</button>
              </div>
            </div>
          </div>
        ) : hasPin ? (
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs text-[#1DC078] font-medium"><Key className="w-3.5 h-3.5" /> PIN 활성</span>
            <button onClick={onRemovePin} className="text-[10px] text-zinc-400 hover:text-red-500">해제</button>
          </div>
        ) : (
          <button onClick={() => setShowPinReg(true)} className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-[#1DC078] transition-colors">
            <Key className="w-3.5 h-3.5" /> PIN 등록 (4~6자리 빠른 잠금 해제)
          </button>
        )}
      </div>

      {/* PQC 번들 생성 (활성인데 번들 없을 때) */}
      {pqcEnabled && !hasPqcBundle && (
        <div className="py-2 border-t border-zinc-100">
          {showPqcForm ? (
            <div className="space-y-2">
              <p className="text-[10px] text-zinc-600">니모닉 12단어 + 키 비밀번호를 입력하면 PQC 번들을 생성합니다.</p>
              <textarea
                value={pqcMnemonic} onChange={e => setPqcMnemonic(e.target.value)}
                placeholder="12단어 니모닉 (공백 구분)"
                rows={2}
                className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-400 resize-none"
              />
              <div className="flex gap-2">
                <input type="password" value={pqcPassword} onChange={e => setPqcPassword(e.target.value)} placeholder="키 비밀번호"
                  className="flex-1 border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
                  onKeyDown={e => e.key === 'Enter' && handleCreatePqcBundle()} />
                <button onClick={handleCreatePqcBundle} disabled={pqcCreating}
                  className="bg-violet-600 text-white text-xs px-3 py-2 rounded-lg disabled:opacity-50">
                  {pqcCreating ? '생성 중...' : 'PQC 생성'}
                </button>
                <button onClick={() => { setShowPqcForm(false); setPqcMnemonic(''); setPqcPassword(''); }} className="text-xs text-zinc-400">취소</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setShowPqcForm(true)}
              className="flex items-center gap-1.5 text-xs text-violet-600 hover:text-violet-800 transition-colors">
              <Shield className="w-3.5 h-3.5" /> PQC 번들 생성 (ML-KEM + ML-DSA)
            </button>
          )}
        </div>
      )}

      {/* PQC 번들 있음 표시 */}
      {pqcEnabled && hasPqcBundle && (
        <div className="py-2 border-t border-zinc-100">
          <span className="flex items-center gap-1.5 text-xs text-violet-600 font-medium">
            <Shield className="w-3.5 h-3.5" /> PQC 번들 활성 (ML-KEM + ML-DSA)
          </span>
        </div>
      )}

      {/* 하단 액션 */}
      <div className="flex gap-2 pt-3 mt-auto border-t border-zinc-200">
        <button onClick={onExportCert}
          className="flex-1 flex items-center justify-center gap-1.5 text-xs border border-zinc-200 rounded-xl py-2 text-zinc-600 hover:bg-zinc-50 transition-colors">
          <Download className="w-3 h-3" /> 인증서 다운로드
        </button>
        {deleteConfirm ? (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
            <span className="text-[11px] text-red-600 flex-1 whitespace-nowrap">니모닉 없이 복구 불가!</span>
            <button onClick={onDelete} className="text-[11px] text-white bg-red-500 hover:bg-red-600 rounded-md px-3 py-1 font-medium">삭제</button>
            <button onClick={() => setDeleteConfirm(false)} className="text-[11px] text-zinc-600 bg-zinc-200 hover:bg-zinc-300 rounded-md px-3 py-1">취소</button>
          </div>
        ) : (
          <button onClick={() => setDeleteConfirm(true)}
            className="flex items-center justify-center gap-1.5 text-xs border border-zinc-200 rounded-xl py-2 px-4 text-zinc-400 hover:text-red-500 hover:border-red-200 transition-colors">
            <Trash2 className="w-3 h-3" /> 삭제
          </button>
        )}
      </div>
    </div>
  );
}
