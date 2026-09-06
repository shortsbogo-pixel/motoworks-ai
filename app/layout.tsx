import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '모토웍스 AI · 정비 운영 시스템',
  description: '오토바이 정비소용 멀티지점 AI 접수·검수·정산 SaaS',
  manifest: '/manifest.webmanifest',
};

export const viewport: Viewport = { themeColor: '#0b0f17' };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="dark bg-[#0b0f17] text-slate-100">
      <body className="bg-[#0b0f17] text-slate-100 min-h-screen antialiased selection:bg-emerald-500/20 selection:text-emerald-300">{children}</body>
    </html>
  );
}
