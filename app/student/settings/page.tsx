'use client';

import NumericNameNotice from '@/app/components/NumericNameNotice';
import { useState, useEffect } from 'react';
import { useAuth } from '@/app/context/AuthContext';
import { useSettings } from '@/app/context/SettingsContext';
import { auth, db } from '@/lib/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { changeOwnPassword, PasswordChangeError } from '@/lib/client-password-change';
import { BASIC_PASSWORD_MIN_LENGTH, passwordPolicyError } from '@/lib/password-policy';
import { PASSWORD_CHANGED_RELOGIN_MESSAGE, passwordChangedButReloginFailed } from '@/lib/password-change-error';
import {
  User, Lock, LogOut, ChevronRight,
  Save, Type,
  Volume2, Smartphone, Download, Share, PlusSquare, HelpCircle, Check,
  Palette, LayoutGrid, Settings
} from 'lucide-react';
import { Button, ButtonLink, Card, PageHeader, SectionTitle, useToast } from '@/app/components/ui';
import LineLinkPanel from '@/app/components/LineLinkPanel';
import PushNotificationToggle from '@/app/components/PushNotificationToggle';
import RecoveryEmailSettings from '@/app/components/RecoveryEmailSettings';
import SignedInPasswordHelp, { displayLoginId } from '@/app/components/SignedInPasswordHelp';
import { usePortalVisibility } from '@/app/hooks/usePortalVisibility';
import { isStudentFeatureEnabled } from '@/lib/portal-feature-access';
import { playSoundEffect, useSound } from '@/lib/sound';
import {
  DEFAULT_STUDENT_APPEARANCE,
  normalizeStudentAppearance,
  studentBackgroundPatternStyle,
  STUDENT_BACKGROUND_PATTERNS,
  STUDENT_BADGE_FRAMES,
  STUDENT_CARD_STYLES,
  studentBadgeFrameStyle,
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
import { presetTitleText } from '@/lib/reward-presets';

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
  const toast = useToast();
  
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
  const [hasChanges, setHasChanges] = useState(false);
  const { play } = useSound(settings.sound_se !== false);

  // パスワード関連
  const [currentPassword, setCurrentPassword] = useState('');
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
          appearance: normalizeStudentAppearance(profile.settings.appearance, profile.owned_cosmetics),
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
          showMessage('error', '効果音の設定を保存できませんでした。もう一度お試しください。');
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
        ...normalizeStudentAppearance(prev.appearance, profile?.owned_cosmetics),
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
      showMessage('error', '設定を保存できませんでした。もう一度お試しください。');
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
    if (type === 'success') toast.success(text);
    else toast.error(text);
  };

  const appearance = normalizeStudentAppearance(settings.appearance, profile?.owned_cosmetics);
  const ownedCosmetics: string[] = Array.isArray(profile?.owned_cosmetics) ? profile.owned_cosmetics : [];
  const ownedTitles = ownedCosmetics.filter(id => id.startsWith('title_') && presetTitleText(id));
  const ownedFrames = ownedCosmetics.filter(id => STUDENT_BADGE_FRAMES[id]);
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
        'ボタンが出ない場合は、受講講座の登録・変更で登録内容が正しいか確認してください。',
        '登録内容が正しいのに出ない場合は、授業開始前後の表示時間外、または当日の授業予定がまだ反映されていない可能性があります。',
        '別の授業ボタンが出る場合は、学年・曜日・時限・講座の登録がずれている可能性があります。',
      ],
    },
    {
      title: '受講講座を登録・変更したいとき',
      summary: '生徒本人が講座を選び、すぐに登録できます。現在期と受付中の次期が対象です。',
      steps: [
        'ホーム画面または設定から「受講講座を登録・変更」を開きます。',
        '現在実施中の期と、受付期間中の次期講座が表示されます。',
        '手順1で受講したい科目を選びます。',
        '手順2でその科目の開講曜日・時間を選びます。同じ曜日・同じ時限に複数講座は選べません。',
        '右側の「保存される講座」を確認し、「登録する」を押します。',
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
    isStudentFeatureEnabled(visibility, profile, 'shop') && {
      title: 'コイン・バッジを確認したいとき',
      summary: 'ログイン、録画視聴、ミッション達成などで獲得した内容を確認します。',
      steps: [
        'ホーム画面のコイン・バッジ表示を確認します。',
        'ランキングやバッジ一覧を開き、獲得状況を確認します。',
        'デイリーミッションが表示されている場合は、条件を達成して受け取ります。',
      ],
      trouble: [
        'コインやバッジがすぐ反映されない場合は、画面を更新して確認してください。',
        '時期によってはコイン機能が表示されない場合があります。',
      ],
    },
    {
      title: 'ログインできない・パスワードを変えたいとき',
      summary: 'まずID・初期パスワード・入力ミスを確認します。パスワード変更はこの設定画面から行えます。',
      steps: [
        '案内書面に記載されたログインURLを開きます。',
        'IDとパスワードを半角で入力します。前後に空白が入っていないか確認します。',
        'ログイン後にパスワード変更が必要な場合は、設定画面の「セキュリティ」から変更します。',
        '今のパスワードと、新しいパスワード（8文字以上）を入力し、確認欄にも同じものを入力します。',
      ],
      trouble: [
        '何度試しても入れない場合は、ID書面の再発行またはパスワード初期化が必要です。',
        '自分で解決できない場合は、創造学園アプリ サポート窓口（078-321-4123）へ連絡してください。',
      ],
    },
  ].filter(Boolean) as ManualItem[];

  const handleChangePassword = async () => {
    if (!currentPassword) return showMessage('error', '今のパスワードを入力してください');
    if (!newPassword || newPassword !== confirmPassword) return showMessage('error', 'パスワードが一致しません');
    const policyError = passwordPolicyError(newPassword, 'student', [profile?.lifetime_id]);
    if (policyError) return showMessage('error', policyError);
    if (!user) return showMessage('error', 'ログイン情報を確認できません');
    setLoading(true);
    try {
      await changeOwnPassword(user, { password: newPassword, currentPassword });
      showMessage('success', 'パスワードを変更し、ログイン状態を更新しました');
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword(''); setIsPasswordExpanded(false);
    } catch(e) {
      if (passwordChangedButReloginFailed(e)) { showMessage('success', PASSWORD_CHANGED_RELOGIN_MESSAGE); await signOut(auth).catch(() => undefined); window.setTimeout(() => window.location.replace('/'), 2500); return; }
      showMessage('error', e instanceof PasswordChangeError ? e.message : 'パスワードを変更できませんでした。もう一度お試しください。');
    }
    finally { setLoading(false); }
  };

  const choiceClass = (active: boolean, locked = false) => `rounded-btn border-2 p-3 transition-colors ${active ? 'border-accent bg-accent-soft text-fg' : 'border-line bg-surface text-fg-muted hover:bg-canvas'} ${locked ? 'cursor-not-allowed opacity-50' : ''}`;
  const fieldLabel = 'mb-2 block text-xs font-bold text-fg-muted';
  const switchClass = 'relative inline-flex h-11 w-14 shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';
  const switchTrack = (on: boolean) => `block h-7 w-12 rounded-full p-1 transition-colors ${on ? 'bg-accent' : 'bg-slate-200'}`;
  const switchKnob = (on: boolean) => `block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${on ? 'translate-x-5' : 'translate-x-0'}`;

  return (
    <div className="mx-auto max-w-xl space-y-5 px-4 py-6">
      <PageHeader
        tone="hero"
        eyebrow={`現在のテーマ: ${currentTheme.label}`}
        title="設定・アカウント"
        icon={Settings}
        backHref="/student"
      />

      {profile?.isFirstLogin === true && (
        <div role="alert" className="rounded-card border-2 border-warning/40 bg-warning-soft p-4 text-sm font-bold leading-relaxed text-fg">
          初回ログインのため、下の「セキュリティ」から新しいパスワードを設定してください。
        </div>
      )}

      {/* --- 0. アプリインストール (PWA) --- */}
      {!isStandalone && (
        <section className="rounded-card bg-accent p-card text-accent-ink shadow-card">
          <h2 className="mb-2 flex items-center gap-2 text-lg font-bold">
            <Smartphone size={24} aria-hidden /> ショートカットを作成
          </h2>
          <p className="mb-5 text-sm font-medium text-accent-ink/90">
            ホーム画面に追加すると、全画面でアプリのように使えます。
          </p>

          {deferredPrompt ? (
            <button
              type="button"
              onClick={handleInstallClick}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-btn bg-white py-3 font-bold text-accent shadow-card transition-transform active:scale-95"
            >
              <Download size={22} aria-hidden /> 今すぐ追加する
            </button>
          ) : (
            <div>
              {!showManual ? (
                <button
                  type="button"
                  onClick={() => setShowManual(true)}
                  className="flex min-h-11 w-full items-center justify-center gap-2 rounded-btn border border-white/30 bg-white/20 py-3 font-bold transition-colors hover:bg-white/30"
                >
                  <HelpCircle size={20} aria-hidden /> 追加ボタンが出ない場合
                </button>
              ) : (
                <div className="rounded-btn border border-white/20 bg-white/10 p-4">
                  <p className="mb-3 flex items-center gap-2 text-sm font-bold">
                    {isIos ? 'iPhone・iPadの手順' : 'ブラウザメニューの手順'}
                  </p>

                  {isIos ? (
                    <ol className="space-y-3 text-sm font-medium">
                      <li className="flex items-center gap-2">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-xs font-bold text-accent">1</span>
                        <span>画面下の <Share size={16} className="mx-1 inline" aria-hidden /> (共有) をタップ</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-xs font-bold text-accent">2</span>
                        <span>「ホーム画面に追加」<PlusSquare size={16} className="mx-1 inline" aria-hidden /> を探してタップ</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-xs font-bold text-accent">3</span>
                        <span>右上の「追加」をタップ</span>
                      </li>
                    </ol>
                  ) : (
                    <div className="text-sm font-medium">
                      ブラウザのメニューから「アプリをインストール」または「ホーム画面に追加」を選んでください。
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => setShowManual(false)}
                    className="mt-4 min-h-11 w-full rounded-btn bg-white/20 text-sm font-bold hover:bg-white/30"
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
        <div className="flex items-center justify-center gap-2 rounded-card border border-accent/20 bg-accent-soft p-4 text-center text-sm font-bold text-accent">
          <Check size={18} aria-hidden /> アプリとして使用中
        </div>
      )}

      {/* --- 1. 文字サイズ設定 --- */}
      <Card>
        <SectionTitle icon={Type} title="文字の大きさ" />
        <div className="flex rounded-btn bg-canvas p-1.5" role="group" aria-label="文字の大きさ">
          <button
            type="button"
            onClick={() => handleTextSizeChange('normal')}
            aria-pressed={textSize === 'normal'}
            className={`min-h-11 flex-1 rounded-btn text-sm font-bold transition-colors ${textSize === 'normal' ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted'}`}
          >
            ふつう
          </button>
          <button
            type="button"
            onClick={() => handleTextSizeChange('large')}
            aria-pressed={textSize === 'large'}
            className={`min-h-11 flex-1 rounded-btn text-lg font-bold transition-colors ${textSize === 'large' ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted'}`}
          >
            おおきめ
          </button>
        </div>
      </Card>

      {/* --- 2. 見た目カスタム --- */}
      <Card>
        <SectionTitle icon={Palette} title="ホームのデザイン" description="生徒ホームの色やカードの雰囲気を自分好みに変えられます。" />

        {/* プレビュー：保存前のテーマ・カードの形を、そのテーマ自身の色で見せる */}
        <div className={`${currentTheme.pageBg} mb-5 rounded-card border border-line p-3`} style={studentBackgroundPatternStyle(appearance.backgroundPattern)}>
          <div className={`${currentTheme.heroBg} ${currentHeader.heroShape} relative overflow-hidden p-4 text-white`}>
            <div className={`absolute -right-5 -top-5 h-20 w-20 rounded-full ${currentTheme.heroAccent} blur-xl ${currentHeader.decoration}`}></div>
            <p className="text-xs font-bold opacity-80">プレビュー</p>
            <div className="mt-2 flex items-center justify-between">
              <div>
                <p className="text-sm font-bold">こんにちは！</p>
                <p className={`text-xl font-black ${currentTheme.nameColor}`}>{name || '生徒'} さん</p>
              </div>
              {appearance.showMascot && (
                <div className="rounded-2xl bg-white/20 px-3 py-2 text-2xl">🎓</div>
              )}
            </div>
          </div>
          <div className={`mt-3 ${STUDENT_CARD_STYLES[appearance.cardStyle].panel} ${STUDENT_DENSITIES[appearance.density].cardPadding}`}>
            <div className="flex items-center gap-3">
              <span className={`flex h-9 w-9 items-center justify-center rounded-2xl font-bold ${currentTheme.badgeBg} ${currentTheme.badgeText}`}>
                <LayoutGrid size={18} aria-hidden />
              </span>
              <div>
                <p className="text-sm font-bold text-slate-800">カードの見本</p>
                <p className="text-xs font-medium text-slate-500">{STUDENT_CARD_STYLES[appearance.cardStyle].label} / {STUDENT_DENSITIES[appearance.density].label}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-5">
          <div>
            <p className={fieldLabel}>テーマカラー</p>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(STUDENT_THEMES) as StudentThemeId[]).map(themeId => {
                const theme = STUDENT_THEMES[themeId];
                const active = appearance.theme === themeId;
                const locked = Boolean(theme.premium && !ownedCosmetics.includes(theme.premium));
                return (
                  <button
                    key={themeId}
                    type="button"
                    disabled={locked}
                    aria-pressed={active}
                    onClick={() => handleAppearanceChange('theme', themeId)}
                    className={`${choiceClass(active, locked)} text-left`}
                  >
                    {/* スマホの2列表示では幅が狭いので、名前は1行のまま、「限定」は入りきらなければ次の行へ。 */}
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className={`h-5 w-5 shrink-0 rounded-full ${theme.previewDot}`}></span>
                      <span className="whitespace-nowrap text-sm font-bold text-fg">{theme.label}</span>
                      {theme.premium && <span className="shrink-0 whitespace-nowrap rounded-full bg-amber-100 px-1.5 text-[11px] font-bold text-amber-700">{locked ? '🔒 限定' : '限定'}</span>}
                    </div>
                    <p className="mt-1 text-xs font-medium text-fg-muted">{locked ? '交換所・ガチャで手に入るよ' : theme.description}</p>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className={fieldLabel}>カードの雰囲気</p>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(STUDENT_CARD_STYLES) as StudentCardStyle[]).map(styleId => {
                const style = STUDENT_CARD_STYLES[styleId];
                const active = appearance.cardStyle === styleId;
                return (
                  <button
                    key={styleId}
                    type="button"
                    aria-pressed={active}
                    onClick={() => handleAppearanceChange('cardStyle', styleId)}
                    className={`${choiceClass(active)} text-center`}
                  >
                    <span className="block text-xs font-bold">{style.label}</span>
                    <span className="mt-1 block text-xs font-medium leading-relaxed">{style.description}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className={fieldLabel}>表示の詰め具合</p>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(STUDENT_DENSITIES) as StudentDensity[]).map(densityId => {
                const density = STUDENT_DENSITIES[densityId];
                const active = appearance.density === densityId;
                return (
                  <button
                    key={densityId}
                    type="button"
                    aria-pressed={active}
                    onClick={() => handleAppearanceChange('density', densityId)}
                    className={`${choiceClass(active)} text-left`}
                  >
                    <span className="text-sm font-bold text-fg">{density.label}</span>
                    <p className="mt-1 text-xs font-medium text-fg-muted">{density.description}</p>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className={fieldLabel}>ヘッダーの形</p>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(STUDENT_HEADER_STYLES) as StudentHeaderStyle[]).map(headerId => {
                const header = STUDENT_HEADER_STYLES[headerId];
                const active = appearance.headerStyle === headerId;
                return (
                  <button
                    key={headerId}
                    type="button"
                    aria-pressed={active}
                    onClick={() => handleAppearanceChange('headerStyle', headerId)}
                    className={`${choiceClass(active)} text-center`}
                  >
                    <span className="block text-xs font-bold">{header.label}</span>
                    <span className="mt-1 block text-xs font-medium leading-relaxed">{header.description}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className={fieldLabel}>背景パターン</p>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(STUDENT_BACKGROUND_PATTERNS) as StudentBackgroundPattern[]).map(patternId => {
                const pattern = STUDENT_BACKGROUND_PATTERNS[patternId];
                const active = appearance.backgroundPattern === patternId;
                const locked = Boolean(pattern.premium && !ownedCosmetics.includes(pattern.premium));
                return (
                  <button
                    key={patternId}
                    type="button"
                    disabled={locked}
                    aria-pressed={active}
                    onClick={() => handleAppearanceChange('backgroundPattern', patternId)}
                    className={`${choiceClass(active, locked)} text-center`}
                  >
                    <span className="block text-xs font-bold">{locked ? '🔒 ' : ''}{pattern.label}</span>
                    <span className="mt-1 block text-xs font-medium leading-relaxed">{locked ? '交換所で手に入るよ' : pattern.description}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className={fieldLabel}>名前の上の称号（交換所で手に入る）</p>
            {ownedTitles.length === 0 ? (
              <p className="rounded-btn bg-canvas p-3 text-xs font-medium text-fg-muted">まだ称号を持っていません。コイン交換所やガチャで手に入れよう！</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {['', ...ownedTitles].map(titleId => (
                  <button key={titleId || 'none'} type="button" aria-pressed={appearance.title === titleId} onClick={() => handleAppearanceChange('title', titleId)}
                    className={`min-h-9 rounded-full border-2 px-3 py-1.5 text-xs font-bold transition-colors ${appearance.title === titleId ? 'border-accent bg-accent text-accent-ink' : 'border-line bg-surface text-fg-muted hover:bg-canvas'}`}>
                    {titleId ? presetTitleText(titleId) : '表示しない'}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <p className={fieldLabel}>バッジのフレーム（交換所で手に入る）</p>
            {ownedFrames.length === 0 ? (
              <p className="rounded-btn bg-canvas p-3 text-xs font-medium text-fg-muted">まだフレームを持っていません。コイン交換所やガチャで手に入れよう！</p>
            ) : (
              <div className="flex flex-wrap gap-3">
                {['', ...ownedFrames].map(frameId => (
                  <button key={frameId || 'none'} type="button" aria-pressed={appearance.frame === frameId} onClick={() => handleAppearanceChange('frame', frameId)}
                    className={`flex flex-col items-center gap-1 rounded-btn border-2 p-2 transition-colors ${appearance.frame === frameId ? 'border-accent bg-accent-soft' : 'border-line bg-surface hover:bg-canvas'}`}>
                    <span className="rounded-xl" style={studentBadgeFrameStyle(frameId) || { padding: 3 }}>
                      <span className="flex h-9 w-9 items-center justify-center rounded-input bg-white text-xl">🎓</span>
                    </span>
                    <span className="text-xs font-bold text-fg-muted">{frameId ? STUDENT_BADGE_FRAMES[frameId]?.label : 'なし'}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 rounded-btn bg-canvas p-4">
            <span>
              <span className="block text-sm font-bold text-fg">ヘッダーにバッジを表示</span>
              <span className="mt-1 block text-xs font-medium text-fg-muted">ホーム上部に現在のバッジを飾ります。</span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={appearance.showMascot}
              aria-label="ヘッダーにバッジを表示"
              onClick={() => handleAppearanceChange('showMascot', !appearance.showMascot)}
              className={switchClass}
            >
              <span className={switchTrack(appearance.showMascot)}>
                <span className={switchKnob(appearance.showMascot)}></span>
              </span>
            </button>
          </div>
        </div>
      </Card>

      {/* --- 3. プロフィール設定 (表示のみ) --- */}
      <Card>
        <SectionTitle icon={User} title="プロフィール" />
        <div className="space-y-4">
          <div>
            <p className={fieldLabel}>お名前</p>
            <div className="w-full rounded-input border border-line bg-canvas p-4 font-bold text-fg">
              {name}
            </div>
            <NumericNameNotice name={name} className="mt-1 pl-1" />
            <p className="mt-1 pl-1 text-xs text-fg-muted">※お名前の変更は先生にお伝えください</p>
          </div>
          <div>
            <p className={fieldLabel}>目標</p>
            <div className="grid grid-cols-2 gap-2">
              {['定期テスト対策', '受験対策', '苦手克服', '予習中心'].map((t) => (
                <button key={t} type="button" aria-pressed={target === t} onClick={() => { setTarget(t); setHasChanges(true); }} className={`min-h-11 rounded-btn border-2 p-3 text-sm font-bold transition-colors ${target === t ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-surface text-fg-muted hover:bg-canvas'}`}>{t}</button>
              ))}
            </div>
          </div>
        </div>
      </Card>

      <LineLinkPanel
        role="student"
        lineUserId={profile?.line_user_id}
        description="連携すると、授業開始・宿題・お知らせなどの大切な通知をLINEでも受け取れます。"
      />

      <PushNotificationToggle />

      <Card>
        <SectionTitle icon={HelpCircle} title="使用マニュアル" />
        <p className="mb-4 rounded-btn bg-info-soft px-4 py-3 text-xs font-medium leading-relaxed text-info">
          困った時は、問い合わせ前に該当する項目を開いて確認してください。今表示されている機能に関係する手順だけを表示しています。
        </p>
        <ButtonLink href="/manual" fullWidth className="mb-4 justify-between">生徒向け操作マニュアル <ChevronRight size={19} aria-hidden /></ButtonLink>
        <div className="space-y-3">
          {manualItems.map(item => (
            <details key={item.title} className="rounded-btn border border-line bg-canvas px-4 py-3">
              <summary className="flex min-h-9 cursor-pointer items-center text-sm font-bold text-fg">{item.title}</summary>
              <div className="mt-3 space-y-3">
                <p className="rounded-input bg-surface px-3 py-2 text-xs font-medium leading-relaxed text-fg-muted">{item.summary}</p>
                <div>
                  <p className="mb-2 text-xs font-bold text-fg-muted">操作の流れ</p>
                  <ol className="space-y-1.5">
                    {item.steps.map((step, index) => (
                      <li key={`${item.title}-step-${index}`} className="flex gap-2 text-xs font-medium leading-relaxed text-fg">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[11px] font-bold text-accent">{index + 1}</span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>
                {item.trouble && item.trouble.length > 0 && (
                  <div className="rounded-input border border-warning/20 bg-warning-soft px-3 py-2">
                    <p className="mb-2 text-xs font-bold text-warning">うまくいかない時</p>
                    <ul className="space-y-1.5">
                      {item.trouble.map((text, index) => (
                        <li key={`${item.title}-trouble-${index}`} className="flex gap-2 text-xs font-medium leading-relaxed text-fg">
                          <Check size={13} className="mt-0.5 shrink-0 text-warning" strokeWidth={4} aria-hidden />
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
      </Card>

      {/* --- 4. 音・通知 --- */}
      <Card>
        <SectionTitle icon={Volume2} title="音・通知" />
        <div className="space-y-2">
          {[
            { key: 'notification_homework', label: '宿題の通知' },
            { key: 'notification_class', label: '授業開始の通知' },
            { key: 'sound_se', label: '効果音' },
          ].map((item) => (
            <div key={item.key} className="flex items-center justify-between gap-3">
              <span className="text-sm font-bold text-fg">{item.label}</span>
              <button
                type="button"
                role="switch"
                aria-checked={Boolean(settings[item.key])}
                aria-label={item.label}
                onClick={() => handleChange(item.key, !settings[item.key])}
                className={switchClass}
              >
                <span className={switchTrack(Boolean(settings[item.key]))}>
                  <span className={switchKnob(Boolean(settings[item.key]))} />
                </span>
              </button>
            </div>
          ))}
        </div>
      </Card>

      {/* --- 保存ボタン --- */}
      <div className="sticky bottom-20 z-20">
        <Button
          size="lg"
          fullWidth
          onClick={handleSaveSettings}
          loading={loading}
          variant={hasChanges ? 'primary' : 'secondary'}
          icon={<Save size={22} aria-hidden />}
          className="min-h-14 shadow-card"
        >
          {hasChanges ? '変更を保存する' : '保存済み'}
        </Button>
      </div>

      {/* --- 5. セキュリティ --- */}
      <Card>
        <SectionTitle icon={Lock} title="セキュリティ" className="mb-2" />
        <SignedInPasswordHelp
          loginId={displayLoginId(profile, user?.email)}
          hasVerifiedRecoveryEmail={Boolean(profile?.recovery_email && profile?.recovery_email_verified_at)}
          audience="student"
        />
        {!isPasswordExpanded ? (
          <button type="button" onClick={() => setIsPasswordExpanded(true)} className="mt-2 flex min-h-11 w-full items-center justify-between py-3 text-left font-bold text-fg-muted hover:text-fg"><span>パスワードを変更する</span><ChevronRight size={18} aria-hidden /></button>
        ) : (
          <div className="mt-4 space-y-4">
            <p className="text-xs font-medium text-fg-muted">今のパスワードと、新しいパスワード（{BASIC_PASSWORD_MIN_LENGTH}文字以上）を2回入力してください。今のパスワードを忘れたときは、校舎で変更してもらってください。</p>
            <input type="password" autoComplete="current-password" aria-label="今のパスワード" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className="min-h-11 w-full rounded-input border border-line bg-canvas p-3 font-medium text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/20" placeholder="今のパスワード" />
            <input type="password" autoComplete="new-password" aria-label="新しいパスワード" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="min-h-11 w-full rounded-input border border-line bg-canvas p-3 font-medium text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/20" placeholder="新しいパスワード" />
            <input type="password" aria-label="確認用" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="min-h-11 w-full rounded-input border border-line bg-canvas p-3 font-medium text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/20" placeholder="確認用" />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setIsPasswordExpanded(false)}>キャンセル</Button>
              <Button onClick={handleChangePassword} loading={loading}>変更</Button>
            </div>
          </div>
        )}
        <div className="mt-5 border-t border-line pt-5">
          <RecoveryEmailSettings
            currentEmail={profile?.recovery_email}
            verified={Boolean(profile?.recovery_email_verified_at)}
          />
        </div>
      </Card>

      <div className="pb-6 pt-2">
        <button type="button" onClick={logout} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-btn border-2 border-danger/20 bg-surface py-3 font-bold text-danger transition-colors hover:bg-danger-soft">
          <LogOut size={20} aria-hidden /> ログアウト
        </button>
      </div>

    </div>
  );
}
