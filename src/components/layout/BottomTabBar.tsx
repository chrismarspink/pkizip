import { useLocation, Link } from 'react-router-dom';
import { FilePlus, FileArchive, ShieldCheck, Settings } from 'lucide-react';

const TABS = [
  { path: '/', icon: FilePlus, label: '생성' },
  { path: '/files', icon: FileArchive, label: '파일' },
  { path: '/certs', icon: ShieldCheck, label: '인증서' },
  { path: '/settings', icon: Settings, label: '설정' },
];

export function BottomTabBar() {
  const { pathname } = useLocation();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-zinc-200 pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-center justify-around h-14">
        {TABS.map(tab => {
          const active = pathname === tab.path;
          return (
            <Link
              key={tab.path}
              to={tab.path}
              className={`flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-colors ${
                active ? 'text-[#1DC078]' : 'text-zinc-400'
              }`}
            >
              <tab.icon className="w-5 h-5" />
              <span className="text-[10px] font-medium">{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
