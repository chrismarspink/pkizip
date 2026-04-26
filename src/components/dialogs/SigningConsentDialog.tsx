/**
 * 서명 동의 다이얼로그 — 매 서명 시 사용자 의도 확인
 */
import { useEffect, useState } from 'react';
import { Fingerprint, Lock, KeyRound, X as XIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  getAvailableConsentMethods, requireSigningConsent,
  type ConsentMethod, type ConsentResult,
} from '@/lib/crypto/signing-consent';

interface Props {
  open: boolean;
  intent: string;
  onResolve: (result: ConsentResult) => void;
  onCancel: () => void;
}

export function SigningConsentDialog({ open, intent, onResolve, onCancel }: Props) {
  const { t } = useTranslation();
  const [methods, setMethods] = useState<ConsentMethod[]>([]);
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bioAttempted, setBioAttempted] = useState(false);

  useEffect(() => {
    if (!open) {
      setSecret(''); setError(null); setBusy(false); setBioAttempted(false);
      return;
    }
    getAvailableConsentMethods().then(setMethods);
  }, [open]);

  // 생체 등록되어 있으면 다이얼로그 열리자마자 자동 시도
  useEffect(() => {
    if (!open || bioAttempted) return;
    if (!methods.includes('biometric')) return;
    setBioAttempted(true);
    setBusy(true);
    requireSigningConsent({ force: 'biometric' })
      .then(r => {
        if (r.ok) onResolve(r);
        else setError(r.error ?? t('biometric.authFail'));
      })
      .finally(() => setBusy(false));
  }, [open, bioAttempted, methods, onResolve, t]);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!secret.trim()) return;
    setBusy(true); setError(null);
    const r = await requireSigningConsent({ secret });
    setBusy(false);
    if (r.ok) onResolve(r);
    else setError(r.error ?? '인증 실패');
  };

  const retryBio = async () => {
    setBusy(true); setError(null);
    const r = await requireSigningConsent({ force: 'biometric' });
    setBusy(false);
    if (r.ok) onResolve(r);
    else setError(r.error ?? t('biometric.authFail'));
  };

  if (!open) return null;

  const hasBio = methods.includes('biometric');
  const hasPin = methods.includes('pin');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-xl max-w-sm w-full">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100">
          <h2 className="font-semibold flex items-center gap-2">
            <Lock className="w-4 h-4" /> 서명 동의
          </h2>
          <button type="button" onClick={onCancel} className="p-1 hover:bg-zinc-100 rounded-lg">
            <XIcon className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-sm text-zinc-700">{intent}</p>

          {hasBio && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-center">
              <Fingerprint className="w-10 h-10 mx-auto mb-2 text-[#175DDC]" />
              <p className="text-xs text-zinc-700 mb-3">{t('biometric.authenticate')}</p>
              <button type="button" onClick={retryBio} disabled={busy}
                className="text-sm bg-[#175DDC] text-white rounded-lg px-4 py-2 disabled:opacity-50">
                {busy ? '인증 중...' : '다시 시도'}
              </button>
            </div>
          )}

          {(!hasBio || error) && (
            <div className="space-y-2">
              <label className="block">
                <span className="text-xs text-zinc-500 mb-1 flex items-center gap-1">
                  <KeyRound className="w-3 h-3" /> {hasPin ? 'PIN 또는 비밀번호' : '비밀번호'}
                </span>
                <input
                  type="password"
                  value={secret}
                  onChange={e => setSecret(e.target.value)}
                  autoFocus
                  className="w-full px-3 py-2 text-sm border border-zinc-300 rounded-lg"
                  placeholder={hasPin ? '4~6자리 PIN 또는 비밀번호' : '비밀번호'}
                />
              </label>
            </div>
          )}

          {error && (
            <div className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <div className="flex gap-2">
            <button type="button" onClick={onCancel}
              className="flex-1 px-4 py-2 text-sm border border-zinc-300 rounded-lg">
              {t('common.cancel')}
            </button>
            <button type="submit" disabled={busy || !secret.trim()}
              className="flex-1 px-4 py-2 text-sm bg-[#175DDC] text-white rounded-lg disabled:opacity-50">
              {busy ? t('common.loading') : '서명'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
