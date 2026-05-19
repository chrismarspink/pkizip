import { useLocation, Link } from 'react-router-dom';
import { Home, FilePlus, FileArchive, ShieldCheck, BookUser, Settings, FolderSearch, FlaskConical } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export function BottomTabBar() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const TABS = [
    { path: '/', icon: Home, label: t('nav.home') },
    { path: '/create', icon: FilePlus, label: t('nav.create') },
    { path: '/files', icon: FileArchive, label: t('nav.files') },
    { path: '/explorer', icon: FolderSearch, label: t('nav.explorer') },
    { path: '/certs', icon: ShieldCheck, label: t('nav.certificates') },
    { path: '/contacts', icon: BookUser, label: t('nav.contacts') },
    { path: '/settings', icon: Settings, label: t('nav.settings') },
    { path: '/policies', icon: FlaskConical, label: t('nav.policies') },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-zinc-200 pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-center justify-around h-14">
        {TABS.map(tab => {
          const active = pathname === tab.path;
          return (
            <Link
              key={tab.path}
              to={tab.path}
              className={`flex flex-col items-center justify-center gap-0.5 flex-1 h-full min-w-0 px-0.5 transition-colors ${
                active ? 'text-[#175DDC]' : 'text-zinc-400'
              }`}
            >
              <tab.icon className="w-5 h-5 flex-shrink-0" />
              <span className="text-[9px] font-medium truncate max-w-full">{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
