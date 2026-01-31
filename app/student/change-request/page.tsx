'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/app/context/AuthContext';
import { db } from '@/lib/firebase';
import { doc, getDoc, collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { ArrowLeft, CheckCircle, Loader2, Send, Calendar, BookOpen, MessageSquare, Info } from 'lucide-react';
import Link from 'next/link';

// 科目ごとの選択肢
const OPTIONS_SOCIAL = ['地理', '歴史', '公民'];
const OPTIONS_SCIENCE = ['物理', '化学', '生物', '地学'];

export default function StudentChangeRequestPage() {
  const { user } = useAuth();
  const router = useRouter();

  const [profile, setProfile] = useState<any>(null);
  const [fetching, setFetching] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);

  // フォーム状態
  const [form, setForm] = useState({
    day: '',
    science: '', 
    social: '',
    reason: ''
  });

  useEffect(() => {
    const fetchProfile = async () => {
      if (!user) return;
      try {
        const docRef = doc(db, 'users', user.uid);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
          const data = docSnap.data();
          setProfile(data);
          
          // ★修正: 正しいフィールド名からデータを読み込む
          // (データがない場合はリストの先頭をデフォルトにする)
          setForm({
            day: data.day_of_week || '月',
            science: data.subject_science || OPTIONS_SCIENCE[0], // 理科
            social: data.subject_social || OPTIONS_SOCIAL[0],   // 社会
            reason: ''
          });
        }
      } catch (e) {
        console.error('Profile fetch error:', e);
      } finally {
        setFetching(false);
      }
    };
    fetchProfile();
  }, [user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.reason.trim()) return alert('変更理由を入力してください');
    if (!user) return;

    // 変更がない場合のチェック (任意)
    if (
      form.day === profile.day_of_week &&
      form.science === profile.subject_science &&
      form.social === profile.subject_social
    ) {
      if(!confirm('変更箇所がありませんが、申請を送信しますか？')) return;
    } else {
      if (!confirm('変更申請を送信しますか？')) return;
    }

    setSubmitting(true);
    try {
      await addDoc(collection(db, 'requests'), {
        student_id: user.uid,
        user_id: user.uid, // 管理画面での参照用
        student_name: profile?.student_name || user.displayName || '生徒',
        target_grade: profile?.grade,
        
        type: 'change', 
        status: 'pending',
        
        // ★修正: 明確なフィールド名で保存
        target_day: form.day,
        target_science: form.science,
        target_social: form.social,
        reason: form.reason,

        // 管理者通知用のテキスト
        content: `【変更希望】\n曜日: ${form.day}\n理科: ${form.science}\n社会: ${form.social}\n理由: ${form.reason}`,
        
        created_at: serverTimestamp()
      });

      setCompleted(true);
    } catch (err) {
      console.error(err);
      alert('送信に失敗しました');
    } finally {
      setSubmitting(false);
    }
  };

  if (fetching) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin text-indigo-400" size={40}/></div>;
  if (!profile) return <div className="min-h-screen flex items-center justify-center text-gray-400">ユーザー情報が見つかりません</div>;

  if (completed) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-indigo-50 p-6 font-sans">
        <div className="bg-white p-10 rounded-[40px] shadow-xl shadow-indigo-100 text-center max-w-sm w-full animate-in zoom-in-95 border-4 border-white">
          <div className="w-24 h-24 bg-green-100 text-green-500 rounded-full flex items-center justify-center mx-auto mb-6 animate-bounce">
            <CheckCircle size={48} strokeWidth={3} />
          </div>
          <h2 className="text-2xl font-black text-gray-800 mb-2 tracking-tight">申請完了！</h2>
          <p className="text-gray-500 font-bold mb-8 leading-relaxed">
            変更希望を受け付けました。<br/>先生からの連絡をお待ちください。
          </p>
          <Link href="/student" className="block w-full bg-indigo-600 text-white px-6 py-4 rounded-2xl font-black shadow-lg shadow-indigo-200 hover:bg-indigo-700 hover:shadow-xl hover:-translate-y-1 transition-all">
            ダッシュボードへ戻る
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F0F4F8] p-6 pb-32 font-sans flex flex-col items-center">
      <div className="w-full max-w-4xl mx-auto">
        
        {/* ヘッダー */}
        <div className="flex items-center gap-4 mb-8">
          <Link href="/student" className="bg-white p-3 rounded-2xl shadow-sm border border-gray-100 text-gray-400 hover:text-indigo-600 hover:border-indigo-200 transition-all">
            <ArrowLeft size={24} strokeWidth={3} />
          </Link>
          <div>
            <h1 className="text-2xl font-black text-gray-800 flex items-center gap-2 tracking-tight">
              受講変更申請
            </h1>
            <p className="text-xs font-bold text-gray-400">科目や曜日を変更したいとき</p>
          </div>
        </div>

        {/* フォームエリア */}
        <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8 items-start">
          
          {/* 左カラム */}
          <div className="space-y-6">
            
            {/* 現在の状況 */}
            <div className="bg-gradient-to-r from-indigo-500 to-blue-500 text-white p-6 rounded-[32px] shadow-lg shadow-indigo-200 relative overflow-hidden">
              <div className="relative z-10 flex gap-3 items-start">
                <Info size={24} className="mt-1 shrink-0 text-indigo-100"/>
                <div>
                  <p className="text-xs font-bold opacity-70 mb-1 uppercase tracking-wider">Current Status</p>
                  <p className="text-lg font-black leading-snug">
                    現在の登録情報
                  </p>
                  <div className="mt-3 flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold opacity-70 w-8">曜日</span>
                      <span className="bg-white/20 px-3 py-1 rounded-lg text-sm font-bold backdrop-blur-sm">
                        {profile.day_of_week || '未設定'}曜日
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold opacity-70 w-8">理科</span>
                      <span className="bg-white/20 px-3 py-1 rounded-lg text-sm font-bold backdrop-blur-sm">
                        {profile.subject_science || '未設定'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold opacity-70 w-8">社会</span>
                      <span className="bg-white/20 px-3 py-1 rounded-lg text-sm font-bold backdrop-blur-sm">
                        {profile.subject_social || '未設定'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-white/10 rounded-full blur-2xl"></div>
            </div>

            {/* 変更内容入力 */}
            <div className="bg-white p-6 rounded-[32px] shadow-sm border border-gray-100 space-y-6">
              
              {/* 曜日選択 */}
              <div>
                <label className="flex items-center gap-2 text-sm font-black text-gray-700 mb-3">
                  <span className="bg-orange-100 text-orange-600 p-1.5 rounded-lg"><Calendar size={18} strokeWidth={3}/></span>
                  希望する曜日
                </label>
                <div className="relative">
                  <select 
                    className="w-full p-4 bg-orange-50/50 text-gray-800 border-2 border-transparent rounded-2xl font-bold outline-none focus:bg-white focus:border-orange-400 focus:ring-4 focus:ring-orange-100 transition-all appearance-none cursor-pointer"
                    value={form.day} 
                    onChange={e => setForm({...form, day: e.target.value})}
                  >
                    {['月', '火', '水', '木', '金', '土'].map(day => (
                      <option key={day} value={day}>{day}曜日</option>
                    ))}
                  </select>
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-orange-400">▼</div>
                </div>
              </div>

              {/* 理科選択 */}
              <div>
                <label className="flex items-center gap-2 text-sm font-black text-gray-700 mb-3">
                  <span className="bg-purple-100 text-purple-600 p-1.5 rounded-lg"><BookOpen size={18} strokeWidth={3}/></span>
                  理科
                </label>
                <div className="relative">
                  <select 
                    className="w-full p-4 bg-purple-50/50 text-gray-800 border-2 border-transparent rounded-2xl font-bold outline-none focus:bg-white focus:border-purple-400 focus:ring-4 focus:ring-purple-100 transition-all appearance-none cursor-pointer"
                    value={form.science} 
                    onChange={e => setForm({...form, science: e.target.value})}
                  >
                     {OPTIONS_SCIENCE.map(subj => (
                       <option key={subj} value={subj}>{subj}</option>
                     ))}
                  </select>
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-purple-400">▼</div>
                </div>
              </div>

              {/* 社会選択 */}
              <div>
                <label className="flex items-center gap-2 text-sm font-black text-gray-700 mb-3">
                  <span className="bg-pink-100 text-pink-600 p-1.5 rounded-lg"><BookOpen size={18} strokeWidth={3}/></span>
                  社会
                </label>
                <div className="relative">
                  <select 
                    className="w-full p-4 bg-pink-50/50 text-gray-800 border-2 border-transparent rounded-2xl font-bold outline-none focus:bg-white focus:border-pink-400 focus:ring-4 focus:ring-pink-100 transition-all appearance-none cursor-pointer"
                    value={form.social} 
                    onChange={e => setForm({...form, social: e.target.value})}
                  >
                     {OPTIONS_SOCIAL.map(subj => (
                       <option key={subj} value={subj}>{subj}</option>
                     ))}
                  </select>
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-pink-400">▼</div>
                </div>
              </div>

            </div>
          </div>

          {/* 右カラム */}
          <div className="flex flex-col gap-6 h-full">
            
            <div className="bg-white p-6 rounded-[32px] shadow-sm border border-gray-100 flex-1 flex flex-col">
              <label className="flex items-center gap-2 text-sm font-black text-gray-700 mb-4">
                <span className="bg-green-100 text-green-600 p-1.5 rounded-lg"><MessageSquare size={18} strokeWidth={3}/></span>
                変更したい理由
              </label>
              <textarea
                required
                value={form.reason}
                onChange={e => setForm({...form, reason: e.target.value})}
                placeholder="（例）志望校の受験科目に合わせて、地理から公民に変更したいです。"
                className="w-full flex-1 p-4 min-h-[160px] md:min-h-0 bg-gray-50 text-gray-800 border-2 border-transparent rounded-2xl outline-none focus:bg-white focus:border-green-400 focus:ring-4 focus:ring-green-100 transition-all resize-none font-bold placeholder:font-medium placeholder:text-gray-400"
              />
            </div>

            <button 
              type="submit" 
              disabled={submitting}
              className="w-full bg-indigo-600 text-white py-5 rounded-2xl font-black text-xl hover:bg-indigo-700 shadow-xl shadow-indigo-200 transition-all flex items-center justify-center gap-3 disabled:opacity-50 active:scale-95"
            >
              {submitting ? <Loader2 className="animate-spin" size={24}/> : <Send size={24} strokeWidth={3}/>}
              申請を送る
            </button>

          </div>

        </form>
      </div>
    </div>
  );
}