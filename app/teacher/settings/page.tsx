'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/app/context/AuthContext';
import { auth, db } from '@/lib/firebase';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { PASSWORD_CHANGED_RELOGIN_MESSAGE, passwordChangedButReloginFailed } from '@/lib/password-change-error';
import { doc, updateDoc } from 'firebase/firestore';
import { 
  User, Lock, LogOut, ChevronRight, 
  Save, Bell, Type, 
  Smartphone, Download, Share, PlusSquare, HelpCircle, Briefcase, Check
} from 'lucide-react';
import { Button, Card, PageHeader, SectionTitle, useConfirm, useToast } from '@/app/components/ui';
import LineLinkPanel from '@/app/components/LineLinkPanel';
import PushNotificationToggle from '@/app/components/PushNotificationToggle';
import RecoveryEmailSettings from '@/app/components/RecoveryEmailSettings';
import SignedInPasswordHelp, { displayLoginId } from '@/app/components/SignedInPasswordHelp';

// 実際に送信側（/api/admin/notifications の種類 shift / announcements）が読む設定だけを出す。
// 「生徒からの連絡」は通知の仕組みがないため表示しない。
const NOTIFICATION_ITEMS = [
  { key: 'notification_shift', label: 'シフト提出のお願い', description: '管理者が送る「シフト・勤怠」の通知' },
  { key: 'notification_admin', label: '運営からのお知らせ', description: '管理者が送るお知らせ' },
] as const;

export default function TeacherSettingsPage() {
  const { user, profile, logout } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  
  const [textSize, setTextSize] = useState('normal'); 

  // --- State ---
  const [name, setName] = useState('');
  const [settings, setSettings] = useState({
    notification_shift: true,
    notification_admin: true,
    sound_bgm: false,
  });

  const [loading, setLoading] = useState(false);
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
    // 1. プロフィールの読み込み
    if (profile) {
      setName(profile.name || user?.displayName || '');
      if (profile.settings) setSettings(prev => ({ ...prev, ...profile.settings }));
      if (profile.isFirstLogin === true) setIsPasswordExpanded(true);
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

  const handleChange = (key: keyof typeof settings, value: boolean) => {
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
        notification_preferences: {
          ...(profile?.notification_preferences || {}),
          in_app: true,
          line: profile?.notification_preferences?.line !== false,
          shift: settings.notification_shift,
          announcements: settings.notification_admin,
        },
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
    if (type === 'success') toast.success(text);
    else toast.error(text);
  };

  const handleChangePassword = async () => {
    if (!newPassword || newPassword !== confirmPassword) return showMessage('error', '新しいパスワードと確認用が一致しません');
    if (newPassword.length < 6) return showMessage('error', 'パスワードは6文字以上で入力してください');
    if (!user) return showMessage('error', 'ログイン情報を確認できません');
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ password: newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || 'password-change-failed');
      if (!user.email) throw new Error('missing-auth-email');
      sessionStorage.removeItem(`classbase_profile_cache:${user.uid}`);
      const refreshedCredential = await signInWithEmailAndPassword(auth, user.email, newPassword);
      await refreshedCredential.user.getIdToken(true);
      showMessage('success', 'パスワードを変更し、ログイン状態を更新しました');
      setNewPassword(''); setConfirmPassword(''); setIsPasswordExpanded(false);
    } catch(e) {
      if (passwordChangedButReloginFailed(e)) { showMessage('success', PASSWORD_CHANGED_RELOGIN_MESSAGE); await signOut(auth).catch(() => undefined); window.setTimeout(() => window.location.replace('/'), 2500); return; }
      showMessage('error', 'パスワードを変更できませんでした。もう一度お試しください。');
    }
    finally { setLoading(false); }
  };

  const handleLogout = async () => {
    const ok = await confirm({ title: 'ログアウトしますか？', confirmLabel: 'ログアウト' });
    if (!ok) return;
    await logout();
  };

  const inputClass = 'w-full rounded-input border border-line bg-canvas p-3 text-sm font-bold text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20';
  const readonlyClass = 'w-full rounded-input border border-line bg-canvas p-3 text-sm font-bold text-fg';

  return (
    <div className="px-4 py-5 sm:px-6">
      <div className="mx-auto max-w-xl space-y-6">
        
        <PageHeader tone="plain" title="設定・アカウント" icon={Briefcase} />

        <Link href="/manual" className="flex min-h-12 items-center justify-between rounded-card border border-accent/30 bg-accent-soft px-5 py-3 text-sm font-bold text-accent">
          講師・職員向け操作マニュアル <ChevronRight size={19} aria-hidden />
        </Link>

        {profile?.isFirstLogin === true && (
          <div role="alert" className="rounded-card border-2 border-amber-300 bg-amber-50 p-4 text-sm font-bold leading-relaxed text-amber-900">
            初回ログインのため、新しいパスワードを設定してください。変更が完了すると通常画面を利用できます。
          </div>
        )}

        {/* --- 0. アプリインストール (PWA) --- */}
        {!isStandalone && (
          <section className="relative overflow-hidden rounded-hero bg-accent p-6 text-accent-ink shadow-card">
            <h2 className="mb-2 flex items-center gap-2 text-lg font-bold">
              <Smartphone size={24} aria-hidden /> アプリとして使う
            </h2>
            <p className="mb-6 text-sm font-bold leading-relaxed opacity-90">
              ホーム画面に追加すると、<br/>全画面表示でスムーズに業務を行えます。
            </p>

            {deferredPrompt ? (
              <button 
                type="button"
                onClick={handleInstallClick}
                className="flex min-h-12 w-full items-center justify-center gap-2 rounded-btn bg-white py-3 font-bold text-accent shadow-sm transition-colors hover:bg-accent-soft"
              >
                <Download size={20} aria-hidden /> 追加する
              </button>
            ) : (
              <div>
                 {!showManual ? (
                   <button 
                     type="button"
                     onClick={() => setShowManual(true)}
                     className="flex min-h-11 w-full items-center justify-center gap-2 rounded-btn border border-white/30 bg-white/20 py-3 text-sm font-bold text-white transition-colors hover:bg-white/30"
                   >
                     <HelpCircle size={18} aria-hidden /> 追加方法を見る
                   </button>
                 ) : (
                   <div className="rounded-card border border-white/20 bg-white/10 p-4">
                     <p className="mb-3 flex items-center gap-2 text-sm font-bold">
                       {isIos ? 'iPhone・iPadの手順' : 'ブラウザメニューの手順'}
                     </p>
                     
                     {isIos ? (
                       <ol className="space-y-2 text-sm font-bold opacity-90">
                         <li className="flex items-center gap-2">
                           <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-xs text-accent">1</span>
                           <span>画面下の <Share size={14} className="mx-1 inline" aria-hidden /> (共有) をタップ</span>
                         </li>
                         <li className="flex items-center gap-2">
                           <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-xs text-accent">2</span>
                           <span>「ホーム画面に追加」<PlusSquare size={14} className="mx-1 inline" aria-hidden /> をタップ</span>
                         </li>
                         <li className="flex items-center gap-2">
                           <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-xs text-accent">3</span>
                           <span>右上の「追加」をタップ</span>
                         </li>
                       </ol>
                     ) : (
                       <div className="text-sm font-bold opacity-90">
                         ブラウザメニューから「ホーム画面に追加」を選択してください。
                       </div>
                     )}
                     
                     <button 
                       type="button"
                       onClick={() => setShowManual(false)} 
                       className="mt-3 min-h-10 w-full rounded-btn bg-white/20 text-sm font-bold hover:bg-white/30"
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
           <div className="flex items-center justify-center gap-2 rounded-card border border-sky-100 bg-sky-50 p-3 text-center text-xs font-bold text-sky-700">
             <Check size={16} aria-hidden /> アプリとして使用中
           </div>
        )}

        {/* --- 1. 文字サイズ設定 --- */}
        <Card>
          <SectionTitle icon={Type} title="表示設定" />
          <div className="flex rounded-btn bg-slate-100 p-1" role="group" aria-label="文字サイズ">
            <button 
              type="button"
              aria-pressed={textSize === 'normal'}
              onClick={() => handleTextSizeChange('normal')} 
              className={`min-h-10 flex-1 rounded-btn text-xs font-bold transition-colors ${textSize === 'normal' ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted'}`}
            >
              標準
            </button>
            <button 
              type="button"
              aria-pressed={textSize === 'large'}
              onClick={() => handleTextSizeChange('large')} 
              className={`min-h-10 flex-1 rounded-btn text-sm font-bold transition-colors ${textSize === 'large' ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted'}`}
            >
              拡大
            </button>
          </div>
        </Card>

        {/* --- 2. プロフィール設定 (表示のみ) --- */}
        <Card>
          <SectionTitle icon={User} title="プロフィール" />
          <div className="space-y-4">
            <div>
              <p className="mb-2 block text-xs font-bold text-fg-muted">表示名</p>
              <div className={readonlyClass}>
                {name}
              </div>
            </div>
            
            <div>
              <p className="mb-2 block text-xs font-bold text-fg-muted">ログインID</p>
              <div className={`${readonlyClass} font-mono tracking-wide`}>
                {displayLoginId(profile, user?.email)}
              </div>
            </div>
          </div>
        </Card>

        <LineLinkPanel
          role="teacher"
          lineUserId={profile?.line_user_id}
          description="連携すると、管理者からのシフト提出のお願いやお知らせをLINEでも受け取れます。"
        />

        <PushNotificationToggle />

        {/* --- 3. 通知設定 --- */}
        <Card>
          <SectionTitle icon={Bell} title="通知の受け取り" description="オフにした種類は、アプリ内・LINE・メールのいずれでも届かなくなります。" />
          <div className="space-y-2">
            {NOTIFICATION_ITEMS.map((item) => (
              <div key={item.key} className="flex min-h-11 items-center justify-between gap-3">
                <span id={`setting-${item.key}`} className="text-sm font-bold text-fg">
                  {item.label}
                  <span className="block text-xs font-medium text-fg-muted">{item.description}</span>
                </span>
                <button 
                  type="button"
                  role="switch"
                  aria-checked={settings[item.key]}
                  aria-labelledby={`setting-${item.key}`}
                  onClick={() => handleChange(item.key, !settings[item.key])}
                  className="inline-flex h-11 shrink-0 items-center rounded-full px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <span className={`flex h-6 w-11 items-center rounded-full p-1 transition-colors ${settings[item.key] ? 'bg-accent' : 'bg-slate-200'}`}>
                    <span className={`h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${settings[item.key] ? 'translate-x-5' : 'translate-x-0'}`} />
                  </span>
                </button>
              </div>
            ))}
          </div>
        </Card>

        {/* --- 保存ボタン --- */}
        <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20">
          <Button
            size="lg"
            fullWidth
            onClick={handleSaveSettings}
            loading={loading}
            disabled={!hasChanges && !loading}
            icon={<Save size={18} aria-hidden />}
            className="shadow-card"
          >
            {hasChanges ? '変更を保存する' : '保存済み'}
          </Button>
        </div>

        {/* --- 4. セキュリティ --- */}
        <Card>
          <SectionTitle icon={Lock} title="セキュリティ" className="mb-2" />
          <SignedInPasswordHelp
            loginId={displayLoginId(profile, user?.email)}
            hasVerifiedRecoveryEmail={Boolean(profile?.recovery_email && profile?.recovery_email_verified_at)}
            audience="teacher"
          />
          {!isPasswordExpanded ? (
            <button type="button" onClick={() => setIsPasswordExpanded(true)} className="mt-2 flex min-h-11 w-full items-center justify-between py-3 text-left text-sm font-bold text-fg-muted hover:text-fg"><span>パスワードを変更する（今のパスワードは不要）</span><ChevronRight size={16} aria-hidden /></button>
          ) : (
            <div className="mt-3 space-y-3">
              <p className="text-xs font-medium text-fg-muted">新しいパスワード（6文字以上）を2回入力してください。今のパスワードは入力しなくて大丈夫です。</p>
              <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className={inputClass} placeholder="新しいパスワード" aria-label="新しいパスワード" autoComplete="new-password" />
              <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className={inputClass} placeholder="確認用" aria-label="新しいパスワード（確認用）" autoComplete="new-password" />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setIsPasswordExpanded(false)}>キャンセル</Button>
                <Button variant="secondary" size="sm" onClick={handleChangePassword} loading={loading}>変更</Button>
              </div>
            </div>
          )}
          <div className="mt-5 border-t border-line pt-5">
            <RecoveryEmailSettings
              currentEmail={profile?.recovery_email}
              verified={Boolean(profile?.recovery_email_verified_at)}
              compact
            />
          </div>
        </Card>

        <div className="pb-10 pt-4">
           <Button variant="secondary" fullWidth onClick={handleLogout} icon={<LogOut size={18} aria-hidden />} className="!text-rose-600 hover:!bg-rose-50">
             ログアウト
           </Button>
        </div>

      </div>
    </div>
  );
}
