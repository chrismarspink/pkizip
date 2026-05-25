import { Check } from 'lucide-react';

export interface StepItem<K extends string> {
  key: K;
  label: string;
}

interface Props<K extends string> {
  steps: ReadonlyArray<StepItem<K>>;
  current: K;
  /** 'done' 같은 종료 상태 — 모든 step 을 완료로 표시 */
  isComplete?: boolean;
}

export function Stepper<K extends string>({ steps, current, isComplete }: Props<K>) {
  const stepIdx = steps.findIndex(s => s.key === current);
  return (
    <div className="flex items-center mb-8">
      {steps.map((s, i) => {
        const done = i < stepIdx || isComplete;
        const active = s.key === current;
        return (
          <div key={s.key} className="flex items-center flex-1 min-w-0">
            <div className="flex flex-col items-center gap-0.5 shrink-0">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 ${
                done ? 'bg-[#175DDC] border-[#175DDC] text-white'
                     : active ? 'border-zinc-800 text-zinc-800'
                     : 'border-zinc-300 text-zinc-400'
              }`}>
                {done ? <Check className="w-4 h-4" /> : i + 1}
              </div>
              <span className={`text-[10px] font-medium leading-tight ${
                done ? 'text-[#175DDC]' : active ? 'text-zinc-800' : 'text-zinc-400'
              }`}>{s.label}</span>
            </div>
            {i < steps.length - 1 && (
              <div className={`flex-1 h-0.5 mx-1.5 mt-[-12px] rounded ${done ? 'bg-[#175DDC]' : 'bg-zinc-200'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}
