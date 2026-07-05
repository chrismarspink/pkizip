import { useState } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { Shield, Home, FilePlus, FileArchive, ShieldCheck, BookUser, Settings, FolderSearch, FlaskConical, BarChart3, Scale, MoreHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { APP_VERSION } from '@/version';

export function SidebarNav() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const [showMore, setShowMore] = useState(false);
  // 일상 동선 5개만 기본 노출 — 나머지는 "더보기"로 접음(라우트는 그대로 유지)
  const PRIMARY = [
    { path: '/', icon: Home, label: t('nav.home') },
    { path: '/create', icon: FilePlus, label: t('nav.create') },
    { path: '/files', icon: FileArchive, label: t('nav.files') },
    { path: '/contacts', icon: BookUser, label: t('nav.contacts') },
    { path: '/settings', icon: Settings, label: t('nav.settings') },
  ];
  const SECONDARY = [
    { path: '/explorer', icon: FolderSearch, label: t('nav.explorer') },
    { path: '/stats', icon: BarChart3, label: t('nav.stats') },
    { path: '/certs', icon: ShieldCheck, label: t('nav.certificates') },
    { path: '/policies', icon: FlaskConical, label: t('nav.policies') },
    { path: '/compliance', icon: Scale, label: t('nav.compliance') },
  ];
  // 접힌 그룹에 현재 페이지가 있으면 자동으로 펼침
  const inSecondary = SECONDARY.some(i => i.path === pathname);
  const NAV_ITEMS = [...PRIMARY, ...((showMore || inSecondary) ? SECONDARY : [])];

  return (
    <nav className="flex flex-col items-center py-4 gap-1 bg-white border-r border-zinc-200 w-[60px] shrink-0 overflow-y-auto">
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

      {/* 더보기 — 통계·정책·컴플라이언스·인증서·탐색기 접기 (라우트는 유지) */}
      {!inSecondary && (
        <button
          onClick={() => setShowMore(v => !v)}
          className="flex flex-col items-center justify-center w-12 h-12 rounded-xl text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors"
          title={showMore ? '접기' : '더보기'}
        >
          <MoreHorizontal className="w-5 h-5" />
          <span className="text-[9px] mt-0.5 font-medium">{showMore ? '접기' : '더보기'}</span>
        </button>
      )}
    </nav>
  );
}
