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
      className={`text-left p-3 rounded-lg border-2 transition ${
        selected
          ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200'
          : 'border-zinc-200 bg-white hover:border-blue-300'
      }`}
    >
      <div className="font-semibold text-sm">{title}</div>
      <div className="text-[11px] mt-1 text-zinc-600 leading-relaxed">{desc}</div>
    </button>
  );
}
