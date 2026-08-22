'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/app/context/AuthContext';
import { useSettings } from '@/app/context/SettingsContext';
import { db } from '@/lib/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { 
  ArrowLeft, User, Lock, LogOut, ChevronRight, 
  Save, Loader2, Shield, Target, Type, 
  Volume2, Smartphone, Download, Share, PlusSquare, HelpCircle, Check, Copy,
  Palette, LayoutGrid
} from 'lucide-react';
import Link from 'next/link';
import LineLinkPanel from '@/app/components/LineLinkPanel';
import RecoveryEmailSettings from '@/app/components/RecoveryEmailSettings';
import { usePortalVisibility } from '@/app/hooks/usePortalVisibility';
import { playSoundEffect, useSound } from '@/lib/sound';
import {
  DEFAULT_STUDENT_APPEARANCE,
  normalizeStudentAppearance,
  studentBackgroundPatternStyle,
  STUDENT_BACKGROUND_PATTERNS,
  STUDENT_CARD_STYLES,
  STUDENT_DENSITIES,
  STUDENT_HEADER_STYLES,
  STUDENT_THEMES,
  StudentAppearance,
  StudentBackgroundPattern,
  StudentCardStyle,
  StudentDensity,
  StudentHeaderStyle,
  StudentThemeId,
} from '@/lib/student-customization';

type ManualItem = {
  title: string;
  summary: string;
  steps: string[];
  trouble?: string[];
};

export default function StudentSettingsPage() {
  const { user, profile, logout } = useAuth();
  const { textSize, setTextSize } = useSettings();
  const { visibility } = usePortalVisibility('student');
  
  // --- State ---
  const [name, setName] = useState('');
  const [target, setTarget] = useState('定期テスト対策');
  const [settings, setSettings] = useState<{
    sound_bgm: boolean;
    sound_se: boolean;
    notification_homework: boolean;
    notification_class: boolean;
    notification_news: boolean;
    appearance: StudentAppearance;
    [key: string]: any;
  }>({
    sound_bgm: true,
    sound_se: true,
    notification_homework: true,
    notification_class: true,
    notification_news: false,
    appearance: DEFAULT_STUDENT_APPEARANCE,
  });

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{type: 'success'|'error', text: string} | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const { play } = useSound(settings.sound_se !== false);

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
        setSettings(prev => ({
          ...prev,
          ...profile.settings,
          appearance: normalizeStudentAppearance(profile.settings.appearance),
        }));
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
    if (key === 'sound_se') {
      if (value === true) playSoundEffect('button', { sound_se: true });
      if (user) {
        updateDoc(doc(db, 'users', user.uid), {
          'settings.sound_se': value,
          updated_at: new Date().toISOString(),
        }).catch(() => {
          showMessage('error', '効果音設定の保存に失敗しました');
          setSettings(prev => ({ ...prev, sound_se: !value }));
        });
      }
      return;
    }
    setHasChanges(true);
  };

  const handleAppearanceChange = <K extends keyof StudentAppearance>(key: K, value: StudentAppearance[K]) => {
    setSettings(prev => ({
      ...prev,
      appearance: {
        ...normalizeStudentAppearance(prev.appearance),
        [key]: value,
      },
    }));
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
        notification_preferences: {
          ...(profile?.notification_preferences || {}),
          in_app: true,
          line: profile?.notification_preferences?.line !== false,
          homework: settings.notification_homework,
          class_start: settings.notification_class,
          announcements: settings.notification_news,
        },
        updated_at: new Date().toISOString()
      });
      showMessage('success', '設定を保存しました！');
      if (settings.sound_se) play('notification');
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

  const appearance = normalizeStudentAppearance(settings.appearance);
  const currentTheme = STUDENT_THEMES[appearance.theme];
  const currentHeader = STUDENT_HEADER_STYLES[appearance.headerStyle];
  const manualItems = [
    {
      title: '授業に参加したいとき',
      summary: 'ホーム画面の参加ボタンから入ります。ボタンは受講登録と当日の授業予定が一致した授業だけ表示されます。',
      steps: [
        'ホーム画面を開き、1限または2限の授業カードを確認します。',
        '自分が登録している曜日・時限・講座と当日の授業予定が一致すると「Zoomに参加」ボタンが表示されます。',
        'ボタンを押すとZoomが開きます。スマホでアプリが開かない場合は、表示されたブラウザ画面から「アプリで参加」を選びます。',
        '自分の登録授業がない時間は参加ボタンではなく、振替参加の案内が表示されます。',
      ],
      trouble: [
        'ボタンが出ない場合は、受講講座・曜日時間の変更で登録内容が正しいか確認してください。',
        '登録内容が正しいのに出ない場合は、授業開始前後の表示時間外、または当日の授業予定がまだ反映されていない可能性があります。',
        '別の授業ボタンが出る場合は、学年・曜日・時限・講座の登録がずれている可能性があります。',
      ],
    },
    visibility.changeRequest !== false && {
      title: '受講講座・曜日時間を変更したいとき',
      summary: '保存するとすぐに反映されます。科目を選んでから曜日・時間を選びます。',
      steps: [
        'ホーム画面または設定から「受講講座・曜日時間の変更」を開きます。',
        '現在実施中の期だけが表示されます。過去や先の期は選べません。',
        'Step 1で受講したい科目を選びます。',
        'Step 2でその科目の開講曜日・時間を選びます。同じ曜日・同じ時限に複数講座は選べません。',
        '右側の「保存される講座」を確認し、「すぐに変更する」を押します。',
      ],
      trouble: [
        '選びたい講座が出ない場合は、現在の期・学年に該当する講座候補がない可能性があります。',
        '同じ時限の別講座を選ぶと、前に選んだ講座は自動で外れます。',
        '保存後はホーム画面の参加ボタン判定にも反映されます。',
      ],
    },
    visibility.transfer !== false && {
      title: '振替で参加したいとき',
      summary: '登録授業がない時間や、保護者から振替選択を依頼された時に使います。',
      steps: [
        'ホーム画面で登録授業がない時間に「振替参加」の案内が出たら開きます。',
        '現在行われている授業のうち、自分の学年に合う候補が表示されます。',
        '参加したい授業を1つ選び、内容を確認して確定します。',
        '保護者が「お子様が選択する」を選んだ欠席連絡がある場合は、振替を選ぶまでホーム画面に選択案内が表示されます。',
      ],
      trouble: [
        '候補が出ない場合は、その時間に自分の学年の授業がない可能性があります。',
        '違う学年の候補は表示されません。',
        '時期によっては、いつでも振替できる表示が出ない場合があります。',
      ],
    },
    visibility.homework !== false && {
      title: 'Monoxerの宿題に取り組むとき',
      summary: '宿題はMonoxerを開いて進めます。スマホ・タブレットではアプリ起動を優先します。',
      steps: [
        'ホーム画面の「Monoxer」を押します。',
        'スマホ・タブレットではMonoxerアプリが開くか確認します。',
        'アプリが開かない場合は、表示されたWeb版リンクからログインして進めます。',
        'PCではブラウザ版のMonoxerが開きます。',
      ],
      trouble: [
        'アプリが開かない場合は、端末にMonoxerアプリが入っているか確認してください。',
        'ログインが求められる場合は、MonoxerのID・パスワードを確認してください。',
        'うまく開けない場合は、アプリではなくWeb版リンクから開いてください。',
      ],
    },
    visibility.recordings !== false && {
      title: '欠席した授業や復習の録画を見るとき',
      summary: '公開済みの録画だけが表示されます。日付または単元で探せます。',
      steps: [
        'ホーム画面の「授業録画」を開きます。',
        '日付で探す場合は、録画がある日に表示される印を選びます。',
        '単元で探す場合は、単元名や講座名で検索します。',
        '録画を選ぶとアプリ内の視聴画面で再生できます。',
      ],
      trouble: [
        '録画が出ない場合は、まだ公開前の可能性があります。',
        '授業名と録画が違う場合は、少し時間をおいて再度確認してください。',
        '再生できない場合は、通信環境を確認してから再度開いてください。',
      ],
    },
    visibility.absence !== false && {
      title: '欠席するとき',
      summary: '欠席連絡は主に保護者画面から行います。生徒画面に表示されている場合は生徒側からも確認できます。',
      steps: [
        '保護者画面で欠席する日を選びます。',
        '振替を保護者が選ぶ場合は、候補から振替先を選んで確定します。',
        '生徒が選ぶ場合は「お子様が選択する」を選びます。',
        '生徒が選ぶ設定の場合、生徒画面に振替選択の案内が表示されます。',
      ],
      trouble: [
        '生徒画面に振替案内が出ない場合は、保護者画面で「お子様が選択する」が選ばれているか確認してください。',
        '振替候補がない場合は、同じ単元または同じ学年の開講候補がない可能性があります。',
      ],
    },
    visibility.calendar !== false && {
      title: '授業日や予定を確認したいとき',
      summary: 'カレンダーでは授業日、予定、宿題期限を確認します。',
      steps: [
        'ホーム画面のカレンダーを確認します。',
        '日付を選ぶと、その日の予定や授業情報を確認できます。',
        '宿題期限やお知らせがある場合は、該当日やホーム画面にも表示されます。',
      ],
      trouble: [
        '予定が出ない場合は、年間予定や当日の授業予定がまだ反映されていない可能性があります。',
        '自分の受講登録と関係ない予定は表示されない場合があります。',
      ],
    },
    visibility.news !== false && {
      title: 'お知らせを確認するとき',
      summary: '教室からの連絡事項や重要なお知らせを確認します。',
      steps: [
        'ホーム画面のお知らせ欄、またはお知らせページを開きます。',
        '未読のお知らせを上から確認します。',
        '重要なお知らせは通知にも表示されることがあります。',
      ],
      trouble: [
        'お知らせが見つからない場合は、表示対象の学年・校舎に含まれていない可能性があります。',
        '通知が来ない場合は、設定画面の通知設定とLINE連携を確認してください。',
      ],
    },
    visibility.shop !== false && {
      title: 'ポイント・バッジを確認したいとき',
      summary: 'ログイン、録画視聴、ミッション達成などで獲得した内容を確認します。',
      steps: [
        'ホーム画面のポイント・バッジ表示を確認します。',
        'ランキングやバッジ一覧を開き、獲得状況を確認します。',
        'デイリーミッションが表示されている場合は、条件を達成して受け取ります。',
      ],
      trouble: [
        'ポイントやバッジがすぐ反映されない場合は、画面を更新して確認してください。',
        '時期によってはポイント機能が表示されない場合があります。',
      ],
    },
    {
      title: 'ログインできない・パスワードを変えたいとき',
      summary: 'まずID・初期パスワード・入力ミスを確認します。パスワード変更はこの設定画面から行えます。',
      steps: [
        '案内書面に記載されたログインURLを開きます。',
        'IDとパスワードを半角で入力します。前後に空白が入っていないか確認します。',
        'ログイン後にパスワード変更が必要な場合は、設定画面の「セキュリティ」から変更します。',
        '新しいパスワードは10文字以上で、確認欄にも同じものを入力します。',
      ],
      trouble: [
        '何度試しても入れない場合は、ID書面の再発行またはパスワード初期化が必要です。',
        '自分で解決できない場合は、理社講座サポートセンター（078-321-4123）へ連絡してください。',
      ],
    },
  ].filter(Boolean) as ManualItem[];

  const handleChangePassword = async () => {
    if (!newPassword || newPassword !== confirmPassword) return showMessage('error', 'パスワード不一致');
    if (newPassword.length < 10) return showMessage('error', 'パスワードは10文字以上で入力してください');
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
      showMessage('success', 'パスワードを変更しました');
      setNewPassword(''); setConfirmPassword(''); setIsPasswordExpanded(false);
    } catch(e) { showMessage('error', 'パスワード変更に失敗しました'); }
    finally { setLoading(false); }
  };

  return (
    <div className={`min-h-screen ${currentTheme.pageBg} p-6 pb-40 font-sans`} style={studentBackgroundPatternStyle(appearance.backgroundPattern)}>
      <div className="max-w-xl mx-auto space-y-8">
        
        {/* ヘッダー */}
        <div className={`${currentTheme.heroBg} ${currentHeader.heroShape} p-5 text-white relative overflow-hidden`}>
          <div className={`absolute -right-8 -top-8 h-28 w-28 rounded-full ${currentTheme.heroAccent} blur-xl ${currentHeader.decoration}`}></div>
          <div className="relative z-10 flex items-center gap-4">
          <Link href="/student" className="bg-white/20 p-3 rounded-full shadow-sm text-white hover:bg-white/30 transition-colors">
            <ArrowLeft size={20} />
          </Link>
            <div>
              <p className="text-xs font-black opacity-80">現在のテーマ: {currentTheme.label}</p>
              <h1 className="text-2xl font-extrabold">設定・アカウント</h1>
            </div>
          </div>
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

        {/* --- 2. 見た目カスタム --- */}
        <section className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
          <h2 className="text-lg font-extrabold text-gray-800 mb-2 flex items-center gap-2">
            <Palette size={20} className="text-pink-500"/> ホームのデザイン
          </h2>
          <p className="mb-5 text-xs font-bold leading-relaxed text-gray-400">
            生徒ホームの色やカードの雰囲気を自分好みに変えられます。
          </p>

          <div className={`${currentTheme.pageBg} rounded-3xl p-3 border border-gray-100 mb-5`} style={studentBackgroundPatternStyle(appearance.backgroundPattern)}>
            <div className={`${currentTheme.heroBg} ${currentHeader.heroShape} p-4 text-white relative overflow-hidden`}>
              <div className={`absolute -right-5 -top-5 h-20 w-20 rounded-full ${currentTheme.heroAccent} blur-xl ${currentHeader.decoration}`}></div>
              <p className="text-[10px] font-black opacity-80">プレビュー</p>
              <div className="mt-2 flex items-center justify-between">
                <div>
                  <p className="text-sm font-black">こんにちは！</p>
                  <p className={`text-xl font-black ${currentTheme.nameColor}`}>{name || '生徒'} さん</p>
                </div>
                {appearance.showMascot && (
                  <div className="rounded-2xl bg-white/20 px-3 py-2 text-2xl">🎓</div>
                )}
              </div>
            </div>
            <div className={`mt-3 ${STUDENT_CARD_STYLES[appearance.cardStyle].panel} ${STUDENT_DENSITIES[appearance.density].cardPadding}`}>
              <div className="flex items-center gap-3">
                <span className={`h-9 w-9 rounded-2xl ${currentTheme.badgeBg} ${currentTheme.badgeText} flex items-center justify-center font-black`}>
                  <LayoutGrid size={18} />
                </span>
                <div>
                  <p className="text-sm font-black text-gray-800">カードの見本</p>
                  <p className="text-[10px] font-bold text-gray-400">{STUDENT_CARD_STYLES[appearance.cardStyle].label} / {STUDENT_DENSITIES[appearance.density].label}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-5">
            <div>
              <label className="mb-2 block text-xs font-black text-gray-400">テーマカラー</label>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(STUDENT_THEMES) as StudentThemeId[]).map(themeId => {
                  const theme = STUDENT_THEMES[themeId];
                  const active = appearance.theme === themeId;
                  return (
                    <button
                      key={themeId}
                      type="button"
                      onClick={() => handleAppearanceChange('theme', themeId)}
                      className={`rounded-2xl border-2 p-3 text-left transition-all ${active ? 'border-gray-900 bg-gray-50' : 'border-gray-100 bg-white hover:bg-gray-50'}`}
                    >
                      <div className="flex items-center gap-2">
                        <span className={`h-5 w-5 rounded-full ${theme.previewDot}`}></span>
                        <span className="text-sm font-black text-gray-800">{theme.label}</span>
                      </div>
                      <p className="mt-1 text-[10px] font-bold text-gray-400">{theme.description}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="mb-2 block text-xs font-black text-gray-400">カードの雰囲気</label>
              <div className="grid grid-cols-3 gap-2">
                {(Object.keys(STUDENT_CARD_STYLES) as StudentCardStyle[]).map(styleId => {
                  const style = STUDENT_CARD_STYLES[styleId];
                  const active = appearance.cardStyle === styleId;
                  return (
                    <button
                      key={styleId}
                      type="button"
                      onClick={() => handleAppearanceChange('cardStyle', styleId)}
                      className={`rounded-2xl border-2 p-3 text-center transition-all ${active ? 'border-gray-900 bg-gray-50 text-gray-900' : 'border-gray-100 bg-white text-gray-400 hover:bg-gray-50'}`}
                    >
                      <span className="block text-xs font-black">{style.label}</span>
                      <span className="mt-1 block text-[9px] font-bold leading-relaxed">{style.description}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="mb-2 block text-xs font-black text-gray-400">表示の詰め具合</label>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(STUDENT_DENSITIES) as StudentDensity[]).map(densityId => {
                  const density = STUDENT_DENSITIES[densityId];
                  const active = appearance.density === densityId;
                  return (
                    <button
                      key={densityId}
                      type="button"
                      onClick={() => handleAppearanceChange('density', densityId)}
                      className={`rounded-2xl border-2 p-3 text-left transition-all ${active ? 'border-gray-900 bg-gray-50' : 'border-gray-100 bg-white hover:bg-gray-50'}`}
                    >
                      <span className="text-sm font-black text-gray-800">{density.label}</span>
                      <p className="mt-1 text-[10px] font-bold text-gray-400">{density.description}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="mb-2 block text-xs font-black text-gray-400">ヘッダーの形</label>
              <div className="grid grid-cols-3 gap-2">
                {(Object.keys(STUDENT_HEADER_STYLES) as StudentHeaderStyle[]).map(headerId => {
                  const header = STUDENT_HEADER_STYLES[headerId];
                  const active = appearance.headerStyle === headerId;
                  return (
                    <button
                      key={headerId}
                      type="button"
                      onClick={() => handleAppearanceChange('headerStyle', headerId)}
                      className={`rounded-2xl border-2 p-3 text-center transition-all ${active ? 'border-gray-900 bg-gray-50 text-gray-900' : 'border-gray-100 bg-white text-gray-400 hover:bg-gray-50'}`}
                    >
                      <span className="block text-xs font-black">{header.label}</span>
                      <span className="mt-1 block text-[9px] font-bold leading-relaxed">{header.description}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="mb-2 block text-xs font-black text-gray-400">背景パターン</label>
              <div className="grid grid-cols-3 gap-2">
                {(Object.keys(STUDENT_BACKGROUND_PATTERNS) as StudentBackgroundPattern[]).map(patternId => {
                  const pattern = STUDENT_BACKGROUND_PATTERNS[patternId];
                  const active = appearance.backgroundPattern === patternId;
                  return (
                    <button
                      key={patternId}
                      type="button"
                      onClick={() => handleAppearanceChange('backgroundPattern', patternId)}
                      className={`rounded-2xl border-2 p-3 text-center transition-all ${active ? 'border-gray-900 bg-gray-50 text-gray-900' : 'border-gray-100 bg-white text-gray-400 hover:bg-gray-50'}`}
                    >
                      <span className="block text-xs font-black">{pattern.label}</span>
                      <span className="mt-1 block text-[9px] font-bold leading-relaxed">{pattern.description}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <label className="flex items-center justify-between rounded-2xl bg-gray-50 p-4">
              <span>
                <span className="block text-sm font-black text-gray-700">ヘッダーにバッジを表示</span>
                <span className="mt-1 block text-[10px] font-bold text-gray-400">ホーム上部に現在のバッジを飾ります。</span>
              </span>
              <button
                type="button"
                onClick={() => handleAppearanceChange('showMascot', !appearance.showMascot)}
                className={`h-7 w-12 rounded-full p-1 transition-colors ${appearance.showMascot ? 'bg-pink-500' : 'bg-gray-200'}`}
              >
                <span className={`block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${appearance.showMascot ? 'translate-x-5' : 'translate-x-0'}`}></span>
              </button>
            </label>
          </div>
        </section>

        {/* --- 3. プロフィール設定 (表示のみ) --- */}
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

        <LineLinkPanel
          role="student"
          lineUserId={profile?.line_user_id}
          description="連携すると、授業開始・宿題・お知らせなどの大切な通知をLINEでも受け取れます。"
        />

        <section className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
          <h2 className="text-lg font-extrabold text-gray-800 mb-4 flex items-center gap-2">
            <HelpCircle size={20} className="text-sky-500"/> 使用マニュアル
          </h2>
          <p className="mb-4 rounded-2xl bg-sky-50 px-4 py-3 text-xs font-bold leading-relaxed text-sky-700">
            困った時は、問い合わせ前に該当する項目を開いて確認してください。今表示されている機能に関係する手順だけを表示しています。
          </p>
          <div className="space-y-3">
            {manualItems.map(item => (
              <details key={item.title} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                <summary className="cursor-pointer text-sm font-black text-slate-800">{item.title}</summary>
                <div className="mt-3 space-y-3">
                  <p className="rounded-xl bg-white px-3 py-2 text-xs font-bold leading-relaxed text-slate-600">{item.summary}</p>
                  <div>
                    <p className="mb-2 text-[11px] font-black text-slate-400">操作の流れ</p>
                    <ol className="space-y-1.5">
                      {item.steps.map((step, index) => (
                        <li key={`${item.title}-step-${index}`} className="flex gap-2 text-xs font-bold leading-relaxed text-slate-600">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-100 text-[10px] font-black text-sky-700">{index + 1}</span>
                          <span>{step}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                  {item.trouble && item.trouble.length > 0 && (
                    <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2">
                      <p className="mb-2 text-[11px] font-black text-amber-700">うまくいかない時</p>
                      <ul className="space-y-1.5">
                        {item.trouble.map((text, index) => (
                          <li key={`${item.title}-trouble-${index}`} className="flex gap-2 text-xs font-bold leading-relaxed text-amber-800">
                            <Check size={13} className="mt-0.5 shrink-0" strokeWidth={4} />
                            <span>{text}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </details>
            ))}
          </div>
        </section>

        {/* --- 4. 音・通知 --- */}
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
                  onClick={() => handleChange(item.key, !settings[item.key])}
                  className={`w-12 h-7 rounded-full p-1 transition-colors duration-300 ${settings[item.key] ? 'bg-teal-500' : 'bg-gray-200'}`}
                >
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

        {/* --- 5. セキュリティ --- */}
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
          <div className="mt-5 border-t border-gray-100 pt-5">
            <RecoveryEmailSettings
              currentEmail={profile?.recovery_email}
              verified={Boolean(profile?.recovery_email_verified_at)}
            />
          </div>
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
