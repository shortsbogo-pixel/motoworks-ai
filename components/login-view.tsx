'use client';

import { useState } from 'react';
import { Bike, ShieldCheck, AlertTriangle } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';

export type UserProfile = {
  id: string;
  email: string;
  displayName: string;
  isOwner?: boolean;
  status?: string;
  roles?: any[];
};

interface LoginViewProps {
  onLoginSuccess: (user: UserProfile) => void;
}

export function LoginView({ onLoginSuccess }: LoginViewProps) {
  const [email, setEmail] = useState('shortsbogo@gmail.com');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setErrorMsg('이메일과 비밀번호를 모두 입력해주세요.');
      return;
    }

    setLoading(true);
    setErrorMsg('');
    setRetryAfter(null);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      const data = (await res.json().catch(() => ({}))) as any;

      if (!res.ok) {
        if (res.status === 429) {
          const seconds = parseInt(res.headers.get('Retry-After') || '900', 10);
          setRetryAfter(seconds);
          setErrorMsg(data.error || '연속된 로그인 실패로 계정이 일시 잠금되었습니다. 잠시 후 다시 시도하세요.');
        } else {
          setErrorMsg(data.error || '이메일 또는 비밀번호가 올바르지 않습니다.');
        }
        return;
      }

      if (data.user) {
        onLoginSuccess(data.user);
      }
    } catch {
      setErrorMsg('서버와 통신 중 오류가 발생했습니다. 네트워크 상태를 확인하세요.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#090d16] px-4 py-12 text-slate-100">
      <div className="w-full max-w-md space-y-8 rounded-2xl border border-slate-800/90 bg-[#161d28]/95 p-8 shadow-2xl backdrop-blur-xl">
        {/* 상단 로고 & 헤더 */}
        <div className="text-center">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-amber-500 text-slate-950 shadow-[0_0_25px_rgba(245,158,11,0.4)]">
            <Bike size={32} strokeWidth={2.5} />
          </div>
          <h2 className="text-2xl font-black tracking-tight text-white">모토웍스 AI 정비 센터</h2>
          <p className="mt-1 text-sm text-slate-400">현장 정비 업무 및 관리자 보안 로그인</p>
        </div>

        {/* 보안 안내 배지 */}
        <div className="flex items-center gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 text-xs text-emerald-300">
          <ShieldCheck size={18} className="shrink-0 text-emerald-400" />
          <span>표준 PBKDF2-HMAC-SHA256 및 12시간 보안 세션이 적용되었습니다.</span>
        </div>

        {/* 오류 알림 메시지 */}
        {errorMsg && (
          <div className="flex items-start gap-2.5 rounded-lg border border-rose-500/40 bg-rose-500/15 p-3.5 text-sm text-rose-200 animate-in fade-in duration-200">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-rose-400" />
            <div className="flex-1 text-xs leading-relaxed">
              <p className="font-bold text-rose-300">로그인 불가</p>
              <p>{errorMsg}</p>
              {retryAfter && (
                <p className="mt-1 font-mono text-amber-300">
                  남은 잠금 시간: 약 {Math.ceil(retryAfter / 60)}분 ({retryAfter}초)
                </p>
              )}
            </div>
          </div>
        )}

        {/* 로그인 폼 */}
        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-300">
              관리자/직원 계정 (이메일)
            </label>
            <Input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="shortsbogo@gmail.com"
              className="mt-1.5 h-11 border-slate-700 bg-slate-900/80 text-white placeholder-slate-500 focus:border-amber-500 focus:ring-amber-500/20"
              disabled={loading || Boolean(retryAfter)}
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-300">
              비밀번호
            </label>
            <Input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="mt-1.5 h-11 border-slate-700 bg-slate-900/80 text-white placeholder-slate-500 focus:border-amber-500 focus:ring-amber-500/20 font-mono"
              disabled={loading || Boolean(retryAfter)}
            />
          </div>

          <Button
            type="submit"
            disabled={loading || Boolean(retryAfter)}
            className="w-full h-11 bg-amber-500 font-bold text-slate-950 hover:bg-amber-400 focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 focus:ring-offset-slate-900 transition-all shadow-lg shadow-amber-500/20"
          >
            {loading ? (
              <div className="flex items-center gap-2">
                <Spinner className="h-4 w-4" />
                <span>인증 확인 중...</span>
              </div>
            ) : (
              '로그인'
            )}
          </Button>
        </form>

        {/* 하단 안내 */}
        <div className="border-t border-slate-800/80 pt-4 text-center text-xs text-slate-500">
          비밀번호 재설정은 관리자 CLI (<code className="font-mono text-slate-400">set-admin-password.mjs</code>)를 통해 터미널에서 수행할 수 있습니다.
        </div>
      </div>
    </div>
  );
}
