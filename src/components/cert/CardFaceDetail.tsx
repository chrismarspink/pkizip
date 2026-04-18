/**
 * CardFaceDetail — 인증서 카드 뒷면 1 (면 1)
 * 기존 CertCard 하단 상세 정보와 100% 동일
 */
import { Mail, Hash, Calendar, Copy, Download } from 'lucide-react';
import type { StoredCertificate } from '@/lib/crypto/key-manager';
import { toast } from 'sonner';

interface CardFaceDetailProps {
  cert: StoredCertificate;
  pqcEnabled: boolean;
  onCopyPem: () => void;
  onExport: () => void;
}

export function CardFaceDetail({ cert, pqcEnabled, onCopyPem, onExport }: CardFaceDetailProps) {
  const formatDate = (ts: number) =>
    new Date(ts).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <div className="bg-white px-5 py-4 space-y-2.5 h-full">
      <Row icon={<Mail className="w-3.5 h-3.5" />} label="이메일" value={cert.email} />

      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="flex items-center gap-1.5 text-zinc-500 shrink-0 text-xs">
          <Hash className="w-3.5 h-3.5" /> 핑거프린트
        </span>
        <span className="flex items-center gap-1.5 text-right">
          <span
            className="text-xs font-mono truncate max-w-[180px] text-zinc-800"
            title={`0x${cert.fingerprint}`}
          >
            0x{cert.fingerprint}
          </span>
          {pqcEnabled && (
            <span className="text-[8px] bg-violet-100 text-violet-600 px-1 py-0.5 rounded font-bold shrink-0">
              ML-KEM
            </span>
          )}
          {pqcEnabled && (
            <span className="text-[8px] bg-violet-100 text-violet-600 px-1 py-0.5 rounded font-bold shrink-0">
              ML-DSA
            </span>
          )}
        </span>
      </div>

      <Row icon={<Calendar className="w-3.5 h-3.5" />} label="발급일" value={formatDate(cert.notBefore)} />
      <Row icon={<Calendar className="w-3.5 h-3.5" />} label="만료일" value={formatDate(cert.notAfter)} />
      <Row icon={<Hash className="w-3.5 h-3.5" />} label="시리얼" value={cert.serialNumber} mono small />

      {/* 액션 버튼 */}
      <div className="flex gap-2 pt-2">
        <button
          onClick={onCopyPem}
          className="flex-1 flex items-center justify-center gap-1.5 text-xs border border-zinc-200 rounded-xl py-2 text-zinc-600 hover:bg-zinc-50 transition-colors"
        >
          <Copy className="w-3 h-3" /> PEM 복사
        </button>
        <button
          onClick={onExport}
          className="flex-1 flex items-center justify-center gap-1.5 text-xs border border-zinc-200 rounded-xl py-2 text-zinc-600 hover:bg-zinc-50 transition-colors"
        >
          <Download className="w-3 h-3" /> 내보내기
        </button>
      </div>
    </div>
  );
}

function Row({
  icon,
  label,
  value,
  mono,
  small,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  mono?: boolean;
  small?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="flex items-center gap-1.5 text-zinc-500 shrink-0 text-xs">
        {icon} {label}
      </span>
      <span
        className={`text-right truncate max-w-[220px] text-zinc-800 ${mono ? 'font-mono' : ''} ${small ? 'text-[9px]' : 'text-xs'}`}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}
