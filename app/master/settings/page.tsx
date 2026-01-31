'use client';

import { useState, useEffect } from 'react';
import { db, auth } from '@/lib/firebase';
import { doc, setDoc, getDoc, updateDoc } from 'firebase/firestore';
import { updatePassword, signOut } from 'firebase/auth';
import { 
  ArrowLeft, Link as LinkIcon, Loader2, Save, 
  Settings, User, Lock, LogOut, Smartphone, 
  Download, Share, HelpCircle, Check, PlusSquare, 
  Type, Globe, Beaker, BookOpen
} from 'lucide-react';
import Link from 'next/link';

// --- 設定用定数 ---
const GRADES = ['中1', '中2', '中3'];
const BASIC_SUBJECTS = ['英語', '数学', '国語'];
const SOCIAL_FIELDS = ['地理', '歴史', '公民'];
const SCIENCE_FIELDS = ['物理', '化学', '生物', '地学'];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<'system' | 'account'>('system');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [user, setUser] = useState<any>(null);

  // --- Zoom URL設定 State ---
  const [urls, setUrls] = useState<{[key:string]: string}>({});

  // --- アカウント設定 State ---
  const [textSize, setTextSize] = useState('normal');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordMsg, setPasswordMsg] = useState('');

  // --- PWA State ---
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [isIos, setIsIos] = useState(false);

  // 初期データ取得
  useEffect(() => {
    const init = async () => {
      setLoading(true);
      try {
        // ユーザー情報
        const currentUser = auth.currentUser;
        setUser(currentUser);

        // Zoom URL設定の取得
        const subjectSnap = await getDoc(doc(db, 'settings', 'subjects'));
        if (subjectSnap.exists()) {
          setUrls(subjectSnap.data().urls || {});
        }

        // PWAチェック
        const isApp = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone;
        setIsStandalone(!!isApp);
        setIsIos(/iPhone|iPad|iPod/.test(navigator.userAgent));

      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };

    init();

    // PWAインストールイベント
    const handleBeforeInstallPrompt = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  // --- ハンドラ関連 ---

  // URL入力
  const handleUrlChange = (key: string, value: string) => {
    setUrls(prev => ({ ...prev, [key]: value }));
  };

  // Zoom URL設定保存
  const handleSaveUrls = async () => {
    setSaving(true);
    try {
      await setDoc(doc(db, 'settings', 'subjects'), { urls }, { merge: true });
      alert('Zoom URL設定を保存しました');
    } catch(e) { 
      console.error(e);
      alert('保存エラー'); 
    } finally { 
      setSaving(false); 
    }
  };

  // パスワード変更
  const handleChangePassword = async () => {
    if (!newPassword || newPassword !== confirmPassword) {
      setPasswordMsg('パスワードが一致しません');
      return;
    }
    try {
      if(user) await updatePassword(user, newPassword);
      setPasswordMsg('パスワードを変更しました');
      setNewPassword(''); setConfirmPassword('');
    } catch(e) { setPasswordMsg('エラー: 再ログインが必要です'); }
  };

  // 文字サイズ変更
  const handleTextSizeChange = (size: 'normal' | 'large') => {
    setTextSize(size);
    document.documentElement.style.fontSize = size === 'large' ? '110%' : '100%';
  };

  // PWAインストール
  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') setDeferredPrompt(null);
    } else {
      setShowManual(true);
    }
  };

  // ログアウト
  const handleLogout = async () => {
    if (!confirm('ログアウトしますか？')) return;
    await signOut(auth);
    window.location.href = '/';
  };

  if (loading) return <div className="min-h-screen flex justify-center items-center"><Loader2 className="animate-spin text-slate-400" size={40}/></div>;

  return (
    <div className="min-h-screen bg-[#F0F3FF] p-6 pb-40 font-sans text-slate-800">
      <div className="max-w-5xl mx-auto">
        
        {/* ヘッダー */}
        <div className="flex flex-col md:flex-row items-center justify-between mb-8 gap-4">
          <div className="flex items-center gap-4 w-full md:w-auto">
            <Link href="/master" className="bg-white p-3 rounded-full shadow-sm hover:shadow-md transition-all text-slate-600">
              <ArrowLeft size={20} />
            </Link>
            <div>
              <h1 className="text-2xl font-black text-slate-800 flex items-center gap-2">
                <Settings className="text-slate-600" /> 設定管理
              </h1>
              <p className="text-xs font-bold text-slate-400 mt-1">Zoom URLとアカウント設定</p>
            </div>
          </div>

          {/* タブ切り替え */}
          <div className="flex bg-white p-1 rounded-2xl shadow-sm w-full md:w-auto">
            <button 
              onClick={() => setActiveTab('system')}
              className={`flex-1 md:flex-none px-6 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all ${activeTab === 'system' ? 'bg-slate-800 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}
            >
              <LinkIcon size={14}/> Zoom URL設定
            </button>
            <button 
              onClick={() => setActiveTab('account')}
              className={`flex-1 md:flex-none px-6 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all ${activeTab === 'account' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}
            >
              <User size={14}/> アカウント・アプリ
            </button>
          </div>
        </div>

        {/* =======================
            タブ1: Zoom URL設定
           ======================= */}
        {activeTab === 'system' && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2">
            
            {/* 1. 社会 (学年×分野) */}
            <div className="bg-white p-8 rounded-[32px] shadow-sm border border-slate-100">
              <h2 className="text-lg font-black text-slate-700 mb-6 flex items-center gap-2 border-b border-slate-100 pb-4">
                <Globe size={24} className="text-orange-500"/> 社会 (学年×分野)
              </h2>
              <div className="space-y-6">
                {GRADES.map(grade => (
                  <div key={grade}>
                    <h3 className="text-sm font-bold text-slate-500 mb-3 ml-1">{grade}</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {SOCIAL_FIELDS.map(field => {
                        const key = `${grade}社会${field}`; // 例: 中1社会地理
                        return (
                          <div key={key} className="relative group">
                            <span className="absolute top-2 left-3 text-[10px] font-bold text-orange-400">{field}</span>
                            <input 
                              type="text" 
                              placeholder="https://zoom.us/..."
                              className="w-full pt-6 pb-2 px-3 bg-orange-50/30 border-2 border-orange-100 rounded-xl text-xs font-bold text-slate-600 outline-none focus:border-orange-400 focus:bg-white transition-all"
                              value={urls[key] || ''}
                              onChange={e => handleUrlChange(key, e.target.value)}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 2. 理科 (学年×分野) */}
            <div className="bg-white p-8 rounded-[32px] shadow-sm border border-slate-100">
              <h2 className="text-lg font-black text-slate-700 mb-6 flex items-center gap-2 border-b border-slate-100 pb-4">
                <Beaker size={24} className="text-green-500"/> 理科 (学年×分野)
              </h2>
              <div className="space-y-6">
                {GRADES.map(grade => (
                  <div key={grade}>
                    <h3 className="text-sm font-bold text-slate-500 mb-3 ml-1">{grade}</h3>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                      {SCIENCE_FIELDS.map(field => {
                        const key = `${grade}理科${field}`; // 例: 中2理科化学
                        return (
                          <div key={key} className="relative group">
                            <span className="absolute top-2 left-3 text-[10px] font-bold text-green-500">{field}</span>
                            <input 
                              type="text" 
                              placeholder="URL"
                              className="w-full pt-6 pb-2 px-3 bg-green-50/30 border-2 border-green-100 rounded-xl text-xs font-bold text-slate-600 outline-none focus:border-green-400 focus:bg-white transition-all"
                              value={urls[key] || ''}
                              onChange={e => handleUrlChange(key, e.target.value)}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 3. 主要3科目 (学年別) */}
            <div className="bg-white p-8 rounded-[32px] shadow-sm border border-slate-100">
              <h2 className="text-lg font-black text-slate-700 mb-6 flex items-center gap-2 border-b border-slate-100 pb-4">
                <BookOpen size={24} className="text-indigo-500"/> 主要3科目 (学年別)
              </h2>
              <div className="space-y-6">
                {GRADES.map(grade => (
                  <div key={grade}>
                    <h3 className="text-sm font-bold text-slate-500 mb-3 ml-1">{grade}</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {BASIC_SUBJECTS.map(subject => {
                        const key = `${grade}${subject}`; // 例: 中3英語
                        return (
                          <div key={key} className="relative group">
                            <span className="absolute top-2 left-3 text-[10px] font-bold text-indigo-400">{subject}</span>
                            <input 
                              type="text" 
                              placeholder="URL"
                              className="w-full pt-6 pb-2 px-3 bg-indigo-50/30 border-2 border-indigo-100 rounded-xl text-xs font-bold text-slate-600 outline-none focus:border-indigo-400 focus:bg-white transition-all"
                              value={urls[key] || ''}
                              onChange={e => handleUrlChange(key, e.target.value)}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="sticky bottom-6 z-20 flex justify-end">
              <button 
                onClick={handleSaveUrls} 
                disabled={saving} 
                className="bg-slate-800 text-white px-8 py-4 rounded-2xl font-black shadow-xl shadow-slate-300 hover:bg-slate-700 transition-all active:scale-95 flex items-center gap-2 disabled:opacity-50"
              >
                {saving ? <Loader2 className="animate-spin" size={20}/> : <Save size={20}/>} URL設定を保存
              </button>
            </div>
          </div>
        )}

        {/* =======================
            タブ2: アカウント・アプリ設定
           ======================= */}
        {activeTab === 'account' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
            
            {/* PWAインストール */}
            {!isStandalone && (
              <div className="bg-gradient-to-br from-indigo-600 to-purple-700 p-6 rounded-[32px] shadow-lg text-white relative overflow-hidden">
                <div className="relative z-10">
                  <h2 className="font-black flex items-center gap-2 mb-2"><Smartphone size={20}/> アプリとしてインストール</h2>
                  <p className="text-xs font-bold opacity-80 mb-4">ホーム画面に追加して全画面で利用できます。</p>
                  
                  {deferredPrompt ? (
                    <button onClick={handleInstallClick} className="w-full bg-white text-indigo-600 py-3 rounded-xl font-black shadow-lg flex items-center justify-center gap-2 active:scale-95 transition-transform">
                      <Download size={18}/> 追加する
                    </button>
                  ) : (
                    <button onClick={() => setShowManual(true)} className="w-full bg-white/20 border border-white/30 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-white/30 transition-all text-xs">
                      <HelpCircle size={16}/> 追加方法を見る
                    </button>
                  )}

                  {showManual && (
                    <div className="mt-4 bg-white/10 backdrop-blur-md p-4 rounded-xl border border-white/20 text-xs font-bold">
                      <p className="mb-2">{isIos ? 'iOSの手順:' : 'ブラウザの手順:'}</p>
                      {isIos ? (
                        <ol className="list-decimal list-inside opacity-90 space-y-1">
                          <li><Share size={12} className="inline"/> (共有) をタップ</li>
                          <li>「ホーム画面に追加」<PlusSquare size={12} className="inline"/> を選択</li>
                          <li>右上の「追加」をタップ</li>
                        </ol>
                      ) : (
                        <p className="opacity-90">ブラウザのメニューから「ホーム画面に追加」または「アプリをインストール」を選択してください。</p>
                      )}
                      <button onClick={() => setShowManual(false)} className="mt-3 w-full bg-white/20 py-2 rounded-lg hover:bg-white/30">閉じる</button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 文字サイズ */}
            <div className="bg-white p-6 rounded-[32px] shadow-sm border border-slate-100">
              <h2 className="text-sm font-black text-slate-500 mb-4 flex items-center gap-2"><Type size={18}/> 表示サイズ設定</h2>
              <div className="flex bg-slate-100 p-1 rounded-xl">
                <button onClick={() => handleTextSizeChange('normal')} className={`flex-1 py-2.5 rounded-lg text-xs font-bold transition-all ${textSize === 'normal' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-400'}`}>標準</button>
                <button onClick={() => handleTextSizeChange('large')} className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all ${textSize === 'large' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-400'}`}>拡大</button>
              </div>
            </div>

            {/* パスワード変更 */}
            <div className="bg-white p-6 rounded-[32px] shadow-sm border border-slate-100">
              <h2 className="text-sm font-black text-slate-500 mb-4 flex items-center gap-2"><Lock size={18}/> パスワード変更</h2>
              <div className="space-y-3">
                <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm outline-none focus:border-indigo-400" placeholder="新しいパスワード" />
                <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm outline-none focus:border-indigo-400" placeholder="確認用" />
                <div className="flex justify-between items-center">
                  <span className={`text-xs font-bold ${passwordMsg.includes('エラー')?'text-red-500':'text-green-500'}`}>{passwordMsg}</span>
                  <button onClick={handleChangePassword} className="bg-slate-800 text-white px-5 py-2 rounded-xl font-bold text-xs hover:bg-slate-700 transition-colors">変更する</button>
                </div>
              </div>
            </div>

            {/* ログアウト */}
            <button onClick={handleLogout} className="w-full bg-white border-2 border-red-100 text-red-400 py-3 rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-red-50 text-sm transition-colors mt-8">
              <LogOut size={18}/> ログアウト
            </button>

          </div>
        )}

      </div>
    </div>
  );
}