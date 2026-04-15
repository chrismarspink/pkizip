import { useLocation, Link } from 'react-router-dom';
import { Shield, FilePlus, FileArchive, ShieldCheck, Settings, Sparkles } from 'lucide-react';

const NAV_ITEMS = [
  { path: '/', icon: FilePlus, label: '생성' },
  { path: '/files', icon: FileArchive, label: '파일' },
  { path: '/files-temp', icon: Sparkles, label: '임시' },
  { path: '/certs', icon: ShieldCheck, label: '인증서' },
  { path: '/settings', icon: Settings, label: '설정' },
];

export function SidebarNav() {
  const { pathname } = useLocation();

  return (
    <nav className="flex flex-col items-center py-4 gap-1 bg-white border-r border-zinc-200 w-[60px] shrink-0">
      {/* PKIZIP 로고 */}
      <Link to="/" className="mb-4" title="PKIZIP">
        <div className="w-9 h-9 rounded-xl bg-[#1DC078] flex items-center justify-center">
          <Shield className="w-5 h-5 text-white" />
        </div>
      </Link>

      {/* 네비게이션 */}
      {NAV_ITEMS.map(item => {
        const active = pathname === item.path;
        return (
          <Link
            key={item.path}
            to={item.path}
            className={`
              flex flex-col items-center justify-center w-12 h-12 rounded-xl transition-colors
              ${active
                ? 'bg-[#1DC078]/10 text-[#1DC078]'
                : 'text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100'
              }
            `}
            title={item.label}
          >
            <item.icon className="w-5 h-5" />
            <span className="text-[9px] mt-0.5 font-medium">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
