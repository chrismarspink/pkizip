/**
 * 등급 score 그라데이션 게이지 — O(0~S) / S(S~C) / C(C~) + 임계 마커.
 */
interface Props {
  score: number;
  sThreshold: number;
  cThreshold: number;
}

export function ScoreBar({ score, sThreshold, cThreshold }: Props) {
  const max = Math.max(cThreshold * 1.5, score * 1.1, cThreshold + 1);
  const pct = (v: number) => Math.max(0, Math.min(100, (v / max) * 100));
  const sPct = pct(sThreshold);
  const cPct = pct(cThreshold);
  const scorePct = pct(score);

  return (
    <div className="mt-3 pt-3 border-t border-current/10">
      <div className="relative h-3 rounded-full overflow-hidden"
        style={{
          background: `linear-gradient(to right,
            #10b981 0%, #10b981 ${sPct}%,
            #f59e0b ${sPct}%, #f59e0b ${cPct}%,
            #ef4444 ${cPct}%, #ef4444 100%)`,
        }}
      >
        <div
          className="absolute top-0 h-full w-0.5 bg-zinc-900 shadow"
          style={{ left: `calc(${scorePct}% - 1px)` }}
        />
      </div>
      <div className="relative h-4 mt-1 text-[10px] text-current/70">
        <span style={{ position: 'absolute', left: '0%' }}>0</span>
        <span style={{ position: 'absolute', left: `${sPct}%`, transform: 'translateX(-50%)' }}>
          S={sThreshold}
        </span>
        <span style={{ position: 'absolute', left: `${cPct}%`, transform: 'translateX(-50%)' }}>
          C={cThreshold}
        </span>
        <span
          className="font-bold"
          style={{ position: 'absolute', left: `${scorePct}%`, transform: 'translateX(-50%)' }}
        >
          ▲ {score}
        </span>
      </div>
    </div>
  );
}
