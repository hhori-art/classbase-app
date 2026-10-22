'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Bell, Info, AlertCircle, Sparkles, ChevronRight, Megaphone, List } from 'lucide-react';
import { loadAnnouncements } from '@/lib/client-announcements';

interface NewsItem {
  id: string;
  title: string;
  content: string;
  created_at: string;
  publish_at?: string;
  label: string;
  target: string;
}

interface Props {
  role?: 'student' | 'teacher' | 'parent' | 'admin';
  pendingRequests?: any[];
  onOpenRequest?: (req: any) => void;
}

const newsPreview = (value: string) => {
  const text = String(value || '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return text.length > 120 ? `${text.slice(0, 120)}...` : text;
};

export default function NewsWidget({ role, pendingRequests = [], onOpenRequest }: Props) {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // 一覧ページへのパス
  const listPagePath = role === 'student' ? '/student/news' : role === 'teacher' ? '/teacher/news' : role === 'parent' ? '/parent/news' : '#';
  // 詳細ページへのプレフィックス
  const detailPagePrefix = role === 'student' ? '/student/news' : role === 'teacher' ? '/teacher/news' : role === 'parent' ? '/parent/news' : '#';

  useEffect(() => {
    const fetchNews = async () => {
      setLoading(true);
      setLoadError(false);
      try {
        const list = await loadAnnouncements(5) as NewsItem[];

        const filteredList = list.filter(item => 
          !item.target || 
          item.target === 'all' || 
          (role && item.target === role) ||
          (role === 'admin' && ['admin', 'school_admin'].includes(item.target))
        );

        setNews(filteredList);
      } catch (e) {
        console.error('News fetch error:', e);
        setLoadError(true);
      } finally {
        setLoading(false);
      }
    };

    fetchNews();
  }, [role, reloadKey]);

  const getBadgeStyle = (label: string) => {
    switch (label) {
      case 'important':
        return { bg: 'bg-red-100', text: 'text-red-600', label: '重要', icon: <AlertCircle size={12} /> };
      case 'event':
        return { bg: 'bg-orange-100', text: 'text-orange-600', label: 'イベント', icon: <Sparkles size={12} /> };
      case 'alert':
        return { bg: 'bg-yellow-100', text: 'text-yellow-700', label: '緊急', icon: <Megaphone size={12} /> };
      case 'maintenance':
        return { bg: 'bg-slate-100', text: 'text-slate-600', label: 'メンテ', icon: <Info size={12} /> };
      default:
        return { bg: 'bg-blue-100', text: 'text-blue-600', label: 'お知らせ', icon: <Bell size={12} /> };
    }
  };

  if (loading) {
    return (
      <div className="bg-white p-4 rounded-3xl shadow-sm border border-slate-100 animate-pulse h-24 flex items-center justify-center mb-6">
        <span className="text-slate-300 text-xs font-bold">読み込み中...</span>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mb-6 rounded-3xl border border-amber-200 bg-amber-50 p-5 text-center">
        <p className="text-sm font-bold text-amber-800">お知らせを読み込めませんでした</p>
        <button type="button" onClick={() => setReloadKey(value => value + 1)} className="mt-3 rounded-xl bg-amber-700 px-4 py-2 text-xs font-bold text-white">
          もう一度読み込む
        </button>
      </div>
    );
  }

  const isEmpty = news.length === 0 && pendingRequests.length === 0;

  return (
    <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden mb-6">
      <div className="bg-slate-50 px-4 py-3 border-b border-slate-100 flex items-center gap-2">
        <Bell size={16} className="text-slate-400" />
        <span className="text-xs font-bold text-slate-500">連絡事項</span>
      </div>
      
      <div className="p-2">
        <div className="divide-y divide-slate-50">
          
          {isEmpty && (
            <div className="py-8 text-center">
              <p className="text-xs font-bold text-slate-400">新しいお知らせはありません</p>
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
                <span className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold bg-red-100 text-red-600 animate-pulse">
                  <AlertCircle size={12} /> 未登録
                </span>
                
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-center mb-1">
                    <h4 className="text-sm font-bold text-slate-800 line-clamp-1 group-hover:text-red-600 transition-colors">
                      {req.title}
                    </h4>
                    <ChevronRight size={16} className="text-slate-300 group-hover:text-red-400"/>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    期限: {req.deadline ? new Date(req.deadline).toLocaleDateString() : 'お早めに'} までに登録してください
                  </p>
                </div>
              </div>
            </button>
          ))}

          {/* お知らせ一覧 */}
          {news.slice(0, 3).map((item) => {
            const style = getBadgeStyle(item.label);
            const dateLabel = item.publish_at || item.created_at ? new Date(item.publish_at || item.created_at).toLocaleDateString('ja-JP') : '-';

            return (
              <Link 
                href={`${detailPagePrefix}/${item.id}`} 
                key={item.id} 
                className="block p-3 hover:bg-slate-50 transition-colors no-underline group rounded-xl"
              >
                <div className="flex items-start gap-3">
                  <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold ${style.bg} ${style.text}`}>
                    {style.icon} {style.label}
                  </span>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-baseline mb-1">
                      <h4 className="text-sm font-bold text-slate-800 line-clamp-1 group-hover:text-indigo-600 transition-colors">
                        {item.title}
                      </h4>
                      <span className="text-[11px] text-slate-400 shrink-0 ml-2">
                        {dateLabel}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">
                      {newsPreview(item.content) || '詳細を開いて内容を確認してください。'}
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
            className="mt-2 flex items-center justify-center w-full py-2.5 text-xs font-bold text-slate-500 bg-slate-50 hover:bg-slate-100 hover:text-indigo-600 rounded-xl transition-colors gap-2 no-underline"
          >
            <List size={14} /> すべてのお知らせを見る{news.length > 3 ? `（ほか${news.length - 3}件）` : ''}
          </Link>
        )}
      </div>
    </div>
  );
}
