import { motion } from 'framer-motion';
import { Check } from 'lucide-react';

interface Props {
  checked: boolean;
  onChange: () => void;
  icon: React.ReactNode;
  title: string;
  desc: string;
  disabled?: boolean;
}

export function OptionCard({ checked, onChange, icon, title, desc, disabled }: Props) {
  return (
    <motion.button
      onClick={disabled ? undefined : onChange}
      disabled={disabled}
      className={`w-full text-left rounded-xl p-4 border-2 transition-all ${
        checked ? 'bg-[#175DDC]/5 border-[#175DDC]'
                : disabled ? 'opacity-40 border-zinc-200 bg-zinc-50'
                : 'border-zinc-200 bg-white hover:border-zinc-400'
      }`}
      whileTap={disabled ? undefined : { scale: 0.98 }}
    >
      <div className="flex items-center gap-3">
        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 ${
          checked ? 'bg-[#175DDC] border-[#175DDC]' : 'border-zinc-300'
        }`}>
          {checked && <Check className="w-3 h-3 text-white" />}
        </div>
        {icon}
        <div>
          <div className="text-sm font-medium">{title}</div>
          <div className="text-xs text-zinc-500">{desc}</div>
        </div>
      </div>
    </motion.button>
  );
}
