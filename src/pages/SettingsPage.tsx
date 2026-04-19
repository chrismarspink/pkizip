/**
 * SettingsPage — PQC 설정 + 앱 전역 설정
 *
 * 아이덴티티 관리는 CertsPage(인증서 카드 면 2)로 이동됨.
 */
import { useState, useEffect } from 'react';
import { Shield, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { useAppStore } from '@/lib/store/app-store';

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
