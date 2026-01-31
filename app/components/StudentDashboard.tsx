'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/app/context/AuthContext';
import { useRouter } from 'next/navigation';
import { db } from '@/lib/firebase';
import { doc, getDoc, collection, query, where, getDocs, orderBy, limit } from 'firebase/firestore';
import { 
  BookOpen, Calendar, Clock, Trophy, Target, 
  ArrowRight, CheckCircle, AlertCircle, Loader2 
} from 'lucide-react';
import Link from 'next/link';

// 型定義 (必要に応じて)
type Homework = {
  id: string;
  title: string;
  deadline: any;
  subject: string;
};

export default function StudentDashboard() {
  const { user, profile, loading } = useAuth();
  const router = useRouter();
  
  const [homeworks, setHomeworks] = useState<Homework[]>([]);
  const [nextClass, setNextClass] = useState<any>(null);
  const [isLoadingData, setIsLoadingData] = useState(true);

  // 認証チェック
  useEffect(() => {
    if (!loading && !user) {
      router.push('/');
    }
  }, [user, loading, router]);

  // データ取得
  useEffect(() => {
    const fetchData = async () => {
      if (!user) return;
      
      try {
        // 1. 未提出の宿題を取得 (簡易実装)
        // 実際には subcollections や 提出状況を確認するロジックが必要
        // ここではデモとして homework_tasks を取得
        const hwRef = collection(db, 'homework_tasks');
        const hwSnap = await getDocs(query(hwRef, orderBy('deadline', 'asc'), limit(3)));
        const hwList = hwSnap.docs.map(d => ({ id: d.id, ...d.data() } as Homework));
        setHomeworks(hwList);

        // 2. 次の授業 (シフト) を取得
        // 本来は shifts コレクションから生徒IDで検索
        // ここではダミー、または実装済みのロジックを入れてください
        setNextClass({
          subject: '英語',
          time: '本日 19:00',
          teacher: '田中先生'
        });

      } catch (e) {
        console.error(e);
      } finally {
        setIsLoadingData(false);
      }
    };

    if (user) {
      fetchData();
    }
  }, [user]);

  if (loading || isLoadingData) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#F3F4F6]">
        <Loader2 className="animate-spin text-indigo-600" size={40} />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      
      {/* ヘッダー: 挨拶 */}
      <div className="flex justify-between items-end mb-4">
        <div>
          <h1 className="text-2xl font-black text-slate-800">
            こんにちは、{profile?.name || user.displayName}さん 👋
          </h1>
          <p className="text-sm font-bold text-slate-400 mt-1">今日も一緒に頑張りましょう！</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* 左カラム (メイン) */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* 次の授業カード */}
          <div className="bg-gradient-to-r from-indigo-600 to-purple-600 rounded-2xl p-6 text-white shadow-lg relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full blur-2xl -mr-10 -mt-10"></div>
            
            <h2 className="text-xs font-bold opacity-80 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Clock size={16}/> Next Class
            </h2>
            
            <div className="flex items-center justify-between relative z-10">
              <div>
                <p className="text-3xl font-black mb-1">{nextClass?.subject || '予定なし'}</p>
                <p className="text-sm font-bold opacity-90">{nextClass?.time}</p>
                <div className="mt-4 inline-flex items-center gap-2 bg-white/20 backdrop-blur-sm px-3 py-1.5 rounded-lg text-xs font-bold">
                  <Users size={14} />
                  担当: {nextClass?.teacher || '-'}
                </div>
              </div>
              <div className="bg-white/20 p-4 rounded-2xl backdrop-blur-md">
                <Video size={32} />
              </div>
            </div>

            {nextClass?.subject && (
              <button className="mt-6 w-full bg-white text-indigo-600 py-3 rounded-xl font-black shadow-lg hover:bg-indigo-50 transition-colors flex items-center justify-center gap-2">
                <Video size={18}/> 授業に参加する (Zoom)
              </button>
            )}
          </div>

          {/* 宿題リスト */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-slate-700 flex items-center gap-2">
                <BookOpen className="text-indigo-500" size={20}/> 宿題・課題
              </h2>
              <Link href="/student/homework" className="text-xs font-bold text-indigo-600 hover:underline">
                すべて見る
              </Link>
            </div>

            <div className="space-y-3">
              {homeworks.length > 0 ? (
                homeworks.map((hw) => (
                  <div key={hw.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100 hover:border-indigo-200 transition-colors group">
                    <div className="flex items-center gap-3">
                      <div className="bg-white p-2 rounded-lg text-slate-400 border border-slate-200 group-hover:text-indigo-500 group-hover:border-indigo-200">
                        <CheckSquare size={18}/>
                      </div>
                      <div>
                        <p className="text-sm font-bold text-slate-700">{hw.title}</p>
                        <p className="text-xs text-slate-400 font-mono mt-0.5">
                          期限: {hw.deadline?.toDate().toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <button className="text-xs bg-indigo-600 text-white px-3 py-1.5 rounded-lg font-bold hover:bg-indigo-700 transition-colors">
                      提出
                    </button>
                  </div>
                ))
              ) : (
                <div className="text-center py-8 text-slate-400 text-xs font-bold">
                  未提出の課題はありません 🎉
                </div>
              )}
            </div>
          </div>

        </div>

        {/* 右カラム (サイド) */}
        <div className="space-y-6">
          
          {/* 目標・ステータス */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
            <h2 className="font-bold text-slate-700 flex items-center gap-2 mb-4">
              <Trophy className="text-yellow-500" size={20}/> 現在のステータス
            </h2>
            
            <div className="space-y-4">
              <div className="bg-slate-50 p-4 rounded-xl">
                <p className="text-xs font-bold text-slate-400 mb-1">今月の出席率</p>
                <div className="flex items-end justify-between">
                  <span className="text-2xl font-black text-slate-700">92<span className="text-sm text-slate-400 ml-1">%</span></span>
                  <Activity size={20} className="text-green-500 mb-1"/>
                </div>
                <div className="w-full bg-slate-200 h-1.5 rounded-full mt-2 overflow-hidden">
                  <div className="bg-green-500 h-full rounded-full" style={{ width: '92%' }}></div>
                </div>
              </div>

              <div className="bg-slate-50 p-4 rounded-xl">
                <p className="text-xs font-bold text-slate-400 mb-1">獲得ポイント</p>
                <div className="flex items-end justify-between">
                  <span className="text-2xl font-black text-slate-700">{profile?.points || 0}<span className="text-sm text-slate-400 ml-1">pt</span></span>
                  <ShoppingBag size={20} className="text-orange-500 mb-1"/>
                </div>
              </div>
            </div>
          </div>

          {/* クイックリンク */}
          <div className="grid grid-cols-2 gap-3">
            <Link href="/student/schedule" className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 hover:shadow-md transition-all flex flex-col items-center justify-center gap-2 text-center group">
              <Calendar size={24} className="text-indigo-500 group-hover:scale-110 transition-transform"/>
              <span className="text-xs font-bold text-slate-600">スケジュール</span>
            </Link>
            <Link href="/student/chat" className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 hover:shadow-md transition-all flex flex-col items-center justify-center gap-2 text-center group">
              <MessageCircle size={24} className="text-pink-500 group-hover:scale-110 transition-transform"/>
              <span className="text-xs font-bold text-slate-600">先生に連絡</span>
            </Link>
          </div>

        </div>
      </div>
    </div>
  );
}

// アイコン用の追加インポート
import { Users, Video, CheckSquare, Activity, ShoppingBag, MessageCircle } from 'lucide-react';