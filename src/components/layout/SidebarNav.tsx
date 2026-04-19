import { useLocation, Link } from 'react-router-dom';
import { Shield, Home, FilePlus, FileArchive, ShieldCheck, BookUser, Settings } from 'lucide-react';
import { APP_VERSION } from '@/version';

const NAV_ITEMS = [
  { path: '/', icon: Home, label: '홈' },
  { path: '/create', icon: FilePlus, label: '생성' },
  { path: '/files', icon: FileArchive, label: '파일' },
  { path: '/certs', icon: ShieldCheck, label: '인증서' },
  { path: '/contacts', icon: BookUser, label: '주소록' },
  { path: '/settings', icon: Settings, label: '설정' },
];

export function SidebarNav() {
  const { pathname } = useLocation();

  return (
    <nav className="flex flex-col items-center py-4 gap-1 bg-white border-r border-zinc-200 w-[60px] shrink-0">
      {/* PKIZIP 로고 (호버 시 버전 표시) */}
      <Link to="/" className="mb-4 group relative" title={`PKIZIP v${APP_VERSION}`}>
        <div className="w-9 h-9 rounded-xl bg-[#175DDC] flex items-center justify-center">
          <Shield className="w-5 h-5 text-white" />
        </div>
        {/* 커스텀 버전 툴팁 */}
        <div className="absolute left-full top-1/2 -translate-y-1/2 ml-3 px-2.5 py-1.5 bg-zinc-900 text-white text-[10px] rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50 shadow-lg">
          <div className="font-semibold">PKIZIP</div>
          <div className="text-zinc-400 font-mono">v{APP_VERSION}</div>
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
                ? 'bg-[#175DDC]/10 text-[#175DDC]'
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
