/**
 * HomePage — 홈 화면
 * PKIZIP 타이포 제목 + 부엉이 로고 + 니모닉 생성/복구 버튼
 */
import { useState } from 'react';
import { Plus, Import } from 'lucide-react';
import { MnemonicDialog } from '@/components/dialogs/MnemonicDialog';

export function HomePage() {
  const [mnemonicDialog, setMnemonicDialog] = useState<'generate' | 'recover' | null>(null);
  const base = import.meta.env.BASE_URL;

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 lg:py-10">
      {/* PKIZIP + 태그라인 — 좌측 정렬 */}
      <img
        src={`${base}logo-header.png`}
        alt="PKIZIP — 12 words. Sign · Seal · Encrypt · Quantum-safe."
        className="h-7 sm:h-8 mb-6 select-none self-start"
        draggable={false}
      />

      {/* 부엉이 로고 — 중앙 */}
      <div className="flex justify-center">
        <img
          src={`${base}logo-owl.png`}
          alt=""
          className="w-48 max-w-[50vw] mb-10 select-none"
          draggable={false}
        />
      </div>

      {/* 니모닉 버튼 — 좌우 배치 */}
      <div className="grid grid-cols-2 gap-3">
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

      {/* 니모닉 다이얼로그 */}
      <MnemonicDialog
        open={mnemonicDialog === 'generate'}
        onOpenChange={open => { if (!open) setMnemonicDialog(null); }}
        mode="generate"
      />
      <MnemonicDialog
        open={mnemonicDialog === 'recover'}
        onOpenChange={open => { if (!open) setMnemonicDialog(null); }}
        mode="recover"
      />
    </div>
  );
}
