/**
 * PqcBadge — Q(Quantum Protected) / C(Classic) 배지
 *
 * .pki 파일 분석 시, 생성 완료 시 CMS 타입 옆에 표시
 */

interface PqcBadgeProps {
  pqc: boolean;        // true = Quantum, false = Classic
  size?: 'sm' | 'md';
  className?: string;
}

export function PqcBadge({ pqc, size = 'sm', className = '' }: PqcBadgeProps) {
  const base = size === 'md'
    ? 'text-xs px-2 py-0.5 font-bold rounded-md'
    : 'text-[9px] px-1.5 py-0.5 font-bold rounded';

  if (pqc) {
    return (
      <span className={`${base} bg-violet-600 text-white ${className}`} title="Quantum Protected — ML-KEM-1024 + ML-DSA-87">
        Q
      </span>
    );
  }

  return (
    <span className={`${base} bg-zinc-400 text-white ${className}`} title="Classical — RSA/ECDSA">
      C
    </span>
  );
}

/**
 * PqcBadgeDetail — 상세 배지 (모드 표시)
 */
export function PqcBadgeDetail({ mode, className = '' }: { mode: string; className?: string }) {
  const colors: Record<string, string> = {
    hybrid: 'bg-violet-100 text-violet-700 border-violet-200',
    'pqc-only': 'bg-violet-600 text-white border-violet-700',
    classical: 'bg-zinc-100 text-zinc-600 border-zinc-200',
  };

  const labels: Record<string, string> = {
    hybrid: 'Hybrid (RSA+PQC)',
    'pqc-only': 'PQC Only',
    classical: 'Classical',
  };

  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${colors[mode] || colors.classical} ${className}`}>
      {labels[mode] || mode}
    </span>
  );
}
