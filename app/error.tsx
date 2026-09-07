'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Motoworks App Error:', error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0b0f17] text-slate-100 p-6">
      <div className="max-w-md w-full bg-[#161d28] border border-slate-800 rounded-2xl p-8 text-center shadow-2xl">
        <div className="mx-auto w-14 h-14 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center mb-5 text-2xl font-bold">
          !
        </div>
        <h2 className="text-xl font-bold text-white mb-2">화면을 불러오는 중 문제가 발생했습니다</h2>
        <p className="text-sm text-slate-400 mb-6">
          일시적인 네트워크 또는 세션 연결 지연일 수 있습니다. 아래 버튼을 눌러 다시 시도해 주세요.
        </p>
        {error?.message && (
          <div className="p-3 mb-6 bg-slate-900/80 border border-slate-800 rounded-lg text-left text-xs font-mono text-red-300 break-all max-h-32 overflow-y-auto">
            {error.message}
          </div>
        )}
        <div className="flex gap-3 justify-center">
          <button
            onClick={() => reset()}
            className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm transition shadow-lg shadow-amber-500/20 active:scale-95"
          >
            화면 다시 시도
          </button>
          <button
            onClick={() => { window.location.href = '/'; }}
            className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-sm transition active:scale-95"
          >
            홈으로 새로고침
          </button>
        </div>
      </div>
    </div>
  );
}
