/** 분석 위자드 진행 표시 — 1/2/3 단계 인디케이터. 이전 단계는 클릭으로 회귀 가능. */
type WizardStep = 1 | 2 | 3;

interface Props {
  step: WizardStep;
  onStepClick: (s: WizardStep) => void;
}

export function WizardProgress({ step, onStepClick }: Props) {
  const labels = ['원본 분석', '처리 방식', '최종 결정'];
  return (
    <div className="flex items-center gap-1 mb-2">
      {labels.map((label, i) => {
        const n = (i + 1) as WizardStep;
        const isActive = step === n;
        const isPast = step > n;
        const isFuture = step < n;
        return (
          <div key={n} className="flex-1 flex items-center gap-1 min-w-0">
            <button
              onClick={() => isPast && onStepClick(n)}
              disabled={!isPast}
              className={`flex-1 flex items-center gap-1.5 px-2 py-1.5 rounded text-xs font-medium transition min-w-0 ${
                isActive ? 'bg-[#175DDC] text-white'
                : isPast ? 'bg-[#175DDC]/10 text-[#175DDC] hover:bg-[#175DDC]/20 cursor-pointer'
                : 'bg-zinc-100 text-zinc-400'
              }`}
              title={isPast ? '이 단계로 돌아가기' : undefined}
            >
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
                isActive ? 'bg-white text-[#175DDC]'
                : isPast ? 'bg-[#175DDC] text-white'
                : 'bg-zinc-300 text-zinc-500'
              }`}>
                {isPast ? '✓' : n}
              </span>
              <span className="truncate">{label}</span>
            </button>
            {i < 2 && <span className={`text-xs ${isFuture ? 'text-zinc-300' : 'text-[#175DDC]/70'}`}>→</span>}
          </div>
        );
      })}
    </div>
  );
}
