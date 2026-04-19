/**
 * ContactsPage — 인증서 디렉토리 검색 + 주소록 추가
 * 로그인 필수
 */
import { useState, useCallback, useRef } from 'react';
import { Search, UserPlus, Shield, Lock } from 'lucide-react';
import { useAuthStore } from '@/lib/supabase/auth-store';
import { searchCertBundles, type CertBundle } from '@/lib/supabase/cert-directory';
import { addToKeyRing, getAllKeyRingEntries } from '@/lib/crypto/key-manager';
import { AuthDialog } from '@/components/auth/AuthDialog';
import { toast } from 'sonner';

export function ContactsPage() {
  const user = useAuthStore(s => s.user);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CertBundle[]>([]);
  const [searching, setSearching] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleSearch = useCallback((q: string) => {
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.trim().length < 2) { setResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await searchCertBundles(q);
        setResults(r);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  }, []);

  const handleAddToKeyring = useCallback(async (bundle: CertBundle) => {
    try {
      const existing = await getAllKeyRingEntries();
      if (existing.some(e => e.fingerprint === bundle.fingerprint)) {
        toast('이미 주소록에 있습니다', { icon: '📋' });
        return;
      }
      await addToKeyRing({
        fingerprint: bundle.fingerprint || bundle.username,
        label: `${bundle.display_name} <${bundle.email || ''}>`,
        signingKeyJWK: {}, // 인증서 PEM에서 추출 필요 — 현재는 placeholder
        encryptionKeyJWK: {},
        createdAt: Date.now(),
        type: 'imported',
      });
      toast.success(`${bundle.display_name}을(를) 주소록에 추가했습니다`);
    } catch (err) {
      toast.error(`주소록 추가 실패: ${err instanceof Error ? err.message : '오류'}`);
    }
  }, []);

  // 비로그인
  if (!user) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-6 lg:py-10">
        <h1 className="text-xl font-bold mb-2">주소록</h1>
        <div className="text-center py-20">
          <Lock className="w-16 h-16 mx-auto mb-4 text-zinc-200" />
          <p className="text-zinc-500 mb-4">로그인 후 인증서를 검색하고 주소록에 추가할 수 있습니다.</p>
          <button onClick={() => setShowAuth(true)}
            className="bg-[#175DDC] text-white px-5 py-2.5 rounded-xl text-sm font-medium">
            로그인
          </button>
        </div>
        <AuthDialog open={showAuth} onOpenChange={setShowAuth} />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 lg:py-10">
      <h1 className="text-xl font-bold mb-2">주소록</h1>
      <p className="text-sm text-zinc-500 mb-4">이름, 이메일, username으로 인증서를 검색하세요.</p>

      {/* 검색바 */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
        <input
          type="text"
          value={query}
          onChange={e => handleSearch(e.target.value)}
          placeholder="검색 (최소 2자)"
          className="w-full border border-zinc-200 rounded-xl pl-10 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#175DDC]"
        />
      </div>

      {/* 결과 */}
      {searching && <p className="text-sm text-zinc-400 text-center py-8">검색 중...</p>}

      {!searching && query.length >= 2 && results.length === 0 && (
        <p className="text-sm text-zinc-400 text-center py-8">검색 결과가 없습니다</p>
      )}

      {!searching && query.length < 2 && (
        <p className="text-sm text-zinc-400 text-center py-8">이름, 이메일, username으로 검색하세요</p>
      )}

      <div className="space-y-3">
        {results.map(b => (
          <div key={b.id} className="bg-white border border-zinc-200 rounded-xl p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium text-sm truncate">{b.display_name}</div>
                {b.email && <div className="text-xs text-zinc-500 truncate">{b.email}</div>}
                <div className="text-[10px] text-zinc-400 font-mono">@{b.username}</div>
                {b.fingerprint && (
                  <div className="text-[10px] text-zinc-400 font-mono mt-0.5">0x{b.fingerprint.slice(0, 8)}</div>
                )}
                {/* 인증서 배지 */}
                <div className="flex gap-1 mt-1.5">
                  {b.cert_classic && <span className="text-[8px] bg-zinc-100 text-zinc-600 px-1.5 py-0.5 rounded font-bold">ECDSA</span>}
                  {b.cert_kem && <span className="text-[8px] bg-violet-100 text-violet-600 px-1.5 py-0.5 rounded font-bold">ML-KEM</span>}
                  {b.cert_dsa && <span className="text-[8px] bg-violet-100 text-violet-600 px-1.5 py-0.5 rounded font-bold">ML-DSA</span>}
                </div>
              </div>
              <button onClick={() => handleAddToKeyring(b)}
                className="flex items-center gap-1 text-xs text-[#175DDC] hover:bg-[#175DDC]/5 border border-[#175DDC]/30 rounded-lg px-3 py-1.5 transition-colors shrink-0">
                <UserPlus className="w-3 h-3" /> 주소록 추가
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
