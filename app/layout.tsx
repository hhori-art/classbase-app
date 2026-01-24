import './globals.css';
import { AuthProvider } from '@/app/context/AuthContext';
import { SettingsProvider } from '@/app/context/SettingsContext';

export const metadata = {
  // ★ここを変更
  title: '理社講座アプリ', 
  description: '生徒管理・学習支援システム',
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
            {children}
          </SettingsProvider>
        </AuthProvider>
      </body>
    </html>
  );
}