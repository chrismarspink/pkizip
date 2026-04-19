/**
 * UserMenu — 로그인 사용자 드롭다운 메뉴
 */
import { useState } from 'react';
import { LogOut, UserRound } from 'lucide-react';
import { useAuthStore } from '@/lib/supabase/auth-store';
import { AuthDialog } from './AuthDialog';
import { toast } from 'sonner';

export function UserMenu() {
  const { user, profile, signOut, loading } = useAuthStore();
  const [showAuth, setShowAuth] = useState(false);

  if (loading) return null;

  // 비로그인
  if (!user) {
    return (
      <>
        <button onClick={() => setShowAuth(true)}
          className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-[#175DDC] transition-colors px-2 py-1.5 rounded-lg hover:bg-zinc-100">
          <UserRound className="w-4 h-4" /> 로그인
        </button>
        <AuthDialog open={showAuth} onOpenChange={setShowAuth} />
      </>
    );
  }

  // 로그인
  const initial = (profile?.display_name || user.email || '?')[0].toUpperCase();
  const name = profile?.display_name || user.email?.split('@')[0] || '';

  const handleSignOut = async () => {
    await signOut();
    toast.success('로그아웃 완료');
  };

  return (
    <div className="flex items-center gap-2 px-1">
      {/* 아바타 */}
      <div className="w-7 h-7 rounded-full bg-[#175DDC] flex items-center justify-center text-white text-xs font-bold shrink-0">
        {initial}
      </div>
      <div className="min-w-0 hidden sm:block">
        <div className="text-[11px] font-medium text-zinc-700 truncate max-w-[100px]">{name}</div>
      </div>
      <button onClick={handleSignOut} title="로그아웃"
        className="p-1.5 text-zinc-400 hover:text-red-500 hover:bg-zinc-100 rounded-lg transition-colors">
        <LogOut className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
