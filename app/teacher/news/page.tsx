'use client';

import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, query, orderBy, getDocs, limit } from 'firebase/firestore';
import { Bell, ArrowLeft, ChevronRight, Loader2, Calendar } from 'lucide-react';
import Link from 'next/link';

// タグ定義
const LABELS: {[key: string]: { label: string, color: string }} = {
  important: { label: '重要', color: 'bg-red-50 text-red-600 border-red-200' },
  event:     { label: 'イベント', color: 'bg-orange-50 text-orange-600 border-orange-200' },
  info:      { label: 'お知らせ', color: 'bg-blue-50 text-blue-600 border-blue-200' },
  alert:     { label: '緊急', color: 'bg-yellow-50 text-yellow-700 border-yellow-200' },
};

export default function TeacherNewsPage() {
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchNews = async () => {
      try {
        const q = query(collection(db, 'announcements'), orderBy('created_at', 'desc'), limit(50));
        const snapshot = await getDocs(q);
        const allData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        // ★フィルタリング: 「全員宛」または「先生宛」のみ抽出
        const myNews = allData.filter((item: any) => 
          item.target === 'all' || item.target === 'teacher'
        );

        setList(myNews);
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    };

    fetchNews();
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 p-6 pb-32 font-sans">
      <div className="max-w-3xl mx-auto">
        
        {/* ヘッダー */}
        <div className="flex items-center gap-4 mb-6">
          <Link href="/teacher" className="bg-white p-2.5 rounded-full shadow-sm border border-gray-100 text-gray-600 hover:bg-gray-50 transition-colors">
            <ArrowLeft size={20} />
          </Link>
          <h1 className="text-xl font-extrabold text-gray-800 flex items-center gap-2">
            <Bell className="text-green-600" /> 運営からのお知らせ
          </h1>
        </div>

        {/* リスト表示 */}
        <div className="space-y-4">
          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="animate-spin text-gray-400"/></div>
          ) : list.length === 0 ? (
            <div className="text-center py-12 text-gray-400 bg-white rounded-2xl border border-dashed border-gray-200">
              お知らせはありません
            </div>
          ) : (
            list.map((item) => {
              const labelKey = item.label || 'info';
              const labelInfo = LABELS[labelKey] || LABELS.info;

              return (
                <Link key={item.id} href={`/teacher/news/${item.id}`} className="block group">
                  <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 hover:border-green-200 hover:shadow-md transition-all relative overflow-hidden">
                    
                    <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${labelInfo.color.split(' ')[0]}`}></div>

                    <div className="flex justify-between items-start mb-2 pl-2">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] px-2 py-0.5 rounded-md font-bold border ${labelInfo.color}`}>
                          {labelInfo.label}
                        </span>
                        <span className="text-xs text-gray-400 flex items-center gap-1">
                          <Calendar size={12}/>
                          {item.created_at ? new Date(item.created_at).toLocaleDateString() : '-'}
                        </span>
                      </div>
                      <ChevronRight size={16} className="text-gray-300 group-hover:text-green-600 transition-colors"/>
                    </div>

                    <h3 className="text-base font-bold text-gray-800 mb-1 pl-2 group-hover:text-green-700 transition-colors line-clamp-1">
                      {item.title}
                    </h3>
                    
                    <p className="text-xs text-gray-500 pl-2 line-clamp-2 leading-relaxed">
                      {item.content}
                    </p>
                  </div>
                </Link>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}