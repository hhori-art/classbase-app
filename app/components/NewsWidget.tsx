'use client';
// ... import は変更なし ...
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { db } from '@/lib/firebase';
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { Megaphone, Loader2, ChevronRight, List } from 'lucide-react';

export default function NewsWidget({ role }: { role: 'student' | 'teacher' }) {
  // ... useEffectなどはそのまま ...
  const [news, setNews] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const listPagePath = role === 'student' ? '/student/news' : '/teacher/news';
  const detailPagePrefix = role === 'student' ? '/student/news' : '/teacher/news';

  useEffect(() => {
    const fetchNews = async () => {
      try {
        const q = query(collection(db, 'announcements'), orderBy('created_at', 'desc'), limit(20));
        const snapshot = await getDocs(q);
        const allNews = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const filteredNews = allNews.filter((item: any) => item.target === 'all' || item.target === role).slice(0, 3);
        setNews(filteredNews);
      } catch (e) { console.error(e); } finally { setLoading(false); }
    };
    fetchNews();
  }, [role]);

  // バッジのスタイル定義ヘルパー
  const getBadge = (label: string) => {
    switch (label) {
      case 'important': return <span className="text-[10px] bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-bold">重要</span>;
      case 'event':     return <span className="text-[10px] bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full font-bold">イベント</span>;
      case 'alert':     return <span className="text-[10px] bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full font-bold">緊急</span>;
      default: return null; // 'info' や未設定の場合はバッジなし、または「お知らせ」を表示してもOK
    }
  };

  return (
    <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 mb-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-sm font-bold text-gray-700 flex items-center gap-2">
          <Megaphone className="text-blue-500" size={18} />
          連絡事項
        </h2>
      </div>

      {loading ? (
        <div className="flex justify-center py-4"><Loader2 className="animate-spin text-gray-300" size={20}/></div>
      ) : news.length === 0 ? (
        <div className="text-center py-4 text-xs text-gray-400 bg-gray-50 rounded-lg border border-dashed border-gray-200">新しいお知らせはありません</div>
      ) : (
        <div className="space-y-3">
          {news.map((item) => (
            <Link 
              href={`${detailPagePrefix}/${item.id}`} 
              key={item.id} 
              className="block group border-b border-gray-50 last:border-0 pb-3 last:pb-0 hover:bg-gray-50 transition-colors rounded-lg px-3 py-2 -mx-3 relative"
            >
              <div className="flex justify-between items-start mb-1 pr-4">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-gray-400">
                    {item.created_at ? new Date(item.created_at).toLocaleDateString() : '-'}
                  </span>
                  {/* ▼▼▼ labelに基づいてバッジを表示 ▼▼▼ */}
                  {getBadge(item.label)} 
                </div>
              </div>
              
              <div className="flex justify-between items-center">
                <h3 className="text-sm font-bold text-gray-800 mb-1 group-hover:text-blue-600 transition-colors line-clamp-1">
                  {item.title}
                </h3>
                <ChevronRight size={16} className="text-gray-300 group-hover:text-blue-500 transition-colors" />
              </div>
              <p className="text-xs text-gray-500 leading-relaxed whitespace-pre-wrap line-clamp-1 opacity-80">
                {item.content}
              </p>
            </Link>
          ))}
          <Link href={listPagePath} className="mt-2 flex items-center justify-center w-full py-2.5 text-xs font-bold text-gray-500 bg-gray-50 hover:bg-gray-100 hover:text-blue-600 rounded-xl transition-colors gap-2">
            <List size={14} /> すべてのお知らせを見る
          </Link>
        </div>
      )}
    </div>
  );
}