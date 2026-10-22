'use client';

import type React from 'react';
import { useState, useEffect } from 'react';
import { db, auth } from '@/lib/firebase';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { useAuth } from '@/app/context/AuthContext';
import { 
  Link as LinkIcon, Save, 
  User, Smartphone, 
  Download, Share, HelpCircle, PlusSquare, 
  Type, Globe, Beaker, BookOpen, Eye, Bell, Mail, MessageCircle,
  Plus, Trash2, Clock
} from 'lucide-react';
import AdminPageHeader from '@/app/components/master/AdminPageHeader';
import AdminTabs from '@/app/components/master/AdminTabs';
import { Button, IconButton, ListSkeleton, EmptyState, ErrorState, useConfirm, useToast } from '@/app/components/ui';
import AdminAccountPanel from '@/app/components/master/AdminAccountPanel';
import { RELEASE_PHASES, ReleasePhaseId } from '@/lib/release-phase-visibility';
import SystemControl from '@/app/components/master/SystemControl';
import {
  CLASS_BUTTON_GRADES,
  DEFAULT_CLASS_BUTTON_SETTINGS,
  normalizeClassButtonSettings,
  type ClassButtonSettings,
} from '@/lib/class-button-settings';

// --- 設定用定数 ---
const GRADES = ['中1', '中2', '中3'];
const BASIC_SUBJECTS = ['英語', '数学', '国語'];
const SOCIAL_FIELDS = ['地理', '歴史', '公民'];
const SCIENCE_FIELDS = ['物理', '化学', '生物', '地学'];
const DEFAULT_VISIBILITY = {
  student: {
    adaptiveQuest: true,
    chat: true,
    homework: true,
    recordings: true,
    absence: true,
    transfer: true,
    calendar: true,
    changeRequest: true,
    community: true,
    ocrQuiz: true,
    news: true,
    notifications: true,
    settings: true,
    shop: true,
    history: true,
  },
  parent: {
    courseRegistration: true,
    homework: true,
    attendance: true,
    absence: true,
    transfer: true,
    recordings: true,
    aiMessages: true,
    announcements: true,
    calendar: true,
    contact: true,
    notificationSettings: true,
    notifications: true,
    settings: true,
  },
  teacher: {
    dashboard: true,
    work: true,
    attendance: true,
    shifts: true,
    substitutions: true,
    community: true,
    notifications: true,
    settings: true,
    news: true,
    calendar: true,
    chat: true,
    contacts: true,
    homework: true,
    pf: true,
    riskMonitor: true,
    slides: true,
    students: true,
  },
  admin: {
    users: true,
    schoolStudents: true,
    sso: true,
    shifts: true,
    monthlySchedules: true,
    attendance: false,
    attendanceDiagnostics: false,
    substitutions: true,
    announcements: true,
    requests: true,
    parentInquiries: true,
    registrationTasks: true,
    curriculum: true,
    pf: true,
    recordings: true,
    slides: true,
    community: true,
    rewards: true,
    stats: true,
    betaAnalytics: true,
    surveySettings: true,
    imports: true,
    delete: true,
    line: true,
    notifications: true,
    settings: true,
  },
};

const DEFAULT_NOTIFICATION_SETTINGS = {
  line_enabled: true,
  email_enabled: true,
  in_app_enabled: true,
  push_enabled: true,
  class_start_enabled: true,
  homework_enabled: true,
  announcements_enabled: true,
  student_line_enabled: true,
  parent_line_enabled: true,
  teacher_line_enabled: true,
  admin_line_enabled: true,
};

const DEFAULT_MISSION_SETTINGS = {
  login: true,
  recording: true,
  community: false,
};

type CustomMissionCondition = 'manual' | 'login' | 'recording' | 'community';

type CustomMission = {
  id: string;
  title: string;
  description: string;
  reward: number;
  enabled: boolean;
  condition: CustomMissionCondition;
  link_url: string;
  link_label: string;
};

const CUSTOM_MISSION_CONDITIONS: { value: CustomMissionCondition; label: string }[] = [
  { value: 'manual', label: 'ボタン受取' },
  { value: 'login', label: 'ログイン済み' },
  { value: 'recording', label: '録画視聴済み' },
  { value: 'community', label: 'コミュニティ参加済み' },
];

const createEmptyCustomMission = (): CustomMission => ({
  id: `mission_${Date.now().toString(36)}`,
  title: '',
  description: '',
  reward: 10,
  enabled: true,
  condition: 'manual',
  link_url: '',
  link_label: '開く',
});

const normalizeCustomMission = (mission: Partial<CustomMission>): CustomMission => ({
  id: String(mission.id || `mission_${Date.now().toString(36)}`).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40),
  title: String(mission.title || ''),
  description: String(mission.description || ''),
  reward: Math.max(0, Math.min(500, Number(mission.reward || 0))),
  enabled: mission.enabled !== false,
  condition: CUSTOM_MISSION_CONDITIONS.some(item => item.value === mission.condition) ? mission.condition as CustomMissionCondition : 'manual',
  link_url: String(mission.link_url || ''),
  link_label: String(mission.link_label || '開く'),
});

const STUDENT_VISIBILITY_ITEMS = [
  { key: 'adaptiveQuest', label: 'AI学習クエスト' },
  { key: 'chat', label: 'AIチューター' },
  { key: 'homework', label: '宿題提出' },
  { key: 'recordings', label: '授業録画' },
  { key: 'absence', label: '欠席連絡' },
  { key: 'transfer', label: '生徒の振替登録（β用）' },
  { key: 'calendar', label: '学習カレンダー' },
  { key: 'changeRequest', label: '受講講座・曜日時間の変更' },
  { key: 'community', label: 'コミュニティ' },
  { key: 'ocrQuiz', label: 'OCR問題作成' },
  { key: 'news', label: 'お知らせ一覧' },
  { key: 'notifications', label: '通知一覧' },
  { key: 'settings', label: '設定' },
  { key: 'shop', label: '景品交換' },
  { key: 'history', label: '履歴' },
] as const;

const PARENT_VISIBILITY_ITEMS = [
  { key: 'courseRegistration', label: '受講講座の登録・変更' },
  { key: 'homework', label: '宿題提出状況' },
  { key: 'attendance', label: '出席状況' },
  { key: 'absence', label: '欠席連絡' },
  { key: 'transfer', label: '振替登録' },
  { key: 'recordings', label: '録画視聴状況' },
  { key: 'aiMessages', label: 'AIメッセージ' },
  { key: 'announcements', label: 'お知らせ' },
  { key: 'calendar', label: 'カレンダー操作' },
  { key: 'contact', label: '教室への連絡' },
  { key: 'notificationSettings', label: '通知設定' },
  { key: 'notifications', label: '通知一覧' },
  { key: 'settings', label: '設定' },
] as const;

const TEACHER_VISIBILITY_ITEMS = [
  { key: 'dashboard', label: '講師ホーム' },
  { key: 'work', label: '仕事メニュー' },
  { key: 'attendance', label: '勤怠打刻' },
  { key: 'shifts', label: 'シフト提出' },
  { key: 'substitutions', label: '代行掲示板' },
  { key: 'community', label: 'コミュニティ' },
  { key: 'notifications', label: '通知一覧' },
  { key: 'settings', label: '設定' },
  { key: 'news', label: 'お知らせ' },
  { key: 'calendar', label: '年間予定カレンダー' },
  { key: 'chat', label: '講師チャット' },
  { key: 'contacts', label: '連絡先' },
  { key: 'homework', label: '宿題管理' },
  { key: 'pf', label: 'PF' },
  { key: 'riskMonitor', label: 'リスク監視' },
  { key: 'slides', label: 'スライド' },
  { key: 'students', label: '生徒一覧' },
] as const;

// 校舎管理者に見せる管理メニュー。校舎管理者が使える範囲（SCHOOL_ADMIN_ALLOWED_PATHS）の項目だけを切り替える。
// 勤怠・Booster の管理者は「管理者の権限設定」で付けたアプリの項目がそのまま出る（ここでは隠さない）。
const ADMIN_VISIBILITY_ITEMS = [
  { key: 'scienceSocialHome', label: '理社講座 ダッシュボード' },
  { key: 'schoolStudents', label: '校舎別 生徒管理' },
  { key: 'monthlySchedules', label: '月間予定' },
  { key: 'shifts', label: 'シフト配置・提出確認' },
  { key: 'rewards', label: 'コイン・景品' },
] as const;

export default function SettingsPage() {
  const { profile } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [activeTab, setActiveTab] = useState<'system' | 'visibility' | 'notifications' | 'account'>('system');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [savingVisibility, setSavingVisibility] = useState(false);
  const [user, setUser] = useState<any>(null);

  // --- Zoom URL設定 State ---
  const [urls, setUrls] = useState<{[key:string]: string}>({});

  // --- アカウント設定 State ---
  const [textSize, setTextSize] = useState('normal');
  const [visibility, setVisibility] = useState(DEFAULT_VISIBILITY);
  const [releasePhase, setReleasePhase] = useState<ReleasePhaseId | 'custom'>('custom');
  const [notificationSettings, setNotificationSettings] = useState(DEFAULT_NOTIFICATION_SETTINGS);
  const [missionSettings, setMissionSettings] = useState(DEFAULT_MISSION_SETTINGS);
  const [customMissions, setCustomMissions] = useState<CustomMission[]>([]);
  const [classButtonSettings, setClassButtonSettings] = useState<ClassButtonSettings>(DEFAULT_CLASS_BUTTON_SETTINGS);
  const [savingNotifications, setSavingNotifications] = useState(false);

  useEffect(() => {
    if (profile?.isFirstLogin === true) setActiveTab('account');
  }, [profile?.isFirstLogin]);

  // --- PWA State ---
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [isIos, setIsIos] = useState(false);

  // 初期データ取得
  useEffect(() => {
    const init = async () => {
      setLoading(true);
      setLoadError(false);
      try {
        // ユーザー情報
        const currentUser = auth.currentUser;
        setUser(currentUser);

        // Zoom URL設定の取得
        const subjectSnap = await getDoc(doc(db, 'settings', 'subjects'));
        if (subjectSnap.exists()) {
          setUrls(subjectSnap.data().urls || {});
        }

        const visibilitySnap = await getDoc(doc(db, 'settings', 'portal_visibility'));
        if (visibilitySnap.exists()) {
          const data = visibilitySnap.data();
          setVisibility({
            student: { ...DEFAULT_VISIBILITY.student, ...(data.student || {}) },
            parent: { ...DEFAULT_VISIBILITY.parent, ...(data.parent || {}) },
            teacher: { ...DEFAULT_VISIBILITY.teacher, ...(data.teacher || {}) },
            admin: { ...DEFAULT_VISIBILITY.admin, ...(data.admin || {}) },
          });
          setReleasePhase((data.release_phase || 'custom') as ReleasePhaseId | 'custom');
        }

        const notificationSnap = await getDoc(doc(db, 'settings', 'notification_channels'));
        if (notificationSnap.exists()) {
          setNotificationSettings(prev => ({ ...prev, ...notificationSnap.data() }));
        }

        const classButtonSnap = await getDoc(doc(db, 'settings', 'class_button'));
        setClassButtonSettings(normalizeClassButtonSettings(classButtonSnap.exists() ? classButtonSnap.data() : {}));

        const missionSnap = await getDoc(doc(db, 'settings', 'mission_control'));
        if (missionSnap.exists()) {
          const data = missionSnap.data();
          setMissionSettings(prev => ({
            ...prev,
            login: data.login ?? prev.login,
            recording: data.recording ?? prev.recording,
            community: data.community ?? prev.community,
          }));
          setCustomMissions(Array.isArray(data.custom_missions) ? data.custom_missions.map(normalizeCustomMission) : []);
        }

        // PWAチェック
        const isApp = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone;
        setIsStandalone(!!isApp);
        setIsIos(/iPhone|iPad|iPod/.test(navigator.userAgent));

      } catch (e) {
        console.error(e);
        setLoadError(true);
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
  }, [reloadKey]);

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
      await setDoc(doc(db, 'settings', 'class_button'), {
        ...normalizeClassButtonSettings(classButtonSettings),
        updated_at: new Date().toISOString(),
        updated_by: user?.uid || null,
      }, { merge: true });
      toast.success('Zoom URL・参加ボタン設定を保存しました');
    } catch(e) { 
      console.error(e);
      toast.error('保存できませんでした。もう一度お試しください。'); 
    } finally { 
      setSaving(false); 
    }
  };

  const handleClassButtonSettingChange = (key: keyof ClassButtonSettings, value: string | number | boolean) => {
    setClassButtonSettings(prev => normalizeClassButtonSettings({ ...prev, [key]: value }));
  };

  const handleTestPrepGradeVisibilityChange = (studentGrade: typeof CLASS_BUTTON_GRADES[number], shiftGrade: typeof CLASS_BUTTON_GRADES[number], checked: boolean) => {
    setClassButtonSettings(prev => normalizeClassButtonSettings({
      ...prev,
      test_prep_grade_visibility: {
        ...prev.test_prep_grade_visibility,
        [studentGrade]: checked
          ? Array.from(new Set([...prev.test_prep_grade_visibility[studentGrade], shiftGrade]))
          : prev.test_prep_grade_visibility[studentGrade].filter(grade => grade !== shiftGrade),
      },
    }));
  };

  const handleVisibilityChange = (group: 'student' | 'parent' | 'teacher' | 'admin', key: string, value: boolean) => {
    setReleasePhase('custom');
    setVisibility(prev => ({
      ...prev,
      [group]: {
        ...prev[group],
        [key]: value,
      },
    }));
  };

  const handleSaveVisibility = async () => {
    setSavingVisibility(true);
    try {
      await setDoc(doc(db, 'settings', 'portal_visibility'), {
        ...visibility,
        release_phase: releasePhase,
        updated_at: new Date().toISOString(),
        updated_by: user?.uid || null,
      }, { merge: true });
      await setDoc(doc(db, 'settings', 'notification_channels'), {
        ...notificationSettings,
        updated_at: new Date().toISOString(),
        updated_by: user?.uid || null,
      }, { merge: true });
      await setDoc(doc(db, 'settings', 'mission_control'), {
        ...missionSettings,
        custom_missions: customMissions.map(normalizeCustomMission),
        updated_at: new Date().toISOString(),
        updated_by: user?.uid || null,
      }, { merge: true });
      toast.success('表示設定を保存しました');
    } catch (e) {
      console.error(e);
      toast.error('保存できませんでした。もう一度お試しください。');
    } finally {
      setSavingVisibility(false);
    }
  };

  const applyReleasePhase = (phaseId: ReleasePhaseId) => {
    if (profile?.role !== 'master') {
      toast.error('βテストのフェーズ設定はマスター管理者のみ変更できます。');
      return;
    }
    const phase = RELEASE_PHASES[phaseId];
    setReleasePhase(phaseId);
    setVisibility(prev => ({
      student: { ...prev.student, ...phase.visibility.student },
      parent: { ...prev.parent, ...phase.visibility.parent },
      teacher: { ...prev.teacher, ...phase.visibility.teacher },
      admin: { ...prev.admin, ...phase.visibility.admin },
    }));
    setNotificationSettings(prev => ({ ...prev, ...phase.notificationSettings }));
    setMissionSettings(prev => ({ ...prev, ...phase.missionSettings }));
  };

  const handleMissionChange = (key: keyof typeof DEFAULT_MISSION_SETTINGS, value: boolean) => {
    setReleasePhase('custom');
    setMissionSettings(prev => ({ ...prev, [key]: value }));
  };

  const handleAddCustomMission = () => {
    setReleasePhase('custom');
    setCustomMissions(prev => [...prev, createEmptyCustomMission()]);
  };

  const handleCustomMissionChange = (index: number, patch: Partial<CustomMission>) => {
    setReleasePhase('custom');
    setCustomMissions(prev => prev.map((mission, i) => (
      i === index ? normalizeCustomMission({ ...mission, ...patch }) : mission
    )));
  };

  const handleDeleteCustomMission = async (index: number) => {
    const name = customMissions[index]?.title.trim() || 'この追加ミッション';
    if (!(await confirm({
      title: `「${name}」を削除しますか？`,
      message: '「表示設定を保存」を押すまで生徒画面には反映されません。',
      confirmLabel: '削除する',
      tone: 'danger',
    }))) return;
    setReleasePhase('custom');
    setCustomMissions(prev => prev.filter((_, i) => i !== index));
  };

  const handleNotificationChange = (key: keyof typeof DEFAULT_NOTIFICATION_SETTINGS, value: boolean) => {
    setNotificationSettings(prev => ({ ...prev, [key]: value }));
  };

  const handleSaveNotifications = async () => {
    setSavingNotifications(true);
    try {
      await setDoc(doc(db, 'settings', 'notification_channels'), {
        ...notificationSettings,
        updated_at: new Date().toISOString(),
        updated_by: user?.uid || null,
      }, { merge: true });
      toast.success('通知連携設定を保存しました');
    } catch (e) {
      console.error(e);
      toast.error('保存できませんでした。もう一度お試しください。');
    } finally {
      setSavingNotifications(false);
    }
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
  const tabs = [
    { id: 'system' as const, label: '理社講座：Zoom・授業ボタン', icon: LinkIcon },
    { id: 'visibility' as const, label: '全体：表示・ミッション', icon: Eye },
    { id: 'notifications' as const, label: '全体：通知連携', icon: Bell },
    { id: 'account' as const, label: '自分のアカウント', icon: User },
  ];

  if (loading) return <ListSkeleton rows={5} />;

  return (
    <div className="font-sans text-slate-800">
      <div>

        <AdminPageHeader
          description="マスター専用のシステム設定です。勤怠の設定は「勤怠 ＞ 勤怠の設定」、理社講座のCSV取込・アンケートは「理社講座の設定・データ」にあります。"
        />

        <AdminTabs
          className="mb-6"
          tabs={tabs}
          value={activeTab}
          onChange={setActiveTab}
          urlParam="tab"
          ariaLabel="システム設定の切り替え"
        />

        {loadError && activeTab !== 'account' && (
          <ErrorState
            className="mb-6"
            title="設定を読み込めませんでした"
            message="このまま保存すると初期値で上書きされるおそれがあります。再読み込みしてください。"
            onRetry={() => setReloadKey(key => key + 1)}
          />
        )}

        {/* =======================
            タブ1: Zoom URL設定
           ======================= */}
        {activeTab === 'system' && !loadError && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2">
            <SystemControl />

            <div className="rounded-card border border-line bg-white p-6 shadow-sm">
              <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-accent">Class Button Window</p>
                  <h2 className="mt-1 flex items-center gap-2 text-xl font-bold text-slate-800">
                    <Clock size={22} className="text-accent" /> 生徒画面の参加ボタン表示時間
                  </h2>
                  <p className="mt-2 text-sm font-bold text-slate-400">
                    講師が生徒画面を確認する際、参加ボタンが出る時間帯をここで調整します。保存後、生徒画面・講師プレビューの両方に反映されます。
                  </p>
                </div>
                <div className="rounded-btn bg-slate-50 px-4 py-3 text-xs font-bold text-slate-500">
                  表示範囲: 開始 {classButtonSettings.show_before_minutes}分前 〜 終了 {classButtonSettings.show_after_minutes}分後
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <ClassPeriodTimeEditor
                  label="1限"
                  start={classButtonSettings.period1_start}
                  end={classButtonSettings.period1_end}
                  colorClass="border-sky-100 bg-sky-50/40 text-sky-700"
                  onStartChange={value => handleClassButtonSettingChange('period1_start', value)}
                  onEndChange={value => handleClassButtonSettingChange('period1_end', value)}
                />
                <ClassPeriodTimeEditor
                  label="2限"
                  start={classButtonSettings.period2_start}
                  end={classButtonSettings.period2_end}
                  colorClass="border-violet-100 bg-violet-50/40 text-violet-700"
                  onStartChange={value => handleClassButtonSettingChange('period2_start', value)}
                  onEndChange={value => handleClassButtonSettingChange('period2_end', value)}
                />
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-2">
                <ClassWindowSlider
                  label="開始前に表示する時間"
                  value={classButtonSettings.show_before_minutes}
                  min={0}
                  max={120}
                  suffix="分前"
                  onChange={value => handleClassButtonSettingChange('show_before_minutes', value)}
                />
                <ClassWindowSlider
                  label="終了後も表示する時間"
                  value={classButtonSettings.show_after_minutes}
                  min={0}
                  max={60}
                  suffix="分後"
                  onChange={value => handleClassButtonSettingChange('show_after_minutes', value)}
                />
              </div>

              <div className="mt-5 rounded-card border border-slate-100 bg-slate-50 p-4">
                <p className="mb-3 text-xs font-bold text-slate-500">表示時間の見え方</p>
                <div className="space-y-3">
                  <ClassWindowPreview label="1限" start={classButtonSettings.period1_start} end={classButtonSettings.period1_end} settings={classButtonSettings} />
                  <ClassWindowPreview label="2限" start={classButtonSettings.period2_start} end={classButtonSettings.period2_end} settings={classButtonSettings} />
                </div>
              </div>

              <div className="mt-5 rounded-card border border-amber-200 bg-amber-50/70 p-5">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-amber-600">Test Preparation</p>
                    <h3 className="mt-1 text-base font-bold text-slate-900">講師配置の「対策」を参加ボタンへ表示</h3>
                    <p className="mt-2 text-xs font-bold leading-relaxed text-slate-600">講師配置の講座名・詳細科目などに「対策」を含む授業を、受講登録とは別に表示します。行が生徒の学年、列が表示対象の講師配置学年です。</p>
                  </div>
                  <label className="flex min-h-11 shrink-0 cursor-pointer items-center gap-3 rounded-btn bg-white px-4 py-3 text-sm font-bold text-slate-700 ring-1 ring-amber-200">
                    <input type="checkbox" checked={classButtonSettings.test_prep_enabled} onChange={event => handleClassButtonSettingChange('test_prep_enabled', event.target.checked)} className="h-5 w-5 accent-amber-600" />
                    対策表示を有効にする
                  </label>
                </div>
                <div className={`mt-5 overflow-x-auto rounded-btn bg-white ring-1 ring-amber-100 ${classButtonSettings.test_prep_enabled ? '' : 'opacity-50'}`}>
                  <table className="w-full min-w-[520px] text-sm">
                    <thead className="bg-amber-100/70 text-xs font-bold text-amber-900"><tr><th className="px-4 py-3 text-left">生徒の学年</th>{CLASS_BUTTON_GRADES.map(grade => <th key={grade} className="px-4 py-3 text-center">{grade}の対策を表示</th>)}</tr></thead>
                    <tbody className="divide-y divide-amber-100">{CLASS_BUTTON_GRADES.map(studentGrade => <tr key={studentGrade}><th className="px-4 py-4 text-left font-bold text-slate-800">{studentGrade}</th>{CLASS_BUTTON_GRADES.map(shiftGrade => <td key={shiftGrade} className="px-4 py-4 text-center"><input type="checkbox" disabled={!classButtonSettings.test_prep_enabled} checked={classButtonSettings.test_prep_grade_visibility[studentGrade].includes(shiftGrade)} onChange={event => handleTestPrepGradeVisibilityChange(studentGrade, shiftGrade, event.target.checked)} aria-label={`${studentGrade}に${shiftGrade}の対策を表示`} className="h-5 w-5 accent-amber-600" /></td>)}</tr>)}</tbody>
                  </table>
                </div>
                <p className="mt-3 text-xs font-bold text-amber-800">現在の推奨設定: 中1・中2は相互表示、中3は中3のみ。</p>
              </div>
            </div>
            
            {/* 1. 社会 (学年×分野) */}
            <div className="bg-white p-8 rounded-card shadow-sm border border-slate-100">
              <h2 className="text-lg font-bold text-slate-700 mb-6 flex items-center gap-2 border-b border-slate-100 pb-4">
                <Globe size={24} className="text-amber-500"/> 社会 (学年×分野)
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
                            <span className="absolute top-2 left-3 text-xs font-bold text-amber-400">{field}</span>
                            <input 
                              type="text" 
                              placeholder="https://zoom.us/..."
                              className="w-full pt-6 pb-2 px-3 bg-amber-50/30 border-2 border-amber-100 rounded-input text-xs font-bold text-slate-600 outline-none focus:border-accent focus:bg-white transition-all"
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
            <div className="bg-white p-8 rounded-card shadow-sm border border-slate-100">
              <h2 className="text-lg font-bold text-slate-700 mb-6 flex items-center gap-2 border-b border-slate-100 pb-4">
                <Beaker size={24} className="text-emerald-500"/> 理科 (学年×分野)
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
                            <span className="absolute top-2 left-3 text-xs font-bold text-emerald-500">{field}</span>
                            <input 
                              type="text" 
                              placeholder="URL"
                              className="w-full pt-6 pb-2 px-3 bg-emerald-50/30 border-2 border-emerald-100 rounded-input text-xs font-bold text-slate-600 outline-none focus:border-emerald-400 focus:bg-white transition-all"
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
            <div className="bg-white p-8 rounded-card shadow-sm border border-slate-100">
              <h2 className="text-lg font-bold text-slate-700 mb-6 flex items-center gap-2 border-b border-slate-100 pb-4">
                <BookOpen size={24} className="text-accent"/> 主要3科目 (学年別)
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
                            <span className="absolute top-2 left-3 text-xs font-bold text-accent">{subject}</span>
                            <input 
                              type="text" 
                              placeholder="URL"
                              className="w-full pt-6 pb-2 px-3 bg-accent-soft/40 border-2 border-line rounded-input text-xs font-bold text-slate-600 outline-none focus:border-accent focus:bg-white transition-all"
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
              <Button size="lg" className="shadow-xl" onClick={handleSaveUrls} loading={saving} icon={<Save size={20} aria-hidden />}>
                URL・参加ボタン設定を保存
              </Button>
            </div>
          </div>
        )}

        {/* =======================
            タブ2: 生徒・保護者の表示設定
           ======================= */}
        {activeTab === 'visibility' && !loadError && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
            {profile?.role === 'master' && (
              <div className="rounded-card border border-amber-100 bg-amber-50 p-6 shadow-sm">
                <div className="mb-5 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-amber-600">Beta Release Control</p>
                    <h2 className="mt-1 text-xl font-bold text-slate-900">βテスト表示フェーズ</h2>
                    <p className="mt-2 text-sm font-bold text-slate-500">マスター管理者のみ、リリース段階に合わせて表示機能を一括切替できます。</p>
                  </div>
                  <span className="w-fit rounded-full bg-white px-4 py-2 text-xs font-bold text-amber-700 ring-1 ring-amber-100">
                    現在: {releasePhase === 'custom' ? 'カスタム' : RELEASE_PHASES[releasePhase].label}
                  </span>
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  {(Object.keys(RELEASE_PHASES) as ReleasePhaseId[]).map(phaseId => {
                    const phase = RELEASE_PHASES[phaseId];
                    const active = releasePhase === phaseId;
                    return (
                      <button
                        key={phase.id}
                        type="button"
                        onClick={() => applyReleasePhase(phaseId)}
                        className={`rounded-card border-2 p-5 text-left transition-all ${active ? 'border-amber-400 bg-white shadow-sm' : 'border-white bg-white/70 hover:border-amber-200 hover:bg-white'}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-base font-bold text-slate-900">{phase.label}</p>
                            <p className="mt-2 text-sm font-bold leading-relaxed text-slate-500">{phase.description}</p>
                          </div>
                          <span className={`rounded-full px-3 py-1 text-xs font-bold ${active ? 'bg-amber-400 text-slate-950' : 'bg-slate-100 text-slate-500'}`}>
                            {active ? '適用中' : '適用'}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-4 rounded-btn bg-white/80 p-4 text-xs font-bold leading-relaxed text-slate-500">
                  フェーズ1では、AIチャット・AI学習クエスト・コイン/景品・保護者機能・LINE/メール通知を非表示にします。アプリ内通知、Zoom入室、講師勤怠、名簿、アカウント/配置管理は表示対象です。
                </div>
              </div>
            )}

            <div className="rounded-card border border-emerald-100 bg-white p-6 shadow-sm">
              <div className="mb-6">
                <p className="text-xs font-bold uppercase tracking-wider text-emerald-500">Portal Visibility</p>
                <h2 className="mt-1 text-xl font-bold text-slate-800">アカウント別の表示制御</h2>
                <p className="mt-2 text-sm font-bold text-slate-400">OFFにした項目は、対象アカウントのホーム・ナビ・主要導線から非表示になります。</p>
              </div>

              <div className="grid gap-6 lg:grid-cols-2 2xl:grid-cols-4">
                <VisibilityPanel
                  title="生徒アカウント"
                  description="生徒ホームと下部ナビの主要導線"
                  items={STUDENT_VISIBILITY_ITEMS}
                  values={visibility.student}
                  onChange={(key, value) => handleVisibilityChange('student', key, value)}
                />
                <VisibilityPanel
                  title="保護者アカウント"
                  description="保護者ダッシュボードの詳細項目とカレンダー操作"
                  items={PARENT_VISIBILITY_ITEMS}
                  values={visibility.parent}
                  onChange={(key, value) => handleVisibilityChange('parent', key, value)}
                />
                <VisibilityPanel
                  title="講師アカウント"
                  description="講師ポータルと下部ナビ、講師向け各機能"
                  items={TEACHER_VISIBILITY_ITEMS}
                  values={visibility.teacher}
                  onChange={(key, value) => handleVisibilityChange('teacher', key, value)}
                />
                <VisibilityPanel
                  title="管理者アカウント"
                  description="校舎管理者に見せる管理メニュー（勤怠・Booster の管理者は権限設定どおりに表示）"
                  items={ADMIN_VISIBILITY_ITEMS}
                  values={visibility.admin}
                  onChange={(key, value) => handleVisibilityChange('admin', key, value)}
                />
              </div>
            </div>

            <div className="rounded-card border border-amber-100 bg-white p-6 shadow-sm">
              <div className="mb-6">
                <p className="text-xs font-bold uppercase tracking-wider text-amber-500">Mission Control</p>
                <h2 className="mt-1 text-xl font-bold text-slate-800">デイリーミッション表示制御</h2>
                <p className="mt-2 text-sm font-bold text-slate-400">
                  OFFにしたミッションは生徒画面に表示されず、API側でも報酬を受け取れません。βテスト中はコミュニティミッションをOFFにしてください。
                </p>
              </div>
              <MissionPanel
                values={missionSettings}
                onChange={handleMissionChange}
                customMissions={customMissions}
                onAddCustom={handleAddCustomMission}
                onCustomChange={handleCustomMissionChange}
                onCustomDelete={handleDeleteCustomMission}
              />
            </div>

            <div className="sticky bottom-6 z-20 flex justify-end">
              <Button size="lg" className="shadow-xl" onClick={handleSaveVisibility} loading={savingVisibility} icon={<Save size={20} aria-hidden />}>
                表示設定を保存
              </Button>
            </div>
          </div>
        )}

        {/* =======================
            タブ3: 通知連携設定
           ======================= */}
        {activeTab === 'notifications' && !loadError && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
            <div className="rounded-card border border-emerald-100 bg-white p-6 shadow-sm">
              <div className="mb-6">
                <p className="text-xs font-bold uppercase tracking-wider text-emerald-600">Notification Channels</p>
                <h2 className="mt-1 text-xl font-bold text-slate-800">通知連携のオン・オフ</h2>
                <p className="mt-2 text-sm font-bold text-slate-400">
                  LINE・メール・アプリ内通知の利用可否を全体で管理します。ユーザー個別の通知設定よりもこちらが優先されます。
                </p>
              </div>

              <div className="grid gap-5 lg:grid-cols-3">
                <NotificationPanel
                  title="配信チャネル"
                  icon={<Bell size={18} className="text-slate-500" />}
                  items={[
                    { key: 'line_enabled', label: 'LINE通知を使う', description: '全アカウントのLINE通知を有効にします。' },
                    { key: 'email_enabled', label: 'メール通知を使う', description: '対象者へのメール送信を有効にします（1回100名まで）。' },
                    { key: 'in_app_enabled', label: 'アプリ内通知を使う', description: 'アプリ内のお知らせ・通知表示を有効にします。' },
                    { key: 'push_enabled', label: '端末への通知を使う', description: '「この端末に通知を送る」をオンにした端末へ、アプリ内通知と同時に知らせます。' },
                  ]}
                  values={notificationSettings}
                  onChange={handleNotificationChange}
                />
                <NotificationPanel
                  title="LINE対象アカウント"
                  icon={<MessageCircle size={18} className="text-[#06C755]" />}
                  items={[
                    { key: 'teacher_line_enabled', label: '講師へのLINE通知', description: 'シフト・代行・運営連絡をLINE送信できます。' },
                    { key: 'parent_line_enabled', label: '保護者へのLINE通知', description: '登録依頼・欠席・お知らせをLINE送信できます。' },
                    { key: 'student_line_enabled', label: '生徒へのLINE通知', description: '授業開始・宿題・お知らせをLINE送信できます。' },
                    { key: 'admin_line_enabled', label: '管理者へのLINE通知', description: '校舎管理者・マスター管理者へ運営通知をLINE送信できます。' },
                  ]}
                  values={notificationSettings}
                  onChange={handleNotificationChange}
                />
                <NotificationPanel
                  title="通知種別"
                  icon={<Mail size={18} className="text-accent" />}
                  items={[
                    { key: 'class_start_enabled', label: '授業開始通知', description: '授業前リマインドの配信を許可します。' },
                    { key: 'homework_enabled', label: '宿題通知', description: '宿題・提出期限の配信を許可します。' },
                    { key: 'announcements_enabled', label: 'お知らせ通知', description: '管理者のお知らせ配信を許可します。' },
                  ]}
                  values={notificationSettings}
                  onChange={handleNotificationChange}
                />
              </div>
            </div>

            <div className="sticky bottom-6 z-20 flex justify-end">
              <Button size="lg" className="shadow-xl" onClick={handleSaveNotifications} loading={savingNotifications} icon={<Save size={20} aria-hidden />}>
                通知連携設定を保存
              </Button>
            </div>
          </div>
        )}

        {/* =======================
            タブ4: アカウント・アプリ設定
           ======================= */}
        {activeTab === 'account' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
            {profile?.isFirstLogin === true && (
              <div className="rounded-btn border-2 border-amber-300 bg-amber-50 p-4 text-sm font-bold leading-relaxed text-amber-900">
                初回ログインのため、この画面で新しいパスワードを設定してください。
              </div>
            )}
            
            {/* PWAインストール */}
            {!isStandalone && (
              <div className="bg-accent p-6 rounded-hero shadow-lg text-accent-ink relative overflow-hidden">
                <div className="relative z-10">
                  <h2 className="font-bold flex items-center gap-2 mb-2"><Smartphone size={20}/> アプリとしてインストール</h2>
                  <p className="text-xs font-bold opacity-80 mb-4">ホーム画面に追加して全画面で利用できます。</p>
                  
                  {deferredPrompt ? (
                    <button onClick={handleInstallClick} className="w-full min-h-11 bg-white text-accent py-3 rounded-btn font-bold shadow-lg flex items-center justify-center gap-2 active:scale-95 transition-transform">
                      <Download size={18}/> 追加する
                    </button>
                  ) : (
                    <button onClick={() => setShowManual(true)} className="w-full bg-white/20 border border-white/30 text-white py-3 rounded-btn font-bold flex items-center justify-center gap-2 hover:bg-white/30 transition-all text-xs">
                      <HelpCircle size={16}/> 追加方法を見る
                    </button>
                  )}

                  {showManual && (
                    <div className="mt-4 bg-white/10 backdrop-blur-md p-4 rounded-btn border border-white/20 text-xs font-bold">
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
            <div className="bg-white p-6 rounded-card shadow-sm border border-slate-100">
              <h2 className="text-sm font-bold text-slate-500 mb-4 flex items-center gap-2"><Type size={18}/> 表示サイズ設定</h2>
              <div className="flex bg-slate-100 p-1 rounded-btn">
                <button onClick={() => handleTextSizeChange('normal')} className={`flex-1 py-2.5 rounded-lg text-xs font-bold transition-all ${textSize === 'normal' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-400'}`}>標準</button>
                <button onClick={() => handleTextSizeChange('large')} className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all ${textSize === 'large' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-400'}`}>拡大</button>
              </div>
            </div>

            {/* パスワード変更・LINE連携・ログアウト（/master/account と同じ部品） */}
            <AdminAccountPanel onPasswordChanged={profile?.isFirstLogin === true ? () => window.location.replace('/master') : undefined} />

          </div>
        )}

      </div>
    </div>
  );
}

function VisibilityPanel({
  title,
  description,
  items,
  values,
  onChange,
}: {
  title: string;
  description: string;
  items: readonly { key: string; label: string }[];
  values: Record<string, boolean>;
  onChange: (key: string, value: boolean) => void;
}) {
  return (
    <div className="rounded-card border border-slate-100 bg-slate-50 p-5">
      <div className="mb-4">
        <h3 className="text-base font-bold text-slate-800">{title}</h3>
        <p className="mt-1 text-xs font-bold text-slate-400">{description}</p>
      </div>
      <div className="space-y-2">
        {items.map(item => (
          <label key={item.key} className="flex items-center justify-between rounded-btn bg-white px-4 py-3 shadow-sm">
            <span className="text-sm font-bold text-slate-700">{item.label}</span>
            <input
              type="checkbox"
              checked={values[item.key] !== false}
              onChange={e => onChange(item.key, e.target.checked)}
              className="h-5 w-5 accent-emerald-600"
            />
          </label>
        ))}
      </div>
    </div>
  );
}

function MissionPanel({
  values,
  onChange,
  customMissions,
  onAddCustom,
  onCustomChange,
  onCustomDelete,
}: {
  values: typeof DEFAULT_MISSION_SETTINGS;
  onChange: (key: keyof typeof DEFAULT_MISSION_SETTINGS, value: boolean) => void;
  customMissions: CustomMission[];
  onAddCustom: () => void;
  onCustomChange: (index: number, patch: Partial<CustomMission>) => void;
  onCustomDelete: (index: number) => void;
}) {
  const items: { key: keyof typeof DEFAULT_MISSION_SETTINGS; label: string; description: string }[] = [
    { key: 'login', label: 'ログインミッション', description: 'アプリにログインするミッションを表示します。' },
    { key: 'recording', label: '録画視聴ミッション', description: '授業録画を1本見るミッションを表示します。' },
    { key: 'community', label: 'コミュニティミッション', description: '投稿・コメント・いいね・投票による参加ミッションを表示します。' },
  ];

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-3">
        {items.map(item => {
          const enabled = values[item.key] !== false;
          return (
            <label key={item.key} className={`rounded-card border-2 p-5 shadow-sm transition-all ${enabled ? 'border-amber-200 bg-amber-50' : 'border-slate-100 bg-slate-50'}`}>
              <div className="flex items-start justify-between gap-4">
                <span>
                  <span className="block text-sm font-bold text-slate-800">{item.label}</span>
                  <span className="mt-2 block text-xs font-bold leading-relaxed text-slate-500">{item.description}</span>
                </span>
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={e => onChange(item.key, e.target.checked)}
                  className="mt-1 h-5 w-5 shrink-0 accent-amber-500"
                />
              </div>
              <span className={`mt-4 inline-flex rounded-full px-3 py-1 text-xs font-bold ${enabled ? 'bg-amber-500 text-white' : 'bg-slate-200 text-slate-500'}`}>
                {enabled ? '表示中' : '非表示'}
              </span>
            </label>
          );
        })}
      </div>

      <div className="rounded-card border border-amber-100 bg-amber-50/60 p-5">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-800">追加デイリーミッション</h3>
            <p className="mt-1 text-xs font-bold text-slate-500">
              テスト期間やイベントに合わせて、生徒画面に出すミッションを追加できます。1日1回だけ受け取れます。
            </p>
          </div>
          <Button variant="secondary" onClick={onAddCustom} icon={<Plus size={16} aria-hidden />}>
            新規作成
          </Button>
        </div>

        {customMissions.length === 0 ? (
          <EmptyState
            className="border border-dashed border-amber-200 bg-white/70"
            title="追加ミッションはまだありません"
            description="「新規作成」から、テスト期間などに出すミッションを追加できます。"
          />
        ) : (
          <div className="space-y-4">
            {customMissions.map((mission, index) => (
              <div key={`${mission.id}_${index}`} className="rounded-card border border-amber-100 bg-white p-4 shadow-sm">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
                    <input
                      type="checkbox"
                      checked={mission.enabled !== false}
                      onChange={e => onCustomChange(index, { enabled: e.target.checked })}
                      className="h-5 w-5 accent-amber-500"
                    />
                    表示する
                  </label>
                  <IconButton
                    label="追加ミッションを削除"
                    onClick={() => onCustomDelete(index)}
                    className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                  >
                    <Trash2 size={16} aria-hidden />
                  </IconButton>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-xs font-bold text-slate-400">管理ID</span>
                    <input
                      value={mission.id}
                      onChange={e => onCustomChange(index, { id: e.target.value })}
                      className="w-full rounded-input border border-line bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:border-accent focus:bg-white"
                      placeholder="test_week"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-bold text-slate-400">報酬コイン</span>
                    <input
                      type="number"
                      min={0}
                      max={500}
                      value={mission.reward}
                      onChange={e => onCustomChange(index, { reward: Number(e.target.value) })}
                      className="w-full rounded-input border border-line bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:border-accent focus:bg-white"
                    />
                  </label>
                  <label className="space-y-1 md:col-span-2">
                    <span className="text-xs font-bold text-slate-400">ミッション名</span>
                    <input
                      value={mission.title}
                      onChange={e => onCustomChange(index, { title: e.target.value })}
                      className="w-full rounded-input border border-line bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:border-accent focus:bg-white"
                      placeholder="例: テスト対策の動画を確認する"
                    />
                  </label>
                  <label className="space-y-1 md:col-span-2">
                    <span className="text-xs font-bold text-slate-400">説明</span>
                    <input
                      value={mission.description}
                      onChange={e => onCustomChange(index, { description: e.target.value })}
                      className="w-full rounded-input border border-line bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:border-accent focus:bg-white"
                      placeholder="生徒に表示する補足文"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-bold text-slate-400">達成条件</span>
                    <select
                      value={mission.condition}
                      onChange={e => onCustomChange(index, { condition: e.target.value as CustomMissionCondition })}
                      className="w-full rounded-input border border-line bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:border-accent focus:bg-white"
                    >
                      {CUSTOM_MISSION_CONDITIONS.map(condition => (
                        <option key={condition.value} value={condition.value}>{condition.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-bold text-slate-400">リンクボタン名</span>
                    <input
                      value={mission.link_label}
                      onChange={e => onCustomChange(index, { link_label: e.target.value })}
                      className="w-full rounded-input border border-line bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:border-accent focus:bg-white"
                      placeholder="開く"
                    />
                  </label>
                  <label className="space-y-1 md:col-span-2">
                    <span className="text-xs font-bold text-slate-400">リンクURL</span>
                    <input
                      value={mission.link_url}
                      onChange={e => onCustomChange(index, { link_url: e.target.value })}
                      className="w-full rounded-input border border-line bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:border-accent focus:bg-white"
                      placeholder="/student/recordings または https://..."
                    />
                  </label>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function NotificationPanel({
  title,
  icon,
  items,
  values,
  onChange,
}: {
  title: string;
  icon: React.ReactNode;
  items: { key: keyof typeof DEFAULT_NOTIFICATION_SETTINGS; label: string; description: string }[];
  values: typeof DEFAULT_NOTIFICATION_SETTINGS;
  onChange: (key: keyof typeof DEFAULT_NOTIFICATION_SETTINGS, value: boolean) => void;
}) {
  return (
    <div className="rounded-card border border-slate-100 bg-slate-50 p-5">
      <div className="mb-4 flex items-center gap-2">
        {icon}
        <h3 className="text-base font-bold text-slate-800">{title}</h3>
      </div>
      <div className="space-y-2">
        {items.map(item => (
          <label key={item.key} className="flex items-start justify-between gap-3 rounded-btn bg-white px-4 py-3 shadow-sm">
            <span>
              <span className="block text-sm font-bold text-slate-700">{item.label}</span>
              <span className="mt-1 block text-xs font-bold leading-relaxed text-slate-400">{item.description}</span>
            </span>
            <input
              type="checkbox"
              checked={values[item.key] !== false}
              onChange={e => onChange(item.key, e.target.checked)}
              className="mt-1 h-5 w-5 shrink-0 accent-emerald-600"
            />
          </label>
        ))}
      </div>
    </div>
  );
}

function timeToMinutes(time: string) {
  const [h, m] = time.split(':').map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

function minutesToTime(totalMinutes: number) {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function ClassPeriodTimeEditor({
  label,
  start,
  end,
  colorClass,
  onStartChange,
  onEndChange,
}: {
  label: string;
  start: string;
  end: string;
  colorClass: string;
  onStartChange: (value: string) => void;
  onEndChange: (value: string) => void;
}) {
  return (
    <div className={`rounded-card border p-4 ${colorClass}`}>
      <p className="mb-3 text-sm font-bold">{label}の授業時間</p>
      <div className="grid grid-cols-2 gap-3">
        <label>
          <span className="mb-1 block text-xs font-bold opacity-70">開始</span>
          <input type="time" value={start} onChange={e => onStartChange(e.target.value)} className="w-full rounded-input border border-white/70 bg-white px-4 py-3 font-mono text-sm font-bold text-slate-800 outline-none" />
        </label>
        <label>
          <span className="mb-1 block text-xs font-bold opacity-70">終了</span>
          <input type="time" value={end} onChange={e => onEndChange(e.target.value)} className="w-full rounded-input border border-white/70 bg-white px-4 py-3 font-mono text-sm font-bold text-slate-800 outline-none" />
        </label>
      </div>
    </div>
  );
}

function ClassWindowSlider({
  label,
  value,
  min,
  max,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="rounded-card border border-slate-100 bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm font-bold text-slate-700">{label}</p>
        <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-bold text-white">{value}{suffix}</span>
      </div>
      <input type="range" min={min} max={max} step={5} value={value} onChange={e => onChange(Number(e.target.value))} className="w-full accent-accent" />
      <div className="mt-1 flex justify-between text-xs font-bold text-slate-300">
        <span>{min}分</span>
        <span>{max}分</span>
      </div>
    </div>
  );
}

function ClassWindowPreview({
  label,
  start,
  end,
  settings,
}: {
  label: string;
  start: string;
  end: string;
  settings: ClassButtonSettings;
}) {
  const lessonStart = timeToMinutes(start);
  const lessonEnd = timeToMinutes(end);
  const windowStart = lessonStart - settings.show_before_minutes;
  const windowEnd = lessonEnd + settings.show_after_minutes;
  const baseStart = Math.min(windowStart, lessonStart) - 10;
  const baseEnd = Math.max(windowEnd, lessonEnd) + 10;
  const width = Math.max(1, baseEnd - baseStart);
  const windowLeft = ((windowStart - baseStart) / width) * 100;
  const windowWidth = ((windowEnd - windowStart) / width) * 100;
  const lessonLeft = ((lessonStart - baseStart) / width) * 100;
  const lessonWidth = ((lessonEnd - lessonStart) / width) * 100;

  return (
    <div className="rounded-btn bg-white p-3">
      <div className="mb-2 flex flex-col gap-1 text-xs font-bold sm:flex-row sm:items-center sm:justify-between">
        <span className="text-slate-700">{label}</span>
        <span className="text-slate-400">
          ボタン表示 {minutesToTime(windowStart)}〜{minutesToTime(windowEnd)} / 授業 {start}〜{end}
        </span>
      </div>
      <div className="relative h-8 overflow-hidden rounded-full bg-slate-100">
        <div className="absolute top-1/2 h-5 -translate-y-1/2 rounded-full bg-accent-soft" style={{ left: `${windowLeft}%`, width: `${windowWidth}%` }} />
        <div className="absolute top-1/2 h-5 -translate-y-1/2 rounded-full bg-accent" style={{ left: `${lessonLeft}%`, width: `${lessonWidth}%` }} />
      </div>
      <div className="mt-2 flex items-center gap-4 text-xs font-bold text-slate-400">
        <span className="inline-flex items-center gap-1"><span className="h-2 w-5 rounded-full bg-accent-soft" />ボタン表示</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-5 rounded-full bg-accent" />授業時間</span>
      </div>
    </div>
  );
}
