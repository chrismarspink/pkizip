/**
 * CertsPage — 인증서 월렛 + 아이덴티티 관리 통합 페이지
 *
 * 기존 CertsPage(인증서 카드)와 SettingsPage(아이덴티티 섹션)를 통합.
 * 각 인증서 카드는 3면 (앞면/상세/설정)으로 스와이프 전환.
 */
import { useState, useEffect, useCallback } from 'react';
import { CertWallet } from '@/components/cert/CertWallet';
import { Identicon } from '@/components/cert/Identicon';
import { Shield, Clock, Plus, Import, QrCode, Star, User, Building2, Download, Hourglass } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { QrDisplayModal } from '@/components/qr/QrDisplayModal';
import { MnemonicDialog } from '@/components/dialogs/MnemonicDialog';
import { toast } from 'sonner';
import { useAppStore } from '@/lib/store/app-store';
import type { CertCardProps } from '@/components/cert/CertCard';
import {
  getAllIdentityMetas, getAllCertificates, getActiveIdentityId,
  getAllKeyRingEntries, loadIdentitySeed, deleteIdentity,
  setActiveIdentityId, saveCertificate,
  setIdentityCategory, setDefaultIdentity,
  type StoredCertificate, type EncryptedIdentity, type PublicKeyEntry,
  type IdentityCategory,
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
  const { t } = useTranslation();
  const [qrFor, setQrFor] = useState<StoredCertificate | null>(null);
  const {
    setKeyIdentity, setActiveIdentityId: storeSetActive,
    setIdentities, activeIdentityId, isKeyLoaded,
    pqcConfig,
  } = useAppStore();

  const pqcEnabled = pqcConfig.kemEnabled || pqcConfig.dsaEnabled;

  const [metas, setMetas] = useState<EncryptedIdentity[]>([]);
  const [certs, setCerts] = useState<Map<string, StoredCertificate>>(new Map());
  const [contacts, setContacts] = useState<PublicKeyEntry[]>([]);
  const [, setLocalKeyring] = useState<PublicKeyEntry[]>([]);
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
      category: m.category, isDefault: m.isDefault,
    })));

    const entries = await getAllKeyRingEntries();
    setContacts(entries.filter(e => e.type === 'imported'));
    setLocalKeyring(entries.filter(e => e.type === 'local'));

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
    try {
      await deleteIdentity(id);
      if (activeIdentityId === id) { setKeyIdentity(null); storeSetActive(null); useAppStore.getState().setPqcInstances(null, null); }
      await loadData();
      toast.success('삭제 완료');
    } catch (err) {
      toast.error(`삭제 실패: ${err instanceof Error ? err.message : '오류'}`);
    }
  }, [activeIdentityId, setKeyIdentity, storeSetActive]);

  // ── 핸들러: 생체 인증 등록 ──
  const handleRegisterBio = useCallback(async (id: string, name: string, pw: string) => {
    try {
      const seed = await loadIdentitySeed(id, pw);
      const mode = await registerBiometric(id, name, seed);
      setBiometricMap(prev => ({ ...prev, [id]: true }));
      toast.success(mode === 'prf' ? '생체 인증 등록 완료 (PRF)' : '생체 인증 등록 완료 (지문/얼굴)');
    } catch (err) {
      toast.error(`생체 인증 등록 실패: ${err instanceof Error ? err.message : '비밀번호가 틀렸거나 인증이 취소되었습니다.'}`);
    }
  }, []);

  const handleRemoveBio = useCallback(async (id: string) => {
    try {
      await removeBiometric(id);
      setBiometricMap(prev => ({ ...prev, [id]: false }));
      toast.success('생체 인증이 해제되었습니다.');
    } catch (err) {
      toast.error(`생체 인증 해제 실패: ${err instanceof Error ? err.message : '오류'}`);
    }
  }, []);

  // ── 핸들러: PIN ──
  const handleRegisterPin = useCallback(async (id: string, pw: string, pin: string) => {
    if (!/^\d{4,6}$/.test(pin)) { toast.error('PIN은 4~6자리 숫자'); return; }
    try {
      const seed = await loadIdentitySeed(id, pw);
      await registerPin(id, seed, pin);
      setPinMap(prev => ({ ...prev, [id]: true }));
      toast.success('PIN 등록 완료');
    } catch (err) {
      toast.error(`PIN 등록 실패: ${err instanceof Error ? err.message : '비밀번호가 틀렸습니다.'}`);
    }
  }, []);

  const handleRemovePin = useCallback(async (id: string) => {
    try {
      await removePin(id);
      setPinMap(prev => ({ ...prev, [id]: false }));
      toast.success('PIN 해제 완료');
    } catch (err) {
      toast.error(`PIN 해제 실패: ${err instanceof Error ? err.message : '오류'}`);
    }
  }, []);

  // ── 카테고리 / 기본 핸들러 ──
  const handleSetDefault = useCallback(async (id: string) => {
    await setDefaultIdentity(id);
    await loadData();
    toast.success('기본 인증서로 지정됨');
  }, []);

  const handleChangeCategory = useCallback(async (id: string, category: IdentityCategory) => {
    await setIdentityCategory(id, category);
    await loadData();
  }, []);

  // ── CertCardProps + 메타 (카테고리/기본) 목록 조립 ──
  type CardWithMeta = Omit<CertCardProps, 'initialFace'> & {
    category?: IdentityCategory;
    isDefault?: boolean;
  };
  const cardProps: CardWithMeta[] = metas
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
        onDelete: () => handleDelete(m.id),
        onCardColorChange: async (color: string) => {
          const updated = { ...cert, cardColor: color };
          await saveCertificate(updated);
          setCerts(prev => { const next = new Map(prev); next.set(cert.fingerprint, updated); return next; });
        },
        category: m.category,
        isDefault: m.isDefault,
      } as CardWithMeta;
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
        <div className="space-y-6">
          {(['personal', 'institution', 'imported', 'ephemeral'] as const).map(cat => {
            const inCat = cardProps.filter(p => (p.category ?? 'personal') === cat);
            if (inCat.length === 0) return null;
            const meta = CATEGORY_META[cat];
            const Icon = meta.icon;
            return (
              <section key={cat}>
                <div className="flex items-center gap-2 mb-3">
                  <Icon className={`w-4 h-4 ${meta.iconColor}`} />
                  <h2 className="text-sm font-semibold text-zinc-700">{meta.label}</h2>
                  <span className="text-[11px] text-zinc-400">({inCat.length})</span>
                </div>
                <CertWallet cards={inCat} />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {inCat.map(p => (
                    <IdentityActionRow key={p.identityId} cardProp={p}
                      onSetDefault={() => handleSetDefault(p.identityId)}
                      onChangeCategory={(c) => handleChangeCategory(p.identityId, c)} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* 활성 인증서 QR 공유 */}
      {cardProps.length > 0 && (
        <div className="mt-4 flex justify-center">
          <button
            onClick={() => {
              const active = cardProps.find(p => p.isActive);
              const cert = active?.cert ?? cardProps[0]?.cert;
              if (cert) setQrFor(cert);
              else toast.error('인증서가 없습니다');
            }}
            className="flex items-center gap-1.5 text-sm text-[#175DDC] border border-[#175DDC]/30 hover:bg-[#175DDC]/5 rounded-lg px-4 py-2"
          >
            <QrCode className="w-4 h-4" /> {t('certificates.showQr')}
          </button>
        </div>
      )}

      {/* 니모닉 생성/복구 버튼 */}
      <div className="grid grid-cols-2 gap-3 mt-6">
        <button
          onClick={() => setMnemonicDialog('generate')}
          className="flex items-center justify-center gap-2 border-2 border-dashed border-zinc-200 rounded-xl py-3 text-sm text-zinc-500 hover:border-[#175DDC] hover:text-[#175DDC] transition-colors"
        >
          <Plus className="w-4 h-4" /> 새 니모닉 생성
        </button>
        <button
          onClick={() => setMnemonicDialog('recover')}
          className="flex items-center justify-center gap-2 border-2 border-dashed border-zinc-200 rounded-xl py-3 text-sm text-zinc-500 hover:border-[#175DDC] hover:text-[#175DDC] transition-colors"
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

      {/* QR 표시 모달 — 메타만 (PEM/JWK는 서버에서 fetch) */}
      {qrFor && (
        <QrDisplayModal
          open={true}
          onClose={() => setQrFor(null)}
          cert={{
            fingerprint: qrFor.fingerprint,
            name: qrFor.commonName,
            email: qrFor.email,
            username: 'u-' + qrFor.fingerprint.slice(0, 8).toLowerCase(),
            url: `${window.location.origin}${import.meta.env.BASE_URL}contacts?u=u-${qrFor.fingerprint.slice(0, 8).toLowerCase()}`,
          }}
        />
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

// ─────────────────────────────────────────────
// 카테고리 메타 + 인라인 액션 행
// ─────────────────────────────────────────────

const CATEGORY_META: Record<IdentityCategory, { label: string; icon: typeof User; iconColor: string }> = {
  personal:    { label: '개인',         icon: User,      iconColor: 'text-blue-600' },
  institution: { label: '기관 / 회사',  icon: Building2, iconColor: 'text-violet-600' },
  imported:    { label: '가져온 인증서', icon: Download,  iconColor: 'text-emerald-600' },
  ephemeral:   { label: '임시',         icon: Hourglass, iconColor: 'text-zinc-500' },
};

interface IdentityActionRowProps {
  cardProp: { identityId: string; identityName: string; category?: IdentityCategory; isDefault?: boolean };
  onSetDefault: () => void;
  onChangeCategory: (c: IdentityCategory) => void;
}

function IdentityActionRow({ cardProp, onSetDefault, onChangeCategory }: IdentityActionRowProps) {
  const cat = cardProp.category ?? 'personal';
  return (
    <div className="flex items-center gap-2 text-[11px] bg-zinc-50 border border-zinc-200 rounded-lg px-2 py-1">
      <span className="font-medium text-zinc-700 truncate max-w-[120px]" title={cardProp.identityName}>
        {cardProp.identityName}
      </span>
      <select
        value={cat}
        onChange={e => onChangeCategory(e.target.value as IdentityCategory)}
        className="text-[11px] bg-white border border-zinc-200 rounded px-1 py-0.5"
      >
        {(Object.keys(CATEGORY_META) as IdentityCategory[]).map(c => (
          <option key={c} value={c}>{CATEGORY_META[c].label}</option>
        ))}
      </select>
      {cardProp.isDefault ? (
        <span className="inline-flex items-center gap-1 text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
          <Star className="w-3 h-3 fill-amber-500 text-amber-500" /> 기본
        </span>
      ) : (
        <button
          onClick={onSetDefault}
          className="inline-flex items-center gap-1 text-zinc-500 hover:text-amber-700 hover:bg-amber-50 rounded px-1.5 py-0.5"
          title="기본 인증서로 지정"
        >
          <Star className="w-3 h-3" /> 기본 지정
        </button>
      )}
    </div>
  );
}
