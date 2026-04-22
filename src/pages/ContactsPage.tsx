/**
 * ContactsPage — 인증서 디렉토리 검색 + 주소록 관리
 * 로그인 필수
 */
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Search, UserPlus, Lock, Info, Trash2, X as XIcon, Shield } from 'lucide-react';
import { useAuthStore } from '@/lib/supabase/auth-store';
import { searchCertBundles, type CertBundle } from '@/lib/supabase/cert-directory';
import { addToKeyRing, getAllKeyRingEntries, removeFromKeyRing } from '@/lib/crypto/key-manager';
import { parsePemCertificate, extractLogotypeFromPem } from '@/lib/crypto/certificate';
import { AuthDialog } from '@/components/auth/AuthDialog';
import { toast } from 'sonner';

export function ContactsPage() {
  const user = useAuthStore(s => s.user);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CertBundle[]>([]);
  const [searching, setSearching] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [keyringFps, setKeyringFps] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<CertBundle | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const reloadKeyring = useCallback(async () => {
    const list = await getAllKeyRingEntries();
    setKeyringFps(new Set(list.map(e => e.fingerprint)));
  }, []);

  useEffect(() => { reloadKeyring(); }, [reloadKeyring]);

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

  const handleAdd = useCallback(async (bundle: CertBundle) => {
    const fp = bundle.fingerprint || bundle.username;
    try {
      await addToKeyRing({
        fingerprint: fp,
        label: `${bundle.display_name} <${bundle.email || ''}>`,
        signingKeyJWK: {},
        encryptionKeyJWK: {},
        createdAt: Date.now(),
        type: 'imported',
      });
      toast.success(`${bundle.display_name} 주소록 추가`);
      reloadKeyring();
    } catch (err) {
      toast.error(`추가 실패: ${err instanceof Error ? err.message : '오류'}`);
    }
  }, [reloadKeyring]);

  const handleRemove = useCallback(async (bundle: CertBundle) => {
    const fp = bundle.fingerprint || bundle.username;
    if (!confirm(`${bundle.display_name}을(를) 주소록에서 삭제하시겠습니까?`)) return;
    try {
      await removeFromKeyRing(fp);
      toast.success('삭제 완료');
      reloadKeyring();
    } catch (err) {
      toast.error(`삭제 실패: ${err instanceof Error ? err.message : '오류'}`);
    }
  }, [reloadKeyring]);

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

      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
        <input
          type="text" value={query} onChange={e => handleSearch(e.target.value)}
          placeholder="검색 (최소 2자)"
          className="w-full border border-zinc-200 rounded-xl pl-10 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#175DDC]"
        />
      </div>

      {searching && <p className="text-sm text-zinc-400 text-center py-8">검색 중...</p>}
      {!searching && query.length >= 2 && results.length === 0 && (
        <p className="text-sm text-zinc-400 text-center py-8">검색 결과가 없습니다</p>
      )}
      {!searching && query.length < 2 && (
        <p className="text-sm text-zinc-400 text-center py-8">이름, 이메일, username으로 검색하세요</p>
      )}

      <div className="space-y-3">
        {results.map(b => (
          <ContactCard
            key={b.id} bundle={b}
            inKeyring={keyringFps.has(b.fingerprint || b.username)}
            onAdd={() => handleAdd(b)}
            onRemove={() => handleRemove(b)}
            onDetail={() => setDetail(b)}
          />
        ))}
      </div>

      {detail && <DetailDialog bundle={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

// ── 카드 ──
function ContactCard({ bundle, inKeyring, onAdd, onRemove, onDetail }: {
  bundle: CertBundle;
  inKeyring: boolean;
  onAdd: () => void;
  onRemove: () => void;
  onDetail: () => void;
}) {
  const logotype = useMemo(
    () => bundle.cert_classic ? extractLogotypeFromPem(bundle.cert_classic) : null,
    [bundle.cert_classic],
  );

  return (
    <div className="bg-white border border-zinc-200 rounded-xl p-4">
      <div className="flex items-start gap-3">
        {/* 로고 or 플레이스홀더 */}
        <div className="w-12 h-12 rounded-lg bg-zinc-100 flex items-center justify-center overflow-hidden shrink-0">
          {logotype ? (
            <img src={logotype} alt="logo" className="w-full h-full object-cover" />
          ) : (
            <Shield className="w-5 h-5 text-zinc-400" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="font-medium text-sm truncate">{bundle.display_name}</div>
          {bundle.email && <div className="text-xs text-zinc-500 truncate">{bundle.email}</div>}
          <div className="text-[10px] text-zinc-400 font-mono">@{bundle.username}</div>
          {bundle.fingerprint && (
            <div className="text-[10px] text-zinc-400 font-mono mt-0.5">0x{bundle.fingerprint.slice(0, 8)}</div>
          )}
          <div className="flex gap-1 mt-1.5">
            {bundle.cert_classic && <span className="text-[8px] bg-zinc-100 text-zinc-600 px-1.5 py-0.5 rounded font-bold">ECDSA</span>}
            {bundle.cert_kem && <span className="text-[8px] bg-violet-100 text-violet-600 px-1.5 py-0.5 rounded font-bold">ML-KEM</span>}
            {bundle.cert_dsa && <span className="text-[8px] bg-violet-100 text-violet-600 px-1.5 py-0.5 rounded font-bold">ML-DSA</span>}
          </div>
        </div>

        <div className="flex flex-col gap-1 shrink-0">
          {inKeyring ? (
            <>
              <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded text-center">추가됨</span>
              <button onClick={onDetail} title="자세히 보기"
                className="flex items-center gap-1 text-xs text-zinc-600 hover:bg-zinc-100 border border-zinc-200 rounded-lg px-2 py-1">
                <Info className="w-3 h-3" /> 자세히
              </button>
              <button onClick={onRemove} title="주소록 삭제"
                className="flex items-center gap-1 text-xs text-red-500 hover:bg-red-50 border border-red-200 rounded-lg px-2 py-1">
                <Trash2 className="w-3 h-3" /> 삭제
              </button>
            </>
          ) : (
            <>
              <button onClick={onAdd}
                className="flex items-center gap-1 text-xs text-[#175DDC] hover:bg-[#175DDC]/5 border border-[#175DDC]/30 rounded-lg px-3 py-1.5">
                <UserPlus className="w-3 h-3" /> 주소록 추가
              </button>
              <button onClick={onDetail}
                className="flex items-center gap-1 text-xs text-zinc-600 hover:bg-zinc-100 border border-zinc-200 rounded-lg px-3 py-1">
                <Info className="w-3 h-3" /> 자세히
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 자세히 보기 다이얼로그 ──
function DetailDialog({ bundle, onClose }: { bundle: CertBundle; onClose: () => void }) {
  const info = useMemo(
    () => bundle.cert_classic ? parsePemCertificate(bundle.cert_classic) : null,
    [bundle.cert_classic],
  );
  const logotype = useMemo(
    () => bundle.cert_classic ? extractLogotypeFromPem(bundle.cert_classic) : null,
    [bundle.cert_classic],
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full max-h-[85vh] overflow-auto"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100">
          <h2 className="font-semibold">인증서 자세히 보기</h2>
          <button onClick={onClose} className="p-1 hover:bg-zinc-100 rounded-lg">
            <XIcon className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* 로고 + 기본 */}
          <div className="flex items-center gap-3">
            <div className="w-16 h-16 rounded-xl bg-zinc-100 flex items-center justify-center overflow-hidden shrink-0">
              {logotype
                ? <img src={logotype} alt="logo" className="w-full h-full object-cover" />
                : <Shield className="w-7 h-7 text-zinc-400" />}
            </div>
            <div className="min-w-0">
              <div className="font-semibold truncate">{bundle.display_name}</div>
              {bundle.email && <div className="text-xs text-zinc-500 truncate">{bundle.email}</div>}
              <div className="text-[11px] text-zinc-400 font-mono">@{bundle.username}</div>
            </div>
          </div>

          {/* 메타 */}
          <dl className="text-xs space-y-1.5">
            {bundle.fingerprint && (
              <Row label="Fingerprint" value={<span className="font-mono text-[10px] break-all">0x{bundle.fingerprint}</span>} />
            )}
            {info && (
              <>
                <Row label="Serial" value={<span className="font-mono text-[10px] break-all">{info.serialNumber}</span>} />
                <Row label="유효 시작" value={info.notBefore.toLocaleDateString()} />
                <Row label="유효 종료" value={info.notAfter.toLocaleDateString()} />
              </>
            )}
            <Row label="업로드" value={new Date(bundle.uploaded_at).toLocaleString()} />
          </dl>

          {/* 배지 */}
          <div>
            <div className="text-[10px] text-zinc-500 uppercase mb-1">지원 알고리즘</div>
            <div className="flex flex-wrap gap-1">
              {bundle.cert_classic && <span className="text-[9px] bg-zinc-100 text-zinc-700 px-2 py-0.5 rounded font-bold">ECDSA P-256</span>}
              {bundle.cert_kem && <span className="text-[9px] bg-violet-100 text-violet-700 px-2 py-0.5 rounded font-bold">ML-KEM-1024</span>}
              {bundle.cert_dsa && <span className="text-[9px] bg-violet-100 text-violet-700 px-2 py-0.5 rounded font-bold">ML-DSA-87</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[90px_1fr] gap-2">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="text-zinc-800 min-w-0">{value}</dd>
    </div>
  );
}
