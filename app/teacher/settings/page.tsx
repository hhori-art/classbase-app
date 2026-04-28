'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/app/context/AuthContext';
import { db } from '@/lib/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { updatePassword } from 'firebase/auth';
import { 
  User, Lock, LogOut, ChevronRight, 
  Save, Loader2, Shield, Bell, Type, 
  Smartphone, Download, Share, PlusSquare, HelpCircle, Check, Briefcase, MessageCircle
} from 'lucide-react';

export default function TeacherSettingsPage() {
  const { user, profile, logout } = useAuth();
  
  const [textSize, setTextSize] = useState('normal'); 

  // --- State ---
  const [name, setName] = useState('');
  const [settings, setSettings] = useState({
    notification_shift: true,
    notification_student: true,
    notification_admin: true,
    sound_bgm: false,
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

  // --- LINE連携状態 ---
  const [lineUserId, setLineUserId] = useState<string | null>(null);
  const [lineLinking, setLineLinking] = useState(false);

  useEffect(() => {
    // 1. プロフィールの読み込み
    if (profile) {
      setName(profile.name || user?.displayName || '');
      if (profile.line_user_id) setLineUserId(profile.line_user_id);
      if (profile.settings) setSettings(prev => ({ ...prev, ...profile.settings }));
    }

    // 2. LINE連携からの戻り時の処理 (URLパラメータのチェック)
    if (typeof window !== 'undefined') {
      const searchParams = new URLSearchParams(window.location.search);
      const newLineId = searchParams.get('line_id');
      const error = searchParams.get('error');

      // 連携成功時
      if (newLineId && user && profile && !profile.line_user_id) {
        const saveLineId = async () => {
          setLoading(true);
          try {
            const userRef = doc(db, 'users', user.uid);
            await updateDoc(userRef, { line_user_id: newLineId });
            setLineUserId(newLineId);
            showMessage('success', 'LINE連携が完了しました！');
            // パラメータを消してURLを綺麗にする
            window.history.replaceState(null, '', window.location.pathname);
          } catch (e) {
            console.error(e);
            showMessage('error', 'LINE連携の保存に失敗しました');
          } finally {
            setLoading(false);
          }
        };
        saveLineId();
      }

      // 連携失敗時・キャンセル時
      if (error) {
        showMessage('error', 'LINE連携に失敗したか、キャンセルされました');
        window.history.replaceState(null, '', window.location.pathname);
      }
    }

    // 3. PWAインストールの準備
    const handleBeforeInstallPrompt = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    const isIosDevice = /iPhone|iPad|iPod/.test(navigator.userAgent);
    setIsIos(isIosDevice);

    const checkStandalone = () => {
      const isApp = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone;
      setIsStandalone(!!isApp);
    };
    checkStandalone();

    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, [profile, user]);

  const handleChange = (key: string, value: any) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const handleTextSizeChange = (size: 'normal' | 'large') => {
    setTextSize(size);
    document.documentElement.style.fontSize = size === 'large' ? '110%' : '100%';
  };

  // 保存処理
  const handleSaveSettings = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, { 
        settings: settings,
        updated_at: new Date().toISOString()
      });
      
      showMessage('success', '設定を保存しました！');
      setHasChanges(false);
    } catch (e: any) {
      console.error(e);
      showMessage('error', '保存に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  // LINE連携ボタンの処理
  const handleLineLink = async () => {
    if (!user) return;
    setLineLinking(true);
    try {
      // 連携用APIへリダイレクト
      const currentUrl = encodeURIComponent(window.location.href);
      window.location.href = `/api/line/auth?uid=${user.uid}&redirect=${currentUrl}`;
    } catch (e) {
      console.error(e);
      showMessage('error', 'LINE連携画面への移動に失敗しました');
      setLineLinking(false);
    }
  };

  // LINE連携解除の処理
  const handleLineUnlink = async () => {
    if (!user || !confirm('LINE連携を解除しますか？\n授業のお知らせなどが届かなくなります。')) return;
    setLoading(true);
    try {
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, { 
        line_user_id: null,
        updated_at: new Date().toISOString()
      });
      setLineUserId(null);
      showMessage('success', 'LINE連携を解除しました');
    } catch (e) {
      console.error(e);
      showMessage('error', '解除に失敗しました');
    } finally {
      setLoading(false);
    }
  };

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

  const handleLogout = async () => {
    if (!confirm('ログアウトしますか？')) return;
    await logout();
  };

  return (
    <div className="min-h-screen bg-[#F0F4F8] p-4 sm:p-6 lg:p-8 font-sans transition-all pb-32">
      <div className="max-w-xl mx-auto space-y-8">
        
        {/* ヘッダー */}
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-extrabold text-gray-800 flex items-center gap-2">
            <Briefcase className="text-indigo-600"/> 設定・アカウント
          </h1>
        </div>

        {message && (
          <div className={`p-4 rounded-2xl font-bold flex items-center gap-3 shadow-sm ${message.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
            <Shield size={20}/> {message.text}
          </div>
        )}

        {/* --- 0. アプリインストール (PWA) --- */}
        {!isStandalone && (
          <section className="bg-gradient-to-br from-indigo-600 to-purple-700 p-6 rounded-3xl shadow-lg text-white relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full blur-3xl transform translate-x-10 -translate-y-10"></div>
            
            <h2 className="text-lg font-black flex items-center gap-2 mb-2 relative z-10">
              <Smartphone size={24}/> アプリとして使う
            </h2>
            <p className="text-sm font-bold opacity-90 mb-6 relative z-10 leading-relaxed">
              ホーム画面に追加すると、<br/>全画面表示でスムーズに業務を行えます。
            </p>

            {deferredPrompt ? (
              <button 
                onClick={handleInstallClick}
                className="relative z-10 w-full bg-white text-indigo-600 py-3 rounded-xl font-black shadow-lg flex items-center justify-center gap-2 active:scale-95 transition-transform"
              >
                <Download size={20}/> 追加する
              </button>
            ) : (
              <div className="relative z-10">
                 {!showManual ? (
                   <button 
                     onClick={() => setShowManual(true)}
                     className="w-full bg-white/20 border border-white/30 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-white/30 transition-all text-sm"
                   >
                     <HelpCircle size={18}/> 追加方法を見る
                   </button>
                 ) : (
                   <div className="bg-white/10 backdrop-blur-md p-4 rounded-xl border border-white/20 animate-in fade-in">
                     <p className="font-bold mb-3 flex items-center gap-2 text-sm">
                       {isIos ? 'iPhone・iPadの手順' : 'ブラウザメニューの手順'}
                     </p>
                     
                     {isIos ? (
                       <ol className="space-y-2 text-xs font-bold opacity-90">
                         <li className="flex items-center gap-2">
                           <span className="bg-white text-indigo-600 w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-[10px]">1</span>
                           <span>画面下の <Share size={14} className="inline mx-1"/> (共有) をタップ</span>
                         </li>
                         <li className="flex items-center gap-2">
                           <span className="bg-white text-indigo-600 w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-[10px]">2</span>
                           <span>「ホーム画面に追加」<PlusSquare size={14} className="inline mx-1"/> をタップ</span>
                         </li>
                         <li className="flex items-center gap-2">
                           <span className="bg-white text-indigo-600 w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-[10px]">3</span>
                           <span>右上の「追加」をタップ</span>
                         </li>
                       </ol>
                     ) : (
                       <div className="text-xs font-bold opacity-90">
                         ブラウザメニューから「ホーム画面に追加」を選択してください。
                       </div>
                     )}
                     
                     <button 
                       onClick={() => setShowManual(false)} 
                       className="mt-3 w-full bg-white/20 py-2 rounded-lg text-xs font-bold hover:bg-white/30"
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
           <div className="bg-blue-50 text-blue-600 p-3 rounded-2xl text-center font-bold text-xs flex items-center justify-center gap-2 border border-blue-100">
             <Check size={16}/> アプリとして使用中
           </div>
        )}

        {/* --- 1. 文字サイズ設定 --- */}
        <section className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
          <h2 className="text-sm font-extrabold text-gray-500 uppercase tracking-wider mb-4 flex items-center gap-2">
            <Type size={18}/> 表示設定
          </h2>
          <div className="flex bg-gray-100 p-1 rounded-xl">
            <button 
              onClick={() => handleTextSizeChange('normal')} 
              className={`flex-1 py-2.5 rounded-lg text-xs font-bold transition-all ${textSize === 'normal' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-400'}`}
            >
              標準
            </button>
            <button 
              onClick={() => handleTextSizeChange('large')} 
              className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all ${textSize === 'large' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-400'}`}
            >
              拡大
            </button>
          </div>
        </section>

        {/* --- 2. プロフィール設定 (表示のみ) --- */}
        <section className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
          <h2 className="text-sm font-extrabold text-gray-500 uppercase tracking-wider mb-4 flex items-center gap-2">
            <User size={18}/> プロフィール
          </h2>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-gray-400 mb-2">表示名</label>
              <div className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl font-bold text-gray-700 text-sm">
                {name}
              </div>
            </div>
            
            <div>
              <label className="block text-xs font-bold text-gray-400 mb-2">ログインID</label>
              <div className="w-full p-3 bg-gray-50 border border-gray-100 rounded-xl font-bold text-gray-700 text-sm font-mono tracking-wide">
                {user?.email?.replace('@sozogakuen.co.jp', '')}
              </div>
            </div>
          </div>
        </section>

        {/* --- LINE連携セクション --- */}
        <section className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
          <h2 className="text-sm font-extrabold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-2">
            <MessageCircle size={18} className="text-[#06C755]"/> LINE連携
          </h2>
          <p className="text-xs text-gray-500 mb-4 font-medium leading-relaxed">
            連携すると、授業当日のリマインドやシフト提出のお願いなどをLINEで受け取ることができます。
          </p>

          {lineUserId ? (
            <div className="bg-[#06C755]/10 border border-[#06C755]/20 p-4 rounded-2xl flex flex-col gap-3">
              <div className="flex items-center gap-2 text-[#06C755] font-bold text-sm">
                <Check size={18}/> 連携済み
              </div>
              <button 
                onClick={handleLineUnlink}
                className="w-full py-2.5 bg-white text-gray-500 text-xs font-bold rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors"
              >
                連携を解除する
              </button>
            </div>
          ) : (
            <button 
              onClick={handleLineLink}
              disabled={lineLinking}
              className="w-full bg-[#06C755] hover:bg-[#05b34c] text-white py-3.5 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-all active:scale-95 shadow-md shadow-[#06C755]/20"
            >
              {lineLinking ? <Loader2 className="animate-spin" size={18}/> : <MessageCircle size={18} fill="currentColor"/>}
              LINEと連携する
            </button>
          )}
        </section>

        {/* --- 3. 通知設定 --- */}
        <section className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
          <h2 className="text-sm font-extrabold text-gray-500 uppercase tracking-wider mb-4 flex items-center gap-2">
            <Bell size={18}/> アプリ内通知設定
          </h2>
          <div className="space-y-4">
            {[
              { key: 'notification_shift', label: 'シフト提出のリマインド' },
              { key: 'notification_student', label: '生徒からの連絡' },
              { key: 'notification_admin', label: '運営からのお知らせ' },
            ].map((item) => (
              <div key={item.key} className="flex items-center justify-between">
                <span className="font-bold text-gray-700 text-sm">{item.label}</span>
                <button 
                  // @ts-ignore
                  onClick={() => handleChange(item.key, !settings[item.key])}
                  // @ts-ignore
                  className={`w-11 h-6 rounded-full p-1 transition-colors duration-300 flex items-center ${settings[item.key] ? 'bg-indigo-500' : 'bg-gray-200'}`}
                >
                  {/* @ts-ignore */}
                  <div className={`w-4 h-4 bg-white rounded-full shadow-sm transition-transform duration-300 ${settings[item.key] ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* --- 保存ボタン --- */}
        <div className="sticky bottom-24 z-20">
          <button 
            onClick={handleSaveSettings}
            disabled={loading}
            className={`w-full py-4 rounded-2xl font-black text-sm shadow-xl flex items-center justify-center gap-2 transition-all transform ${hasChanges ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white hover:scale-[1.02] active:scale-95 shadow-indigo-200' : 'bg-gray-200 text-gray-400'}`}
          >
            {loading ? <Loader2 className="animate-spin" size={18}/> : <Save size={18}/>} 
            {hasChanges ? '変更を保存する' : '保存済み'}
          </button>
        </div>

        {/* --- 4. セキュリティ --- */}
        <section className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
          <h2 className="text-sm font-extrabold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-2">
            <Lock size={18}/> セキュリティ
          </h2>
          {!isPasswordExpanded ? (
            <button onClick={() => setIsPasswordExpanded(true)} className="w-full py-3 text-left font-bold text-gray-500 hover:text-gray-800 flex items-center justify-between text-sm"><span>パスワードを変更する</span><ChevronRight size={16}/></button>
          ) : (
            <div className="space-y-3 mt-3 animate-in fade-in">
              <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="w-full p-3 bg-gray-50 rounded-xl font-bold text-sm" placeholder="新しいパスワード" />
              <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="w-full p-3 bg-gray-50 rounded-xl font-bold text-sm" placeholder="確認用" />
              <div className="flex justify-end gap-2">
                <button onClick={() => setIsPasswordExpanded(false)} className="px-4 py-2 text-gray-400 font-bold text-xs">キャンセル</button>
                <button onClick={handleChangePassword} className="bg-gray-800 text-white px-5 py-2 rounded-xl font-bold text-xs">変更</button>
              </div>
            </div>
          )}
        </section>

        <div className="pt-4 pb-10">
           <button onClick={handleLogout} className="w-full bg-white border-2 border-red-50 text-red-400 py-3 rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-red-50 text-sm transition-colors">
             <LogOut size={18}/> ログアウト
           </button>
        </div>

      </div>
    </div>
  );
}
