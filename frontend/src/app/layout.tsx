import type { Metadata } from 'next';
import 'leaflet/dist/leaflet.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'LOOK-AT-ME // C4I TACTICAL',
  description: '다중 UAV 자율 임무할당 및 돌발상황 동적 재계획 지휘통제체계',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700;800&family=Noto+Sans+KR:wght@400;500;600;700;800&display=swap"
        />
      </head>
      <body className="bg-[#050811] text-slate-100 antialiased overflow-hidden select-none">
        {children}
      </body>
    </html>
  );
}
