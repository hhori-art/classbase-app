import './globals.css';
import { AuthProvider } from '@/app/context/AuthContext'; // ★追加

export const metadata = {
  title: 'オンライン理社講座',
  description: '生徒管理・学習支援システム',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body className="bg-gray-50 text-gray-900 font-sans">
        {/* ★AuthProviderで囲むことで、アプリ内のどこでもログイン情報を使えるようにする */}
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}