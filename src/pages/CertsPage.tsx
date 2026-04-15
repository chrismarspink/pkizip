import { useState, useEffect } from 'react';
import { CertWallet } from '@/components/cert/CertWallet';
import { Identicon } from '@/components/cert/Identicon';
import { Shield, KeyRound, Clock } from 'lucide-react';
import { Link } from 'react-router-dom';
import { getAllIdentityMetas, getAllCertificates, getActiveIdentityId, getAllKeyRingEntries, type StoredCertificate, type PublicKeyEntry } from '@/lib/crypto/key-manager';

interface CertItem {
  cert: StoredCertificate;
  identityName: string;
  isActive: boolean;
}

export function CertsPage() {
  const [certs, setCerts] = useState<CertItem[]>([]);
  const [contacts, setContacts] = useState<PublicKeyEntry[]>([]);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    const metas = await getAllIdentityMetas();
    const allCerts = await getAllCertificates();
    const activeId = await getActiveIdentityId();

    const items: CertItem[] = metas
      .map(m => {
        const cert = allCerts.find(c => c.fingerprint === m.signingFingerprint);
        if (!cert) return null;
        return { cert, identityName: m.name, isActive: m.id === activeId };
      })
      .filter((x): x is CertItem => x !== null);

    items.sort((a, b) => (b.isActive ? 1 : 0) - (a.isActive ? 1 : 0));
    setCerts(items);

    const entries = await getAllKeyRingEntries();
    setContacts(entries.filter(e => e.type === 'imported'));
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 lg:py-10">
      <h1 className="text-xl font-bold mb-2">내 인증서</h1>
      <p className="text-sm text-zinc-500 mb-6">인증서 상세 정보와 아바타를 확인하세요.</p>

      {certs.length === 0 ? (
        <div className="text-center py-20">
          <Shield className="w-16 h-16 mx-auto mb-4 text-zinc-200" />
          <p className="text-zinc-500 mb-4">등록된 인증서가 없습니다</p>
          <Link
            to="/settings"
            className="inline-flex items-center gap-2 bg-[#1DC078] text-white px-5 py-2.5 rounded-xl text-sm font-medium"
          >
            <KeyRound className="w-4 h-4" /> 설정에서 키 생성
          </Link>
        </div>
      ) : (
        <CertWallet certs={certs} />
      )}

      {/* 주소록 인증서 (타인) */}
      {contacts.length > 0 && (
        <div className="mt-10">
          <h2 className="text-lg font-bold mb-4">주소록</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {contacts.map(c => (
              <div key={c.fingerprint} className="rounded-xl border border-zinc-200 bg-white p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-zinc-100 p-0.5 shrink-0">
                  <Identicon value={c.fingerprint} size={36} className="rounded-full overflow-hidden" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm truncate">{c.label}</div>
                  <div className="text-[10px] font-mono text-zinc-400 truncate">0x{c.fingerprint}</div>
                  <div className="text-[10px] text-zinc-400 flex items-center gap-1 mt-0.5">
                    <Clock className="w-2.5 h-2.5" /> {new Date(c.createdAt).toLocaleDateString('ko-KR')}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
