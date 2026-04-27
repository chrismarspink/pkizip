/**
 * CardFaceFront — 인증서 카드 앞면 (면 0)
 * 기존 CertCard 상단 비주얼과 100% 동일
 */
import { ShieldCheck } from 'lucide-react';
import { Identicon } from './Identicon';
import { PqcBadge } from '@/components/PqcBadge';
import { getCardBackground } from '@/components/LogoCrop';
import type { StoredCertificate } from '@/lib/crypto/key-manager';

interface CardFaceFrontProps {
  cert: StoredCertificate;
  identityName: string;
  isActive: boolean;
  pqcEnabled: boolean;
}

export function CardFaceFront({ cert, identityName, isActive, pqcEnabled }: CardFaceFrontProps) {
  const days = Math.max(0, Math.floor((cert.notAfter - Date.now()) / 86400000));
  const expired = cert.notAfter < Date.now();
  const formatDate = (ts: number) =>
    new Date(ts).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <div
      className="p-5 text-white relative h-full"
      style={{
        background: getCardBackground(cert.cardColor),
        // 비활성 시 채도/명도 낮춤 (잠금 표시 유지)
        filter: isActive ? undefined : 'saturate(0.4) brightness(0.7)',
      }}
    >
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
          {isActive ? (
            <span className="text-[10px] bg-white/25 px-2.5 py-0.5 rounded-full font-medium">활성</span>
          ) : (
            <span className="text-[10px] bg-white/15 px-2.5 py-0.5 rounded-full font-medium">잠김</span>
          )}
        </div>
      </div>

      {/* 중앙: 아바타 + 이름 */}
      <div className="flex items-center gap-4 my-4">
        <div className="w-24 h-24 rounded-xl bg-white shrink-0 overflow-hidden flex items-center justify-center">
          {cert.logotype ? (
            <img src={cert.logotype} alt="" className="w-full h-full object-cover" style={{ aspectRatio: '1/1' }} />
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
        <div
          className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
            expired ? 'bg-red-500/40' : days < 30 ? 'bg-amber-500/40' : 'bg-white/20'
          }`}
        >
          {expired ? '만료됨' : `${days}일 남음`}
        </div>
      </div>

      {/* 스와이프 힌트 */}
      <div className="text-center mt-3 text-[10px] opacity-40 select-none">
        스와이프하여 상세 보기
      </div>
    </div>
  );
}
