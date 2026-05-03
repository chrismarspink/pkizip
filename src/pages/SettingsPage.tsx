/**
 * SettingsPage — PQC 설정 + 앱 전역 설정
 *
 * 아이덴티티 관리는 CertsPage(인증서 카드 면 2)로 이동됨.
 */
import { useState, useEffect, useCallback } from 'react';
import { Shield, ChevronDown, Share2, Copy, Trash2, Lock, CloudUpload, Clock, Languages, Fingerprint, RefreshCw } from 'lucide-react';
import { ForceRefreshButton, VersionBadge } from '@/components/UpdateBanner';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { changeLanguage, getCurrentLanguage, SUPPORTED_LANGUAGES, type Language } from '@/i18n';
import { useAppStore } from '@/lib/store/app-store';
import { useAuthStore } from '@/lib/supabase/auth-store';
import { uploadCertBundle, getMyCertBundles, deleteCertBundle, type CertBundle } from '@/lib/supabase/cert-directory';
import { listBackups, deleteBackup, type BackupEntry } from '@/lib/supabase/mnemonic-backup';
import { getTsaSettings, saveTsaSettings, DEFAULT_TSA_LIST, type TsaServer } from '@/lib/tsa-health';
import { getAllCertificates, getFromKeyRing } from '@/lib/crypto/key-manager';
import { AuthDialog } from '@/components/auth/AuthDialog';

export function SettingsPage() {
  const { t } = useTranslation();
  return (
    <div className="max-w-2xl mx-auto px-4 py-6 lg:py-10">
      <h1 className="text-xl font-bold mb-6">{t('settings.title')}</h1>

      {/* 언어 */}
      <div className="mb-6">
        <h2 className="text-sm font-bold text-zinc-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <Languages className="w-4 h-4" /> {t('settings.language')}
        </h2>
        <LanguageSection />
      </div>

      {/* 생체 인증 */}
      <div className="mb-6">
        <h2 className="text-sm font-bold text-zinc-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <Fingerprint className="w-4 h-4" /> {t('settings.biometric')}
        </h2>
        <BiometricSection />
      </div>

      {/* 양자 암호 섹션 */}
      <div className="mb-6">
        <h2 className="text-sm font-bold text-zinc-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <Shield className="w-4 h-4" /> {t('settings.pqc')}
        </h2>
        <PQCSettings />
      </div>

      {/* 인증서 공유 섹션 */}
      <div className="mb-6">
        <h2 className="text-sm font-bold text-zinc-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <Share2 className="w-4 h-4" /> 인증서 공유
        </h2>
        <CertSharingSection />
      </div>

      {/* 타임스탬프 설정 */}
      <div className="mb-6">
        <h2 className="text-sm font-bold text-zinc-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <Clock className="w-4 h-4" /> 타임스탬프 (RFC 3161)
        </h2>
        <TsaSettingsSection />
      </div>

      {/* 니모닉 백업 관리 */}
      <div className="mb-6">
        <h2 className="text-sm font-bold text-zinc-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <CloudUpload className="w-4 h-4" /> 니모닉 백업
        </h2>
        <BackupManagementSection />
      </div>

      {/* 앱 업데이트 + 캐시 청소 — 모바일 PWA stale cache 대응 */}
      <div className="mb-6">
        <h2 className="text-sm font-bold text-zinc-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <RefreshCw className="w-4 h-4" /> 앱 업데이트
        </h2>
        <div className="bg-white rounded-xl border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">현재 버전</div>
              <VersionBadge className="mt-0.5" />
            </div>
            <button
              onClick={() => window.pkizipUpdate?.(true)}
              className="text-xs px-3 py-1.5 border border-blue-300 text-blue-700 rounded hover:bg-blue-50 inline-flex items-center gap-1.5"
            >
              <RefreshCw className="w-3 h-3" />
              업데이트 확인
            </button>
          </div>
          <div className="text-[11px] text-zinc-500 leading-relaxed border-t pt-3">
            모바일에서 옛 버전이 계속 보이면 아래 "캐시 강제 청소" 를 눌러주세요.
            서비스 워커 등록 해제 + 모든 캐시 + 세션 데이터를 삭제합니다.
          </div>
          <ForceRefreshButton />
        </div>
      </div>
    </div>
  );
}

// ══ PQC 설정 컴포넌트 (기존 그대로) ══

function PQCSettings() {
  const { pqcConfig: storeConfig, setPqcConfig } = useAppStore();
  const [config, setConfig] = useState<{
    kem: { enabled: boolean; mode: string };
    dsa: { enabled: boolean; mode: string };
  }>({
    kem: { enabled: storeConfig.kemEnabled, mode: storeConfig.kemMode },
    dsa: { enabled: storeConfig.dsaEnabled, mode: storeConfig.dsaMode },
  });
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setConfig({
      kem: { enabled: storeConfig.kemEnabled, mode: storeConfig.kemMode },
      dsa: { enabled: storeConfig.dsaEnabled, mode: storeConfig.dsaMode },
    });
  }, [storeConfig]);

  const saveConfig = (next: typeof config) => {
    setConfig(next);
    setPqcConfig({ kemEnabled: next.kem.enabled, kemMode: next.kem.mode, dsaEnabled: next.dsa.enabled, dsaMode: next.dsa.mode });
    toast.success('PQC 설정 저장됨');
  };

  const MODES = [
    { value: 'hybrid', label: 'Hybrid (RSA + PQC 병행)', desc: '기존 호환성 유지 + 양자 보호' },
    { value: 'pqc-only', label: 'PQC 전용', desc: '최고 보안, 기존 암호 미사용' },
    { value: 'classical', label: '기존 암호만', desc: 'PQC 미적용 (양자 취약)' },
  ];

  return (
    <div className="space-y-3">
      {/* 요약 카드 */}
      <div className={`rounded-xl border-2 p-4 shadow-sm ${
        config.kem.enabled || config.dsa.enabled ? 'border-[#175DDC] bg-[#175DDC]/5' : 'border-zinc-300 bg-white'
      }`}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-[#175DDC]" />
            <span className="font-medium text-sm">양자 암호 보호</span>
          </div>
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
            config.kem.enabled || config.dsa.enabled ? 'bg-[#175DDC] text-white' : 'bg-zinc-200 text-zinc-500'
          }`}>
            {config.kem.enabled || config.dsa.enabled ? '활성' : '비활성'}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs mb-3">
          <div className="bg-white/80 rounded-lg p-2 border border-zinc-100">
            <div className="text-zinc-500 mb-0.5">암호화 (KEM)</div>
            <div className="font-medium">{config.kem.enabled ? 'ML-KEM-1024' : '미사용'}</div>
            <div className="text-[10px] text-zinc-400">{config.kem.mode}</div>
          </div>
          <div className="bg-white/80 rounded-lg p-2 border border-zinc-100">
            <div className="text-zinc-500 mb-0.5">전자서명 (DSA)</div>
            <div className="font-medium">{config.dsa.enabled ? 'ML-DSA-87' : '미사용'}</div>
            <div className="text-[10px] text-zinc-400">{config.dsa.mode}</div>
          </div>
        </div>

        <button onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-800 transition-colors">
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          {expanded ? '접기' : '상세 설정'}
        </button>
      </div>

      {/* 상세 설정 (펼침) */}
      {expanded && (
        <div className="space-y-4 pl-1">
          {/* KEM 설정 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-zinc-700">암호화 — ML-KEM-1024 (FIPS 203)</label>
              <button onClick={() => saveConfig({ ...config, kem: { ...config.kem, enabled: !config.kem.enabled } })}
                className={`w-10 h-5 rounded-full transition-colors relative ${config.kem.enabled ? 'bg-[#175DDC]' : 'bg-zinc-300'}`}>
                <div className={`w-4 h-4 rounded-full bg-white shadow absolute top-0.5 transition-transform ${config.kem.enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
            </div>
            {config.kem.enabled && (
              <div className="flex gap-1.5">
                {MODES.map(m => (
                  <button key={m.value} onClick={() => saveConfig({ ...config, kem: { ...config.kem, mode: m.value } })}
                    className={`flex-1 text-left rounded-lg px-2.5 py-2 border text-[10px] transition-colors ${
                      config.kem.mode === m.value ? 'border-[#175DDC] bg-[#175DDC]/5 text-zinc-800' : 'border-zinc-200 text-zinc-500 hover:border-zinc-300'
                    }`}>
                    <div className="font-medium">{m.label}</div>
                    <div className="text-zinc-400 mt-0.5">{m.desc}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* DSA 설정 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-zinc-700">전자서명 — ML-DSA-87 (FIPS 204)</label>
              <button onClick={() => saveConfig({ ...config, dsa: { ...config.dsa, enabled: !config.dsa.enabled } })}
                className={`w-10 h-5 rounded-full transition-colors relative ${config.dsa.enabled ? 'bg-[#175DDC]' : 'bg-zinc-300'}`}>
                <div className={`w-4 h-4 rounded-full bg-white shadow absolute top-0.5 transition-transform ${config.dsa.enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
            </div>
            {config.dsa.enabled && (
              <div className="flex gap-1.5">
                {MODES.map(m => (
                  <button key={m.value} onClick={() => saveConfig({ ...config, dsa: { ...config.dsa, mode: m.value } })}
                    className={`flex-1 text-left rounded-lg px-2.5 py-2 border text-[10px] transition-colors ${
                      config.dsa.mode === m.value ? 'border-[#175DDC] bg-[#175DDC]/5 text-zinc-800' : 'border-zinc-200 text-zinc-500 hover:border-zinc-300'
                    }`}>
                    <div className="font-medium">{m.label}</div>
                    <div className="text-zinc-400 mt-0.5">{m.desc}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <p className="text-[10px] text-zinc-400">
            NIST FIPS 203 (ML-KEM-1024) + FIPS 204 (ML-DSA-87) 양자 내성 암호 표준.
            Hybrid 모드는 기존 RSA/ECDSA와 병행하여 호환성을 유지합니다.
          </p>
        </div>
      )}
    </div>
  );
}

// ══ 인증서 공유 섹션 ══

import type { StoredCertificate } from '@/lib/crypto/key-manager';

function CertSharingSection() {
  const user = useAuthStore(s => s.user);
  const [showAuth, setShowAuth] = useState(false);
  const [sharedBundles, setSharedBundles] = useState<CertBundle[]>([]);
  const [localCerts, setLocalCerts] = useState<StoredCertificate[]>([]);
  const [uploadingFp, setUploadingFp] = useState<string | null>(null);
  const [deletingFp, setDeletingFp] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!loaded) {
      getAllCertificates().then(setLocalCerts).catch(() => {});
      if (user) {
        getMyCertBundles(user.id).then(setSharedBundles).catch(() => {});
      }
      setLoaded(true);
    }
  }, [user, loaded]);

  const sharedFps = new Set(sharedBundles.map(b => b.fingerprint));

  const handleUpload = useCallback(async (cert: StoredCertificate) => {
    if (!user) return;
    setUploadingFp(cert.fingerprint);
    try {
      // 로컬 keyring에서 암호화 JWK 가져오기 (수신자가 나에게 암호화할 때 필요)
      const localEntry = await getFromKeyRing(cert.fingerprint);
      const encJwk = localEntry?.encryptionKeyJWK && (localEntry.encryptionKeyJWK as JsonWebKey).kty
        ? localEntry.encryptionKeyJWK : undefined;
      await uploadCertBundle(user.id, {
        display_name: cert.commonName,
        email: cert.email,
        cert_classic: cert.pemCertificate,
        cert_kem: cert.pqcCertificates?.kem,
        cert_dsa: cert.pqcCertificates?.dsa,
        fingerprint: cert.fingerprint,
        enc_jwk_classic: encJwk,
      });
      setSharedBundles(await getMyCertBundles(user.id));
      toast.success('인증서 공유 완료');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '업로드 실패');
    } finally {
      setUploadingFp(null);
    }
  }, [user]);

  const handleDelete = useCallback(async (fp: string) => {
    if (!user) return;
    try {
      await deleteCertBundle(user.id, fp);
      setSharedBundles(await getMyCertBundles(user.id));
      setDeletingFp(null);
      toast.success('공유 삭제 완료');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제 실패');
    }
  }, [user]);

  if (!user) {
    return (
      <div className="rounded-xl border border-zinc-200 p-4 text-center">
        <Lock className="w-8 h-8 mx-auto mb-2 text-zinc-300" />
        <p className="text-xs text-zinc-500 mb-3">로그인하면 인증서를 공유하고 검색할 수 있습니다.</p>
        <button onClick={() => setShowAuth(true)} className="text-xs bg-[#175DDC] text-white px-4 py-2 rounded-lg">로그인</button>
        <AuthDialog open={showAuth} onOpenChange={setShowAuth} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-[10px] text-zinc-400">공유 {sharedBundles.length}/5</p>
      {localCerts.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 p-4 text-center">
          <p className="text-xs text-zinc-400">인증서가 없습니다. 먼저 키를 생성하세요.</p>
        </div>
      ) : (
        localCerts.map(cert => {
          const shared = sharedBundles.find(b => b.fingerprint === cert.fingerprint);
          const isShared = !!shared;
          const isUploading = uploadingFp === cert.fingerprint;
          return (
            <div key={cert.fingerprint} className={`rounded-xl border-2 p-4 ${isShared ? 'border-[#175DDC] bg-[#175DDC]/5' : 'border-zinc-200'}`}>
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{cert.commonName}</div>
                  <div className="text-[10px] text-zinc-500">{cert.email}</div>
                  <div className="text-[10px] font-mono text-zinc-400">0x{cert.fingerprint.slice(0, 8)}</div>
                </div>
                {isShared ? (
                  <span className="text-[9px] bg-[#175DDC] text-white px-2 py-0.5 rounded-full font-medium shrink-0">공유 중</span>
                ) : (
                  <span className="text-[9px] bg-zinc-100 text-zinc-500 px-2 py-0.5 rounded-full shrink-0">미공유</span>
                )}
              </div>

              <div className="flex gap-1 mb-2">
                <span className="text-[8px] bg-zinc-100 text-zinc-600 px-1.5 py-0.5 rounded font-bold">ECDSA</span>
                {cert.pqcCertificates?.kem
                  ? <span className="text-[8px] bg-violet-100 text-violet-600 px-1.5 py-0.5 rounded font-bold">ML-KEM</span>
                  : <span className="text-[8px] bg-zinc-50 text-zinc-300 px-1.5 py-0.5 rounded font-bold">ML-KEM ✗</span>}
                {cert.pqcCertificates?.dsa
                  ? <span className="text-[8px] bg-violet-100 text-violet-600 px-1.5 py-0.5 rounded font-bold">ML-DSA</span>
                  : <span className="text-[8px] bg-zinc-50 text-zinc-300 px-1.5 py-0.5 rounded font-bold">ML-DSA ✗</span>}
              </div>

              {isShared ? (
                <div className="flex items-center gap-2">
                  <button onClick={() => handleUpload(cert)} disabled={isUploading} className="text-[10px] text-zinc-500 hover:text-[#175DDC]">
                    {isUploading ? '업로드 중...' : '재업로드'}
                  </button>
                  {deletingFp === cert.fingerprint ? (
                    <div className="flex items-center gap-1">
                      <button onClick={() => handleDelete(cert.fingerprint)} className="text-[10px] text-white bg-red-500 rounded px-2 py-0.5">삭제</button>
                      <button onClick={() => setDeletingFp(null)} className="text-[10px] text-zinc-400">취소</button>
                    </div>
                  ) : (
                    <button onClick={() => setDeletingFp(cert.fingerprint)} className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-red-500">
                      <Trash2 className="w-2.5 h-2.5" /> 공유 삭제
                    </button>
                  )}
                </div>
              ) : (
                <button onClick={() => handleUpload(cert)} disabled={isUploading}
                  className="w-full text-xs bg-[#175DDC] text-white py-2 rounded-lg hover:bg-[#0C3276] transition-colors disabled:opacity-50">
                  {isUploading ? '업로드 중...' : '공유'}
                </button>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

// ══ 니모닉 백업 관리 ══

function BackupManagementSection() {
  const user = useAuthStore(s => s.user);
  const [showAuth, setShowAuth] = useState(false);
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (user && !loaded) {
      listBackups(user.id).then(setBackups).catch(() => {});
      setLoaded(true);
    }
  }, [user, loaded]);

  const handleDelete = useCallback(async (identityId: string) => {
    if (!user) return;
    try {
      await deleteBackup(user.id, identityId);
      setBackups(await listBackups(user.id));
      setDeletingId(null);
      toast.success('백업 삭제 완료');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제 실패');
    }
  }, [user]);

  if (!user) {
    return (
      <div className="rounded-xl border border-zinc-200 p-4 text-center">
        <Lock className="w-8 h-8 mx-auto mb-2 text-zinc-300" />
        <p className="text-xs text-zinc-500 mb-3">로그인하면 니모닉을 서버에 암호화 백업할 수 있습니다.</p>
        <button onClick={() => setShowAuth(true)} className="text-xs bg-[#175DDC] text-white px-4 py-2 rounded-lg">로그인</button>
        <AuthDialog open={showAuth} onOpenChange={setShowAuth} />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-[10px] text-zinc-400">백업 {backups.length}/5 · 니모닉 생성 시 "서버에 암호화 백업 저장"을 체크하면 저장됩니다.</p>
      {backups.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 p-4 text-center">
          <p className="text-xs text-zinc-400">저장된 백업이 없습니다.</p>
        </div>
      ) : (
        backups.map(b => (
          <div key={b.identity_id} className="rounded-xl border border-zinc-200 p-3 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs font-medium truncate">{b.hint || b.identity_id.slice(0, 12)}</div>
              <div className="text-[10px] text-zinc-400">{new Date(b.updated_at).toLocaleDateString('ko-KR')}</div>
            </div>
            {deletingId === b.identity_id ? (
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => handleDelete(b.identity_id)} className="text-[10px] text-white bg-red-500 rounded px-2 py-0.5">삭제</button>
                <button onClick={() => setDeletingId(null)} className="text-[10px] text-zinc-400">취소</button>
              </div>
            ) : (
              <button onClick={() => setDeletingId(b.identity_id)} className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-red-500 shrink-0">
                <Trash2 className="w-2.5 h-2.5" /> 삭제
              </button>
            )}
          </div>
        ))
      )}
    </div>
  );
}

// ══ 타임스탬프 설정 ══

function TsaSettingsSection() {
  const [settings, setSettings] = useState(() => getTsaSettings());
  const [expanded, setExpanded] = useState(false);

  const toggle = (enabled: boolean) => {
    const next = { ...settings, enabled };
    setSettings(next);
    saveTsaSettings(next);
  };

  const toggleServer = (id: string) => {
    const servers = settings.servers.map(s =>
      s.id === id ? { ...s, enabled: !s.enabled } : s
    );
    const next = { ...settings, servers };
    setSettings(next);
    saveTsaSettings(next);
  };

  return (
    <div className="space-y-3">
      <div className={`rounded-xl border-2 p-4 shadow-sm ${settings.enabled ? 'border-[#175DDC] bg-[#175DDC]/5' : 'border-zinc-300 bg-white'}`}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-[#175DDC]" />
            <span className="font-medium text-sm">서명 타임스탬프</span>
          </div>
          <button onClick={() => toggle(!settings.enabled)}
            className={`w-10 h-5 rounded-full transition-colors relative ${settings.enabled ? 'bg-[#175DDC]' : 'bg-zinc-300'}`}>
            <div className={`w-4 h-4 rounded-full bg-white shadow absolute top-0.5 transition-transform ${settings.enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </button>
        </div>
        <p className="text-[10px] text-zinc-500">
          {settings.enabled
            ? '서명 시 RFC 3161 TSA에서 타임스탬프를 발급받습니다. 실패 시 로컬 시각으로 폴백합니다.'
            : '타임스탬프 비활성 — 서명에 시각 정보가 포함되지 않습니다.'}
        </p>

        {settings.enabled && (
          <button onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-800 mt-2 transition-colors">
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
            {expanded ? '접기' : 'TSA 서버 설정'}
          </button>
        )}
      </div>

      {settings.enabled && expanded && (
        <div className="space-y-2 pl-1">
          <p className="text-[10px] text-zinc-400">우선순위 순 (위에서 아래로 시도, 실패 시 다음)</p>
          {settings.servers.map(s => (
            <div key={s.id} className="flex items-center justify-between rounded-lg border border-zinc-200 px-3 py-2">
              <div>
                <div className="text-xs font-medium">{s.name}</div>
                <div className="text-[10px] text-zinc-400 font-mono truncate max-w-[250px]">{s.url}</div>
              </div>
              <button onClick={() => toggleServer(s.id)}
                className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${s.enabled ? 'bg-[#175DDC] text-white' : 'bg-zinc-100 text-zinc-400'}`}>
                {s.enabled ? '활성' : '비활성'}
              </button>
            </div>
          ))}
          <p className="text-[10px] text-zinc-400">
            타임아웃: {settings.timeoutMs / 1000}초 · TSA에는 서명값의 SHA-256 해시만 전송됩니다.
          </p>
        </div>
      )}
    </div>
  );
}

// ══ 언어 선택 컴포넌트 ══
function LanguageSection() {
  const { t } = useTranslation();
  const [current, setCurrent] = useState<Language>(getCurrentLanguage());

  const handleChange = (lng: Language) => {
    changeLanguage(lng);
    setCurrent(lng);
  };

  return (
    <div className="bg-white border border-zinc-200 rounded-xl p-4">
      <p className="text-xs text-zinc-500 mb-3">{t('settings.languageDesc')}</p>
      <div className="space-y-1">
        {SUPPORTED_LANGUAGES.map(lng => (
          <label key={lng} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-zinc-50 cursor-pointer">
            <input type="radio" name="lng" checked={current === lng} onChange={() => handleChange(lng)} />
            <span className="text-sm">{t(`languages.${lng}`)}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

// ══ 생체 인증 컴포넌트 ══
function BiometricSection() {
  const { t } = useTranslation();
  const [supported, setSupported] = useState<{ supported: boolean; prfSupported: boolean; reason?: string } | null>(null);
  const [registered, setRegistered] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const { checkBiometricSupport, isBiometricRegistered } = await import('@/lib/crypto/biometric-key');
      setSupported(await checkBiometricSupport());
      setRegistered(await isBiometricRegistered());
    })();
  }, []);

  const onRegister = async () => {
    setBusy(true);
    try {
      const { registerBiometric } = await import('@/lib/crypto/biometric-key');
      await registerBiometric();
      setRegistered(true);
      toast.success(t('biometric.registerSuccess'));
    } catch (err) {
      toast.error(`${t('biometric.registerFail')}: ${err instanceof Error ? err.message : err}`);
    } finally { setBusy(false); }
  };

  const onUnregister = async () => {
    if (!confirm(t('biometric.unregister'))) return;
    setBusy(true);
    try {
      const { removeBiometric } = await import('@/lib/crypto/biometric-key');
      await removeBiometric();
      setRegistered(false);
      toast.success(t('common.success'));
    } finally { setBusy(false); }
  };

  if (!supported) return <div className="bg-white border border-zinc-200 rounded-xl p-4 text-sm text-zinc-500">{t('common.loading')}</div>;

  if (!supported.supported) {
    return (
      <div className="bg-white border border-zinc-200 rounded-xl p-4 text-sm text-zinc-500">
        {t('biometric.notSupported')} {supported.reason && <span className="text-xs">({supported.reason})</span>}
      </div>
    );
  }

  return (
    <div className="bg-white border border-zinc-200 rounded-xl p-4 space-y-3">
      <p className="text-xs text-zinc-500">{t('settings.biometricDesc')}</p>
      <div className="flex items-center gap-2 text-sm">
        <span className={`px-2 py-0.5 rounded text-xs ${registered ? 'bg-green-100 text-green-700' : 'bg-zinc-100 text-zinc-500'}`}>
          {registered ? t('biometric.registered') : t('biometric.notRegistered')}
        </span>
        {!supported.prfSupported && (
          <span className="px-2 py-0.5 rounded text-xs bg-amber-100 text-amber-700">
            {t('biometric.prfNotSupported')}
          </span>
        )}
      </div>
      {!registered ? (
        <button onClick={onRegister} disabled={busy}
          className="px-4 py-2 text-sm bg-[#175DDC] text-white rounded-lg disabled:opacity-50">
          {busy ? t('common.loading') : t('biometric.register')}
        </button>
      ) : (
        <button onClick={onUnregister} disabled={busy}
          className="px-4 py-2 text-sm bg-red-500 text-white rounded-lg disabled:opacity-50">
          {t('biometric.unregister')}
        </button>
      )}
    </div>
  );
}
