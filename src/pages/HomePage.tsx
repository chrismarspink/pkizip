/**
 * HomePage — 테스트용 홈 화면
 * 부엉이 로고 + 니모닉 생성/복구 버튼
 */
import { useState } from 'react';
import { Plus, Import } from 'lucide-react';
import { MnemonicDialog } from '@/components/dialogs/MnemonicDialog';

export function HomePage() {
  const [mnemonicDialog, setMnemonicDialog] = useState<'generate' | 'recover' | null>(null);

  return (
    <div className="flex flex-col items-center justify-center min-h-full px-6 py-10">
      {/* 로고 */}
      <img
        src={`${import.meta.env.BASE_URL}logo-owl.png`}
        alt="PKIZIP"
        className="w-64 max-w-[65vw] mb-10 select-none"
        draggable={false}
      />

      {/* 버튼 */}
      <div className="w-full max-w-xs space-y-3">
        <button
          onClick={() => setMnemonicDialog('generate')}
          className="w-full flex items-center justify-center gap-2 bg-[#1DC078] text-white rounded-2xl py-3.5 text-sm font-medium shadow-md hover:bg-[#17a568] transition-colors"
        >
          <Plus className="w-4 h-4" /> 새 니모닉 생성
        </button>
        <button
          onClick={() => setMnemonicDialog('recover')}
          className="w-full flex items-center justify-center gap-2 border-2 border-zinc-200 rounded-2xl py-3.5 text-sm text-zinc-600 font-medium hover:border-[#1DC078] hover:text-[#1DC078] transition-colors"
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
