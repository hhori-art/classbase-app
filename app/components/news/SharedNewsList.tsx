'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { db } from '@/lib/firebase';
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { ArrowLeft, Loader2, ChevronRight, Bell, Tag, PartyPopper, AlertTriangle, Info } from 'lucide-react';

type Props = { role: 'student' | 'teacher'; basePath: string; dashboardPath: string; };

export default function SharedNewsList({ role, basePath, dashboardPath }: Props) {
  const [newsList, setNewsList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchNews = async () => {
      try {
        const q = query(collection(db, 'announcements'), orderBy('created_at', 'desc'), limit(50));
        const snapshot = await getDocs(q);
        const allData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const filtered = allData.filter((item: any) => item.target === 'all' || item.target === role);
        setNewsList(filtered);
      } catch (e) { console.error(e); } finally { setLoading(false); }
    };
    fetchNews();
  }, [role]);

  // ▼▼▼ 修正: 全てのパターンでバッジを表示するように変更 ▼▼▼
  const getBadge = (label: string) => {
    switch (label) {
      case 'important':
        return <span className="flex items-center gap-1.5 text-[10px] sm:text-xs font-bold text-red-600 bg-red-50 px-2.5 py-1 rounded-full ring-1 ring-red-100"><Tag size={12} /> 重要</span>;
      case 'event':
        return <span className="flex items-center gap-1.5 text-[10px] sm:text-xs font-bold text-orange-600 bg-orange-50 px-2.5 py-1 rounded-full ring-1 ring-orange-100"><PartyPopper size={12} /> イベント</span>;
      case 'alert':
        return <span className="flex items-center gap-1.5 text-[10px] sm:text-xs font-bold text-yellow-700 bg-yellow-50 px-2.5 py-1 rounded-full ring-1 ring-yellow-200"><AlertTriangle size={12} /> 緊急</span>;
      case 'info':
      default:
        // デフォルト（ラベルなし、またはinfo）でも「お知らせ」バッジを表示
        return <span className="flex items-center gap-1.5 text-[10px] sm:text-xs font-bold text-blue-600 bg-blue-50 px-2.5 py-1 rounded-full ring-1 ring-blue-100"><Info size={12} /> お知らせ</span>;
    }
  };

  return (
    <div className="min-h-screen bg-[#F0F4F8] pb-20 font-sans">
      <div className="bg-white/80 backdrop-blur-md shadow-sm sticky top-0 z-20 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href={dashboardPath} className="flex items-center gap-1 bg-gray-100 hover:bg-gray-200 px-3 py-2 rounded-full transition-colors text-xs font-bold text-gray-600">
            <ArrowLeft size={16} /> <span className="hidden sm:inline">ホームへ</span>戻る
          </Link>
          <h1 className="font-bold text-gray-700">お知らせ一覧</h1>
        </div>
      </div>

      <div className="p-5 max-w-2xl mx-auto space-y-3">
        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="animate-spin text-blue-500" size={30}/></div>
        ) : newsList.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400 gap-4">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center"><Bell size={32} className="opacity-20"/></div>
            <p className="text-sm font-bold">お知らせはありません</p>
          </div>
        ) : (
          newsList.map((item) => (
            <Link key={item.id} href={`${basePath}/${item.id}`} className="block bg-white p-5 rounded-2xl shadow-sm border border-gray-100 hover:border-blue-300 hover:shadow-md transition-all group relative overflow-hidden">
              <div className="flex items-center flex-wrap gap-2 mb-3">
                <span className="text-xs font-bold text-gray-400 bg-gray-50 px-2 py-0.5 rounded">
                  {item.created_at ? new Date(item.created_at).toLocaleDateString() : '-'}
                </span>
                {/* バッジ表示（全てのラベルに対応） */}
                {getBadge(item.label)}
              </div>
              <div className="flex justify-between items-center">
                <h2 className="text-base font-bold text-gray-800 group-hover:text-blue-600 transition-colors line-clamp-1 flex-1 pr-4">{item.title}</h2>
                <ChevronRight size={18} className="text-gray-300 group-hover:text-blue-500 transition-colors flex-shrink-0" />
              </div>
              <p className="text-xs text-gray-500 line-clamp-1 mt-1 opacity-70">{item.content}</p>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}