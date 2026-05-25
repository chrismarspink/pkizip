import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { IdentitySummary } from '@/lib/store/app-store';

interface Props {
  identities: IdentitySummary[];
  selectedId: string | null;
  /** 활성 ID — selectedId 가 비어 있을 때 fallback */
  activeId: string | null;
  onSelect: (id: string) => void;
}

export function CertificateSelectorList({ identities, selectedId, activeId, onSelect }: Props) {
  const { t } = useTranslation();
  if (identities.length === 0) return null;
  const effectiveId = selectedId || activeId || identities[0]?.id;
  return (
    <div className="bg-white border border-zinc-200 rounded-xl p-4 mt-3 space-y-2">
      <label className="text-xs font-medium text-zinc-700">{t('create.certForSigning')}</label>
      <div className="space-y-1.5">
        {identities.map(id => {
          const isSelected = effectiveId === id.id;
          return (
            <button key={id.id} onClick={() => onSelect(id.id)}
              className={`w-full text-left rounded-lg px-3 py-2.5 border-2 transition-all flex items-center gap-3 ${
                isSelected ? 'border-[#175DDC] bg-[#175DDC]/5' : 'border-zinc-100 hover:border-zinc-300'
              }`}>
              <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                isSelected ? 'border-[#175DDC] bg-[#175DDC]' : 'border-zinc-300'
              }`}>
                {isSelected && <Check className="w-2.5 h-2.5 text-white" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{id.name}</div>
                <div className="text-[10px] text-zinc-500">{id.commonName} &lt;{id.email}&gt;</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
