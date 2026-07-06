/**
 * SafeLinkShare — 완료 단계의 "안전 링크로 보내기".
 *
 * 파일을 OTC 로 암호화해 Storage 에 올리고, 링크와 원타임코드를 분리 표시한다.
 * 두 요소를 다른 채널로 전달하는 것이 방어의 핵심(링크=자격, OTC=복호화).
 * 발송은 로그인(봉투 소유자)이 필요하다.
 */
import { useState } from 'react';
import { Link2, KeyRound, Copy, Check, Loader2, Send, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { useAuthStore } from '@/lib/supabase/auth-store';
import { createSafeLink, type SafeLinkResult } from '@/lib/supabase/envelopes';
import type { FileEntry } from '@/lib/compression/compressor';

function CopyField({ label, value, mono, icon }: { label: string; value: string; mono?: boolean; icon: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { toast.error('복사 실패'); }
  };
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-500">{icon}{label}</div>
      <div className="flex items-center gap-2">
        <div className={`flex-1 min-w-0 px-3 py-2 rounded-lg bg-zinc-100 border border-zinc-200 text-sm truncate ${mono ? 'font-mono tracking-wider text-center' : ''}`}>
          {value}
        </div>
        <button onClick={copy} className="flex-shrink-0 p-2 rounded-lg bg-[#175DDC] text-white hover:opacity-90" title="복사">
          {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

export function SafeLinkShare({ files }: { files: FileEntry[] }) {
  const user = useAuthStore(s => s.user);
  const [status, setStatus] = useState<'idle' | 'creating' | 'done'>('idle');
  const [result, setResult] = useState<SafeLinkResult | null>(null);

  if (!user) {
    return (
      <div className="max-w-sm mx-auto text-xs text-zinc-400 flex items-center justify-center gap-1.5 mb-2">
        <AlertTriangle className="w-3.5 h-3.5" /> 로그인하면 안전 링크로 바로 보낼 수 있어요
      </div>
    );
  }

  const create = async () => {
    setStatus('creating');
    try {
      const r = await createSafeLink(files, { maxDownloads: 1, expiresHours: 24 });
      setResult(r);
      setStatus('done');
    } catch (e) {
      setStatus('idle');
      toast.error(`링크 생성 실패: ${e instanceof Error ? e.message : '오류'}`);
    }
  };

  if (status !== 'done') {
    return (
      <div className="flex justify-center mb-4">
        <button onClick={create} disabled={status === 'creating'}
          className="flex items-center gap-2 border border-[#175DDC] text-[#175DDC] px-6 py-2.5 rounded-xl text-sm font-medium hover:bg-[#175DDC]/5 disabled:opacity-50">
          {status === 'creating' ? <><Loader2 className="w-4 h-4 animate-spin" /> 링크 만드는 중…</> : <><Send className="w-4 h-4" /> 안전 링크로 보내기</>}
        </button>
      </div>
    );
  }

  const expires = new Date(result!.expiresAt);
  return (
    <div className="max-w-sm mx-auto bg-white border border-zinc-200 rounded-xl p-4 mb-4 text-left space-y-3">
      <div className="flex items-center gap-1.5 text-sm font-semibold text-zinc-700">
        <Send className="w-4 h-4 text-[#175DDC]" /> 안전 링크 준비됨
      </div>
      <CopyField label="링크" value={result!.link} icon={<Link2 className="w-3.5 h-3.5" />} />
      <CopyField label="원타임코드" value={result!.otcDisplay} mono icon={<KeyRound className="w-3.5 h-3.5" />} />
      <div className="text-[11px] text-amber-700 bg-amber-50 rounded-md px-3 py-2 leading-relaxed">
        ⚠️ 링크와 코드를 <b>서로 다른 채널</b>로 보내세요. (예: 링크는 이메일, 코드는 문자·전화)
      </div>
      <div className="text-[11px] text-zinc-400">
        1회 다운로드 · {expires.toLocaleString()} 만료 · 서버는 원문을 볼 수 없습니다.
      </div>
    </div>
  );
}
