'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/app/context/AuthContext';
import { db } from '@/lib/firebase';
import { doc, getDoc, collection, addDoc } from 'firebase/firestore';
import { Send, ArrowLeft, Loader2 } from 'lucide-react';
import Link from 'next/link';

export default function StudentSettingsPage() {
  const { user } = useAuth(); // AuthContextからユーザー取得
  const router = useRouter();

  const [profile, setProfile] = useState<any>(null);
  const [form, setForm] = useState({ day: '', science: '', social: '', reason: '' });
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    const fetchProfile = async () => {
      if (!user) return;

      try {
        // Firestoreの users コレクションから自分のデータを取得
        const docRef = doc(db, 'users', user.uid);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
          const data = docSnap.data();
          setProfile(data);
          
          // 初期値をセット
          setForm({
            day: data.day_of_week || '月',
            science: data.science_subject || '生物',
            social: data.social_subject || '地理',
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

  const handleSubmit = async () => {
    if (!form.reason) return alert('変更理由を入力してください');
    if (!confirm('受講設定の変更を送信しますか？')) return;
    
    setLoading(true);

    try {
      // requests コレクションに追加
      await addDoc(collection(db, 'requests'), {
        user_id: user?.uid,
        student_name: profile?.student_name || user?.displayName || '生徒',
        target_grade: profile?.grade,
        
        // 申請タイプを明示 (管理者画面での分岐用)
        type: 'change', 
        status: 'pending',
        
        // 変更内容
        target_day: form.day,
        target_science: form.science,
        target_social: form.social,
        reason: form.reason,
        
        created_at: new Date().toISOString()
      });

      alert('受講設定の変更を送信しました。');
      // 生徒用ダッシュボードへ戻る (パスは環境に合わせて調整してください。通常は /student)
      router.push('/student'); 

    } catch (error: any) {
      console.error(error);
      alert('エラーが発生しました: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  if (fetching) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin text-gray-400"/></div>;
  if (!profile) return <div className="p-10 text-center">ユーザー情報が見つかりません</div>;

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-lg mx-auto">
        <Link href="/student" className="flex items-center text-gray-500 mb-6 hover:text-gray-800 transition-colors">
          <ArrowLeft size={18} /> ホームに戻る
        </Link>
        <h1 className="text-2xl font-bold text-gray-800 mb-2">受講講座・曜日時間の変更</h1>
        <p className="text-sm text-gray-500 mb-6">曜日・時間・科目を変更したい場合、ここから送信してください。</p>

        <div className="bg-white p-6 rounded-2xl shadow-sm space-y-4 border border-gray-100">
          <div>
            <label className="block text-xs font-bold text-gray-500 mb-1">希望する曜日</label>
            <select className="w-full p-3 border rounded-lg bg-gray-50 focus:bg-white transition-colors outline-none" value={form.day} onChange={e => setForm({...form, day: e.target.value})}>
              <option>月</option><option>火</option><option>水</option><option>木</option><option>金</option><option>土</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 mb-1">理科科目</label>
            <select className="w-full p-3 border rounded-lg bg-gray-50 focus:bg-white transition-colors outline-none" value={form.science} onChange={e => setForm({...form, science: e.target.value})}>
              <option>生物</option><option>物理</option><option>化学</option><option>地学</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 mb-1">社会科目</label>
            <select className="w-full p-3 border rounded-lg bg-gray-50 focus:bg-white transition-colors outline-none" value={form.social} onChange={e => setForm({...form, social: e.target.value})}>
              <option>地理</option><option>歴史</option><option>公民</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 mb-1">変更理由</label>
            <textarea 
              className="w-full p-3 border rounded-lg bg-gray-50 focus:bg-white transition-colors outline-none h-32 resize-none" 
              placeholder="例: 部活の曜日が変わったため"
              value={form.reason}
              onChange={e => setForm({...form, reason: e.target.value})}
            />
          </div>

          <button 
            onClick={handleSubmit} 
            disabled={loading} 
            className="w-full bg-blue-600 text-white py-3 rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-blue-700 transition-all shadow-md shadow-blue-200 active:scale-95 disabled:opacity-50"
          >
            {loading ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />} 
            変更を送信
          </button>
        </div>
      </div>
    </div>
  );
}
