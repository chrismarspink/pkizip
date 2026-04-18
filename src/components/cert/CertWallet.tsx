import { AnimatePresence, motion } from 'framer-motion';
import { CertCard } from './CertCard';
import { useAppStore } from '@/lib/store/app-store';
import type { StoredCertificate } from '@/lib/crypto/key-manager';

interface CertWalletProps {
  certs: Array<{
    cert: StoredCertificate;
    identityName: string;
    isActive: boolean;
  }>;
}

export function CertWallet({ certs }: CertWalletProps) {
  const { pqcConfig } = useAppStore();
  const pqcEnabled = pqcConfig.kemEnabled || pqcConfig.dsaEnabled;

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
              pqcEnabled={pqcEnabled}
            />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
