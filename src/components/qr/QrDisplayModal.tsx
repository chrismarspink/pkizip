/**
 * QrDisplayModal — 내 인증서 QR 표시
 */
import { useEffect, useState } from 'react';
import { X as XIcon, Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { generateCertQr } from '@/lib/qr-generator';

interface Props {
  open: boolean;
  onClose: () => void;
  cert: {
    fingerprint: string;
    name?: string;
    email?: string;
    username?: string;
    url?: string;
  };
}

export function QrDisplayModal({ open, onClose, cert }: Props) {
  const { t } = useTranslation();
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDataUrl(null);
    generateCertQr({
      fingerprint: cert.fingerprint,
      name: cert.name,
      email: cert.email,
      username: cert.username,
      url: cert.url,
    }).then(setDataUrl).catch(() => setDataUrl(null));
  }, [open, cert.fingerprint, cert.email, cert.name, cert.username, cert.url]);

  if (!open) return null;

  const downloadPng = () => {
    if (!dataUrl) return;
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `pkizip-cert-${cert.fingerprint.slice(0, 8)}.png`;
    a.click();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-xl max-w-sm w-full">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100">
          <h2 className="font-semibold">{t('qr.myCertQr')}</h2>
          <button onClick={onClose} className="p-1 hover:bg-zinc-100 rounded-lg">
            <XIcon className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-xs text-zinc-500 text-center">{t('qr.shareSubtitle')}</p>
          <div className="bg-zinc-50 rounded-xl p-4 flex items-center justify-center min-h-[300px]">
            {dataUrl
              ? <img src={dataUrl} alt="QR" className="w-[280px] h-[280px]" />
              : <div className="text-sm text-zinc-400">{t('common.loading')}</div>}
          </div>
          <div className="text-center text-xs space-y-0.5">
            {cert.name && <div className="font-semibold">{cert.name}</div>}
            {cert.email && <div className="text-zinc-500">{cert.email}</div>}
            <div className="font-mono text-[10px] text-zinc-400">0x{cert.fingerprint.slice(0, 16)}…</div>
          </div>
          <button onClick={downloadPng} disabled={!dataUrl}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm bg-[#175DDC] text-white rounded-lg disabled:opacity-50">
            <Download className="w-4 h-4" /> {t('qr.downloadPng')}
          </button>
        </div>
      </div>
    </div>
  );
}
