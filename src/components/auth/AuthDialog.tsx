/**
 * AuthDialog — 이메일 전용 로그인/회원가입
 * Google 소셜 없음
 */
import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Mail, Lock } from 'lucide-react';
import { useAuthStore } from '@/lib/supabase/auth-store';
import { toast } from 'sonner';

interface AuthDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AuthDialog({ open, onOpenChange }: AuthDialogProps) {
  const [tab, setTab] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { signIn, signUp } = useAuthStore();

  const handleSubmit = async () => {
    setError('');
    if (!email || !password) { setError('이메일과 패스워드를 입력하세요.'); return; }

    if (tab === 'signup') {
      if (password.length < 8) { setError('패스워드는 8자 이상이어야 합니다.'); return; }
      if (password !== passwordConfirm) { setError('패스워드가 일치하지 않습니다.'); return; }
    }

    setLoading(true);
    try {
      if (tab === 'login') {
        await signIn(email, password);
        toast.success('로그인 성공');
        onOpenChange(false);
      } else {
        await signUp(email, password);
        toast.success('인증 이메일을 발송했습니다. 이메일을 확인해 주세요.');
        setTab('login');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '오류 발생';
      if (msg.includes('Invalid login')) setError('이메일 또는 패스워드가 올바르지 않습니다.');
      else if (msg.includes('Email not confirmed')) setError('이메일 인증을 완료해 주세요.');
      else if (msg.includes('already registered')) setError('이미 가입된 이메일입니다.');
      else setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const reset = () => { setEmail(''); setPassword(''); setPasswordConfirm(''); setError(''); };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-white rounded-2xl shadow-2xl w-[90vw] max-w-[400px] p-6">
          <Dialog.Close className="absolute top-4 right-4 text-zinc-400 hover:text-zinc-800">
            <X className="w-5 h-5" />
          </Dialog.Close>

          <Dialog.Title className="text-lg font-bold mb-1">
            {tab === 'login' ? '로그인' : '회원가입'}
          </Dialog.Title>
          <Dialog.Description className="text-sm text-zinc-500 mb-5">
            {tab === 'login' ? '이메일과 패스워드로 로그인하세요.' : '새 계정을 만듭니다.'}
          </Dialog.Description>

          {/* 탭 전환 */}
          <div className="flex gap-1 bg-zinc-100 rounded-lg p-0.5 mb-4">
            <button onClick={() => { setTab('login'); reset(); }}
              className={`flex-1 text-xs py-2 rounded-md font-medium transition-colors ${tab === 'login' ? 'bg-white shadow text-zinc-800' : 'text-zinc-500'}`}>
              로그인
            </button>
            <button onClick={() => { setTab('signup'); reset(); }}
              className={`flex-1 text-xs py-2 rounded-md font-medium transition-colors ${tab === 'signup' ? 'bg-white shadow text-zinc-800' : 'text-zinc-500'}`}>
              회원가입
            </button>
          </div>

          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs text-zinc-500 flex items-center gap-1"><Mail className="w-3 h-3" /> 이메일</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com"
                className="w-full border border-zinc-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#175DDC]"
                autoFocus onKeyDown={e => e.key === 'Enter' && handleSubmit()} />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-zinc-500 flex items-center gap-1"><Lock className="w-3 h-3" /> 패스워드</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder={tab === 'signup' ? '8자 이상' : '패스워드'}
                className="w-full border border-zinc-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#175DDC]"
                onKeyDown={e => e.key === 'Enter' && handleSubmit()} />
            </div>

            {tab === 'signup' && (
              <div className="space-y-1">
                <label className="text-xs text-zinc-500">패스워드 확인</label>
                <input type="password" value={passwordConfirm} onChange={e => setPasswordConfirm(e.target.value)}
                  placeholder="패스워드 재입력"
                  className="w-full border border-zinc-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#175DDC]"
                  onKeyDown={e => e.key === 'Enter' && handleSubmit()} />
              </div>
            )}

            {error && <p className="text-sm text-red-500">{error}</p>}

            <button onClick={handleSubmit} disabled={loading}
              className="w-full bg-[#175DDC] text-white py-3 rounded-xl text-sm font-medium hover:bg-[#0C3276] transition-colors disabled:opacity-50">
              {loading ? '처리 중...' : tab === 'login' ? '로그인' : '회원가입'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
