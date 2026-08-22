'use client';

import type React from 'react';
import { useState, useEffect } from 'react';
import { db, auth } from '@/lib/firebase';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { updatePassword } from 'firebase/auth';
import { useAuth } from '@/app/context/AuthContext';
import { 
  ArrowLeft, Link as LinkIcon, Loader2, Save, 
  Settings, User, Lock, LogOut, Smartphone, 
  Download, Share, HelpCircle, PlusSquare, 
  Type, Globe, Beaker, BookOpen, Eye, Bell, Mail, MessageCircle,
  Plus, Trash2, Clock
} from 'lucide-react';
import Link from 'next/link';
import LineLinkPanel from '@/app/components/LineLinkPanel';
import { RELEASE_PHASES, ReleasePhaseId } from '@/lib/release-phase-visibility';
import SystemControl from '@/app/components/master/SystemControl';
import {
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
    attendanceCorrections: false,
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
  { key: 'homework', label: '宿題提出状況' },
  { key: 'attendance', label: '出席状況' },
  { key: 'absence', label: '欠席連絡' },
  { key: 'transfer', label: '振替登録' },
  { key: 'recordings', label: '録画視聴状況' },
  { key: 'aiMessages', label: 'AIメッセージ' },
  { key: 'announcements', label: 'お知らせ' },
  { key: 'calendar', label: 'カレンダー操作' },
  { key: 'contact', label: 'お問い合わせ' },
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

const ADMIN_VISIBILITY_ITEMS = [
  { key: 'users', label: 'ID書面・印刷' },
  { key: 'schoolStudents', label: '校舎別 生徒管理' },
  { key: 'sso', label: 'アカウント管理' },
  { key: 'shifts', label: 'シフト管理' },
  { key: 'monthlySchedules', label: '月間予定' },
  { key: 'attendance', label: '勤怠管理' },
  { key: 'attendanceCorrections', label: '打刻修正承認' },
  { key: 'attendanceDiagnostics', label: '勤怠ミス候補' },
  { key: 'substitutions', label: '代行依頼管理' },
  { key: 'announcements', label: 'お知らせ配信' },
  { key: 'requests', label: '承認・申請' },
  { key: 'parentInquiries', label: '保護者お問い合わせ' },
  { key: 'registrationTasks', label: '登録依頼作成' },
  { key: 'curriculum', label: 'カリキュラム管理' },
  { key: 'pf', label: 'PFデータ管理' },
  { key: 'recordings', label: '授業アーカイブ' },
  { key: 'slides', label: '授業スライド' },
  { key: 'community', label: 'コミュニティ' },
  { key: 'rewards', label: '景品・コイン' },
  { key: 'stats', label: '統計・分析' },
  { key: 'betaAnalytics', label: 'テスト効果検証' },
  { key: 'surveySettings', label: 'アンケート設定' },
  { key: 'imports', label: 'CSV一括登録' },
  { key: 'delete', label: '一括削除' },
  { key: 'line', label: '通知・LINE管理' },
  { key: 'notifications', label: '自分の通知' },
  { key: 'settings', label: '設定' },
] as const;

export default function SettingsPage() {
  const { logout, profile } = useAuth();
  const [activeTab, setActiveTab] = useState<'system' | 'visibility' | 'notifications' | 'account'>('system');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingVisibility, setSavingVisibility] = useState(false);
  const [user, setUser] = useState<any>(null);

  // --- Zoom URL設定 State ---
  const [urls, setUrls] = useState<{[key:string]: string}>({});

  // --- アカウント設定 State ---
  const [textSize, setTextSize] = useState('normal');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordMsg, setPasswordMsg] = useState('');
  const [visibility, setVisibility] = useState(DEFAULT_VISIBILITY);
  const [releasePhase, setReleasePhase] = useState<ReleasePhaseId | 'custom'>('custom');
  const [notificationSettings, setNotificationSettings] = useState(DEFAULT_NOTIFICATION_SETTINGS);
  const [missionSettings, setMissionSettings] = useState(DEFAULT_MISSION_SETTINGS);
  const [customMissions, setCustomMissions] = useState<CustomMission[]>([]);
  const [classButtonSettings, setClassButtonSettings] = useState<ClassButtonSettings>(DEFAULT_CLASS_BUTTON_SETTINGS);
  const [savingNotifications, setSavingNotifications] = useState(false);

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
      await setDoc(doc(db, 'settings', 'class_button'), {
        ...normalizeClassButtonSettings(classButtonSettings),
        updated_at: new Date().toISOString(),
        updated_by: user?.uid || null,
      }, { merge: true });
      alert('Zoom URL・参加ボタン設定を保存しました');
    } catch(e) { 
      console.error(e);
      alert('保存エラー'); 
    } finally { 
      setSaving(false); 
    }
  };

  const handleClassButtonSettingChange = (key: keyof ClassButtonSettings, value: string | number) => {
    setClassButtonSettings(prev => normalizeClassButtonSettings({ ...prev, [key]: value }));
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
      alert('表示設定を保存しました');
    } catch (e) {
      console.error(e);
      alert('保存エラー');
    } finally {
      setSavingVisibility(false);
    }
  };

  const applyReleasePhase = (phaseId: ReleasePhaseId) => {
    if (profile?.role !== 'master') {
      alert('βテストのフェーズ設定はマスター管理者のみ変更できます。');
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

  const handleDeleteCustomMission = (index: number) => {
    if (!confirm('この追加ミッションを削除しますか？')) return;
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
      alert('通知連携設定を保存しました');
    } catch (e) {
      console.error(e);
      alert('保存エラー');
    } finally {
      setSavingNotifications(false);
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
    await logout();
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
          <div className="flex flex-wrap bg-white p-1 rounded-2xl shadow-sm w-full md:w-auto">
            <button 
              onClick={() => setActiveTab('system')}
              className={`flex-1 md:flex-none px-6 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all ${activeTab === 'system' ? 'bg-slate-800 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}
            >
              <LinkIcon size={14}/> Zoom URL設定
            </button>
            <button
              onClick={() => setActiveTab('visibility')}
              className={`flex-1 md:flex-none px-6 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all ${activeTab === 'visibility' ? 'bg-emerald-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}
            >
              <Eye size={14}/> 表示設定
            </button>
            <button
              onClick={() => setActiveTab('notifications')}
              className={`flex-1 md:flex-none px-6 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all ${activeTab === 'notifications' ? 'bg-[#06C755] text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}
            >
              <Bell size={14}/> 通知連携
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
            <SystemControl />

            <div className="rounded-[32px] border border-blue-100 bg-white p-6 shadow-sm">
              <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-xs font-black uppercase tracking-wider text-blue-500">Class Button Window</p>
                  <h2 className="mt-1 flex items-center gap-2 text-xl font-black text-slate-800">
                    <Clock size={22} className="text-blue-500" /> 生徒画面の参加ボタン表示時間
                  </h2>
                  <p className="mt-2 text-sm font-bold text-slate-400">
                    講師が生徒画面を確認する際、参加ボタンが出る時間帯をここで調整します。保存後、生徒画面・講師プレビューの両方に反映されます。
                  </p>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3 text-xs font-black text-slate-500">
                  表示範囲: 開始 {classButtonSettings.show_before_minutes}分前 〜 終了 {classButtonSettings.show_after_minutes}分後
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <ClassPeriodTimeEditor
                  label="1限"
                  start={classButtonSettings.period1_start}
                  end={classButtonSettings.period1_end}
                  colorClass="border-blue-100 bg-blue-50/40 text-blue-700"
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

              <div className="mt-5 rounded-3xl border border-slate-100 bg-slate-50 p-4">
                <p className="mb-3 text-xs font-black text-slate-500">表示時間の見え方</p>
                <div className="space-y-3">
                  <ClassWindowPreview label="1限" start={classButtonSettings.period1_start} end={classButtonSettings.period1_end} settings={classButtonSettings} />
                  <ClassWindowPreview label="2限" start={classButtonSettings.period2_start} end={classButtonSettings.period2_end} settings={classButtonSettings} />
                </div>
              </div>
            </div>
            
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
                {saving ? <Loader2 className="animate-spin" size={20}/> : <Save size={20}/>} URL・参加ボタン設定を保存
              </button>
            </div>
          </div>
        )}

        {/* =======================
            タブ2: 生徒・保護者の表示設定
           ======================= */}
        {activeTab === 'visibility' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
            {profile?.role === 'master' && (
              <div className="rounded-[32px] border border-amber-100 bg-amber-50 p-6 shadow-sm">
                <div className="mb-5 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                  <div>
                    <p className="text-xs font-black uppercase tracking-wider text-amber-600">Beta Release Control</p>
                    <h2 className="mt-1 text-xl font-black text-slate-900">βテスト表示フェーズ</h2>
                    <p className="mt-2 text-sm font-bold text-slate-500">マスター管理者のみ、リリース段階に合わせて表示機能を一括切替できます。</p>
                  </div>
                  <span className="w-fit rounded-full bg-white px-4 py-2 text-xs font-black text-amber-700 ring-1 ring-amber-100">
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
                        className={`rounded-3xl border-2 p-5 text-left transition-all ${active ? 'border-amber-400 bg-white shadow-sm' : 'border-white bg-white/70 hover:border-amber-200 hover:bg-white'}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-base font-black text-slate-900">{phase.label}</p>
                            <p className="mt-2 text-sm font-bold leading-relaxed text-slate-500">{phase.description}</p>
                          </div>
                          <span className={`rounded-full px-3 py-1 text-[11px] font-black ${active ? 'bg-amber-400 text-slate-950' : 'bg-slate-100 text-slate-500'}`}>
                            {active ? '適用中' : '適用'}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-4 rounded-2xl bg-white/80 p-4 text-xs font-bold leading-relaxed text-slate-500">
                  フェーズ1では、AIチャット・AI学習クエスト・ポイント/景品・保護者機能・LINE/メール通知を非表示にします。アプリ内通知、Zoom入室、講師勤怠、名簿、アカウント/配置管理は表示対象です。
                </div>
              </div>
            )}

            <div className="rounded-[32px] border border-emerald-100 bg-white p-6 shadow-sm">
              <div className="mb-6">
                <p className="text-xs font-black uppercase tracking-wider text-emerald-500">Portal Visibility</p>
                <h2 className="mt-1 text-xl font-black text-slate-800">アカウント別の表示制御</h2>
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
                  description="校舎管理者に見せる管理メニュー"
                  items={ADMIN_VISIBILITY_ITEMS}
                  values={visibility.admin}
                  onChange={(key, value) => handleVisibilityChange('admin', key, value)}
                />
              </div>
            </div>

            <div className="rounded-[32px] border border-orange-100 bg-white p-6 shadow-sm">
              <div className="mb-6">
                <p className="text-xs font-black uppercase tracking-wider text-orange-500">Mission Control</p>
                <h2 className="mt-1 text-xl font-black text-slate-800">デイリーミッション表示制御</h2>
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
              <button
                onClick={handleSaveVisibility}
                disabled={savingVisibility}
                className="bg-emerald-600 text-white px-8 py-4 rounded-2xl font-black shadow-xl shadow-emerald-100 hover:bg-emerald-700 transition-all active:scale-95 flex items-center gap-2 disabled:opacity-50"
              >
                {savingVisibility ? <Loader2 className="animate-spin" size={20}/> : <Save size={20}/>} 表示設定を保存
              </button>
            </div>
          </div>
        )}

        {/* =======================
            タブ3: 通知連携設定
           ======================= */}
        {activeTab === 'notifications' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
            <div className="rounded-[32px] border border-green-100 bg-white p-6 shadow-sm">
              <div className="mb-6">
                <p className="text-xs font-black uppercase tracking-wider text-[#06C755]">Notification Channels</p>
                <h2 className="mt-1 text-xl font-black text-slate-800">通知連携のオン・オフ</h2>
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
                    { key: 'email_enabled', label: 'メール通知を使う', description: 'メール送信ジョブの利用を有効にします。' },
                    { key: 'in_app_enabled', label: 'アプリ内通知を使う', description: 'アプリ内のお知らせ・通知表示を有効にします。' },
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
                  icon={<Mail size={18} className="text-indigo-500" />}
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
              <button
                onClick={handleSaveNotifications}
                disabled={savingNotifications}
                className="bg-[#06C755] text-white px-8 py-4 rounded-2xl font-black shadow-xl shadow-green-100 hover:bg-[#05b34c] transition-all active:scale-95 flex items-center gap-2 disabled:opacity-50"
              >
                {savingNotifications ? <Loader2 className="animate-spin" size={20}/> : <Save size={20}/>} 通知連携設定を保存
              </button>
            </div>
          </div>
        )}

        {/* =======================
            タブ4: アカウント・アプリ設定
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

            <LineLinkPanel
              role={profile?.role === 'master' ? 'master' : 'admin'}
              lineUserId={profile?.line_user_id}
              description="連携すると、管理者向けのお知らせ・代行・運営通知をLINEでも受け取れます。"
            />

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
    <div className="rounded-[28px] border border-slate-100 bg-slate-50 p-5">
      <div className="mb-4">
        <h3 className="text-base font-black text-slate-800">{title}</h3>
        <p className="mt-1 text-xs font-bold text-slate-400">{description}</p>
      </div>
      <div className="space-y-2">
        {items.map(item => (
          <label key={item.key} className="flex items-center justify-between rounded-2xl bg-white px-4 py-3 shadow-sm">
            <span className="text-sm font-black text-slate-700">{item.label}</span>
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
            <label key={item.key} className={`rounded-3xl border-2 p-5 shadow-sm transition-all ${enabled ? 'border-orange-200 bg-orange-50' : 'border-slate-100 bg-slate-50'}`}>
              <div className="flex items-start justify-between gap-4">
                <span>
                  <span className="block text-sm font-black text-slate-800">{item.label}</span>
                  <span className="mt-2 block text-[11px] font-bold leading-relaxed text-slate-500">{item.description}</span>
                </span>
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={e => onChange(item.key, e.target.checked)}
                  className="mt-1 h-5 w-5 shrink-0 accent-orange-500"
                />
              </div>
              <span className={`mt-4 inline-flex rounded-full px-3 py-1 text-[10px] font-black ${enabled ? 'bg-orange-500 text-white' : 'bg-slate-200 text-slate-500'}`}>
                {enabled ? '表示中' : '非表示'}
              </span>
            </label>
          );
        })}
      </div>

      <div className="rounded-[28px] border border-orange-100 bg-orange-50/60 p-5">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-base font-black text-slate-800">追加デイリーミッション</h3>
            <p className="mt-1 text-xs font-bold text-slate-500">
              テスト期間やイベントに合わせて、生徒画面に出すミッションを追加できます。1日1回だけ受け取れます。
            </p>
          </div>
          <button
            type="button"
            onClick={onAddCustom}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-orange-500 px-4 py-3 text-xs font-black text-white shadow-sm transition-all hover:bg-orange-600 active:scale-95"
          >
            <Plus size={16} /> 新規作成
          </button>
        </div>

        {customMissions.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-orange-200 bg-white/70 p-6 text-center text-sm font-bold text-slate-400">
            追加ミッションはまだありません
          </div>
        ) : (
          <div className="space-y-4">
            {customMissions.map((mission, index) => (
              <div key={`${mission.id}_${index}`} className="rounded-3xl border border-orange-100 bg-white p-4 shadow-sm">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <label className="flex items-center gap-2 text-xs font-black text-slate-700">
                    <input
                      type="checkbox"
                      checked={mission.enabled !== false}
                      onChange={e => onCustomChange(index, { enabled: e.target.checked })}
                      className="h-5 w-5 accent-orange-500"
                    />
                    表示する
                  </label>
                  <button
                    type="button"
                    onClick={() => onCustomDelete(index)}
                    className="rounded-xl bg-red-50 p-2 text-red-500 transition-colors hover:bg-red-100"
                    aria-label="追加ミッションを削除"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-[10px] font-black text-slate-400">管理ID</span>
                    <input
                      value={mission.id}
                      onChange={e => onCustomChange(index, { id: e.target.value })}
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:border-orange-400 focus:bg-white"
                      placeholder="test_week"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[10px] font-black text-slate-400">報酬コイン</span>
                    <input
                      type="number"
                      min={0}
                      max={500}
                      value={mission.reward}
                      onChange={e => onCustomChange(index, { reward: Number(e.target.value) })}
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:border-orange-400 focus:bg-white"
                    />
                  </label>
                  <label className="space-y-1 md:col-span-2">
                    <span className="text-[10px] font-black text-slate-400">ミッション名</span>
                    <input
                      value={mission.title}
                      onChange={e => onCustomChange(index, { title: e.target.value })}
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:border-orange-400 focus:bg-white"
                      placeholder="例: テスト対策の動画を確認する"
                    />
                  </label>
                  <label className="space-y-1 md:col-span-2">
                    <span className="text-[10px] font-black text-slate-400">説明</span>
                    <input
                      value={mission.description}
                      onChange={e => onCustomChange(index, { description: e.target.value })}
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:border-orange-400 focus:bg-white"
                      placeholder="生徒に表示する補足文"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[10px] font-black text-slate-400">達成条件</span>
                    <select
                      value={mission.condition}
                      onChange={e => onCustomChange(index, { condition: e.target.value as CustomMissionCondition })}
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:border-orange-400 focus:bg-white"
                    >
                      {CUSTOM_MISSION_CONDITIONS.map(condition => (
                        <option key={condition.value} value={condition.value}>{condition.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="text-[10px] font-black text-slate-400">リンクボタン名</span>
                    <input
                      value={mission.link_label}
                      onChange={e => onCustomChange(index, { link_label: e.target.value })}
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:border-orange-400 focus:bg-white"
                      placeholder="開く"
                    />
                  </label>
                  <label className="space-y-1 md:col-span-2">
                    <span className="text-[10px] font-black text-slate-400">リンクURL</span>
                    <input
                      value={mission.link_url}
                      onChange={e => onCustomChange(index, { link_url: e.target.value })}
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold outline-none focus:border-orange-400 focus:bg-white"
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
    <div className="rounded-[28px] border border-slate-100 bg-slate-50 p-5">
      <div className="mb-4 flex items-center gap-2">
        {icon}
        <h3 className="text-base font-black text-slate-800">{title}</h3>
      </div>
      <div className="space-y-2">
        {items.map(item => (
          <label key={item.key} className="flex items-start justify-between gap-3 rounded-2xl bg-white px-4 py-3 shadow-sm">
            <span>
              <span className="block text-sm font-black text-slate-700">{item.label}</span>
              <span className="mt-1 block text-[11px] font-bold leading-relaxed text-slate-400">{item.description}</span>
            </span>
            <input
              type="checkbox"
              checked={values[item.key] !== false}
              onChange={e => onChange(item.key, e.target.checked)}
              className="mt-1 h-5 w-5 shrink-0 accent-[#06C755]"
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
    <div className={`rounded-3xl border p-4 ${colorClass}`}>
      <p className="mb-3 text-sm font-black">{label}の授業時間</p>
      <div className="grid grid-cols-2 gap-3">
        <label>
          <span className="mb-1 block text-xs font-black opacity-70">開始</span>
          <input type="time" value={start} onChange={e => onStartChange(e.target.value)} className="w-full rounded-2xl border border-white/70 bg-white px-4 py-3 font-mono text-sm font-black text-slate-800 outline-none" />
        </label>
        <label>
          <span className="mb-1 block text-xs font-black opacity-70">終了</span>
          <input type="time" value={end} onChange={e => onEndChange(e.target.value)} className="w-full rounded-2xl border border-white/70 bg-white px-4 py-3 font-mono text-sm font-black text-slate-800 outline-none" />
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
    <div className="rounded-3xl border border-slate-100 bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm font-black text-slate-700">{label}</p>
        <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-black text-white">{value}{suffix}</span>
      </div>
      <input type="range" min={min} max={max} step={5} value={value} onChange={e => onChange(Number(e.target.value))} className="w-full accent-indigo-600" />
      <div className="mt-1 flex justify-between text-[10px] font-black text-slate-300">
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
    <div className="rounded-2xl bg-white p-3">
      <div className="mb-2 flex flex-col gap-1 text-xs font-black sm:flex-row sm:items-center sm:justify-between">
        <span className="text-slate-700">{label}</span>
        <span className="text-slate-400">
          ボタン表示 {minutesToTime(windowStart)}〜{minutesToTime(windowEnd)} / 授業 {start}〜{end}
        </span>
      </div>
      <div className="relative h-8 overflow-hidden rounded-full bg-slate-100">
        <div className="absolute top-1/2 h-5 -translate-y-1/2 rounded-full bg-indigo-200" style={{ left: `${windowLeft}%`, width: `${windowWidth}%` }} />
        <div className="absolute top-1/2 h-5 -translate-y-1/2 rounded-full bg-indigo-600" style={{ left: `${lessonLeft}%`, width: `${lessonWidth}%` }} />
      </div>
      <div className="mt-2 flex items-center gap-4 text-[10px] font-black text-slate-400">
        <span className="inline-flex items-center gap-1"><span className="h-2 w-5 rounded-full bg-indigo-200" />ボタン表示</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-5 rounded-full bg-indigo-600" />授業時間</span>
      </div>
    </div>
  );
}
