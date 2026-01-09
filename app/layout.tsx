// app/layout.tsx
import './globals.css';

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
        {children}
      </body>
    </html>
  );
}