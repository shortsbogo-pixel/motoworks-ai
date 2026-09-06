import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '모토웍스 AI · 정비 운영 시스템',
  description: '오토바이 정비소용 멀티지점 AI 접수·검수·정산 SaaS',
  manifest: '/manifest.webmanifest',
};

export const viewport: Viewport = { themeColor: '#082925' };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
