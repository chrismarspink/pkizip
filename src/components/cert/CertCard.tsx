import { motion } from 'framer-motion';
import { ShieldCheck, Mail, Hash, Calendar, Copy, Download } from 'lucide-react';
import { Identicon } from './Identicon';
import { PqcBadge } from '@/components/PqcBadge';
import type { StoredCertificate } from '@/lib/crypto/key-manager';
import { toast } from 'sonner';

interface CertCardProps {
  cert: StoredCertificate;
  identityName: string;
  isActive?: boolean;
  pqcEnabled?: boolean;
  onExport?: () => void;
}

export function CertCard({ cert, identityName, isActive, pqcEnabled, onExport }: CertCardProps) {
  const days = Math.max(0, Math.floor((cert.notAfter - Date.now()) / 86400000));
  const expired = cert.notAfter < Date.now();
  const formatDate = (ts: number) => new Date(ts).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });

  const buildFullPem = async (): Promise<string> => {
    let pem = `# PKIZIP Certificate Bundle\n# Subject: ${cert.commonName} <${cert.email}>\n# Date: ${new Date().toISOString()}\n\n`;
    pem += `# === Classic Certificate (ECDSA P-256) ===\n`;
    pem += cert.pemCertificate + '\n\n';

    // PQC 번들에서 ML-KEM, ML-DSA 인증서 가져오기
    if (pqcEnabled) {
      try {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const req = indexedDB.open('pkizip-pqc-v3', 1);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        const tx = db.transaction('bundles', 'readonly');
        const bundle = await new Promise<any>((resolve) => {
          const req = tx.objectStore('bundles').get('default');
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        });
        db.close();

        const meta = bundle?.metaPlain;
        if (meta?.certificates) {
          if (meta.certificates.kem) {
            pem += `# === ML-KEM-1024 Certificate (FIPS 203, RFC 9935) ===\n`;
            pem += `# keyUsage: keyEncipherment\n`;
            pem += meta.certificates.kem + '\n\n';
          }
          if (meta.certificates.dsa) {
            pem += `# === ML-DSA-87 Certificate (FIPS 204, RFC 9881) ===\n`;
            pem += `# keyUsage: digitalSignature, nonRepudiation\n`;
            pem += meta.certificates.dsa + '\n\n';
          }
          if (meta.certificates.ecc) {
            pem += `# === secp256k1 Certificate ===\n`;
            pem += `# keyUsage: digitalSignature\n`;
            pem += meta.certificates.ecc + '\n\n';
          }
          pem += `# PQC Key ID: ${meta.kemKeyId || 'N/A'}\n`;
          pem += `# Mode: ${meta.mode || 'full'}\n`;
        }
      } catch {
        // PQC 번들 없으면 무시
      }
    }

    return pem;
  };

  const handleCopyPem = async () => {
    const pem = await buildFullPem();
    navigator.clipboard.writeText(pem);
    toast.success(pqcEnabled ? '인증서 번들 복사됨 (Classic + PQC 정보)' : 'PEM 인증서 복사됨');
  };

  const handleExport = async () => {
    if (onExport) { onExport(); return; }
    const pem = await buildFullPem();
    const blob = new Blob([pem], { type: 'application/x-pem-file' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${cert.commonName.replace(/\s/g, '_')}_certs.pem`;
    a.click();
    toast.success(pqcEnabled ? '인증서 번들 내보내기 완료' : '인증서 내보내기 완료');
  };

  return (
    <motion.div
      layout
      layoutId={`cert-${cert.fingerprint}`}
      className="rounded-2xl overflow-hidden shadow-lg"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 25 }}
    >
      {/* 상단: 카드 비주얼 */}
      <div className={`p-5 text-white relative ${
        isActive
          ? 'bg-gradient-to-br from-[#1DC078] to-[#0f9d58]'
          : 'bg-gradient-to-br from-zinc-600 to-zinc-700'
      }`}>
        {/* 헤더 라인 */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-white/20 flex items-center justify-center">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <span className="text-xs font-medium opacity-80">인증서</span>
            <PqcBadge pqc={!!pqcEnabled} size="sm" />
          </div>
          <div className="flex items-center gap-1.5">
            {isActive && (
              <span className="text-[10px] bg-white/25 px-2.5 py-0.5 rounded-full font-medium">활성</span>
            )}
          </div>
        </div>

        {/* 중앙: 아바타/로고 + 이름 */}
        <div className="flex items-center gap-4 my-4">
          <div className="w-24 h-24 rounded-xl bg-white shrink-0 overflow-hidden flex items-center justify-center">
            {cert.logotype ? (
              <img
                src={cert.logotype}
                alt=""
                className="w-full h-full object-cover"
                style={{ aspectRatio: '1/1' }}
              />
            ) : (
              <Identicon value={cert.fingerprint} size={96} />
            )}
          </div>
          <div className="flex-1 min-w-0 text-right">
            <div className="text-2xl font-bold tracking-wide truncate">{cert.commonName}</div>
            <div className="text-xs opacity-70 mt-0.5">{identityName}</div>
          </div>
        </div>

        {/* 하단 라인 */}
        <div className="flex items-end justify-between mt-2">
          <div className="text-[10px] opacity-60 space-y-0.5">
            <div className="flex items-center gap-1">
              <ShieldCheck className="w-3 h-3" /> PKIZIP 자체서명 인증서
            </div>
            <div>{formatDate(cert.notAfter)} 까지</div>
          </div>
          <div className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
            expired ? 'bg-red-500/40' : days < 30 ? 'bg-amber-500/40' : 'bg-white/20'
          }`}>
            {expired ? '만료됨' : `${days}일 남음`}
          </div>
        </div>
      </div>

      {/* 하단: 상세 정보 (항상 표시) */}
      <div className="bg-white px-5 py-4 space-y-2.5">
        <Row icon={<Mail className="w-3.5 h-3.5" />} label="이메일" value={cert.email} />
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="flex items-center gap-1.5 text-zinc-500 shrink-0 text-xs"><Hash className="w-3.5 h-3.5" /> 핑거프린트</span>
          <span className="flex items-center gap-1.5 text-right">
            <span className="text-xs font-mono truncate max-w-[180px] text-zinc-800" title={`0x${cert.fingerprint}`}>0x{cert.fingerprint}</span>
            {pqcEnabled && <span className="text-[8px] bg-violet-100 text-violet-600 px-1 py-0.5 rounded font-bold shrink-0">ML-KEM</span>}
            {pqcEnabled && <span className="text-[8px] bg-violet-100 text-violet-600 px-1 py-0.5 rounded font-bold shrink-0">ML-DSA</span>}
          </span>
        </div>
        <Row icon={<Calendar className="w-3.5 h-3.5" />} label="발급일" value={formatDate(cert.notBefore)} />
        <Row icon={<Calendar className="w-3.5 h-3.5" />} label="만료일" value={formatDate(cert.notAfter)} />
        <Row icon={<Hash className="w-3.5 h-3.5" />} label="시리얼" value={cert.serialNumber} mono small />

        {/* 액션 버튼 */}
        <div className="flex gap-2 pt-2">
          <button onClick={handleCopyPem}
            className="flex-1 flex items-center justify-center gap-1.5 text-xs border border-zinc-200 rounded-xl py-2 text-zinc-600 hover:bg-zinc-50 transition-colors">
            <Copy className="w-3 h-3" /> PEM 복사
          </button>
          <button onClick={handleExport}
            className="flex-1 flex items-center justify-center gap-1.5 text-xs border border-zinc-200 rounded-xl py-2 text-zinc-600 hover:bg-zinc-50 transition-colors">
            <Download className="w-3 h-3" /> 내보내기
          </button>
        </div>
      </div>
    </motion.div>
  );
}

function Row({ icon, label, value, mono, small }: {
  icon: React.ReactNode; label: string; value: string; mono?: boolean; small?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="flex items-center gap-1.5 text-zinc-500 shrink-0 text-xs">{icon} {label}</span>
      <span className={`text-right truncate max-w-[220px] text-zinc-800 ${mono ? 'font-mono' : ''} ${small ? 'text-[9px]' : 'text-xs'}`}
        title={value}>{value}</span>
    </div>
  );
}
