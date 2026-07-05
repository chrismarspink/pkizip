// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Supabase 클라이언트를 모킹 — 실제 네트워크/GoTrue 없이 부착 여부만 관찰.
const h = vi.hoisted(() => ({
  onAuthStateChange: vi.fn(),
  signInWithPassword: vi.fn(async () => ({ error: null })),
  signUp: vi.fn(async () => ({ error: null })),
  signOut: vi.fn(async () => ({ error: null })),
}));

vi.mock('./client', () => ({
  supabase: {
    auth: {
      onAuthStateChange: h.onAuthStateChange,
      signInWithPassword: h.signInWithPassword,
      signUp: h.signUp,
      signOut: h.signOut,
    },
    // loadProfile 경로 방어용 체이너블 스텁 (본 테스트에서는 세션을 발화하지 않으므로 미호출)
    from: () => ({
      select: () => ({ single: async () => ({ data: null }), eq: async () => ({ data: null }) }),
      update: () => ({ eq: async () => ({ data: null }) }),
    }),
  },
}));

describe('C2 — 인증 부팅 게이팅 (initAuth)', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.values(h).forEach(fn => fn.mockClear());
    localStorage.clear();
  });

  it('솔로 사용자(세션 토큰 없음): 부팅 시 리스너 미부착 + 서버 미접속 + loading=false', async () => {
    const { useAuthStore } = await import('./auth-store');
    // onAuthStateChange가 호출되지 않음 = initAuth 미실행 = 서버 상태 조회 안 함
    expect(h.onAuthStateChange).not.toHaveBeenCalled();
    expect(useAuthStore.getState().loading).toBe(false);
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('이전 로그인 세션 존재: 부팅 시 initAuth 실행 (세션 복원 경로)', async () => {
    // getAccessToken()이 읽는 Supabase auth-token localStorage 키
    const AUTH_TOKEN_KEY = 'sb-ikyhpuerwljxypyzkpiw-auth-token';
    localStorage.setItem(AUTH_TOKEN_KEY, JSON.stringify({ access_token: 'persisted-token' }));

    await import('./auth-store'); // 모듈 로드 시 게이트가 토큰을 감지
    expect(h.onAuthStateChange).toHaveBeenCalledTimes(1);
  });

  it('signIn(): 솔로 상태에서도 로그인 시 initAuth를 명시적으로 부착', async () => {
    const { useAuthStore } = await import('./auth-store');
    expect(h.onAuthStateChange).not.toHaveBeenCalled(); // 아직 솔로

    await useAuthStore.getState().signIn('a@b.com', 'pw');

    expect(h.signInWithPassword).toHaveBeenCalledWith({ email: 'a@b.com', password: 'pw' });
    expect(h.onAuthStateChange).toHaveBeenCalledTimes(1); // 로그인이 리스너를 부착함
  });

  it('initAuth는 중복 부착하지 않음 (idempotent)', async () => {
    const { initAuth } = await import('./auth-store');
    initAuth();
    initAuth();
    initAuth();
    expect(h.onAuthStateChange).toHaveBeenCalledTimes(1);
  });
});
