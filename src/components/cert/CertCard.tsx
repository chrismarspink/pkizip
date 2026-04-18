/**
 * CertCard — 3면 스와이프 인증서 카드
 *
 * 면 0: 앞면 (비주얼, Identicon, 이름, 유효기간)
 * 면 1: 상세 (이메일, 핑거프린트, 시리얼, PEM 복사/내보내기)
 * 면 2: 설정 (잠금해제, 생체인증, PIN, 삭제)
 *
 * 전환: Framer Motion 수평 슬라이드 + 드래그 제스처
 */
import { useState, useCallback } from 'react';
import { motion, AnimatePresence, type PanInfo } from 'framer-motion';
import { CardFaceFront } from './CardFaceFront';
import { CardFaceDetail } from './CardFaceDetail';
import { CardFaceSettings } from './CardFaceSettings';
import type { StoredCertificate } from '@/lib/crypto/key-manager';
import { toast } from 'sonner';

export interface CertCardProps {
  cert: StoredCertificate;
  identityId: string;
  identityName: string;
  isActive: boolean;
  pqcEnabled: boolean;

  // 생체/PIN 상태
  biometricSupported: boolean;
  hasBiometric: boolean;
  hasPin: boolean;

  // 액션 핸들러
  onRegisterBiometric: (pw: string) => Promise<void>;
  onRemoveBiometric: () => void;
  onRegisterPin: (pw: string, pin: string) => Promise<void>;
  onRemovePin: () => void;
  onUnlock: (pw: string) => void;
  onExportCert: () => void;
  onDelete: () => void;

  initialFace?: 0 | 1 | 2;
}

const FACE_LABELS = ['앞면', '상세 정보', '설정'] as const;

export function CertCard(props: CertCardProps) {
  const {
    cert, identityId, identityName, isActive, pqcEnabled,
    biometricSupported, hasBiometric, hasPin,
    onRegisterBiometric, onRemoveBiometric,
    onRegisterPin, onRemovePin,
    onUnlock, onExportCert, onDelete,
    initialFace = 0,
  } = props;

  const [face, setFace] = useState<0 | 1 | 2>(initialFace);
  const [dir, setDir] = useState(0);

  const goTo = useCallback((next: 0 | 1 | 2) => {
    setDir(next > face ? 1 : -1);
    setFace(next);
  }, [face]);

  const handleDragEnd = useCallback((_: unknown, info: PanInfo) => {
    if (info.offset.x < -50 && face < 2) goTo((face + 1) as 1 | 2);
    if (info.offset.x > 50 && face > 0) goTo((face - 1) as 0 | 1);
  }, [face, goTo]);

  // PEM 복사
  const handleCopyPem = useCallback(async () => {
    let pem = `# PKIZIP Certificate Bundle\n# Subject: ${cert.commonName} <${cert.email}>\n# Date: ${new Date().toISOString()}\n\n`;
    pem += `# === Classic Certificate (ECDSA P-256) ===\n`;
    pem += cert.pemCertificate + '\n\n';

    if (pqcEnabled) {
      try {
        const { PQCKeystore } = await import('@/lib/pqc/pqc-keystore.js');
        const info = await PQCKeystore.getInfo('default');
        if (info?.certificates) {
          if (info.certificates.kem) {
            pem += `# === ML-KEM-1024 Certificate (FIPS 203, RFC 9935) ===\n`;
            pem += info.certificates.kem + '\n\n';
          }
          if (info.certificates.dsa) {
            pem += `# === ML-DSA-87 Certificate (FIPS 204, RFC 9881) ===\n`;
            pem += info.certificates.dsa + '\n\n';
          }
          if (info.certificates.ecc) {
            pem += `# === secp256k1 Certificate ===\n`;
            pem += info.certificates.ecc + '\n\n';
          }
          pem += `# PQC Key ID: ${info.kemKeyId || 'N/A'}\n`;
        }
      } catch {
        pem += `# PQC 인증서 로드 실패\n`;
      }
    }

    navigator.clipboard.writeText(pem);
    toast.success(pqcEnabled ? '인증서 번들 복사됨 (Classic + PQC)' : 'PEM 인증서 복사됨');
  }, [cert, pqcEnabled]);

  // PEM 내보내기
  const handleExport = useCallback(async () => {
    let pem = cert.pemCertificate;
    if (pqcEnabled) {
      try {
        const { PQCKeystore } = await import('@/lib/pqc/pqc-keystore.js');
        const info = await PQCKeystore.getInfo('default');
        if (info?.certificates) {
          if (info.certificates.kem) pem += '\n' + info.certificates.kem;
          if (info.certificates.dsa) pem += '\n' + info.certificates.dsa;
          if (info.certificates.ecc) pem += '\n' + info.certificates.ecc;
        }
      } catch { /* ignore */ }
    }
    const blob = new Blob([pem], { type: 'application/x-pem-file' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${cert.commonName.replace(/\s/g, '_')}_certs.pem`;
    a.click();
    toast.success(pqcEnabled ? '인증서 번들 내보내기 완료' : '인증서 내보내기 완료');
  }, [cert, pqcEnabled]);

  // 현재 면 렌더
  const renderFace = () => {
    switch (face) {
      case 0:
        return (
          <CardFaceFront
            cert={cert}
            identityName={identityName}
            isActive={isActive}
            pqcEnabled={pqcEnabled}
          />
        );
      case 1:
        return (
          <CardFaceDetail
            cert={cert}
            pqcEnabled={pqcEnabled}
            onCopyPem={handleCopyPem}
            onExport={handleExport}
          />
        );
      case 2:
        return (
          <CardFaceSettings
            identityId={identityId}
            identityName={identityName}
            signingFingerprint={cert.fingerprint}
            isActive={isActive}
            biometricSupported={biometricSupported}
            hasBiometric={hasBiometric}
            hasPin={hasPin}
            onRegisterBiometric={onRegisterBiometric}
            onRemoveBiometric={onRemoveBiometric}
            onRegisterPin={onRegisterPin}
            onRemovePin={onRemovePin}
            onUnlock={onUnlock}
            onExportCert={onExportCert}
            onDelete={onDelete}
          />
        );
    }
  };

  return (
    <div
      className="rounded-2xl overflow-hidden shadow-lg"
      role="region"
      aria-label={`인증서 카드, 현재 ${FACE_LABELS[face]}`}
    >
      {/* 카드 면 영역 */}
      <div className="overflow-hidden">
        <AnimatePresence initial={false} custom={dir} mode="wait">
          <motion.div
            key={face}
            custom={dir}
            variants={{
              enter: (d: number) => ({ x: d > 0 ? 300 : -300, opacity: 0 }),
              center: { x: 0, opacity: 1 },
              exit: (d: number) => ({ x: d > 0 ? -300 : 300, opacity: 0 }),
            }}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ type: 'spring' as const, stiffness: 300, damping: 30 }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.15}
            onDragEnd={handleDragEnd}
            style={{ touchAction: 'pan-y' }}
          >
            {renderFace()}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* 인디케이터 도트 */}
      <div className="flex justify-center gap-2 py-2.5 bg-zinc-50">
        {([0, 1, 2] as const).map(i => (
          <button
            key={i}
            onClick={() => goTo(i)}
            aria-label={FACE_LABELS[i]}
            tabIndex={0}
            className={`h-1.5 rounded-full transition-all duration-200 ${
              face === i
                ? 'bg-[#1DC078] w-4'
                : 'bg-zinc-300 w-1.5 hover:bg-zinc-400'
            }`}
          />
        ))}
      </div>
    </div>
  );
}
