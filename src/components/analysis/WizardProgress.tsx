/** 분석 위자드 진행 표시 — 1/2/3 단계 인디케이터. 이전 단계는 클릭으로 회귀 가능. */
type WizardStep = 1 | 2 | 3;

interface Props {
  step: WizardStep;
  onStepClick: (s: WizardStep) => void;
}

export function WizardProgress({ step, onStepClick }: Props) {
  const labels = ['원본 분석', '처리 방식', '최종 결정'];
  // 생성 위저드(cms/Stepper)와 동일한 원형+연결선+라벨 스타일로 통일 (괴리 제거)
  return (
    <div className="flex items-center mb-3">
      {labels.map((label, i) => {
        const n = (i + 1) as WizardStep;
        const isActive = step === n;
        const done = step > n;
        return (
          <div key={n} className="flex items-center flex-1 min-w-0">
            <button
              onClick={() => done && onStepClick(n)}
              disabled={!done}
              className="flex flex-col items-center gap-0.5 shrink-0 disabled:cursor-default"
              title={done ? '이 단계로 돌아가기' : undefined}
            >
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 ${
                done ? 'bg-[#175DDC] border-[#175DDC] text-white'
                : isActive ? 'border-zinc-800 text-zinc-800'
                : 'border-zinc-300 text-zinc-400'
              }`}>
                {done ? '✓' : n}
              </div>
              <span className={`text-[10px] font-medium leading-tight ${
                done ? 'text-[#175DDC]' : isActive ? 'text-zinc-800' : 'text-zinc-400'
              }`}>{label}</span>
            </button>
            {i < 2 && <div className={`flex-1 h-0.5 mx-1.5 mt-[-12px] rounded ${done ? 'bg-[#175DDC]' : 'bg-zinc-200'}`} />}
          </div>
        );
      })}
    </div>
  );
}
