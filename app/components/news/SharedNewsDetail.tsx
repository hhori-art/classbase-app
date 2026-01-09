'use client';
// ... import は既存のまま ...
import { useEffect, useState } from 'react';
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { ArrowLeft, Calendar, Loader2, Tag, Clock, AlertTriangle, PartyPopper, Info } from 'lucide-react';
import Link from 'next/link';

type Props = { id: string; backLink: string; };

export default function SharedNewsDetail({ id, backLink }: Props) {
  // ... fetchロジック ...
  const [news, setNews] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  
  // (省略: useEffectでのデータ取得ロジックは既存のまま)
  useEffect(() => {
    if (!id) return;
    const fetchNewsDetail = async () => {
      try {
        const docRef = doc(db, 'announcements', id);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) { setNews({ id: docSnap.id, ...docSnap.data() }); } else { setNews(null); }
      } catch (e) { console.error(e); } finally { setLoading(false); }
    };
    fetchNewsDetail();
  }, [id]);

  // (省略: getLabelBadgeロジックは既存のまま)
  const getLabelBadge = (label: string) => {
      switch(label) {
        case 'important': return <span className="flex items-center gap-1.5 text-xs font-bold text-red-600 bg-red-50 px-3 py-1.5 rounded-full ring-1 ring-red-100"><Tag size={12} /> 重要</span>;
        case 'event':     return <span className="flex items-center gap-1.5 text-xs font-bold text-orange-600 bg-orange-50 px-3 py-1.5 rounded-full ring-1 ring-orange-100"><PartyPopper size={12} /> イベント</span>;
        case 'alert':     return <span className="flex items-center gap-1.5 text-xs font-bold text-yellow-700 bg-yellow-50 px-3 py-1.5 rounded-full ring-1 ring-yellow-200"><AlertTriangle size={12} /> 緊急</span>;
        case 'info':      
        default:          return <span className="flex items-center gap-1.5 text-xs font-bold text-blue-600 bg-blue-50 px-3 py-1.5 rounded-full ring-1 ring-blue-100"><Info size={12} /> お知らせ</span>;
      }
    };

  // ▼▼▼ 追加: URLをリンクに変換して表示する関数 ▼▼▼
  const formatContent = (text: string) => {
    if (!text) return null;
    // URLを検出する正規表現
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.split(urlRegex).map((part, index) => {
      if (part.match(urlRegex)) {
        return (
          <a
            key={index}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 hover:text-blue-600 underline break-all"
          >
            {part}
          </a>
        );
      }
      return part;
    });
  };

  if (loading) return <div className="min-h-screen bg-[#F0F4F8] flex justify-center items-center"><Loader2 className="animate-spin text-blue-500" size={32} /></div>;
  if (!news) return <div className="min-h-screen bg-[#F0F4F8] p-6 flex flex-col justify-center items-center text-gray-500"><p className="mb-4">お知らせが見つかりませんでした。</p><Link href={backLink} className="text-blue-500 font-bold">一覧に戻る</Link></div>;

  return (
    <div className="min-h-screen bg-[#F0F4F8] pb-20 font-sans">
      <div className="bg-white/80 backdrop-blur-md shadow-sm sticky top-0 z-20 px-4 py-4 flex items-center gap-3">
        <Link href={backLink} className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-600">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="font-bold text-gray-700">詳細</h1>
      </div>

      <div className="p-5 max-w-2xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="bg-white rounded-[32px] p-6 md:p-10 shadow-sm border border-gray-100">
          
          <div className="flex flex-wrap gap-2 items-center mb-6 border-b border-gray-50 pb-6">
            <span className="flex items-center gap-1.5 text-xs font-bold text-gray-500 bg-gray-100 px-3 py-1.5 rounded-full">
              <Calendar size={12} /> {news.created_at ? new Date(news.created_at).toLocaleDateString('ja-JP') : '-'}
            </span>
            {news.created_at && (
              <span className="flex items-center gap-1.5 text-xs font-bold text-gray-400 bg-gray-50 px-3 py-1.5 rounded-full">
                <Clock size={12} /> {new Date(news.created_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            {/* 詳細画面側でもすべてのバッジが出るように確認してください（getLabelBadge内のdefaultを設定） */}
            {getLabelBadge(news.label || 'info')}
          </div>

          <h1 className="text-xl md:text-2xl font-extrabold text-gray-800 mb-8 leading-relaxed tracking-tight">
            {news.title}
          </h1>

          <div className="prose prose-blue prose-sm md:prose-base max-w-none text-gray-600 leading-loose whitespace-pre-wrap break-words font-medium">
            {/* ▼▼▼ 本文表示部分を関数呼び出しに変更 ▼▼▼ */}
            {formatContent(news.content)}
          </div>
        </div>
      </div>
    </div>
  );
}