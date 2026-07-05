/** Step 2 처리 방식 선택 카드 — pseudonymize / anonymize / skip. */
interface Props {
  selected: boolean;
  title: string;
  desc: string;
  onClick: () => void;
}

export function ProcessingChoiceCard({ selected, title, desc, onClick }: Props) {
  return (
    <button
      onClick={onClick}
      className={`text-left p-4 rounded-xl border-2 transition ${
        selected
          ? 'border-[#175DDC] bg-[#175DDC]/5'
          : 'border-zinc-200 bg-white hover:border-[#175DDC]/40'
      }`}
    >
      <div className="font-semibold text-sm">{title}</div>
      <div className="text-[11px] mt-1 text-zinc-600 leading-relaxed">{desc}</div>
    </button>
  );
}
