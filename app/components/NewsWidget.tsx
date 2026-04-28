'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { db } from '@/lib/firebase';
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { Bell, Info, AlertCircle, Sparkles, ChevronRight, Megaphone, List } from 'lucide-react';

interface NewsItem {
  id: string;
  title: string;
  content: string;
  created_at: string;
  label: string;
  target: string;
}

interface Props {
  role?: 'student' | 'teacher' | 'parent' | 'admin';
  pendingRequests?: any[];
  onOpenRequest?: (req: any) => void;
}

export default function NewsWidget({ role, pendingRequests = [], onOpenRequest }: Props) {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);

  // 一覧ページへのパス
  const listPagePath = role === 'student' ? '/student/news' : role === 'teacher' ? '/teacher/news' : '#';
  // 詳細ページへのプレフィックス
  const detailPagePrefix = role === 'student' ? '/student/news' : role === 'teacher' ? '/teacher/news' : '#';

  useEffect(() => {
    const fetchNews = async () => {
      try {
        const q = query(
          collection(db, 'announcements'),
          orderBy('created_at', 'desc'),
          limit(5)
        );
        
        const snap = await getDocs(q);
        const list = snap.docs.map(doc => {
          const data = doc.data();
          let dateStr = '';
          if (data.created_at?.toDate) {
            dateStr = data.created_at.toDate().toISOString();
          } else if (typeof data.created_at === 'string') {
            dateStr = data.created_at;
          }

          return { 
            id: doc.id, 
            ...data,
            created_at: dateStr 
          } as NewsItem;
        });

        const filteredList = list.filter(item => 
          !item.target || 
          item.target === 'all' || 
          (role && item.target === role) ||
          (role === 'admin' && ['admin', 'school_admin'].includes(item.target))
        );

        setNews(filteredList);
      } catch (e) {
        console.error('News fetch error:', e);
      } finally {
        setLoading(false);
      }
    };

    fetchNews();
  }, [role]);

  const getBadgeStyle = (label: string) => {
    switch (label) {
      case 'important':
        return { bg: 'bg-red-100', text: 'text-red-600', label: '重要', icon: <AlertCircle size={12} /> };
      case 'event':
        return { bg: 'bg-orange-100', text: 'text-orange-600', label: 'イベント', icon: <Sparkles size={12} /> };
      case 'alert':
        return { bg: 'bg-yellow-100', text: 'text-yellow-700', label: '緊急', icon: <Megaphone size={12} /> };
      case 'maintenance':
        return { bg: 'bg-gray-100', text: 'text-gray-600', label: 'メンテ', icon: <Info size={12} /> };
      default:
        return { bg: 'bg-blue-100', text: 'text-blue-600', label: 'お知らせ', icon: <Bell size={12} /> };
    }
  };

  if (loading) {
    return (
      <div className="bg-white p-4 rounded-3xl shadow-sm border border-gray-100 animate-pulse h-24 flex items-center justify-center mb-6">
        <span className="text-gray-300 text-xs font-bold">読み込み中...</span>
      </div>
    );
  }

  const isEmpty = news.length === 0 && pendingRequests.length === 0;

  return (
    <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden mb-6">
      <div className="bg-gray-50 px-4 py-3 border-b border-gray-100 flex items-center gap-2">
        <Bell size={16} className="text-gray-400" />
        <span className="text-xs font-bold text-gray-500">連絡事項</span>
      </div>
      
      <div className="p-2">
        <div className="divide-y divide-gray-50">
          
          {isEmpty && (
            <div className="py-8 text-center">
              <p className="text-xs font-bold text-gray-400">新しいお知らせはありません</p>
            </div>
          )}

          {/* 未回答の登録依頼 */}
          {role === 'student' && pendingRequests.map(req => (
            <button 
              key={req.id} 
              onClick={() => onOpenRequest && onOpenRequest(req)}
              className="w-full text-left p-3 hover:bg-red-50 transition-colors group bg-red-50/30 rounded-xl mb-2"
            >
              <div className="flex items-start gap-3">
                <span className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold bg-red-100 text-red-600 animate-pulse">
                  <AlertCircle size={12} /> 未登録
                </span>
                
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-center mb-1">
                    <h4 className="text-sm font-bold text-gray-800 line-clamp-1 group-hover:text-red-600 transition-colors">
                      {req.title}
                    </h4>
                    <ChevronRight size={16} className="text-gray-300 group-hover:text-red-400"/>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    期限: {req.deadline ? new Date(req.deadline).toLocaleDateString() : 'お早めに'} までに登録してください
                  </p>
                </div>
              </div>
            </button>
          ))}

          {/* お知らせ一覧 */}
          {news.map((item) => {
            const style = getBadgeStyle(item.label);
            const dateLabel = item.created_at ? new Date(item.created_at).toLocaleDateString() : '-';

            return (
              <Link 
                href={`${detailPagePrefix}/${item.id}`} 
                key={item.id} 
                className="block p-3 hover:bg-gray-50 transition-colors no-underline group rounded-xl"
              >
                <div className="flex items-start gap-3">
                  <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold ${style.bg} ${style.text}`}>
                    {style.icon} {style.label}
                  </span>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-baseline mb-1">
                      <h4 className="text-sm font-bold text-gray-800 line-clamp-1 group-hover:text-indigo-600 transition-colors">
                        {item.title}
                      </h4>
                      <span className="text-[10px] text-gray-400 shrink-0 ml-2">
                        {dateLabel}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 line-clamp-2 leading-relaxed">
                      {item.content}
                    </p>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>

        {/* ★追加: すべてのお知らせを見るボタン */}
        {!isEmpty && (
          <Link 
            href={listPagePath} 
            className="mt-2 flex items-center justify-center w-full py-2.5 text-xs font-bold text-gray-500 bg-gray-50 hover:bg-gray-100 hover:text-indigo-600 rounded-xl transition-colors gap-2 no-underline"
          >
            <List size={14} /> すべてのお知らせを見る
          </Link>
        )}
      </div>
    </div>
  );
}
