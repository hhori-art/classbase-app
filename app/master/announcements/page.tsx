'use client';

import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, query, orderBy, getDocs, addDoc, deleteDoc, doc } from 'firebase/firestore';
import { 
  ArrowLeft, Send, Trash2, BellRing, Loader2, Filter, XCircle, 
  Megaphone, Users, User, GraduationCap, Check, AlertCircle, ShieldCheck, UserRound
} from 'lucide-react';
import Link from 'next/link';

// タグの定義とスタイル
const LABELS = {
  important: { label: '重要', color: 'bg-red-50 text-red-600 border-red-200 ring-red-500' },
  event:     { label: 'イベント', color: 'bg-orange-50 text-orange-600 border-orange-200 ring-orange-500' },
  info:      { label: 'お知らせ', color: 'bg-blue-50 text-blue-600 border-blue-200 ring-blue-500' },
  alert:     { label: '緊急', color: 'bg-yellow-50 text-yellow-700 border-yellow-200 ring-yellow-500' },
};

// 送信先の定義
const TARGETS = [
  { id: 'all', label: '全員', icon: <Users size={16}/> },
  { id: 'student', label: '生徒のみ', icon: <GraduationCap size={16}/> },
  { id: 'parent', label: '保護者のみ', icon: <UserRound size={16}/> },
  { id: 'teacher', label: '先生のみ', icon: <User size={16}/> },
  { id: 'admin', label: '校舎管理者のみ', icon: <ShieldCheck size={16}/> },
];

const TARGET_NAMES: {[key: string]: string} = {
  all: '全員',
  student: '生徒',
  parent: '保護者',
  teacher: '先生',
  admin: '校舎管理者'
};

export default function AnnouncementsPage() {
  const [list, setList] = useState<any[]>([]);
  const [form, setForm] = useState({ title: '', content: '', target: 'all', label: 'info' });
  
  // フィルター用ステート
  const [filterLabel, setFilterLabel] = useState('all');
  const [filterTarget, setFilterTarget] = useState('any');

  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    fetchList();
  }, []);

  const fetchList = async () => {
    try {
      const q = query(collection(db, 'announcements'), orderBy('created_at', 'desc'));
      const snapshot = await getDocs(q);
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setList(data);
    } catch (error) { console.error(error); } finally { setFetching(false); }
  };

  const handleSubmit = async () => {
    if (!form.title || !form.content) return alert('タイトルと内容を入力してください');
    if (!confirm('お知らせを配信しますか？')) return;

    setLoading(true);
    try {
      await addDoc(collection(db, 'announcements'), {
        ...form,
        created_at: new Date().toISOString()
      });
      setForm({ title: '', content: '', target: 'all', label: 'info' });
      alert('送信しました');
      fetchList();
    } catch (error: any) {
      alert('エラー: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('本当に削除しますか？')) return;
    try {
      await deleteDoc(doc(db, 'announcements', id));
      setList(prev => prev.filter(item => item.id !== id));
    } catch (error: any) { alert('削除エラー: ' + error.message); }
  };

  // フィルタリングロジック
  const filteredList = list.filter(item => {
    const itemLabel = item.label || 'info';
    const matchLabel = filterLabel === 'all' || itemLabel === filterLabel;
    const matchTarget = filterTarget === 'any' || item.target === filterTarget;
    return matchLabel && matchTarget;
  });

  return (
    <div className="min-h-screen bg-gray-50/50 p-6 pb-40 font-sans text-slate-800">
      <div className="max-w-7xl mx-auto">
        
        {/* ヘッダー */}
        <div className="flex items-center gap-4 mb-8">
          <Link href="/master" className="bg-white p-2.5 rounded-full shadow-sm hover:bg-gray-100 text-slate-600 transition-colors border border-gray-200">
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
              <BellRing className="text-blue-600" /> お知らせ配信
            </h1>
            <p className="text-xs text-slate-500 mt-1">生徒や講師への連絡事項を作成・管理します</p>
          </div>
        </div>

        <div className="grid lg:grid-cols-12 gap-8 items-start">
          
          {/* 左カラム: 作成フォーム (幅を広めに確保) */}
          <div className="lg:col-span-5 xl:col-span-5 order-2 lg:order-1">
            <div className="bg-white p-6 rounded-3xl shadow-lg border border-slate-100 sticky top-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="font-bold text-slate-700 flex items-center gap-2 text-lg">
                  <Megaphone size={20} className="text-blue-500"/> メッセージ作成
                </h2>
                <div className="text-[10px] bg-blue-50 text-blue-600 px-2 py-1 rounded-full font-bold">
                  New Message
                </div>
              </div>
              
              <div className="space-y-6">
                
                {/* 送信先選択 */}
                <div>
                  <label className="text-xs font-bold text-slate-400 mb-2 block uppercase tracking-wider">送信先</label>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {TARGETS.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => setForm({...form, target: t.id})}
                        className={`flex flex-col items-center justify-center gap-1 py-3 rounded-xl border-2 transition-all ${
                          form.target === t.id 
                            ? 'border-blue-500 bg-blue-50 text-blue-700' 
                            : 'border-slate-100 text-slate-400 hover:border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        {t.icon}
                        <span className="text-xs font-bold">{t.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* タグ設定 */}
                <div>
                  <label className="text-xs font-bold text-slate-400 mb-2 block uppercase tracking-wider">ラベル</label>
                  <div className="flex flex-wrap gap-2">
                    {(Object.keys(LABELS) as Array<keyof typeof LABELS>).map((key) => (
                      <button
                        key={key}
                        onClick={() => setForm({...form, label: key})}
                        className={`text-xs font-bold px-4 py-2 rounded-full border transition-all flex items-center gap-2 ${
                          form.label === key 
                            ? `${LABELS[key].color} ring-2 ring-offset-1` 
                            : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        {form.label === key && <Check size={12} strokeWidth={4} />}
                        {LABELS[key].label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* タイトル & 本文 */}
                <div className="space-y-4 pt-2">
                  <div>
                    <input 
                      className="w-full px-4 py-3 border-2 border-slate-100 rounded-xl outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50 transition-all text-lg font-bold placeholder:text-slate-300 placeholder:font-normal"
                      placeholder="タイトルを入力"
                      value={form.title}
                      onChange={e => setForm({...form, title: e.target.value})}
                    />
                  </div>
                  <div>
                    <textarea 
                      className="w-full px-4 py-4 border-2 border-slate-100 rounded-xl outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50 transition-all min-h-[300px] resize-y placeholder:text-slate-300 leading-relaxed"
                      placeholder="ここにお知らせの内容を入力してください..."
                      value={form.content}
                      onChange={e => setForm({...form, content: e.target.value})}
                    />
                  </div>
                </div>

                <button 
                  onClick={handleSubmit}
                  disabled={loading}
                  className="w-full bg-slate-900 text-white py-4 rounded-2xl font-bold hover:bg-slate-800 flex items-center justify-center gap-3 disabled:opacity-50 transition-all active:scale-95 shadow-xl shadow-slate-200"
                >
                  {loading ? <Loader2 className="animate-spin" size={20}/> : <Send size={20}/>} 
                  配信する
                </button>
              </div>
            </div>
          </div>

          {/* 右カラム: 履歴リスト */}
          <div className="lg:col-span-7 xl:col-span-7 order-1 lg:order-2 space-y-6">
            
            {/* フィルターバー */}
            <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex flex-wrap gap-4 items-center justify-between sticky top-6 z-10">
              <div className="flex items-center gap-2 text-slate-400">
                <Filter size={16}/>
                <span className="text-xs font-bold">絞り込み</span>
              </div>
              
              <div className="flex flex-1 gap-2 overflow-x-auto pb-1 sm:pb-0 no-scrollbar">
                {/* 送信先フィルター */}
                <select 
                  value={filterTarget} 
                  onChange={(e) => setFilterTarget(e.target.value)}
                  className="bg-slate-50 border border-slate-200 text-xs font-bold text-slate-600 rounded-lg px-3 py-2 outline-none cursor-pointer hover:bg-slate-100 transition-colors"
                >
                  <option value="any">送信先: 全て</option>
                  <option value="all">全員</option>
                  <option value="student">生徒</option>
                  <option value="parent">保護者</option>
                  <option value="teacher">先生</option>
                  <option value="admin">校舎管理者</option>
                </select>

                {/* タグフィルター */}
                <select 
                  value={filterLabel} 
                  onChange={(e) => setFilterLabel(e.target.value)}
                  className="bg-slate-50 border border-slate-200 text-xs font-bold text-slate-600 rounded-lg px-3 py-2 outline-none cursor-pointer hover:bg-slate-100 transition-colors"
                >
                  <option value="all">ラベル: 全て</option>
                  {Object.keys(LABELS).map((key) => (
                    <option key={key} value={key}>{LABELS[key as keyof typeof LABELS].label}</option>
                  ))}
                </select>
              </div>

              {(filterLabel !== 'all' || filterTarget !== 'any') && (
                <button 
                  onClick={() => { setFilterLabel('all'); setFilterTarget('any'); }} 
                  className="text-xs text-red-500 hover:text-red-600 flex items-center gap-1 font-bold bg-red-50 px-3 py-2 rounded-lg hover:bg-red-100 transition-colors"
                >
                  <XCircle size={14}/> リセット
                </button>
              )}
            </div>

            {/* リスト表示 */}
            <div className="space-y-4">
              {fetching ? (
                <div className="flex justify-center py-20"><Loader2 className="animate-spin text-slate-300" size={32}/></div>
              ) : filteredList.length === 0 ? (
                <div className="text-center py-20 bg-white rounded-3xl border-2 border-dashed border-slate-200 text-slate-400 font-bold flex flex-col items-center gap-2">
                  <AlertCircle size={32} className="opacity-50"/>
                  <p>お知らせが見つかりません</p>
                </div>
              ) : (
                filteredList.map(item => {
                  const labelKey = (item.label || 'info') as keyof typeof LABELS;
                  const labelInfo = LABELS[labelKey] || LABELS.info;

                  return (
                    <div key={item.id} className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100 relative group hover:border-blue-200 transition-all hover:shadow-md">
                      {/* 削除ボタン */}
                      <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                          onClick={() => handleDelete(item.id)}
                          className="bg-white text-slate-300 hover:text-red-500 p-2 rounded-full shadow border border-slate-100 hover:bg-red-50 transition-colors"
                          title="削除する"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>

                      <div className="flex items-center gap-3 mb-3">
                        <span className={`text-[10px] px-3 py-1 rounded-full font-bold border ${labelInfo.color.replace('ring-', '')}`}>
                          {labelInfo.label}
                        </span>
                        <span className="text-xs text-slate-400 font-mono">
                          {item.created_at ? new Date(item.created_at).toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}
                        </span>
                        <span className="text-[10px] text-slate-500 bg-slate-100 px-2 py-1 rounded flex items-center gap-1 font-bold">
                          To: {TARGET_NAMES[item.target] || '全員'}
                        </span>
                      </div>

                      <h3 className="font-bold text-slate-800 text-xl mb-3 pr-10">{item.title}</h3>
                      <div className="bg-slate-50 p-4 rounded-2xl text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">
                        {item.content}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
