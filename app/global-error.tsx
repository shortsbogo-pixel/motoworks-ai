'use client';

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Motoworks Global Error:', error);
  }, [error]);

  return (
    <html lang="ko">
      <body style={{ margin: 0, padding: 0, backgroundColor: '#0b0f17', color: '#f1f5f9', fontFamily: 'sans-serif' }}>
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
          <div style={{ maxWidth: '420px', width: '100%', backgroundColor: '#161d28', border: '1px solid #1e293b', borderRadius: '16px', padding: '32px', textAlign: 'center' }}>
            <div style={{ width: '56px', height: '56px', borderRadius: '50%', backgroundColor: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.3)', color: '#f59e0b', fontSize: '24px', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
              !
            </div>
            <h2 style={{ fontSize: '20px', fontWeight: 'bold', color: '#ffffff', margin: '0 0 8px' }}>
              시스템 로딩 중 문제가 발생했습니다
            </h2>
            <p style={{ fontSize: '14px', color: '#94a3b8', margin: '0 0 24px', lineHeight: '1.5' }}>
              네트워크 상태를 확인하신 후 아래 버튼을 눌러 다시 시도해 주세요.
            </p>
            {error?.message && (
              <div style={{ padding: '12px', marginBottom: '24px', backgroundColor: '#090d16', border: '1px solid #1e293b', borderRadius: '8px', textAlign: 'left', fontSize: '12px', fontFamily: 'monospace', color: '#fca5a5', maxHeight: '120px', overflowY: 'auto', wordBreak: 'break-all' }}>
                {error.message}
              </div>
            )}
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              <button
                onClick={() => reset()}
                style={{ padding: '10px 20px', borderRadius: '10px', backgroundColor: '#f59e0b', color: '#090d16', fontWeight: 'bold', fontSize: '14px', border: 'none', cursor: 'pointer' }}
              >
                화면 다시 시도
              </button>
              <button
                onClick={() => { window.location.href = '/'; }}
                style={{ padding: '10px 20px', borderRadius: '10px', backgroundColor: '#334155', color: '#f1f5f9', fontWeight: 'medium', fontSize: '14px', border: 'none', cursor: 'pointer' }}
              >
                홈으로 새로고침
              </button>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
