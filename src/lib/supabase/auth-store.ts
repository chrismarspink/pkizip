/**
 * Supabase 인증 + 프로필 + 테넌트 상태 관리
 */
import { create } from 'zustand';
import { supabase } from './client';
import type { User, Session } from '@supabase/supabase-js';

export interface Profile {
  id: string;
  display_name: string | null;
  active_tenant_id: string | null;
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  plan: 'local' | 'team' | 'enterprise';
  role?: 'owner' | 'admin' | 'member';
}

interface AuthState {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  activeTenant: Tenant | null;
  loading: boolean;

  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  loadProfile: () => Promise<void>;
  switchTenant: (tenantId: string) => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  session: null,
  profile: null,
  activeTenant: null,
  loading: true,

  signIn: async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  },

  signUp: async (email, password) => {
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ user: null, session: null, profile: null, activeTenant: null });
  },

  loadProfile: async () => {
    const { data: p } = await supabase.from('profiles').select('*').single();
    if (!p) return;

    const { data: members } = await supabase
      .from('tenant_members')
      .select('tenant_id, role, tenants(*)')
      .eq('user_id', p.id);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const active = members?.find((m: any) => m.tenant_id === p.active_tenant_id);
    set({
      profile: p,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      activeTenant: active ? { ...(active as any).tenants, role: (active as any).role } : null,
    });
  },

  switchTenant: async (tenantId) => {
    await supabase.from('profiles')
      .update({ active_tenant_id: tenantId })
      .eq('id', get().user!.id);
    await get().loadProfile();
  },
}));

// 인증 상태 변경 리스너
supabase.auth.onAuthStateChange(async (_event, session) => {
  useAuthStore.setState({ session, user: session?.user ?? null, loading: false });
  if (session?.user) {
    await useAuthStore.getState().loadProfile();
    // TSA 기본 인증서 등록 (최초 로그인 시)
    import('../tsa-certs').then(m => m.ensureTsaCerts(session.user.id)).catch(() => {});
  }
});
