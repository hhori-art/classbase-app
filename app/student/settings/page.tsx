'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/app/context/AuthContext';
import { db, auth } from '@/lib/firebase';
import { doc, updateDoc, getDoc } from 'firebase/firestore';
import { updatePassword, updateProfile } from 'firebase/auth';
import { 
  ArrowLeft, User, Lock, Bell, LogOut, ChevronRight, 
  Save, Loader2, Shield, GraduationCap, Target, Type, Volume2
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function StudentSettingsPage() {
  const { user, profile } = useAuth();
  const router = useRouter();
  
  // プロフィール用
  const [name, setName] = useState('');
  
  // 学習設定用
  const [target, setTarget] = useState('定期テスト対策'); // 目標
  const [textSize, setTextSize] = useState('normal'); // 文字サイズ
  const [notification, setNotification] = useState({
    homework: true,
    class_reminder: true
  });

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{type: 'success'|'error', text: string} | null>(null);

  // パスワード変更用
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isPasswordExpanded, setIsPasswordExpanded] = useState(false);

  // 初期値セット
  useEffect(() => {
    if (profile) {
      setName(profile.student_name || user?.displayName || '');
      // Firestoreに保存された設定があれば読み込む（なければ初期値）
      if (profile.settings) {
        setTarget(profile.settings.target || '定期テスト対策');
        setTextSize(profile.settings.text_size || 'normal');
        setNotification(prev => ({ ...prev, ...profile.settings.notification }));
      }
    }
  }, [profile, user]);

  // 設定保存処理 (プロフィール + アプリ設定)
  const handleSaveSettings = async () => {
    if (!user) return;
    if (!name.trim()) return showMessage('error', 'お名前を入力してください');
    
    setLoading(true);
    try {
      // 1. Authの表示名更新
      if (user.displayName !== name) {
        await updateProfile(user, { displayName: name });
      }
      
      // 2. Firestore更新 (名前 + 各種設定)
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, { 
        student_name: name,
        settings: {
          target,
          text_size: textSize,
          notification
        },
        updated_at: new Date().toISOString()
      });

      showMessage('success', '設定を保存しました！');
    } catch (e: any) {
      console.error(e);
      showMessage('error', '保存に失敗しました: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  // パスワード変更処理
  const handleChangePassword = async () => {
    if (!user) return;
    if (newPassword.length < 6) return showMessage('error', 'パスワードは6文字以上で設定してください');
    if (newPassword !== confirmPassword) return showMessage('error', '確認用パスワードが一致しません');
    if (!confirm('本当にパスワードを変更しますか？')) return;

    setLoading(true);
    try {
      await updatePassword(user, newPassword);
      showMessage('success', 'パスワードを変更しました！');
      setNewPassword('');
      setConfirmPassword('');
      setIsPasswordExpanded(false);
    } catch (e: any) {
      if (e.code === 'auth/requires-recent-login') {
        showMessage('error', '再ログインが必要です。一度ログアウトしてからお試しください。');
      } else {
        showMessage('error', '変更失敗: ' + e.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const showMessage = (type: 'success'|'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 5000);
  };

  return (
    <div className="min-h-screen bg-[#F0F4F8] p-6 pb-32 font-sans">
      <div className="max-w-xl mx-auto">
        
        {/* ヘッダー */}
        <div className="flex items-center gap-4 mb-8">
          <Link href="/student" className="bg-white p-3 rounded-full shadow-sm text-gray-600 hover:bg-gray-50 transition-colors">
            <ArrowLeft size={20} />
          </Link>
          <h1 className="text-2xl font-extrabold text-gray-800 flex items-center gap-2">
            <span className="bg-gray-200 text-gray-600 p-1.5 rounded-lg"><User size={24} /></span>
            設定・アカウント
          </h1>
        </div>

        {/* メッセージ通知 */}
        {message && (
          <div className={`mb-6 p-4 rounded-2xl text-sm font-bold flex items-center gap-2 animate-in slide-in-from-top-2 shadow-sm ${
            message.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
          }`}>
            <Shield size={18}/> {message.text}
          </div>
        )}

        <div className="space-y-6">

          {/* 1. 基本設定カード */}
          <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
            <h2 className="text-lg font-extrabold text-gray-800 mb-6 flex items-center gap-2">
              <User size={20} className="text-indigo-500"/> プロフィール・学習設定
            </h2>
            
            <div className="space-y-6">
              {/* 名前 */}
              <div>
                <label className="block text-xs font-bold text-gray-400 mb-2">お名前 (表示名)</label>
                <input 
                  type="text" 
                  value={name} 
                  onChange={(e) => setName(e.target.value)}
                  className="w-full p-3 bg-gray-50 border-2 border-transparent focus:border-indigo-200 rounded-xl outline-none font-bold text-gray-700 transition-colors"
                  placeholder="例: 山田 太郎"
                />
              </div>

              {/* 学習目標 (ラジオボタン) */}
              <div>
                <label className="block text-xs font-bold text-gray-400 mb-2 flex items-center gap-1"><Target size={14}/> 今の目標</label>
                <div className="grid grid-cols-2 gap-2">
                  {['定期テスト対策', '受験対策', '苦手克服', '予習中心'].map((t) => (
                    <button
                      key={t}
                      onClick={() => setTarget(t)}
                      className={`p-2 rounded-xl text-sm font-bold border-2 transition-all ${
                        target === t 
                        ? 'bg-indigo-50 border-indigo-500 text-indigo-700' 
                        : 'bg-white border-gray-100 text-gray-500 hover:bg-gray-50'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              {/* 文字サイズ */}
              <div>
                <label className="block text-xs font-bold text-gray-400 mb-2 flex items-center gap-1"><Type size={14}/> 文字サイズ</label>
                <div className="flex bg-gray-50 p-1 rounded-xl">
                  <button onClick={() => setTextSize('normal')} className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${textSize === 'normal' ? 'bg-white shadow text-gray-800' : 'text-gray-400'}`}>ふつう</button>
                  <button onClick={() => setTextSize('large')} className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${textSize === 'large' ? 'bg-white shadow text-gray-800' : 'text-gray-400'}`}>おおきめ</button>
                </div>
              </div>
            </div>
          </div>

          {/* 2. 通知設定カード */}
          <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
            <h2 className="text-lg font-extrabold text-gray-800 mb-6 flex items-center gap-2">
              <Bell size={20} className="text-orange-500"/> 通知設定
            </h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-gray-700">宿題の締め切り通知</span>
                <button 
                  onClick={() => setNotification(p => ({...p, homework: !p.homework}))}
                  className={`w-12 h-7 rounded-full p-1 transition-colors duration-300 ${notification.homework ? 'bg-orange-500' : 'bg-gray-200'}`}
                >
                  <div className={`w-5 h-5 bg-white rounded-full shadow-sm transition-transform duration-300 ${notification.homework ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-gray-700">授業開始のお知らせ</span>
                <button 
                  onClick={() => setNotification(p => ({...p, class_reminder: !p.class_reminder}))}
                  className={`w-12 h-7 rounded-full p-1 transition-colors duration-300 ${notification.class_reminder ? 'bg-orange-500' : 'bg-gray-200'}`}
                >
                  <div className={`w-5 h-5 bg-white rounded-full shadow-sm transition-transform duration-300 ${notification.class_reminder ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>
            </div>
          </div>

          {/* 保存ボタン */}
          <button 
            onClick={handleSaveSettings}
            disabled={loading}
            className="w-full bg-gradient-to-r from-indigo-500 to-purple-500 text-white py-3.5 rounded-2xl font-bold shadow-lg shadow-indigo-200 hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loading ? <Loader2 className="animate-spin" size={20}/> : <Save size={20}/>} 設定を保存する
          </button>

          {/* 3. パスワード変更 (折りたたみ) */}
          <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 mt-8">
            <h2 className="text-lg font-extrabold text-gray-800 mb-2 flex items-center gap-2">
              <Lock size={20} className="text-gray-400"/> セキュリティ
            </h2>
            
            {!isPasswordExpanded ? (
              <button 
                onClick={() => setIsPasswordExpanded(true)}
                className="w-full py-2 text-left text-sm font-bold text-gray-500 hover:text-gray-800 flex items-center justify-between group transition-colors"
              >
                <span>パスワードを変更する</span>
                <ChevronRight size={18} className="text-gray-300 group-hover:text-gray-500"/>
              </button>
            ) : (
              <div className="space-y-4 mt-4 animate-in fade-in">
                <div>
                  <label className="block text-xs font-bold text-gray-400 mb-1">新しいパスワード</label>
                  <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="w-full p-3 bg-gray-50 border-2 border-transparent focus:border-gray-300 rounded-xl outline-none font-bold text-gray-700" placeholder="6文字以上" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 mb-1">確認用パスワード</label>
                  <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="w-full p-3 bg-gray-50 border-2 border-transparent focus:border-gray-300 rounded-xl outline-none font-bold text-gray-700" placeholder="もう一度入力" />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button onClick={() => setIsPasswordExpanded(false)} className="px-4 py-2 text-gray-400 font-bold text-xs hover:bg-gray-50 rounded-lg">キャンセル</button>
                  <button onClick={handleChangePassword} disabled={loading || !newPassword} className="bg-gray-800 text-white px-6 py-2 rounded-xl font-bold text-xs shadow hover:bg-black transition-all">変更する</button>
                </div>
              </div>
            )}
          </div>

          {/* クラス設定・その他 */}
          <div className="pt-2 space-y-3">
             <Link href="/student/change-request" className="block bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex items-center justify-between group hover:border-green-300 transition-all">
               <div className="flex items-center gap-3">
                 <div className="bg-green-100 text-green-600 p-2 rounded-lg"><GraduationCap size={20} /></div>
                 <div>
                   <div className="text-sm font-bold text-gray-800">科目・曜日の変更申請</div>
                   <div className="text-[10px] text-gray-400">クラス変更はこちら</div>
                 </div>
               </div>
               <ChevronRight size={18} className="text-gray-300 group-hover:text-green-500"/>
             </Link>

             <button 
               onClick={() => auth.signOut()}
               className="w-full bg-white border-2 border-red-50 text-red-400 py-3 rounded-2xl font-bold hover:bg-red-50 hover:text-red-600 transition-all flex items-center justify-center gap-2 mt-6"
             >
               <LogOut size={18}/> ログアウト
             </button>
          </div>
          
          <div className="text-center pb-4">
             <p className="text-[10px] text-gray-300">Student App v1.0.0</p>
          </div>

        </div>
      </div>
    </div>
  );
}