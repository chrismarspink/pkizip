import { useState, useEffect, useCallback } from 'react';
import { KeyRound, Plus, Import, ShieldCheck, Lock, Trash2, Hash, User, Mail, Download, Key, Fingerprint } from 'lucide-react';
import { MnemonicDialog } from '@/components/dialogs/MnemonicDialog';
import { toast } from 'sonner';
import { useAppStore } from '@/lib/store/app-store';
import {
  getAllIdentityMetas, getActiveIdentityId, loadIdentitySeed,
  deleteIdentity, setActiveIdentityId, getCertificate,
  type EncryptedIdentity,
} from '@/lib/crypto/key-manager';
import { deriveKeyIdentity } from '@/lib/crypto/hd-key';
import {
  isPlatformAuthenticatorAvailable, registerBiometric,
  hasBiometric, removeBiometric,
} from '@/lib/crypto/biometric';
import {
  registerPin, hasPin, removePin,
} from '@/lib/crypto/pin';

export function SettingsPage() {
  const { setKeyIdentity, setActiveIdentityId: storeSetActive, setIdentities, activeIdentityId, isKeyLoaded } = useAppStore();
  const [metas, setMetas] = useState<EncryptedIdentity[]>([]);
  const [unlockId, setUnlockId] = useState<string | null>(null);
  const [unlockPw, setUnlockPw] = useState('');
  const [mnemonicDialog, setMnemonicDialog] = useState<'generate' | 'recover' | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [biometricSupported, setBiometricSupported] = useState(false);
  const [biometricMap, setBiometricMap] = useState<Record<string, boolean>>({});
  const [bioRegisterId, setBioRegisterId] = useState<string | null>(null);
  const [bioRegisterPw, setBioRegisterPw] = useState('');
  const [bioRegistering, setBioRegistering] = useState(false);

  // PIN 상태
  const [pinMap, setPinMap] = useState<Record<string, boolean>>({});
  const [pinRegisterId, setPinRegisterId] = useState<string | null>(null);
  const [pinRegisterPw, setPinRegisterPw] = useState('');
  const [pinValue, setPinValue] = useState('');
  const [pinRegistering, setPinRegistering] = useState(false);

  useEffect(() => {
    isPlatformAuthenticatorAvailable().then(setBiometricSupported);
    load();
  }, []);

  // 각 아이덴티티의 biometric/PIN 등록 여부 조회
  useEffect(() => {
    (async () => {
      const bioMap: Record<string, boolean> = {};
      const pinReady: Record<string, boolean> = {};
      for (const m of metas) {
        bioMap[m.id] = await hasBiometric(m.id);
        pinReady[m.id] = await hasPin(m.id);
      }
      setBiometricMap(bioMap);
      setPinMap(pinReady);
    })();
  }, [metas]);

  // PIN 등록
  const handleRegisterPin = useCallback(async (id: string, keyPw: string, pin: string) => {
    if (!/^\d{4,6}$/.test(pin)) { toast.error('PIN은 4~6자리 숫자'); return; }
    setPinRegistering(true);
    try {
      const seed = await loadIdentitySeed(id, keyPw);
      await registerPin(id, seed, pin);
      setPinMap(prev => ({ ...prev, [id]: true }));
      setPinRegisterId(null);
      setPinRegisterPw('');
      setPinValue('');
      toast.success('PIN 등록 완료');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'PIN 등록 실패');
    } finally {
      setPinRegistering(false);
    }
  }, []);

  const handleRemovePin = useCallback(async (id: string) => {
    await removePin(id);
    setPinMap(prev => ({ ...prev, [id]: false }));
    toast.success('PIN 해제 완료');
  }, []);

  async function load() {
    const all = await getAllIdentityMetas();
    setMetas(all);
    const activeId = await getActiveIdentityId();
    storeSetActive(activeId);
    setIdentities(all.map(m => ({
      id: m.id, name: m.name, commonName: m.commonName, email: m.email,
      signingFingerprint: m.signingFingerprint, encryptionFingerprint: m.encryptionFingerprint,
      createdAt: m.createdAt,
    })));
  }

  const handleActivate = useCallback(async (id: string, pw: string) => {
    try {
      const seed = await loadIdentitySeed(id, pw);
      const identity = await deriveKeyIdentity(seed);
      setKeyIdentity(identity);
      await setActiveIdentityId(id);
      storeSetActive(id);
      setUnlockId(null); setUnlockPw('');
      toast.success('키 활성화 완료');
    } catch {
      toast.error('비밀번호가 틀렸습니다.');
    }
  }, [setKeyIdentity, storeSetActive]);

  const handleDelete = useCallback(async (id: string) => {
    await deleteIdentity(id);
    if (activeIdentityId === id) { setKeyIdentity(null); storeSetActive(null); }
    setDeleteConfirm(null);
    await load();
    toast.success('삭제 완료');
  }, [activeIdentityId, setKeyIdentity, storeSetActive]);

  const handleExportCert = useCallback(async (fp: string) => {
    const cert = await getCertificate(fp);
    if (!cert) return;
    const blob = new Blob([cert.pemCertificate], { type: 'application/x-pem-file' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${cert.commonName}_cert.pem`;
    a.click();
  }, []);

  // 생체 인증 등록
  const handleRegisterBio = useCallback(async (id: string, name: string, pw: string) => {
    setBioRegistering(true);
    try {
      const seed = await loadIdentitySeed(id, pw);
      await registerBiometric(id, name, seed);
      setBiometricMap(prev => ({ ...prev, [id]: true }));
      setBioRegisterId(null);
      setBioRegisterPw('');
      toast.success('생체 인증 등록 완료');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '생체 인증 등록 실패');
    } finally {
      setBioRegistering(false);
    }
  }, []);

  // 생체 인증 해제
  const handleRemoveBio = useCallback(async (id: string) => {
    await removeBiometric(id);
    setBiometricMap(prev => ({ ...prev, [id]: false }));
    toast.success('생체 인증이 해제되었습니다.');
  }, []);

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 lg:py-10">
      <h1 className="text-xl font-bold mb-6">설정</h1>

      {/* 아이덴티티 목록 */}
      <h2 className="text-sm font-bold text-zinc-500 uppercase tracking-wider mb-3">내 아이덴티티</h2>

      {metas.length === 0 ? (
        <div className="text-center py-12 text-zinc-400">
          <KeyRound className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>등록된 아이덴티티가 없습니다</p>
        </div>
      ) : (
        <div className="space-y-3 mb-6">
          {metas.map(m => {
            const isActive = m.id === activeIdentityId && isKeyLoaded;
            return (
              <div key={m.id} className={`rounded-xl border-2 p-4 transition-colors ${
                isActive ? 'border-[#1DC078] bg-[#1DC078]/5' : 'border-zinc-100'
              }`}>
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {isActive ? <ShieldCheck className="w-5 h-5 text-[#1DC078]" /> : <Lock className="w-5 h-5 text-zinc-400" />}
                    <div>
                      <div className="font-medium text-sm">{m.name}</div>
                      <div className="text-xs text-zinc-500 flex items-center gap-1">
                        <User className="w-3 h-3" />{m.commonName} · <Mail className="w-3 h-3" />{m.email}
                      </div>
                    </div>
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${isActive ? 'bg-[#1DC078] text-white' : 'bg-zinc-100 text-zinc-500'}`}>
                    {isActive ? '활성' : '잠김'}
                  </span>
                </div>

                <div className="text-[10px] font-mono text-zinc-400 mb-3 flex items-center gap-1">
                  <Hash className="w-3 h-3" /> 0x{m.signingFingerprint}
                </div>

                {/* 잠금 해제 */}
                {!isActive && unlockId === m.id ? (
                  <div className="flex gap-2 items-center">
                    <input type="password" value={unlockPw} onChange={e => setUnlockPw(e.target.value)} placeholder="비밀번호"
                      className="flex-1 border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1DC078]"
                      autoFocus onKeyDown={e => e.key === 'Enter' && handleActivate(m.id, unlockPw)} />
                    <button onClick={() => handleActivate(m.id, unlockPw)} className="bg-zinc-900 text-white text-xs px-3 py-2 rounded-lg">확인</button>
                    <button onClick={() => { setUnlockId(null); setUnlockPw(''); }} className="text-xs text-zinc-400">취소</button>
                  </div>
                ) : (
                  <div className="flex gap-2 flex-wrap">
                    {!isActive && (
                      <button onClick={() => setUnlockId(m.id)} className="flex items-center gap-1 text-xs text-zinc-600 hover:text-[#1DC078] border border-zinc-200 rounded-lg px-3 py-1.5">
                        <Key className="w-3 h-3" /> 잠금 해제
                      </button>
                    )}
                    {isActive && (
                      <button onClick={() => handleExportCert(m.signingFingerprint)} className="flex items-center gap-1 text-xs text-zinc-600 hover:text-[#1DC078] border border-zinc-200 rounded-lg px-3 py-1.5">
                        <Download className="w-3 h-3" /> 인증서
                      </button>
                    )}
                    {deleteConfirm === m.id ? (
                      <div className="flex items-center gap-2 bg-red-50 rounded-lg px-3 py-1.5">
                        <span className="text-[10px] text-red-600">니모닉 없이 복구 불가!</span>
                        <button onClick={() => handleDelete(m.id)} className="text-[10px] text-red-600 font-bold">삭제</button>
                        <button onClick={() => setDeleteConfirm(null)} className="text-[10px] text-zinc-400">취소</button>
                      </div>
                    ) : (
                      <button onClick={() => setDeleteConfirm(m.id)} className="flex items-center gap-1 text-xs text-zinc-400 hover:text-red-500 border border-zinc-100 rounded-lg px-3 py-1.5">
                        <Trash2 className="w-3 h-3" /> 삭제
                      </button>
                    )}
                  </div>
                )}

                {/* 생체 인증 토글 */}
                <div className="mt-3 pt-3 border-t border-zinc-100">
                  {!biometricSupported ? (
                    <p className="text-[10px] text-zinc-400 flex items-center gap-1">
                      <Fingerprint className="w-3 h-3" /> 이 기기는 생체 인증을 지원하지 않습니다.
                    </p>
                  ) : bioRegisterId === m.id ? (
                    <div className="space-y-2">
                      <p className="text-[10px] text-zinc-600">키 비밀번호를 입력하면 생체 인증을 등록합니다.</p>
                      <div className="flex gap-2 items-center">
                        <input type="password" value={bioRegisterPw} onChange={e => setBioRegisterPw(e.target.value)} placeholder="키 비밀번호"
                          className="flex-1 border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1DC078]"
                          autoFocus onKeyDown={e => e.key === 'Enter' && handleRegisterBio(m.id, m.name, bioRegisterPw)} />
                        <button onClick={() => handleRegisterBio(m.id, m.name, bioRegisterPw)}
                          disabled={bioRegistering}
                          className="bg-zinc-900 text-white text-xs px-3 py-2 rounded-lg disabled:opacity-50">
                          {bioRegistering ? '...' : '등록'}
                        </button>
                        <button onClick={() => { setBioRegisterId(null); setBioRegisterPw(''); }} className="text-xs text-zinc-400">취소</button>
                      </div>
                    </div>
                  ) : biometricMap[m.id] ? (
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-xs text-[#1DC078] font-medium">
                        <Fingerprint className="w-3.5 h-3.5" /> 생체 인증 활성
                      </span>
                      <button onClick={() => handleRemoveBio(m.id)}
                        className="text-[10px] text-zinc-400 hover:text-red-500">해제</button>
                    </div>
                  ) : (
                    <button onClick={() => setBioRegisterId(m.id)}
                      className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-[#1DC078] transition-colors">
                      <Fingerprint className="w-3.5 h-3.5" /> 생체 인증 등록 (Touch ID, 지문, Face ID 등)
                    </button>
                  )}
                </div>

                {/* PIN 빠른 잠금 해제 */}
                <div className="mt-2 pt-2 border-t border-zinc-50">
                  {pinRegisterId === m.id ? (
                    <div className="space-y-2">
                      <p className="text-[10px] text-zinc-600">키 비밀번호 + 새 PIN(4~6자리)을 입력하세요.</p>
                      <div className="flex flex-col gap-2">
                        <input type="password" value={pinRegisterPw} onChange={e => setPinRegisterPw(e.target.value)} placeholder="키 비밀번호"
                          className="border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1DC078]"
                          autoFocus />
                        <div className="flex gap-2">
                          <input type="password" inputMode="numeric" pattern="[0-9]*" maxLength={6} value={pinValue}
                            onChange={e => setPinValue(e.target.value.replace(/\D/g, ''))}
                            placeholder="PIN (4~6자리)"
                            className="flex-1 border border-zinc-200 rounded-lg px-3 py-2 text-sm font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-[#1DC078]"
                            onKeyDown={e => e.key === 'Enter' && handleRegisterPin(m.id, pinRegisterPw, pinValue)} />
                          <button onClick={() => handleRegisterPin(m.id, pinRegisterPw, pinValue)}
                            disabled={pinRegistering}
                            className="bg-zinc-900 text-white text-xs px-3 py-2 rounded-lg disabled:opacity-50">
                            {pinRegistering ? '...' : '등록'}
                          </button>
                          <button onClick={() => { setPinRegisterId(null); setPinRegisterPw(''); setPinValue(''); }} className="text-xs text-zinc-400">취소</button>
                        </div>
                      </div>
                    </div>
                  ) : pinMap[m.id] ? (
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-xs text-[#1DC078] font-medium">
                        <Key className="w-3.5 h-3.5" /> PIN 활성
                      </span>
                      <button onClick={() => handleRemovePin(m.id)}
                        className="text-[10px] text-zinc-400 hover:text-red-500">해제</button>
                    </div>
                  ) : (
                    <button onClick={() => setPinRegisterId(m.id)}
                      className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-[#1DC078] transition-colors">
                      <Key className="w-3.5 h-3.5" /> PIN 등록 (4~6자리 빠른 잠금 해제)
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 추가 버튼 */}
      <div className="flex gap-3">
        <button onClick={() => setMnemonicDialog('generate')} className="flex-1 flex items-center justify-center gap-2 border-2 border-dashed border-zinc-200 rounded-xl py-3 text-sm text-zinc-500 hover:border-[#1DC078] hover:text-[#1DC078] transition-colors">
          <Plus className="w-4 h-4" /> 새 니모닉 생성
        </button>
        <button onClick={() => setMnemonicDialog('recover')} className="flex-1 flex items-center justify-center gap-2 border-2 border-dashed border-zinc-200 rounded-xl py-3 text-sm text-zinc-500 hover:border-[#1DC078] hover:text-[#1DC078] transition-colors">
          <Import className="w-4 h-4" /> 기존 니모닉 복구
        </button>
      </div>

      {/* 니모닉 다이얼로그 */}
      <MnemonicDialog
        open={mnemonicDialog === 'generate'}
        onOpenChange={(open) => { if (!open) { setMnemonicDialog(null); load(); } }}
        mode="generate"
      />
      <MnemonicDialog
        open={mnemonicDialog === 'recover'}
        onOpenChange={(open) => { if (!open) { setMnemonicDialog(null); load(); } }}
        mode="recover"
      />
    </div>
  );
}
