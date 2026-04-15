import { AnimatePresence, motion } from 'framer-motion';
import { CertCard } from './CertCard';
import type { StoredCertificate } from '@/lib/crypto/key-manager';

interface CertWalletProps {
  certs: Array<{
    cert: StoredCertificate;
    identityName: string;
    isActive: boolean;
  }>;
}

/**
 * 인증서 카드 리스트
 * 각 카드는 항상 상세 정보를 표시한다 (터치 펼침 불필요)
 */
export function CertWallet({ certs }: CertWalletProps) {
  if (certs.length === 0) return null;

  return (
    <div className="space-y-4">
      <AnimatePresence>
        {certs.map((item, i) => (
          <motion.div
            key={item.cert.fingerprint}
            layout
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ delay: i * 0.05 }}
          >
            <CertCard
              cert={item.cert}
              identityName={item.identityName}
              isActive={item.isActive}
            />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
