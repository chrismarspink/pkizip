import { Outlet } from 'react-router-dom';
import { SidebarNav } from './SidebarNav';
import { BottomTabBar } from './BottomTabBar';
import { HeaderStatus } from './HeaderStatus';
import { UserMenu } from '@/components/auth/UserMenu';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { Toaster } from 'sonner';

export function AppShell() {
  const isMobile = useIsMobile();

  return (
    <div className="h-full flex">
      {/* 사이드바: 태블릿/데스크탑 */}
      {!isMobile && <SidebarNav />}

      {/* 메인 콘텐츠 */}
      <main className={`flex-1 overflow-auto ${isMobile ? 'pb-16' : ''}`}>
        {/* 상단 바: 상태 클러스터 + 사용자 메뉴 */}
        <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-zinc-100 bg-white">
          <HeaderStatus />
          <UserMenu />
        </div>
        <Outlet />
      </main>

      {/* 하단 탭바: 모바일 */}
      {isMobile && <BottomTabBar />}

      <Toaster position={isMobile ? 'top-center' : 'bottom-right'} richColors />
    </div>
  );
}
