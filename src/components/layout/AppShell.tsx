import { Outlet } from 'react-router-dom';
import { SidebarNav } from './SidebarNav';
import { BottomTabBar } from './BottomTabBar';
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
        <Outlet />
      </main>

      {/* 하단 탭바: 모바일 */}
      {isMobile && <BottomTabBar />}

      <Toaster position={isMobile ? 'top-center' : 'bottom-right'} richColors />
    </div>
  );
}
