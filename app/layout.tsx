import './globals.css';
import { Noto_Sans_JP } from 'next/font/google';
import { FeedbackProvider } from '@/app/components/ui/feedback';
import { AuthProvider } from '@/app/context/AuthContext';
import { SettingsProvider } from '@/app/context/SettingsContext';
import SoundEffectsBootstrap from '@/app/components/SoundEffectsBootstrap';
import BetaAnalyticsTracker from '@/app/components/BetaAnalyticsTracker';
import ContextHelp from '@/app/components/ContextHelp';

// 全アプリ共通の書体。本文は標準（400/500）、見出しと数字だけ太字（700/900）。
const notoSansJp = Noto_Sans_JP({
  weight: ['400', '500', '700', '900'],
  subsets: ['latin'],
  display: 'swap',
  preload: false,
  variable: '--font-noto-sans-jp',
});

export const metadata = {
  title: '創造学園アプリ',
  description: '創造学園の講座・学習・勤怠をまとめた共通アプリ',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    title: '創造学園アプリ',
    statusBarStyle: 'default',
  },
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja" className={notoSansJp.variable}>
      <body className="bg-canvas text-fg font-sans antialiased">
        <AuthProvider>
          <SettingsProvider>
            <SoundEffectsBootstrap />
            <BetaAnalyticsTracker />
            <FeedbackProvider>
              {children}
              <ContextHelp />
            </FeedbackProvider>
          </SettingsProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
