/**
 * UserMenu — 로그인 사용자 드롭다운 메뉴
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { LogOut, UserRound, ShieldAlert, Building2, ChevronDown } from 'lucide-react';
import { useAuthStore } from '@/lib/supabase/auth-store';
import { isSystemAdmin } from '@/lib/supabase/system-admin';
import { AuthDialog } from './AuthDialog';
import { toast } from 'sonner';

export function UserMenu() {
  const { user, profile, signOut, loading } = useAuthStore();
  const [showAuth, setShowAuth] = useState(false);
  const [open, setOpen] = useState(false);
  const [isSysAdmin, setIsSysAdmin] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) { setIsSysAdmin(false); return; }
    isSystemAdmin().then(setIsSysAdmin);
  }, [user?.id]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  if (loading) return null;

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

  const initial = (profile?.display_name || user.email || '?')[0].toUpperCase();
  const name = profile?.display_name || user.email?.split('@')[0] || '';

  const handleSignOut = async () => {
    await signOut();
    setOpen(false);
    toast.success('로그아웃 완료');
  };

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-zinc-100">
        <div className="w-7 h-7 rounded-full bg-[#175DDC] flex items-center justify-center text-white text-xs font-bold shrink-0">
          {initial}
        </div>
        <div className="min-w-0 hidden sm:block text-left">
          <div className="text-[11px] font-medium text-zinc-700 truncate max-w-[100px]">{name}</div>
        </div>
        <ChevronDown className="w-3 h-3 text-zinc-400" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-56 bg-white border border-zinc-200 rounded-xl shadow-lg py-1 z-50">
          <div className="px-3 py-2 border-b border-zinc-100">
            <div className="text-xs font-semibold text-zinc-800 truncate">{name}</div>
            <div className="text-[10px] text-zinc-500 truncate">{user.email}</div>
          </div>
          <Link to="/me" onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-zinc-50">
            <UserRound className="w-4 h-4 text-zinc-400" /> 내 계정
          </Link>
          <Link to="/me" onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-zinc-50">
            <Building2 className="w-4 h-4 text-zinc-400" /> 소속 테넌트
          </Link>
          {isSysAdmin && (
            <>
              <div className="border-t border-zinc-100 my-1" />
              <Link to="/admin" onClick={() => setOpen(false)}
                className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-amber-50 text-amber-700">
                <ShieldAlert className="w-4 h-4" /> 시스템 관리
              </Link>
            </>
          )}
          <div className="border-t border-zinc-100 my-1" />
          <button onClick={handleSignOut}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-red-50 text-red-600">
            <LogOut className="w-4 h-4" /> 로그아웃
          </button>
        </div>
      )}
    </div>
  );
}
