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
        // 번들 ID 'default'로 조회 시도, 없으면 전체 DB 스캔
        let info = await PQCKeystore.getInfo('default');
        if (!info) {
          // DB에 다른 번들 ID로 저장되었을 수 있음 — exportJSON으로 전체 확인
          try {
            const json = await PQCKeystore.exportJSON('default');
            console.log('[PKIZIP] PEM복사 - exportJSON 시도:', json ? 'exists' : 'null');
          } catch {
            console.log('[PKIZIP] PEM복사 - DB에 default 번들 없음');
          }
        }
        console.log('[PKIZIP] PEM복사 - PQC getInfo 결과:', info ? { certificates: !!info.certificates, kemKeyId: info.kemKeyId?.slice(0, 16), keys: info.certificates ? Object.keys(info.certificates) : 'none' } : 'null');

        if (info?.certificates) {
          const c = info.certificates;
          if (c.kem) {
            pem += `# === ML-KEM-1024 Certificate (FIPS 203, RFC 9935) ===\n`;
            pem += `# keyUsage: keyEncipherment\n`;
            pem += c.kem + '\n\n';
          }
          if (c.dsa) {
            pem += `# === ML-DSA-87 Certificate (FIPS 204, RFC 9881) ===\n`;
            pem += `# keyUsage: digitalSignature, nonRepudiation\n`;
            pem += c.dsa + '\n\n';
          }
          if (c.ecc) {
            pem += `# === secp256k1 Certificate ===\n`;
            pem += `# keyUsage: digitalSignature\n`;
            pem += c.ecc + '\n\n';
          }
          pem += `# PQC Key ID: ${info.kemKeyId || 'N/A'}\n`;
          pem += `# Mode: ${info.mode || 'full'}\n`;
        } else {
          console.warn('[PKIZIP] PEM복사 - PQC 번들에 인증서 없음. 니모닉 재생성 필요.');
          pem += `# PQC 번들에 인증서가 없습니다. PQC 활성 상태에서 니모닉을 재생성하세요.\n`;
        }
      } catch (err) {
        console.warn('[PKIZIP] PEM복사 - PQC 로드 실패:', err);
        pem += `# PQC 인증서 로드 실패\n`;
      }
    }

    navigator.clipboard.writeText(pem);
    const certCount = (pem.match(/-----PKIZIP-CERT-/g) || []).length + (pem.match(/-----BEGIN CERTIFICATE-----/g) || []).length;
    toast.success(certCount > 1 ? `인증서 번들 복사됨 (${certCount}개)` : 'PEM 인증서 복사됨');
  }, [cert, pqcEnabled]);

  // PEM 내보내기
  const handleExport = useCallback(async () => {
    let pem = `# PKIZIP Certificate Bundle\n# Subject: ${cert.commonName} <${cert.email}>\n# Date: ${new Date().toISOString()}\n\n`;
    pem += `# === Classic Certificate (ECDSA P-256) ===\n`;
    pem += cert.pemCertificate + '\n\n';

    if (pqcEnabled) {
      try {
        const { PQCKeystore } = await import('@/lib/pqc/pqc-keystore.js');
        const info = await PQCKeystore.getInfo('default');
        if (info?.certificates) {
          const c = info.certificates;
          if (c.kem) pem += `# === ML-KEM-1024 Certificate ===\n` + c.kem + '\n\n';
          if (c.dsa) pem += `# === ML-DSA-87 Certificate ===\n` + c.dsa + '\n\n';
          if (c.ecc) pem += `# === secp256k1 Certificate ===\n` + c.ecc + '\n\n';
          pem += `# PQC Key ID: ${info.kemKeyId || 'N/A'}\n`;
        }
      } catch (err) {
        console.warn('[PKIZIP] 내보내기 PQC 로드 실패:', err);
      }
    }

    const blob = new Blob([pem], { type: 'application/x-pem-file' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${cert.commonName.replace(/\s/g, '_')}_certs.pem`;
    a.click();
    toast.success('인증서 내보내기 완료');
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
