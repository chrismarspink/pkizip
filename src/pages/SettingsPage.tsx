/**
 * SettingsPage — PQC 설정 + 앱 전역 설정
 *
 * 아이덴티티 관리는 CertsPage(인증서 카드 면 2)로 이동됨.
 */
import { useState, useEffect, useCallback } from 'react';
import { Shield, ChevronDown, Share2, Copy, Trash2, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { useAppStore } from '@/lib/store/app-store';
import { useAuthStore } from '@/lib/supabase/auth-store';
import { uploadCertBundle, getMyCertBundle, deleteCertBundle, type CertBundle } from '@/lib/supabase/cert-directory';
import { getAllCertificates } from '@/lib/crypto/key-manager';
import { AuthDialog } from '@/components/auth/AuthDialog';

export function SettingsPage() {
  return (
    <div className="max-w-2xl mx-auto px-4 py-6 lg:py-10">
      <h1 className="text-xl font-bold mb-6">설정</h1>

      {/* 양자 암호 섹션 */}
      <div className="mb-6">
        <h2 className="text-sm font-bold text-zinc-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <Shield className="w-4 h-4" /> 양자 암호 (Post-Quantum)
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
  const [username, setUsername] = useState('');
  const [myBundle, setMyBundle] = useState<CertBundle | null>(null);
  const [localCerts, setLocalCerts] = useState<StoredCertificate[]>([]);
  const [uploading, setUploading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  // 로컬 인증서 + 서버 번들 로드
  useEffect(() => {
    if (!loaded) {
      getAllCertificates().then(setLocalCerts).catch(() => {});
      if (user) {
        getMyCertBundle(user.id).then(b => {
          setMyBundle(b);
          if (b) setUsername(b.username);
        }).catch(() => {});
      }
      setLoaded(true);
    }
  }, [user, loaded]);

  const handleUpload = useCallback(async (cert: StoredCertificate) => {
    if (!user) return;
    const uname = username || cert.commonName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').slice(0, 32);
    if (uname.length < 3) {
      toast.error('username 3자 이상 필요 — 아래에서 수정하세요');
      return;
    }
    setUploading(true);
    try {
      await uploadCertBundle(user.id, {
        username: uname,
        display_name: cert.commonName,
        email: cert.email,
        cert_classic: cert.pemCertificate,
        cert_kem: cert.pqcCertificates?.kem,
        cert_dsa: cert.pqcCertificates?.dsa,
        fingerprint: cert.fingerprint,
      });
      const b = await getMyCertBundle(user.id);
      setMyBundle(b);
      if (b) setUsername(b.username);
      toast.success('인증서 공유 완료');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '업로드 실패');
    } finally {
      setUploading(false);
    }
  }, [user, username]);

  const handleDelete = useCallback(async () => {
    if (!user) return;
    try {
      await deleteCertBundle(user.id);
      setMyBundle(null);
      setDeleteConfirm(false);
      toast.success('인증서 공유 삭제 완료');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '삭제 실패');
    }
  }, [user]);

  // 비로그인
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
      {/* 로컬 인증서 목록 + 공유 상태 */}
      {localCerts.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 p-4 text-center">
          <p className="text-xs text-zinc-400">인증서가 없습니다. 먼저 키를 생성하세요.</p>
        </div>
      ) : (
        localCerts.map(cert => {
          const isShared = myBundle?.fingerprint === cert.fingerprint;
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

              {/* 인증서 배지 */}
              <div className="flex gap-1 mb-2">
                <span className="text-[8px] bg-zinc-100 text-zinc-600 px-1.5 py-0.5 rounded font-bold">ECDSA</span>
                {cert.pqcCertificates?.kem && <span className="text-[8px] bg-violet-100 text-violet-600 px-1.5 py-0.5 rounded font-bold">ML-KEM</span>}
                {cert.pqcCertificates?.dsa && <span className="text-[8px] bg-violet-100 text-violet-600 px-1.5 py-0.5 rounded font-bold">ML-DSA</span>}
                {!cert.pqcCertificates?.kem && <span className="text-[8px] bg-zinc-50 text-zinc-300 px-1.5 py-0.5 rounded font-bold">ML-KEM ✗</span>}
                {!cert.pqcCertificates?.dsa && <span className="text-[8px] bg-zinc-50 text-zinc-300 px-1.5 py-0.5 rounded font-bold">ML-DSA ✗</span>}
              </div>

              {isShared ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="font-mono text-[11px] bg-white rounded-lg px-2 py-1 border border-zinc-200 flex-1 truncate">
                      pkizip.app/k/{myBundle!.username}
                    </div>
                    <button onClick={() => { navigator.clipboard.writeText(`pkizip.app/k/${myBundle!.username}`); toast.success('복사됨'); }}
                      className="text-[10px] text-[#175DDC] hover:underline shrink-0">
                      <Copy className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="text-[10px] text-zinc-400">
                    업데이트: {new Date(myBundle!.updated_at).toLocaleDateString('ko-KR')}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => handleUpload(cert)} disabled={uploading} className="text-[10px] text-zinc-500 hover:text-[#175DDC]">
                      {uploading ? '업로드 중...' : '재업로드'}
                    </button>
                    {deleteConfirm ? (
                      <div className="flex items-center gap-1">
                        <button onClick={handleDelete} className="text-[10px] text-white bg-red-500 rounded px-2 py-0.5">삭제</button>
                        <button onClick={() => setDeleteConfirm(false)} className="text-[10px] text-zinc-400">취소</button>
                      </div>
                    ) : (
                      <button onClick={() => setDeleteConfirm(true)} className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-red-500">
                        <Trash2 className="w-2.5 h-2.5" /> 삭제
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <button onClick={() => handleUpload(cert)} disabled={uploading}
                  className="w-full text-xs bg-[#175DDC] text-white py-2 rounded-lg hover:bg-[#0C3276] transition-colors disabled:opacity-50">
                  {uploading ? '업로드 중...' : '공유'}
                </button>
              )}
            </div>
          );
        })
      )}

      {/* username 설정 */}
      <div className="space-y-1">
        <label className="text-[10px] text-zinc-400">공유 주소 (username)</label>
        <input type="text" value={username} onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
          placeholder="my-username (3~32자)" maxLength={32}
          className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-[#175DDC]" />
      </div>
    </div>
  );
}
