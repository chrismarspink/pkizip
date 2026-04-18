/**
 * CertWallet — 인증서 카드 수직 스택 레이아웃
 * 활성 아이덴티티 카드를 최상단 정렬, stagger 진입 애니메이션
 */
import { motion } from 'framer-motion';
import { CertCard, type CertCardProps } from './CertCard';

interface CertWalletProps {
  cards: Omit<CertCardProps, 'initialFace'>[];
}

const containerVariants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.06 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring' as const, stiffness: 400, damping: 28 },
  },
};

export function CertWallet({ cards }: CertWalletProps) {
  if (cards.length === 0) return null;

  // 활성 카드 최상단 정렬
  const sorted = [...cards].sort((a, b) =>
    a.isActive === b.isActive ? 0 : a.isActive ? -1 : 1
  );

  return (
    <motion.div
      className="space-y-4"
      variants={containerVariants}
      initial="hidden"
      animate="show"
    >
      {sorted.map(card => (
        <motion.div
          key={card.cert.fingerprint}
          variants={itemVariants}
          layout
        >
          <CertCard {...card} />
        </motion.div>
      ))}
    </motion.div>
  );
}
