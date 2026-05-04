/**
 * TeamLayout — /team/:slug 하위 모든 페이지의 공통 쉘
 * 좌측 사이드바 + Outlet
 */
import { useEffect, useState, createContext, useContext } from 'react';
import { Outlet, NavLink, useParams, Navigate, Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Users, Mail, BookUser, Shield, FileText,
  Settings, CreditCard, ArrowLeft, Building2, Menu, X,
} from 'lucide-react';
import { useAuthStore } from '@/lib/supabase/auth-store';
import { getTenantBySlug, listMembers, type Tenant } from '@/lib/supabase/tenants';
import { UserMenu } from '@/components/auth/UserMenu';

type Role = 'owner' | 'admin' | 'member';

interface TeamCtx {
  tenant: Tenant;
  myRole: Role;
}
const Ctx = createContext<TeamCtx | null>(null);
export function useTeam(): TeamCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTeam must be inside TeamLayout');
  return v;
}

interface NavItem {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  group: 'general' | 'users' | 'security' | 'ops';
  roles?: Role[]; // 표시 가능 역할 (지정 안 하면 모두)
}

const NAV: NavItem[] = [
  { to: '', icon: LayoutDashboard, label: '대시보드', group: 'general' },
  { to: 'members', icon: Users, label: '멤버', group: 'users' },
  { to: 'invites', icon: Mail, label: '초대', group: 'users', roles: ['owner','admin'] },
  { to: 'contacts', icon: BookUser, label: '공용 주소록', group: 'users' },
  { to: 'policies', icon: Shield, label: '정책', group: 'security', roles: ['owner','admin'] },
  { to: 'audit', icon: FileText, label: '감사 로그', group: 'security', roles: ['owner','admin'] },
  { to: 'settings', icon: Settings, label: '설정', group: 'ops', roles: ['owner','admin'] },
  { to: 'billing', icon: CreditCard, label: '결제', group: 'ops', roles: ['owner'] },
];

const GROUP_LABEL: Record<NavItem['group'], string> = {
  general: '일반', users: '사용자', security: '보안', ops: '운영',
};

export function TeamLayout() {
  const { slug } = useParams();
  const { user, loading } = useAuthStore();
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [myRole, setMyRole] = useState<Role | null>(null);
  const [resolving, setResolving] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    (async () => {
      if (!slug || !user) return;
      setResolving(true);
      try {
        const t = await getTenantBySlug(slug);
        if (!t) { setTenant(null); return; }
        setTenant(t);
        const members = await listMembers(t.id);
        const me = members.find(m => m.user_id === user.id);
        setMyRole((me?.role as Role) ?? null);
      } finally {
        setResolving(false);
      }
    })();
  }, [slug, user?.id]);

  if (loading) return <div className="p-6">불러오는 중…</div>;
  if (!user) return <Navigate to="/" replace />;
  if (resolving) return <div className="p-6">조직 확인 중…</div>;
  if (!tenant) return <div className="p-6 text-red-500">조직을 찾을 수 없습니다</div>;
  if (!myRole) return <div className="p-6 text-red-500">접근 권한이 없습니다</div>;

  const items = NAV.filter(it => !it.roles || it.roles.includes(myRole));

  return (
    <Ctx.Provider value={{ tenant, myRole }}>
      {/* 조직 관리 전용 상단 바 — 메인 사이드바 없음, UserMenu + 'PKIZIP 으로 돌아가기' 만 */}
      <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-zinc-100 bg-white">
        <Link to="/" className="flex items-center gap-2 text-sm text-zinc-600 hover:text-zinc-900">
          <ArrowLeft className="w-4 h-4" />
          <span className="font-semibold">PKIZIP 메인으로</span>
        </Link>
        <UserMenu />
      </div>
      <div className="flex min-h-[calc(100vh-44px)] bg-zinc-50">
        {/* 사이드바 (데스크탑 sticky, 모바일 drawer) */}
        <aside className={`
          ${drawerOpen ? 'fixed inset-y-0 left-0 z-40' : 'hidden'} lg:block
          w-[220px] bg-white border-r border-zinc-200 flex flex-col shrink-0
        `}>
          <div className="px-4 py-4 border-b border-zinc-100">
            <Link to="/me" className="text-[10px] text-zinc-400 hover:text-zinc-700 flex items-center gap-1">
              <ArrowLeft className="w-3 h-3" /> 내 계정
            </Link>
            <div className="mt-2 flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-purple-100 text-purple-700 flex items-center justify-center shrink-0">
                <Building2 className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate">{tenant.name}</div>
                <div className="text-[10px] text-zinc-500 font-mono truncate">{tenant.slug}</div>
              </div>
            </div>
            <div className="mt-2 flex gap-1">
              <span className="text-[9px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">{tenant.plan}</span>
              <span className="text-[9px] bg-zinc-100 text-zinc-600 px-1.5 py-0.5 rounded">{myRole}</span>
            </div>
          </div>

          <nav className="flex-1 overflow-auto px-2 py-3">
            {(['general','users','security','ops'] as const).map(g => {
              const groupItems = items.filter(it => it.group === g);
              if (groupItems.length === 0) return null;
              return (
                <div key={g} className="mb-3">
                  <div className="px-2 py-1 text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                    {GROUP_LABEL[g]}
                  </div>
                  {groupItems.map(it => (
                    <NavLink key={it.to} to={it.to} end={it.to === ''}
                      className={({ isActive }) => `
                        flex items-center gap-2 px-2 py-2 rounded-lg text-sm transition-colors
                        ${isActive
                          ? 'bg-[#175DDC]/10 text-[#175DDC] font-semibold'
                          : 'text-zinc-600 hover:bg-zinc-100'}
                      `}>
                      <it.icon className="w-4 h-4 shrink-0" /> {it.label}
                    </NavLink>
                  ))}
                </div>
              );
            })}
          </nav>

          <div className="px-4 py-3 border-t border-zinc-100 lg:hidden">
            <button onClick={() => setDrawerOpen(false)}
              className="w-full text-xs text-zinc-500 flex items-center gap-1">
              <X className="w-3 h-3" /> 닫기
            </button>
          </div>
        </aside>

        {drawerOpen && (
          <div className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setDrawerOpen(false)} />
        )}

        {/* 메인 */}
        <main className="flex-1 min-w-0">
          <div className="lg:hidden flex items-center gap-2 px-4 py-3 border-b border-zinc-200 bg-white">
            <button onClick={() => setDrawerOpen(true)} className="p-1">
              <Menu className="w-5 h-5" />
            </button>
            <span className="text-sm font-semibold truncate">{tenant.name}</span>
          </div>
          <div className="p-4 lg:p-8 max-w-6xl">
            <Outlet />
          </div>
        </main>
      </div>
    </Ctx.Provider>
  );
}
