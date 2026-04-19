/**
 * CertsPage — 인증서 월렛 + 아이덴티티 관리 통합 페이지
 *
 * 기존 CertsPage(인증서 카드)와 SettingsPage(아이덴티티 섹션)를 통합.
 * 각 인증서 카드는 3면 (앞면/상세/설정)으로 스와이프 전환.
 */
import { useState, useEffect, useCallback } from 'react';
import { CertWallet } from '@/components/cert/CertWallet';
import { Identicon } from '@/components/cert/Identicon';
import { Shield, Clock, Plus, Import } from 'lucide-react';
import { MnemonicDialog } from '@/components/dialogs/MnemonicDialog';
import { toast } from 'sonner';
import { useAppStore } from '@/lib/store/app-store';
import type { CertCardProps } from '@/components/cert/CertCard';
import {
  getAllIdentityMetas, getAllCertificates, getActiveIdentityId,
  getAllKeyRingEntries, loadIdentitySeed, deleteIdentity,
  setActiveIdentityId, getCertificate,
  type StoredCertificate, type EncryptedIdentity, type PublicKeyEntry,
} from '@/lib/crypto/key-manager';
import { deriveKeyIdentity } from '@/lib/crypto/hd-key';
import {
  isPlatformAuthenticatorAvailable, registerBiometric,
  hasBiometric as checkBiometric, removeBiometric,
} from '@/lib/crypto/biometric';
import {
  registerPin, hasPin as checkPin, removePin,
} from '@/lib/crypto/pin';

export function CertsPage() {
  const {
    setKeyIdentity, setActiveIdentityId: storeSetActive,
    setIdentities, activeIdentityId, isKeyLoaded,
    pqcConfig,
  } = useAppStore();

  const pqcEnabled = pqcConfig.kemEnabled || pqcConfig.dsaEnabled;

  const [metas, setMetas] = useState<EncryptedIdentity[]>([]);
  const [certs, setCerts] = useState<Map<string, StoredCertificate>>(new Map());
  const [contacts, setContacts] = useState<PublicKeyEntry[]>([]);
  const [biometricSupported, setBiometricSupported] = useState(false);
  const [biometricMap, setBiometricMap] = useState<Record<string, boolean>>({});
  const [pinMap, setPinMap] = useState<Record<string, boolean>>({});
  const [mnemonicDialog, setMnemonicDialog] = useState<'generate' | 'recover' | null>(null);

  useEffect(() => {
    isPlatformAuthenticatorAvailable().then(setBiometricSupported);
    loadData();
  }, []);

  // 각 아이덴티티의 biometric/PIN 등록 여부 조회
  useEffect(() => {
    (async () => {
      const bioMap: Record<string, boolean> = {};
      const pinReady: Record<string, boolean> = {};
      for (const m of metas) {
        bioMap[m.id] = await checkBiometric(m.id);
        pinReady[m.id] = await checkPin(m.id);
      }
      setBiometricMap(bioMap);
      setPinMap(pinReady);
    })();
  }, [metas]);

  async function loadData() {
    const allMetas = await getAllIdentityMetas();
    setMetas(allMetas);

    const allCerts = await getAllCertificates();
    const certMap = new Map<string, StoredCertificate>();
    for (const c of allCerts) certMap.set(c.fingerprint, c);
    setCerts(certMap);

    const activeId = await getActiveIdentityId();
    storeSetActive(activeId);
    setIdentities(allMetas.map(m => ({
      id: m.id, name: m.name, commonName: m.commonName, email: m.email,
      signingFingerprint: m.signingFingerprint, encryptionFingerprint: m.encryptionFingerprint,
      createdAt: m.createdAt,
    })));

    const entries = await getAllKeyRingEntries();
    setContacts(entries.filter(e => e.type === 'imported'));

  }

  // ── 핸들러: 잠금 해제 (classic + PQC 함께 초기화) ──
  const handleUnlock = useCallback(async (id: string, pw: string) => {
    try {
      const seed = await loadIdentitySeed(id, pw);
      const identity = await deriveKeyIdentity(seed);
      setKeyIdentity(identity);
      await setActiveIdentityId(id);
      storeSetActive(id);

      // PQC 인스턴스도 함께 초기화
      try {
        const { PQCKeystore } = await import('@/lib/pqc/pqc-keystore.js');
        const { PQCBundle } = await import('@/lib/pqc/pqc-bundle.js');
        const { PQCShield } = await import('@/lib/pqc/pqc-shield.js');
        const { PQCSigner } = await import('@/lib/pqc/pqc-signer.js');
        const bundle = await PQCKeystore.load(pw, 'default', { PQCBundleClass: PQCBundle });
        const shield = PQCShield.fromBundle(bundle.getKEMKeyPair());
        const signer = PQCSigner.fromBundle(bundle.getDSAKeyPair());
        useAppStore.getState().setPqcInstances(shield, signer);
        console.log('[PKIZIP] PQC 인스턴스 초기화 완료 (shield + signer)');
      } catch (pqcErr) {
        console.warn('[PKIZIP] PQC 인스턴스 초기화 실패:', pqcErr);
        useAppStore.getState().setPqcInstances(null, null);
        const { pqcConfig: cfg } = useAppStore.getState();
        if (cfg.kemEnabled || cfg.dsaEnabled) {
          toast.error('PQC 키 로드 실패 — 니모닉을 재생성하면 PQC 번들이 생성됩니다.');
        }
      }

      toast.success('키 활성화 완료');
    } catch {
      toast.error('비밀번호가 틀렸습니다.');
    }
  }, [setKeyIdentity, storeSetActive]);

  // ── 핸들러: 삭제 ──
  const handleDelete = useCallback(async (id: string) => {
    await deleteIdentity(id);
    if (activeIdentityId === id) { setKeyIdentity(null); storeSetActive(null); }
    await loadData();
    toast.success('삭제 완료');
  }, [activeIdentityId, setKeyIdentity, storeSetActive]);

  // ── 핸들러: 인증서 내보내기 ──
  const handleExportCert = useCallback(async (fp: string) => {
    const cert = await getCertificate(fp);
    if (!cert) return;
    const blob = new Blob([cert.pemCertificate], { type: 'application/x-pem-file' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${cert.commonName}_cert.pem`;
    a.click();
  }, []);

  // ── 핸들러: 생체 인증 등록 ──
  const handleRegisterBio = useCallback(async (id: string, name: string, pw: string) => {
    const seed = await loadIdentitySeed(id, pw);
    const mode = await registerBiometric(id, name, seed);
    setBiometricMap(prev => ({ ...prev, [id]: true }));
    toast.success(mode === 'prf' ? '생체 인증 등록 완료 (PRF)' : '생체 인증 등록 완료 (지문/얼굴)');
  }, []);

  const handleRemoveBio = useCallback(async (id: string) => {
    await removeBiometric(id);
    setBiometricMap(prev => ({ ...prev, [id]: false }));
    toast.success('생체 인증이 해제되었습니다.');
  }, []);

  // ── 핸들러: PIN ──
  const handleRegisterPin = useCallback(async (id: string, pw: string, pin: string) => {
    if (!/^\d{4,6}$/.test(pin)) { toast.error('PIN은 4~6자리 숫자'); return; }
    const seed = await loadIdentitySeed(id, pw);
    await registerPin(id, seed, pin);
    setPinMap(prev => ({ ...prev, [id]: true }));
    toast.success('PIN 등록 완료');
  }, []);

  const handleRemovePin = useCallback(async (id: string) => {
    await removePin(id);
    setPinMap(prev => ({ ...prev, [id]: false }));
    toast.success('PIN 해제 완료');
  }, []);

  // ── CertCardProps 목록 조립 ──
  const cardProps: Omit<CertCardProps, 'initialFace'>[] = metas
    .map(m => {
      const cert = certs.get(m.signingFingerprint);
      if (!cert) return null;
      const isActive = m.id === activeIdentityId && isKeyLoaded;

      return {
        cert,
        identityId: m.id,
        identityName: m.name,
        isActive,
        pqcEnabled,
        biometricSupported,
        hasBiometric: biometricMap[m.id] ?? false,
        hasPin: pinMap[m.id] ?? false,
        onRegisterBiometric: (pw: string) => handleRegisterBio(m.id, m.name, pw),
        onRemoveBiometric: () => handleRemoveBio(m.id),
        onRegisterPin: (pw: string, pin: string) => handleRegisterPin(m.id, pw, pin),
        onRemovePin: () => handleRemovePin(m.id),
        onUnlock: (pw: string) => handleUnlock(m.id, pw),
        onExportCert: () => handleExportCert(m.signingFingerprint),
        onDelete: () => handleDelete(m.id),
      } satisfies Omit<CertCardProps, 'initialFace'>;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 lg:py-10">
      <h1 className="text-xl font-bold mb-2">내 인증서</h1>
      <p className="text-sm text-zinc-500 mb-6">스와이프하여 상세 정보와 설정을 확인하세요.</p>

      {cardProps.length === 0 ? (
        <div className="text-center py-20">
          <Shield className="w-16 h-16 mx-auto mb-4 text-zinc-200" />
          <p className="text-zinc-500 mb-4">등록된 인증서가 없습니다</p>
          <p className="text-xs text-zinc-400 mb-6">아래에서 새 니모닉을 생성하거나 기존 니모닉을 복구하세요.</p>
        </div>
      ) : (
        <CertWallet cards={cardProps} />
      )}

      {/* 니모닉 생성/복구 버튼 */}
      <div className="grid grid-cols-2 gap-3 mt-6">
        <button
          onClick={() => setMnemonicDialog('generate')}
          className="flex items-center justify-center gap-2 border-2 border-dashed border-zinc-200 rounded-xl py-3 text-sm text-zinc-500 hover:border-[#1DC078] hover:text-[#1DC078] transition-colors"
        >
          <Plus className="w-4 h-4" /> 새 니모닉 생성
        </button>
        <button
          onClick={() => setMnemonicDialog('recover')}
          className="flex items-center justify-center gap-2 border-2 border-dashed border-zinc-200 rounded-xl py-3 text-sm text-zinc-500 hover:border-[#1DC078] hover:text-[#1DC078] transition-colors"
        >
          <Import className="w-4 h-4" /> 기존 니모닉 복구
        </button>
      </div>

      {/* 주소록 인증서 (타인) */}
      {contacts.length > 0 && (
        <div className="mt-10">
          <h2 className="text-lg font-bold mb-4">주소록</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {contacts.map(c => (
              <div key={c.fingerprint} className="rounded-xl border border-zinc-200 bg-white p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-zinc-100 p-0.5 shrink-0">
                  <Identicon value={c.fingerprint} size={36} className="rounded-full overflow-hidden" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm truncate">{c.label}</div>
                  <div className="text-[10px] font-mono text-zinc-400 truncate">0x{c.fingerprint}</div>
                  <div className="text-[10px] text-zinc-400 flex items-center gap-1 mt-0.5">
                    <Clock className="w-2.5 h-2.5" /> {new Date(c.createdAt).toLocaleDateString('ko-KR')}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 니모닉 다이얼로그 */}
      <MnemonicDialog
        open={mnemonicDialog === 'generate'}
        onOpenChange={open => { if (!open) { setMnemonicDialog(null); loadData(); } }}
        mode="generate"
      />
      <MnemonicDialog
        open={mnemonicDialog === 'recover'}
        onOpenChange={open => { if (!open) { setMnemonicDialog(null); loadData(); } }}
        mode="recover"
      />
    </div>
  );
}
