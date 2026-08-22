import './globals.css';
import { AuthProvider } from '@/app/context/AuthContext';
import { SettingsProvider } from '@/app/context/SettingsContext';
import SoundEffectsBootstrap from '@/app/components/SoundEffectsBootstrap';
import BetaAnalyticsTracker from '@/app/components/BetaAnalyticsTracker';

export const metadata = {
  title: '創造学園アプリ',
  description: '創造学園の講座・学習・勤怠をまとめた共通アプリ',
  manifest: '/manifest.json',
  icons: {
    icon: '/icon.png',
    apple: '/icon.png',
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
          </SettingsProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
