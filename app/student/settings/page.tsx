'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/app/context/AuthContext';
import { useSettings } from '@/app/context/SettingsContext';
import { db } from '@/lib/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { updatePassword } from 'firebase/auth';
import { 
  ArrowLeft, User, Lock, LogOut, ChevronRight, 
  Save, Loader2, Shield, Target, Type, 
  Volume2, Smartphone, Download, Share, PlusSquare, HelpCircle, Check, Copy
} from 'lucide-react';
import Link from 'next/link';

export default function StudentSettingsPage() {
  const { user, profile, logout } = useAuth();
  const { textSize, setTextSize } = useSettings();
  
  // --- State ---
  const [name, setName] = useState('');
  const [target, setTarget] = useState('定期テスト対策');
  const [settings, setSettings] = useState({
    sound_bgm: true,
    sound_se: true,
    notification_homework: true,
    notification_class: true,
    notification_news: false,
  });

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{type: 'success'|'error', text: string} | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  // パスワード関連
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isPasswordExpanded, setIsPasswordExpanded] = useState(false);

  // --- PWA (インストール機能) ---
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isIos, setIsIos] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [showManual, setShowManual] = useState(false);

  useEffect(() => {
    // 1. プロフィール読み込み
    if (profile) {
      setName(profile.student_name || user?.displayName || '');
      if (profile.settings) {
        setTarget(profile.settings.target || '定期テスト対策');
        setSettings(prev => ({ ...prev, ...profile.settings }));
      }
    }

    // 2. Android/PC用のインストールイベント捕捉
    const handleBeforeInstallPrompt = (e: any) => {
      e.preventDefault(); 
      setDeferredPrompt(e); 
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    // 3. iOS判定
    const isIosDevice = /iPhone|iPad|iPod/.test(navigator.userAgent);
    setIsIos(isIosDevice);

    // 4. 既に追加済みか判定
    const checkStandalone = () => {
      const isApp = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone;
      setIsStandalone(!!isApp);
    };
    checkStandalone();

    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, [profile, user]);

  // 設定変更ハンドラ
  const handleChange = (key: string, value: any) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  // 文字サイズ変更
  const handleTextSizeChange = (size: 'normal' | 'large') => {
    setTextSize(size);
  };

  // 保存処理 (名前の更新を削除)
  const handleSaveSettings = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, { 
        // student_name: name, // 名前変更は無効化
        settings: { target, ...settings },
        updated_at: new Date().toISOString()
      });
      showMessage('success', '設定を保存しました！');
      setHasChanges(false);
    } catch (e: any) {
      showMessage('error', '保存に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  // インストールボタン押下時
  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt(); 
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setDeferredPrompt(null);
      }
    } else {
      setShowManual(true);
    }
  };

  const showMessage = (type: 'success'|'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 5000);
  };

  const handleChangePassword = async () => {
    if (!newPassword || newPassword !== confirmPassword) return showMessage('error', 'パスワード不一致');
    setLoading(true);
    try {
      if(user) await updatePassword(user, newPassword);
      showMessage('success', 'パスワードを変更しました');
      setNewPassword(''); setConfirmPassword(''); setIsPasswordExpanded(false);
    } catch(e) { showMessage('error', '再ログインが必要です'); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-[#F0F4F8] p-6 pb-40 font-sans transition-all">
      <div className="max-w-xl mx-auto space-y-8">
        
        {/* ヘッダー */}
        <div className="flex items-center gap-4">
          <Link href="/student" className="bg-white p-3 rounded-full shadow-sm text-gray-600 hover:bg-gray-50 transition-colors">
            <ArrowLeft size={20} />
          </Link>
          <h1 className="text-2xl font-extrabold text-gray-800">設定・アカウント</h1>
        </div>

        {message && (
          <div className={`p-4 rounded-2xl font-bold flex items-center gap-3 shadow-sm ${message.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
            <Shield size={20}/> {message.text}
          </div>
        )}

        {/* --- 0. アプリインストール (PWA) --- */}
        {!isStandalone && (
          <section className="bg-gradient-to-br from-indigo-600 to-blue-600 p-6 rounded-3xl shadow-lg text-white relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full blur-3xl transform translate-x-10 -translate-y-10"></div>
            
            <h2 className="text-lg font-black flex items-center gap-2 mb-2 relative z-10">
              <Smartphone size={24}/> ショートカットを作成
            </h2>
            <p className="text-sm font-bold opacity-90 mb-6 relative z-10">
              ホーム画面に追加すると、全画面でアプリのように使えます。
            </p>

            {deferredPrompt ? (
              <button 
                onClick={handleInstallClick}
                className="relative z-10 w-full bg-white text-indigo-600 py-4 rounded-xl font-black shadow-lg flex items-center justify-center gap-2 active:scale-95 transition-transform animate-pulse"
              >
                <Download size={22}/> 今すぐ追加する
              </button>
            ) : (
              <div className="relative z-10">
                 {!showManual ? (
                   <button 
                     onClick={() => setShowManual(true)}
                     className="w-full bg-white/20 border border-white/30 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-white/30 transition-all"
                   >
                     <HelpCircle size={20}/> 追加ボタンが出ない場合
                   </button>
                 ) : (
                   <div className="bg-white/10 backdrop-blur-md p-4 rounded-xl border border-white/20 animate-in fade-in">
                     <p className="font-bold mb-3 flex items-center gap-2 text-sm">
                       {isIos ? 'iPhone・iPadの手順' : 'ブラウザメニューの手順'}
                     </p>
                     
                     {isIos ? (
                       <ol className="space-y-3 text-sm font-bold opacity-90">
                         <li className="flex items-center gap-2">
                           <span className="bg-white text-indigo-600 w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-xs">1</span>
                           <span>画面下の <Share size={16} className="inline mx-1"/> (共有) をタップ</span>
                         </li>
                         <li className="flex items-center gap-2">
                           <span className="bg-white text-indigo-600 w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-xs">2</span>
                           <span>「ホーム画面に追加」<PlusSquare size={16} className="inline mx-1"/> を探してタップ</span>
                         </li>
                         <li className="flex items-center gap-2">
                           <span className="bg-white text-indigo-600 w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-xs">3</span>
                           <span>右上の「追加」をタップ</span>
                         </li>
                       </ol>
                     ) : (
                       <div className="text-sm font-bold opacity-90">
                         ブラウザのメニューから「アプリをインストール」または「ホーム画面に追加」を選んでください。
                       </div>
                     )}
                     
                     <button 
                       onClick={() => setShowManual(false)} 
                       className="mt-4 w-full bg-white/20 py-2 rounded-lg text-xs font-bold hover:bg-white/30"
                     >
                       閉じる
                     </button>
                   </div>
                 )}
              </div>
            )}
          </section>
        )}

        {isStandalone && (
           <div className="bg-blue-50 text-blue-600 p-4 rounded-2xl text-center font-bold text-sm flex items-center justify-center gap-2 border border-blue-100">
             <Check size={18}/> アプリとして使用中
           </div>
        )}

        {/* --- 1. 文字サイズ設定 --- */}
        <section className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
          <h2 className="text-lg font-extrabold text-gray-800 mb-4 flex items-center gap-2">
            <Type size={20} className="text-orange-500"/> 文字の大きさ
          </h2>
          <div className="flex bg-gray-100 p-1.5 rounded-2xl mb-4">
            <button 
              onClick={() => handleTextSizeChange('normal')} 
              className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all ${textSize === 'normal' ? 'bg-white shadow text-gray-800' : 'text-gray-400'}`}
            >
              ふつう
            </button>
            <button 
              onClick={() => handleTextSizeChange('large')} 
              className={`flex-1 py-3 rounded-xl text-lg font-bold transition-all ${textSize === 'large' ? 'bg-white shadow text-gray-800' : 'text-gray-400'}`}
            >
              おおきめ
            </button>
          </div>
        </section>

        {/* --- 2. プロフィール設定 (表示のみ) --- */}
        <section className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
          <h2 className="text-lg font-extrabold text-gray-800 mb-6 flex items-center gap-2">
            <User size={20} className="text-indigo-500"/> プロフィール
          </h2>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-gray-400 mb-2">お名前</label>
              <div className="w-full p-4 bg-gray-50 border border-gray-100 rounded-xl font-bold text-gray-700">
                {name}
              </div>
              <p className="text-[10px] text-gray-400 mt-1 pl-1">※お名前の変更は先生にお伝えください</p>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-400 mb-2">目標</label>
              <div className="grid grid-cols-2 gap-2">
                {['定期テスト対策', '受験対策', '苦手克服', '予習中心'].map((t) => (
                  <button key={t} onClick={() => { setTarget(t); setHasChanges(true); }} className={`p-3 rounded-xl text-sm font-bold border-2 transition-all ${target === t ? 'bg-indigo-50 border-indigo-500 text-indigo-700' : 'bg-white border-gray-100 text-gray-400 hover:bg-gray-50'}`}>{t}</button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* --- 3. 音・通知 --- */}
        <section className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
          <h2 className="text-lg font-extrabold text-gray-800 mb-6 flex items-center gap-2">
            <Volume2 size={20} className="text-teal-500"/> 音・通知
          </h2>
          <div className="space-y-4">
            {[
              { key: 'notification_homework', label: '宿題の通知' },
              { key: 'notification_class', label: '授業開始の通知' },
              { key: 'sound_se', label: '効果音 (SE)' },
            ].map((item) => (
              <div key={item.key} className="flex items-center justify-between">
                <span className="font-bold text-gray-700 text-sm">{item.label}</span>
                <button 
                  // @ts-ignore
                  onClick={() => handleChange(item.key, !settings[item.key])}
                  // @ts-ignore
                  className={`w-12 h-7 rounded-full p-1 transition-colors duration-300 ${settings[item.key] ? 'bg-teal-500' : 'bg-gray-200'}`}
                >
                  {/* @ts-ignore */}
                  <div className={`w-5 h-5 bg-white rounded-full shadow-sm transition-transform duration-300 ${settings[item.key] ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* --- 保存ボタン --- */}
        <div className="sticky bottom-20 z-20">
          <button 
            onClick={handleSaveSettings}
            disabled={loading}
            className={`w-full py-4 rounded-2xl font-black text-lg shadow-xl flex items-center justify-center gap-2 transition-all transform ${hasChanges ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white hover:scale-[1.02] active:scale-95 shadow-indigo-200' : 'bg-gray-200 text-gray-400'}`}
          >
            {loading ? <Loader2 className="animate-spin" size={24}/> : <Save size={24}/>} 
            {hasChanges ? '変更を保存する' : '保存済み'}
          </button>
        </div>

        {/* --- 4. セキュリティ --- */}
        <section className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
          <h2 className="text-lg font-extrabold text-gray-800 mb-2 flex items-center gap-2">
            <Lock size={20} className="text-gray-400"/> セキュリティ
          </h2>
          {!isPasswordExpanded ? (
            <button onClick={() => setIsPasswordExpanded(true)} className="w-full py-3 text-left font-bold text-gray-500 hover:text-gray-800 flex items-center justify-between"><span>パスワードを変更する</span><ChevronRight size={18}/></button>
          ) : (
            <div className="space-y-4 mt-4 animate-in fade-in">
              <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="w-full p-3 bg-gray-50 rounded-xl font-bold" placeholder="新しいパスワード" />
              <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="w-full p-3 bg-gray-50 rounded-xl font-bold" placeholder="確認用" />
              <div className="flex justify-end gap-2">
                <button onClick={() => setIsPasswordExpanded(false)} className="px-4 py-2 text-gray-400 font-bold text-sm">キャンセル</button>
                <button onClick={handleChangePassword} className="bg-gray-800 text-white px-6 py-2 rounded-xl font-bold text-sm">変更</button>
              </div>
            </div>
          )}
        </section>

        <div className="pt-4 pb-10">
           <button onClick={logout} className="w-full bg-white border-2 border-red-50 text-red-400 py-4 rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-red-50">
             <LogOut size={20}/> ログアウト
           </button>
        </div>

      </div>
    </div>
  );
}
