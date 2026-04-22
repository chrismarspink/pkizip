/**
 * ContactsPage — 내 주소록 + 인증서 디렉토리 검색
 */
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Search, UserPlus, Lock, Info, Trash2, X as XIcon, Shield } from 'lucide-react';
import { useAuthStore } from '@/lib/supabase/auth-store';
import { searchCertBundles, type CertBundle } from '@/lib/supabase/cert-directory';
import {
  addToKeyRing, getAllKeyRingEntries, removeFromKeyRing, type PublicKeyEntry,
} from '@/lib/crypto/key-manager';
import { parsePemCertificate, extractLogotypeFromPem } from '@/lib/crypto/certificate';
import { AuthDialog } from '@/components/auth/AuthDialog';
import { toast } from 'sonner';

// 통합 카드 뷰 모델
interface Contact {
  key: string;
  displayName: string;
  email?: string;
  username?: string;
  fingerprint: string;
  certClassicPem?: string;
  certKemPem?: string;
  certDsaPem?: string;
}

function fromBundle(b: CertBundle): Contact {
  return {
    key: b.fingerprint || b.username,
    displayName: b.display_name,
    email: b.email,
    username: b.username,
    fingerprint: b.fingerprint || b.username,
    certClassicPem: b.cert_classic,
    certKemPem: b.cert_kem,
    certDsaPem: b.cert_dsa,
  };
}
function fromEntry(e: PublicKeyEntry): Contact {
  return {
    key: e.fingerprint,
    displayName: e.displayName ?? e.label.replace(/\s*<[^>]*>\s*$/, ''),
    email: e.email,
    username: e.username,
    fingerprint: e.fingerprint,
    certClassicPem: e.certClassicPem,
    certKemPem: e.certKemPem,
    certDsaPem: e.certDsaPem,
  };
}

export function ContactsPage() {
  const user = useAuthStore(s => s.user);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CertBundle[]>([]);
  const [searching, setSearching] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [myKeyring, setMyKeyring] = useState<PublicKeyEntry[]>([]);
  const [detail, setDetail] = useState<Contact | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const myFps = useMemo(() => new Set(myKeyring.map(e => e.fingerprint)), [myKeyring]);

  const reloadKeyring = useCallback(async () => {
    const list = await getAllKeyRingEntries();
    setMyKeyring(list.filter(e => e.type === 'imported'));
  }, []);
  useEffect(() => { reloadKeyring(); }, [reloadKeyring]);

  const handleSearch = useCallback((q: string) => {
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.trim().length < 2) { setResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try { setResults(await searchCertBundles(q)); }
      catch { setResults([]); }
      finally { setSearching(false); }
    }, 300);
  }, []);

  const handleAdd = useCallback(async (b: CertBundle) => {
    const fp = b.fingerprint || b.username;
    try {
      await addToKeyRing({
        fingerprint: fp,
        label: `${b.display_name}${b.email ? ` <${b.email}>` : ''}`,
        signingKeyJWK: {},
        encryptionKeyJWK: {},
        createdAt: Date.now(),
        type: 'imported',
        displayName: b.display_name,
        email: b.email,
        username: b.username,
        certClassicPem: b.cert_classic,
        certKemPem: b.cert_kem,
        certDsaPem: b.cert_dsa,
      });
      toast.success(`${b.display_name} 주소록 추가`);
      reloadKeyring();
    } catch (err) {
      toast.error(`추가 실패: ${err instanceof Error ? err.message : '오류'}`);
    }
  }, [reloadKeyring]);

  const handleRemove = useCallback(async (c: Contact) => {
    if (!confirm(`${c.displayName}을(를) 주소록에서 삭제하시겠습니까?`)) return;
    try {
      await removeFromKeyRing(c.fingerprint);
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
            className="bg-[#175DDC] text-white px-5 py-2.5 rounded-xl text-sm font-medium">로그인</button>
        </div>
        <AuthDialog open={showAuth} onOpenChange={setShowAuth} />
      </div>
    );
  }

  const isSearchMode = query.trim().length >= 2;

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 lg:py-10">
      <h1 className="text-xl font-bold mb-2">주소록</h1>
      <p className="text-sm text-zinc-500 mb-4">이름, 이메일, username으로 인증서를 검색하세요.</p>

      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
        <input type="text" value={query} onChange={e => handleSearch(e.target.value)}
          placeholder="검색 (최소 2자)"
          className="w-full border border-zinc-200 rounded-xl pl-10 pr-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#175DDC]" />
      </div>

      {isSearchMode ? (
        <SearchResults
          searching={searching} results={results} myFps={myFps}
          onAdd={handleAdd} onRemove={c => {
            const entry = myKeyring.find(e => e.fingerprint === c.fingerprint);
            if (entry) handleRemove(fromEntry(entry));
          }}
          onDetail={setDetail}
        />
      ) : (
        <MyKeyring
          list={myKeyring} onRemove={handleRemove} onDetail={setDetail}
        />
      )}

      {detail && <DetailDialog contact={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

// ── 내 주소록 ──
function MyKeyring({ list, onRemove, onDetail }: {
  list: PublicKeyEntry[];
  onRemove: (c: Contact) => void;
  onDetail: (c: Contact) => void;
}) {
  if (list.length === 0) {
    return (
      <div className="text-center py-12 text-sm text-zinc-400">
        주소록이 비어있습니다. 상단 검색창으로 인증서를 찾아 추가하세요.
      </div>
    );
  }
  return (
    <div>
      <div className="text-xs text-zinc-500 mb-2">내 주소록 ({list.length})</div>
      <div className="space-y-3">
        {list.map(e => {
          const c = fromEntry(e);
          return (
            <ContactCard key={c.key} contact={c} inKeyring={true}
              onAdd={() => {}}
              onRemove={() => onRemove(c)}
              onDetail={() => onDetail(c)} />
          );
        })}
      </div>
    </div>
  );
}

// ── 검색 결과 ──
function SearchResults({ searching, results, myFps, onAdd, onRemove, onDetail }: {
  searching: boolean;
  results: CertBundle[];
  myFps: Set<string>;
  onAdd: (b: CertBundle) => void;
  onRemove: (c: Contact) => void;
  onDetail: (c: Contact) => void;
}) {
  if (searching) return <p className="text-sm text-zinc-400 text-center py-8">검색 중...</p>;
  if (results.length === 0) return <p className="text-sm text-zinc-400 text-center py-8">검색 결과가 없습니다</p>;
  return (
    <div className="space-y-3">
      {results.map(b => {
        const c = fromBundle(b);
        const inKeyring = myFps.has(c.fingerprint);
        return (
          <ContactCard key={c.key} contact={c} inKeyring={inKeyring}
            onAdd={() => onAdd(b)}
            onRemove={() => onRemove(c)}
            onDetail={() => onDetail(c)} />
        );
      })}
    </div>
  );
}

// ── 카드 ──
function ContactCard({ contact, inKeyring, onAdd, onRemove, onDetail }: {
  contact: Contact;
  inKeyring: boolean;
  onAdd: () => void;
  onRemove: () => void;
  onDetail: () => void;
}) {
  const logotype = useMemo(
    () => contact.certClassicPem ? extractLogotypeFromPem(contact.certClassicPem) : null,
    [contact.certClassicPem],
  );
  return (
    <div className="bg-white border border-zinc-200 rounded-xl p-4">
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 rounded-lg bg-zinc-100 flex items-center justify-center overflow-hidden shrink-0">
          {logotype
            ? <img src={logotype} alt="logo" className="w-full h-full object-cover" />
            : <Shield className="w-5 h-5 text-zinc-400" />}
        </div>

        <div className="min-w-0 flex-1">
          <div className="font-medium text-sm truncate">{contact.displayName}</div>
          {contact.email && <div className="text-xs text-zinc-500 truncate">{contact.email}</div>}
          {contact.username && <div className="text-[10px] text-zinc-400 font-mono">@{contact.username}</div>}
          {contact.fingerprint && (
            <div className="text-[10px] text-zinc-400 font-mono mt-0.5">0x{contact.fingerprint.slice(0, 8)}</div>
          )}
          <div className="flex gap-1 mt-1.5">
            {contact.certClassicPem && <span className="text-[8px] bg-zinc-100 text-zinc-600 px-1.5 py-0.5 rounded font-bold">ECDSA</span>}
            {contact.certKemPem && <span className="text-[8px] bg-violet-100 text-violet-600 px-1.5 py-0.5 rounded font-bold">ML-KEM</span>}
            {contact.certDsaPem && <span className="text-[8px] bg-violet-100 text-violet-600 px-1.5 py-0.5 rounded font-bold">ML-DSA</span>}
          </div>
        </div>

        <div className="flex flex-col gap-1 shrink-0">
          {inKeyring ? (
            <>
              <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded text-center">추가됨</span>
              <button onClick={onDetail}
                className="flex items-center gap-1 text-xs text-zinc-600 hover:bg-zinc-100 border border-zinc-200 rounded-lg px-2 py-1">
                <Info className="w-3 h-3" /> 자세히
              </button>
              <button onClick={onRemove}
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

// ── 자세히 보기 ──
function DetailDialog({ contact, onClose }: { contact: Contact; onClose: () => void }) {
  const info = useMemo(
    () => contact.certClassicPem ? parsePemCertificate(contact.certClassicPem) : null,
    [contact.certClassicPem],
  );
  const logotype = useMemo(
    () => contact.certClassicPem ? extractLogotypeFromPem(contact.certClassicPem) : null,
    [contact.certClassicPem],
  );
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full max-h-[85vh] overflow-auto"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100">
          <h2 className="font-semibold">인증서 자세히 보기</h2>
          <button onClick={onClose} className="p-1 hover:bg-zinc-100 rounded-lg"><XIcon className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-16 h-16 rounded-xl bg-zinc-100 flex items-center justify-center overflow-hidden shrink-0">
              {logotype
                ? <img src={logotype} alt="logo" className="w-full h-full object-cover" />
                : <Shield className="w-7 h-7 text-zinc-400" />}
            </div>
            <div className="min-w-0">
              <div className="font-semibold truncate">{contact.displayName}</div>
              {contact.email && <div className="text-xs text-zinc-500 truncate">{contact.email}</div>}
              {contact.username && <div className="text-[11px] text-zinc-400 font-mono">@{contact.username}</div>}
            </div>
          </div>
          <dl className="text-xs space-y-1.5">
            {contact.fingerprint && (
              <Row label="Fingerprint" value={<span className="font-mono text-[10px] break-all">0x{contact.fingerprint}</span>} />
            )}
            {info && (
              <>
                <Row label="Serial" value={<span className="font-mono text-[10px] break-all">{info.serialNumber}</span>} />
                <Row label="유효 시작" value={info.notBefore.toLocaleDateString()} />
                <Row label="유효 종료" value={info.notAfter.toLocaleDateString()} />
              </>
            )}
          </dl>
          <div>
            <div className="text-[10px] text-zinc-500 uppercase mb-1">지원 알고리즘</div>
            <div className="flex flex-wrap gap-1">
              {contact.certClassicPem && <span className="text-[9px] bg-zinc-100 text-zinc-700 px-2 py-0.5 rounded font-bold">ECDSA P-256</span>}
              {contact.certKemPem && <span className="text-[9px] bg-violet-100 text-violet-700 px-2 py-0.5 rounded font-bold">ML-KEM-1024</span>}
              {contact.certDsaPem && <span className="text-[9px] bg-violet-100 text-violet-700 px-2 py-0.5 rounded font-bold">ML-DSA-87</span>}
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
