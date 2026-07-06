/**
 * OpenPage — 무설치 열람 랜딩 (`/open/:token`, AppShell 밖 공개 라우트).
 *
 * 수신자는 앱 설치·키·로그인 없이 링크를 열고 OTC(원타임코드)로 복호화한다.
 * 흐름: 진입 → fetch-envelope(게이트) → 암호문 다운로드 → OTC 입력 → 로컬 복호화 → 원문 저장.
 * 서버는 OTC 를 모르고, 복호화는 전적으로 이 브라우저에서만 일어난다.
 */
import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { Lock, Download, ShieldCheck, AlertTriangle, Loader2, FileText } from 'lucide-react';
import { fetchEnvelope, downloadEnvelopeBlob, openEnvelopeBlob } from '@/lib/supabase/envelopes';
import { parseOtc, normalizeOtc } from '@/lib/crypto/otc';
import type { FileEntry } from '@/lib/compression/compressor';

type Phase = 'loading' | 'ready' | 'decrypted' | 'gone';

function formatSize(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

/** 입력 중 4자 그룹 자동 하이픈 (표시용) */
function groupInput(raw: string): string {
  const norm = normalizeOtc(raw).slice(0, 14);
  return norm.match(/.{1,4}/g)?.join('-') ?? norm;
}

export function OpenPage() {
  const { token } = useParams<{ token: string }>();
  const [phase, setPhase] = useState<Phase>('loading');
  const [blob, setBlob] = useState<Uint8Array | null>(null);
  const [sizeBytes, setSizeBytes] = useState(0);
  const [otcInput, setOtcInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [decrypting, setDecrypting] = useState(false);
  const [files, setFiles] = useState<FileEntry[]>([]);

  // 진입 시 게이트 통과 + 암호문 다운로드
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) { setPhase('gone'); return; }
      try {
        const info = await fetchEnvelope(token);
        const bytes = await downloadEnvelopeBlob(info.signedUrl);
        if (cancelled) return;
        setBlob(bytes);
        setSizeBytes(info.sizeBytes || bytes.byteLength);
        setPhase('ready');
      } catch {
        if (!cancelled) setPhase('gone'); // 만료·소진·부재 동일 처리
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const secret = parseOtc(otcInput);

  const handleDecrypt = useCallback(async () => {
    if (!blob || !secret) return;
    setDecrypting(true);
    setError(null);
    try {
      const entries = await openEnvelopeBlob(blob, secret);
      setFiles(entries);
      setPhase('decrypted');
    } catch {
      // AES-GCM 태그 실패 = 잘못된 OTC (또는 손상)
      setError('원타임코드가 올바르지 않거나 파일이 손상되었습니다. 코드를 다시 확인하세요.');
    } finally {
      setDecrypting(false);
    }
  }, [blob, secret]);

  const download = (f: FileEntry) => {
    const url = URL.createObjectURL(new Blob([f.data as unknown as BlobPart], { type: f.type || 'application/octet-stream' }));
    const a = document.createElement('a');
    a.href = url; a.download = f.name || 'download';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center px-4 py-10"
      style={{ background: 'linear-gradient(180deg,#f8fafc,#eef2f8)' }}>
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-zinc-200 overflow-hidden">
        {/* 헤더 */}
        <div className="px-6 py-5 flex items-center gap-2.5" style={{ background: '#175DDC' }}>
          <ShieldCheck className="w-6 h-6 text-white" />
          <div>
            <div className="text-white font-bold text-lg leading-none">pkizip</div>
            <div className="text-white/80 text-xs mt-1">안전 링크로 받은 파일</div>
          </div>
        </div>

        <div className="p-6">
          {phase === 'loading' && (
            <div className="flex flex-col items-center gap-3 py-8 text-zinc-500">
              <Loader2 className="w-7 h-7 animate-spin" />
              <div className="text-sm">암호문을 불러오는 중…</div>
            </div>
          )}

          {phase === 'gone' && (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <AlertTriangle className="w-8 h-8 text-amber-500" />
              <div className="text-sm text-zinc-700 font-medium">링크를 열 수 없습니다</div>
              <div className="text-xs text-zinc-500 leading-relaxed">
                만료되었거나, 이미 다운로드되었거나, 잘못된 링크입니다.<br />
                보낸 사람에게 다시 요청하세요.
              </div>
            </div>
          )}

          {phase === 'ready' && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2 text-zinc-600 text-sm">
                <Lock className="w-4 h-4" />
                <span>암호문 {formatSize(sizeBytes)} · 원타임코드로 잠금 해제</span>
              </div>
              <label className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">원타임코드</label>
              <input
                autoFocus
                value={otcInput}
                onChange={e => setOtcInput(groupInput(e.target.value))}
                onKeyDown={e => { if (e.key === 'Enter' && secret) handleDecrypt(); }}
                placeholder="XXXX-XXXX-XXXX-XX"
                className="w-full px-4 py-3 text-center text-lg font-mono tracking-widest rounded-lg border border-zinc-300 focus:border-[#175DDC] focus:ring-2 focus:ring-[#175DDC]/20 outline-none"
              />
              <div className="text-[11px] text-zinc-400 -mt-2">
                보낸 사람이 링크와 <b>다른 채널</b>(문자·전화·대면)로 알려준 코드입니다.
              </div>
              {error && <div className="text-xs text-red-600 bg-red-50 rounded-md px-3 py-2">{error}</div>}
              <button
                onClick={handleDecrypt}
                disabled={!secret || decrypting}
                className="w-full py-3 rounded-lg font-semibold text-white transition disabled:opacity-40 flex items-center justify-center gap-2"
                style={{ background: '#175DDC' }}
              >
                {decrypting ? <><Loader2 className="w-4 h-4 animate-spin" /> 복호화 중…</> : '잠금 해제'}
              </button>
            </div>
          )}

          {phase === 'decrypted' && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 text-emerald-700 text-sm font-medium">
                <ShieldCheck className="w-4 h-4" /> 복호화 완료 · {files.length}개 파일
              </div>
              <div className="flex flex-col gap-2">
                {files.map((f, i) => (
                  <div key={i} className="flex items-center gap-2.5 p-3 rounded-lg border border-zinc-200 bg-zinc-50">
                    <FileText className="w-5 h-5 text-zinc-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{f.name}</div>
                      <div className="text-[11px] text-zinc-500">{formatSize(f.data.byteLength)}</div>
                    </div>
                    <button onClick={() => download(f)}
                      className="flex-shrink-0 p-2 rounded-md hover:bg-[#175DDC]/10 text-[#175DDC]" title="저장">
                      <Download className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="text-[11px] text-zinc-400 mt-1">
                파일은 이 브라우저에서만 복호화됐습니다. 서버는 원문을 볼 수 없습니다.
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="mt-4 text-[11px] text-zinc-400">🔒 종단 암호화 · 원문은 서버에 저장되지 않습니다</div>
    </div>
  );
}
