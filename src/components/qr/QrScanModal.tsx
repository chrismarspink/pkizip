/**
 * QrScanModal — QR 스캔 → 인증서 추가
 */
import { useEffect, useRef, useState } from 'react';
import { X as XIcon, AlertTriangle, Camera } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { startQrScan, type QrScanResult } from '@/lib/qr-scanner';
import { addToKeyRing, getFromKeyRing } from '@/lib/crypto/key-manager';

interface Props {
  open: boolean;
  onClose: () => void;
  onAdded?: (fingerprint: string) => void;
}

export function QrScanModal({ open, onClose, onAdded }: Props) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const [result, setResult] = useState<QrScanResult | null>(null);
  const [memo, setMemo] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      cleanupRef.current?.();
      cleanupRef.current = null;
      setResult(null); setMemo(''); setError(null);
      return;
    }
    const video = videoRef.current;
    if (!video) return;

    let active = true;
    startQrScan(video, (r) => {
      if (!active) return;
      if (!r.valid) {
        if (r.error === 'permission_denied') setError(t('qr.cameraPermissionDenied'));
        else if (r.error === 'no_camera') setError(t('qr.noCameraFound'));
        return;
      }
      setResult(r);
      cleanupRef.current?.();
      cleanupRef.current = null;
    }).then(stop => {
      if (!active) { stop(); return; }
      cleanupRef.current = stop;
    });

    return () => {
      active = false;
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, [open, t]);

  const handleAdd = async () => {
    if (!result?.data) return;
    const fp = result.data.fingerprint;
    const existing = await getFromKeyRing(fp);
    if (existing?.type === 'local') {
      toast.warning(t('contacts.alreadyLocal'));
      return;
    }
    if (existing) {
      toast(t('qr.alreadyAdded'));
      return;
    }
    setAdding(true);
    try {
      const label = memo.trim() || result.data.name || result.data.email || fp;
      await addToKeyRing({
        fingerprint: fp,
        label,
        signingKeyJWK: {},
        encryptionKeyJWK: result.data.enc_jwk ?? {},
        createdAt: Date.now(),
        type: 'imported',
        displayName: result.data.name ?? (memo.trim() || undefined),
        email: result.data.email,
        username: result.data.username,
        certClassicPem: result.data.pubkey,
      });
      toast.success(t('qr.addSuccess'));
      onAdded?.(fp);
      onClose();
    } catch (err) {
      toast.error(`${t('qr.addFail')}: ${err instanceof Error ? err.message : err}`);
    } finally { setAdding(false); }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-xl max-w-sm w-full overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100">
          <h2 className="font-semibold">{t('qr.title')}</h2>
          <button onClick={onClose} className="p-1 hover:bg-zinc-100 rounded-lg">
            <XIcon className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {error ? (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>{error}</div>
            </div>
          ) : !result ? (
            <>
              <div className="bg-zinc-900 rounded-xl overflow-hidden aspect-square flex items-center justify-center relative">
                <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
                <div className="absolute inset-8 border-2 border-white/40 rounded-2xl pointer-events-none" />
                <div className="absolute bottom-3 left-0 right-0 text-center text-xs text-white/70 flex items-center justify-center gap-1">
                  <Camera className="w-3 h-3" /> {t('qr.scanning')}
                </div>
              </div>
              <p className="text-xs text-zinc-500 text-center">{t('qr.scan')}</p>
            </>
          ) : (
            <>
              <div className="bg-green-50 border border-green-200 text-green-800 rounded-lg p-3 text-sm">
                ✓ {t('qr.detected')}
              </div>
              <div className="space-y-1.5 text-sm">
                {result.data?.name && <Row label={t('common.name')} value={result.data.name} />}
                {result.data?.email && <Row label={t('common.email')} value={result.data.email} />}
                <Row label={t('qr.fingerprint')}
                  value={<span className="font-mono text-[11px] break-all">0x{result.data?.fingerprint}</span>} />
              </div>
              <label className="block">
                <span className="text-xs text-zinc-500 mb-1 block">{t('qr.friendName')}</span>
                <input value={memo} onChange={e => setMemo(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg" />
              </label>
              <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-2.5 text-xs flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <div>{t('qr.verifyFingerprint')}</div>
              </div>
              <div className="flex gap-2">
                <button onClick={onClose}
                  className="flex-1 px-4 py-2 text-sm border border-zinc-300 rounded-lg">
                  {t('common.cancel')}
                </button>
                <button onClick={handleAdd} disabled={adding}
                  className="flex-1 px-4 py-2 text-sm bg-[#175DDC] text-white rounded-lg disabled:opacity-50">
                  {adding ? t('common.loading') : t('qr.trustAdd')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[80px_1fr] gap-2">
      <dt className="text-zinc-500 text-xs">{label}</dt>
      <dd className="text-zinc-800 text-xs">{value}</dd>
    </div>
  );
}
