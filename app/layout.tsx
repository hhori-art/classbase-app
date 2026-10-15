import './globals.css';
import { AuthProvider } from '@/app/context/AuthContext';
import { SettingsProvider } from '@/app/context/SettingsContext';
import SoundEffectsBootstrap from '@/app/components/SoundEffectsBootstrap';
import BetaAnalyticsTracker from '@/app/components/BetaAnalyticsTracker';
import ContextHelp from '@/app/components/ContextHelp';

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
    <html lang="ja">
      <body className="bg-gray-50 text-gray-900 font-sans">
        <AuthProvider>
          <SettingsProvider>
            <SoundEffectsBootstrap />
            <BetaAnalyticsTracker />
            {children}
            <ContextHelp />
          </SettingsProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
