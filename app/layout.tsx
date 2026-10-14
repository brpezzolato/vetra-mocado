import type { Metadata, Viewport } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import './globals.css';
import { LoadingActivity } from '@/components/loading-activity';
import { LoadingRouteGate } from '@/components/loading-route-gate';
import { AppLock } from '@/components/app-lock';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
  themeColor: '#030303',
};

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
  ),
  title: 'Vetra — Seu dinheiro, visto por inteiro',
  description:
    'Unifique seus cofrinhos, entenda o rendimento líquido e veja os próximos dias com clareza.',
  applicationName: 'Vetra',
  icons: {
    // O símbolo do Vetra (os prints da prévia escolhida, ver
    // components/vetra-mark.tsx): branco na aba escura, preto na clara.
    icon: [
      {
        url: '/logos/vetra-favicon-dark.png?v=4',
        type: 'image/png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/logos/vetra-favicon-light.png?v=4',
        type: 'image/png',
        media: '(prefers-color-scheme: light)',
      },
      { url: '/logos/vetra-icon-180.png?v=4', type: 'image/png' },
    ],
    shortcut: ['/logos/vetra-icon-180.png?v=4'],
    apple: [{ url: '/logos/vetra-icon-180.png?v=4', type: 'image/png' }],
  },
  formatDetection: { telephone: false },
  openGraph: {
    title: 'Vetra — Seu dinheiro, visto por inteiro',
    description:
      'Seus cofrinhos, bancos e rendimentos em uma visão clara e precisa.',
    type: 'website',
    images: [
      {
        url: '/og.png?v=2',
        width: 1200,
        height: 630,
        alt: 'Vetra — Seu dinheiro, visto por inteiro.',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Vetra — Seu dinheiro, visto por inteiro',
    description:
      'Seus cofrinhos, bancos e rendimentos em uma visão clara e precisa.',
    images: ['/og.png?v=2'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" className="dark" suppressHydrationWarning>
      <body
        className={`${GeistSans.variable} ${GeistMono.variable} antialiased`}
      >
        <LoadingActivity />
        <LoadingRouteGate />
        <AppLock>{children}</AppLock>
      </body>
    </html>
  );
}
