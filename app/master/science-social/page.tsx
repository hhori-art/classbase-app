'use client';

// Online science/social administration dashboard.

import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { collection, doc, getDoc, query, where, onSnapshot, getDocs, Timestamp } from 'firebase/firestore';
import { 
  Users, AlertTriangle, ArrowRight, Activity, Building2,
  Megaphone, Calendar, ClipboardList, MonitorPlay, BookOpen,
  BarChart2, CheckSquare, Sparkles, Clock, Filter,
  Settings, Briefcase, Video, ShoppingBag,
  Database, Trash2, Edit3, X, Check, LogOut, MessageCircle, Send // ★ Send を追加
} from 'lucide-react';
import Link from 'next/link';
import { useAuth } from '@/app/context/AuthContext';
import { usePortalVisibility } from '@/app/hooks/usePortalVisibility';
import { isMasterOnlyAdminPath } from '@/lib/admin-app-permissions';

// --- 型定義 ---
type ActiveStudent = {
  id: string;
  name: string;
  status: 'online' | 'idle';
  lastActivity: string;
  avatar?: string;
};

type DailyStats = {
  dateStr: string;
  dayLabel: string;
  attendanceRate: number;
  loginRate: number;
  rawAttendance: number;
  rawLogin: number;
};

type UserMap = {
  [uid: string]: { grade: string; name: string }
};

type TeacherPlacement = {
  id: string;
  teacher_name?: string;
  target_date?: string;
  role_type?: string;
  target_grade?: string;
  target_subject?: string;
  target_detail_subject?: string;
  target_place?: string;
  note?: string;
};

const toDateSafe = (value: any): Date | null => {
  if (!value) return null;
  if (value?.toDate) return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

// ★ カスタマイズ可能なアクション一覧
const AVAILABLE_ACTIONS = [
  { key: 'announcements', id: '/master/announcements', title: 'お知らせ配信', icon: Megaphone },
  { key: 'shifts', id: '/master/shifts', title: 'シフト確認', icon: Calendar },
  { key: 'monthlySchedules', id: '/master/monthly-schedules', title: '月間予定', icon: Calendar },
  { key: 'registrationTasks', id: '/master/registration-tasks', title: '登録依頼作成', icon: ClipboardList },
  { key: 'courseAllocation', id: '/master/course-allocation', title: '講座割当管理', icon: BookOpen },
  { key: 'curriculum', id: '/master/curriculum', title: 'カリキュラム管理', icon: BookOpen },
  { key: 'parentInquiries', id: '/master/parent-inquiries', title: '保護者お問い合わせ', icon: MessageCircle },
  { key: 'recordings', id: '/master/recordings', title: '録画承認', icon: Video },
  { key: 'community', id: '/master/community', title: 'コミュニティ管理', icon: MessageCircle },
  { key: 'line', id: '/master/line', title: '通知・LINE管理', icon: Send },
  { key: 'notifications', id: '/master/notifications', title: '自分の通知', icon: Megaphone },
  { key: 'schoolStudents', id: '/master/school-students', title: '校舎別 生徒管理', icon: Users },
  { key: 'substitutions', id: '/master/substitutions', title: '代行依頼管理', icon: Megaphone },
  { key: 'slides', id: '/master/slides', title: '授業スライド', icon: BookOpen },
  { key: 'rewards', id: '/master/rewards', title: '景品管理', icon: ShoppingBag },
  { key: 'stats', id: '/master/stats', title: '統計・分析', icon: Activity },
  { key: 'betaAnalytics', id: '/master/stats#beta-analytics', title: 'テスト効果検証', icon: BarChart2 },
  { key: 'imports', id: '/master/imports', title: 'CSV一括登録', icon: Database },
  { key: 'settings', id: '/master/settings', title: 'システム設定', icon: Settings },
];

// デフォルトの表示項目
const DEFAULT_ACTIONS = [
  '/master/announcements',
  '/master/school-students',
  '/master/shifts',
  '/master/recordings',
  '/master/registration-tasks'
];

export default function MasterDashboard() {
  const { profile, logout } = useAuth();
  const [activeStudents, setActiveStudents] = useState<ActiveStudent[]>([]);
  const [weeklyStats, setWeeklyStats] = useState<DailyStats[]>([]);
  const [clock, setClock] = useState<{ time: string; date: string } | null>(null);
  
  // フィルタリング用
  const [filterGrade, setFilterGrade] = useState<string>('all');
  const [userMap, setUserMap] = useState<UserMap>({});
  const [gradeCounts, setGradeCounts] = useState<{[key:string]: number}>({});

  // 統計・インサイト用ステート
  const [stats, setStats] = useState({
    studentCount: 0,
    totalStudentCount: 0,
    onlineCount: 0,
    submissionCount: 0,
    alertCount: 0, // 退塾リスク
  });
  
  const [pendingCommunityCount, setPendingCommunityCount] = useState(0); // 未承認投稿数
  const [recordingCheckCount, setRecordingCheckCount] = useState(0); // 録画チェック候補数
  const [dashboardError, setDashboardError] = useState('');
  const [todayPlacements, setTodayPlacements] = useState<TeacherPlacement[]>([]);
  const { visibility: adminVisibility } = usePortalVisibility('admin');

  // クイックアクション設定
  const [quickActions, setQuickActions] = useState<string[]>(DEFAULT_ACTIONS);
  const [isCustomizedModalOpen, setIsCustomizedModalOpen] = useState(false);

  // --- 初期化: 設定読み込み ---
  useEffect(() => {
    const saved = localStorage.getItem('master_quick_actions');
    if (saved) {
      try {
        setQuickActions(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to parse saved actions", e);
      }
    }
  }, []);

  useEffect(() => {
    const today = new Date().toISOString().split('T')[0];
    const qTodayPlacements = query(collection(db, 'shift_assignments'), where('target_date', '==', today));
    const unsub = onSnapshot(qTodayPlacements, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as TeacherPlacement));
      list.sort((a, b) => `${a.note || ''}${a.target_grade || ''}`.localeCompare(`${b.note || ''}${b.target_grade || ''}`, 'ja'));
      setTodayPlacements(list.slice(0, 8));
    }, (error) => {
      console.warn('Teacher placement read error:', error);
      setTodayPlacements([]);
    });
    return () => unsub();
  }, []);

  const isMaster = profile?.role === 'master';
  const visibleActions = AVAILABLE_ACTIONS.filter(action =>
    (isMaster || !isMasterOnlyAdminPath(action.id)) &&
    (isMaster || adminVisibility[action.key] !== false)
  );
  const visibleQuickActions = quickActions.filter(path => visibleActions.some(action => action.id === path));
  const loggedInSchoolLabel = isMaster
    ? 'マスター管理者'
    : (Array.isArray(profile?.school_ids) && profile.school_ids.length > 0
      ? profile.school_ids.join(' / ')
      : profile?.school_id || profile?.school || '校舎未設定');

  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setClock({
        time: now.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }),
        date: now.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }),
      });
    };

    updateClock();
    const timer = window.setInterval(updateClock, 30000);
    return () => window.clearInterval(timer);
  }, []);

  // --- ログアウト処理 ---
  const handleLogout = async () => {
    if (!confirm('管理画面からログアウトしますか？')) return;
    try {
      await logout();
    } catch (error) {
      console.error('Logout failed', error);
      alert('ログアウトに失敗しました');
    }
  };

  // --- 設定保存処理 ---
  const saveQuickActions = (newActions: string[]) => {
    setQuickActions(newActions);
    localStorage.setItem('master_quick_actions', JSON.stringify(newActions));
    setIsCustomizedModalOpen(false);
  };

  const toggleActionSelection = (path: string) => {
    setQuickActions(prev => {
      if (prev.includes(path)) {
        return prev.filter(p => p !== path);
      } else {
        if (prev.length >= 6) {
          alert('クイックアクションは最大6個までです');
          return prev;
        }
        return [...prev, path];
      }
    });
  };

  // --- 1. リアルタイム監視 (生徒) ---
  useEffect(() => {
    const qStudents = query(collection(db, 'users'), where('role', '==', 'student'));
    const allowedSchools = new Set(
      (Array.isArray(profile?.school_ids)
        ? profile.school_ids
        : [profile?.school_id, profile?.school]
      ).map(value => String(value || '').trim()).filter(Boolean)
    );

    const unsubStudents = onSnapshot(qStudents, (snapshot) => {
      setDashboardError('');
      const now = new Date();
      let online = 0;
      let alerts = 0;
      const activeList: ActiveStudent[] = [];
      const tempUserMap: UserMap = {};
      const tempGradeCounts: {[key:string]: number} = { '中1':0, '中2':0, '中3':0, 'その他':0 };

      snapshot.forEach((doc) => {
        const data = doc.data();
        const studentSchools = [
          ...(Array.isArray(data.school_ids) ? data.school_ids : []),
          data.school_id,
          data.school,
          data.classroom,
        ].map(value => String(value || '').trim()).filter(Boolean);
        if (!isMaster && !studentSchools.some(school => allowedSchools.has(school))) return;
        const grade = data.grade || 'その他';
        
        tempUserMap[doc.id] = { grade, name: data.student_name || '不明' };
        
        if (tempGradeCounts[grade] !== undefined) {
          tempGradeCounts[grade]++;
        } else {
          tempGradeCounts['その他'] = (tempGradeCounts['その他'] || 0) + 1;
        }
        
        const lastLogin = toDateSafe(data.last_login_at || data.last_login);
        // 30分以内のアクティビティをオンラインとみなす
        const isOnline = lastLogin && (now.getTime() - lastLogin.getTime() < 30 * 60 * 1000);
        
        if (isOnline) {
          online++;
          activeList.push({
            id: doc.id,
            name: data.student_name || '名称未設定',
            status: 'online',
            lastActivity: lastLogin.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}),
            avatar: data.student_name?.[0]
          });
        }
        
        // 退塾リスク (ログイン間隔が空いている、など)
        if (data.churn_risk >= 80 || (data.days_since_login > 14)) alerts++;
      });

      setUserMap(tempUserMap);
      setGradeCounts(tempGradeCounts);

      activeList.sort((a, b) => (a.lastActivity < b.lastActivity ? 1 : -1));
      setActiveStudents(activeList.slice(0, 8));
      
      setStats(prev => ({ 
        ...prev, 
        totalStudentCount: Object.keys(tempUserMap).length,
        onlineCount: online, 
        alertCount: alerts 
      }));
    }, (error) => {
      console.error('Master dashboard users read error:', error);
      setDashboardError('校舎管理者の権限でユーザー情報を読み込めません。Firestoreルールと users/{uid}.role / school_ids を確認してください。');
      setStats(prev => ({ ...prev, studentCount: 0, totalStudentCount: 0, onlineCount: 0, alertCount: 0 }));
      setActiveStudents([]);
      setUserMap({});
      setGradeCounts({});
    });

    return () => unsubStudents();
  }, [isMaster, profile?.school, profile?.school_id, profile?.school_ids]);

  // --- 2. 運営タスク監視 (コミュニティ・録画) ---
  useEffect(() => {
    // 未承認のコミュニティ投稿
    const qComm = query(collection(db, 'community_topics'), where('is_approved', '==', false));
    const unsubComm = onSnapshot(qComm, (snap) => setPendingCommunityCount(snap.size), (error) => {
      console.warn('Master dashboard community read error:', error);
      setPendingCommunityCount(0);
    });

    // 録画URLがあるシフト（簡易チェック）
    // 本来は承認済みを除外するが、ダッシュボードでは「URLが入っているシフト数」を目安として表示
    const qRec = query(collection(db, 'shift_assignments'), where('target_recording_url', '!=', null));
    const unsubRec = onSnapshot(qRec, (snap) => setRecordingCheckCount(snap.size), (error) => {
      console.warn('Master dashboard recording read error:', error);
      setRecordingCheckCount(0);
    });

    return () => {
      unsubComm();
      unsubRec();
    };
  }, []);

  // --- 3. 本日の宿題提出数 ---
  useEffect(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTimestamp = Timestamp.fromDate(today);
    const qToday = query(collection(db, 'homework_answers'), where('submitted_at', '>=', todayTimestamp));
    const unsubToday = onSnapshot(qToday, (snap) => setStats(prev => ({ ...prev, submissionCount: snap.size })), (error) => {
      console.warn('Master dashboard homework read error:', error);
      setStats(prev => ({ ...prev, submissionCount: 0 }));
    });
    return () => unsubToday();
  }, []);

  // --- 4. 週間トレンド集計 ---
  useEffect(() => {
    const fetchWeeklyData = async () => {
      if (stats.totalStudentCount === 0) return;

      const days = 7;
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(endDate.getDate() - (days - 1));
      startDate.setHours(0, 0, 0, 0);
      const startDateStr = startDate.toISOString().split('T')[0];
      const startTimestamp = Timestamp.fromDate(startDate);

      // 並列取得
      const [attendanceSnap, logsSnap] = await Promise.all([
        getDocs(query(collection(db, 'attendance'), where('target_date', '>=', startDateStr))),
        getDocs(query(collection(db, 'activity_logs'), where('created_at', '>=', startTimestamp)))
      ]);

      const attendanceMap: { [key: string]: Set<string> } = {};
      const loginMap: { [key: string]: Set<string> } = {};
      const resultStats: DailyStats[] = [];
      const dayLabels = ['日', '月', '火', '水', '木', '金', '土'];

      const isTargetUser = (uid: string) => {
        if (!uid || !userMap[uid]) return false;
        if (filterGrade === 'all') return true;
        return userMap[uid]?.grade === filterGrade;
      };

      const currentTargetCount = filterGrade === 'all' ? stats.totalStudentCount : (gradeCounts[filterGrade] || 0);
      setStats(prev => ({ ...prev, studentCount: currentTargetCount }));

      attendanceSnap.forEach(doc => {
        const data = doc.data();
        if (isTargetUser(data.user_id)) {
          const date = data.target_date; 
          if (!attendanceMap[date]) attendanceMap[date] = new Set();
          attendanceMap[date].add(data.user_id);
        }
      });

      logsSnap.forEach(doc => {
        const data = doc.data();
        const createdAt = toDateSafe(data.created_at);
        if (createdAt && isTargetUser(data.uid)) {
          const date = createdAt.toISOString().split('T')[0];
          // ログイン系のアクションログを集計
          if (['login', 'app_open', 'submit'].includes(data.type)) {
            if (!loginMap[date]) loginMap[date] = new Set();
            loginMap[date].add(data.uid);
          }
        }
      });

      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];
        const labelDate = `${d.getMonth() + 1}/${d.getDate()}`;
        const labelDay = dayLabels[d.getDay()];

        const attendanceCount = attendanceMap[dateStr]?.size || 0;
        const loginCount = loginMap[dateStr]?.size || 0;

        const attendanceRate = currentTargetCount > 0 ? Math.round((attendanceCount / currentTargetCount) * 100) : 0;
        const loginRate = currentTargetCount > 0 ? Math.round((loginCount / currentTargetCount) * 100) : 0;

        resultStats.push({
          dateStr: labelDate,
          dayLabel: labelDay,
          attendanceRate,
          loginRate,
          rawAttendance: attendanceCount,
          rawLogin: loginCount
        });
      }
      setWeeklyStats(resultStats);
    };
    fetchWeeklyData().catch((error) => {
      console.warn('Master dashboard weekly stats read error:', error);
      setWeeklyStats([]);
    });
  }, [stats.totalStudentCount, filterGrade, userMap, gradeCounts]);

  return (
    <div className="space-y-6 animate-in fade-in duration-500 relative pb-20">
      
      {/* ページヘッダー */}
      <div className="flex justify-between items-end mb-4">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-800 tracking-tight">管理ダッシュボード</h1>
          <p className="text-xs font-bold text-gray-400 mt-1">システム全体の稼働状況と分析</p>
          <div className="mt-3 inline-flex items-center gap-2 rounded-2xl border border-indigo-100 bg-indigo-50 px-4 py-2 text-xs font-black text-indigo-700">
            <Building2 size={15} /> ログイン校舎: {loggedInSchoolLabel}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right hidden sm:block">
            <div className="text-2xl font-black text-indigo-600 font-mono">
              {clock?.time || '--:--'}
            </div>
            <div className="text-[10px] font-bold text-gray-400">
              {clock?.date || ''}
            </div>
          </div>
          {/* ログアウトボタン */}
          <button 
            onClick={handleLogout}
            className="bg-white border-2 border-gray-100 p-3 rounded-xl text-gray-400 hover:text-red-500 hover:bg-red-50 hover:border-red-100 transition-all shadow-sm"
            title="ログアウト"
          >
            <LogOut size={20} strokeWidth={2.5} />
          </button>
        </div>
      </div>

      {dashboardError && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
          {dashboardError}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* --- 左カラム (2/3) --- */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* スタッツカード */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex items-center justify-between relative overflow-hidden group">
              <div className="absolute right-0 top-0 w-24 h-24 bg-indigo-50 rounded-bl-full -mr-4 -mt-4 transition-transform group-hover:scale-110"></div>
              <div className="relative z-10">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Active Students</p>
                <p className="text-3xl font-black text-indigo-900 mt-1">{stats.onlineCount}<span className="text-sm text-gray-400 font-medium ml-1">人</span></p>
              </div>
              <div className="bg-indigo-100 p-3 rounded-xl text-indigo-600 relative z-10">
                <Users size={24} strokeWidth={2.5} />
              </div>
            </div>
            
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex items-center justify-between relative overflow-hidden group">
              <div className="absolute right-0 top-0 w-24 h-24 bg-blue-50 rounded-bl-full -mr-4 -mt-4 transition-transform group-hover:scale-110"></div>
              <div className="relative z-10">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Today's Subs</p>
                <p className="text-3xl font-black text-blue-900 mt-1">{stats.submissionCount}<span className="text-sm text-gray-400 font-medium ml-1">件</span></p>
              </div>
              <div className="bg-blue-100 p-3 rounded-xl text-blue-600 relative z-10">
                <BookOpen size={24} strokeWidth={2.5} />
              </div>
            </div>
            
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex items-center justify-between relative overflow-hidden group">
              <div className="absolute right-0 top-0 w-24 h-24 bg-red-50 rounded-bl-full -mr-4 -mt-4 transition-transform group-hover:scale-110"></div>
              <div className="relative z-10">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Risk Alerts</p>
                <p className={`text-3xl font-black mt-1 ${stats.alertCount > 0 ? 'text-red-500' : 'text-gray-800'}`}>{stats.alertCount}<span className="text-sm text-gray-400 font-medium ml-1">件</span></p>
              </div>
              <div className="bg-red-100 p-3 rounded-xl text-red-600 relative z-10">
                <AlertTriangle size={24} strokeWidth={2.5} />
              </div>
            </div>
          </div>

          {/* 週間学習トレンド (グラフ) */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 min-h-[320px] flex flex-col">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
              <div>
                <h2 className="font-bold text-gray-800 flex items-center gap-2 text-lg">
                  <BarChart2 className="text-indigo-500" size={24}/> 週間学習トレンド
                </h2>
                <p className="text-[10px] text-gray-400 font-bold mt-1">
                  過去7日間の稼働状況 (対象: <span className="text-indigo-600">{filterGrade === 'all' ? '全学年' : filterGrade}</span> / {stats.studentCount}名)
                </p>
              </div>
              
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-4 text-[10px] font-bold text-gray-500 mr-2">
                  <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 bg-blue-500 rounded-sm"></div> 出席</div>
                  <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 bg-green-500 rounded-sm"></div> ログイン</div>
                </div>

                <div className="relative group">
                  <Filter size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"/>
                  <select 
                    value={filterGrade}
                    onChange={(e) => setFilterGrade(e.target.value)}
                    className="bg-gray-50 border border-gray-200 text-gray-700 text-xs font-bold rounded-lg pl-8 pr-3 py-2 outline-none focus:ring-2 focus:ring-indigo-100 cursor-pointer hover:border-indigo-300 transition-colors"
                  >
                    <option value="all">全学年</option>
                    <option value="中1">中1</option>
                    <option value="中2">中2</option>
                    <option value="中3">中3</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="flex-1 flex items-end justify-between gap-2 sm:gap-4 px-2 pb-2 border-b border-gray-100 relative">
              {[25, 50, 75, 100].map(line => (
                <div key={line} className="absolute w-full border-t border-gray-100 border-dashed left-0" style={{ bottom: `${line}%` }}>
                  <span className="text-[9px] text-gray-300 absolute -left-0 -top-2">{line}%</span>
                </div>
              ))}

              {weeklyStats.length === 0 ? (
                <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">データ集計中...</div>
              ) : (
                weeklyStats.map((item, idx) => (
                  <div key={idx} className="flex-1 flex flex-col items-center justify-end h-full gap-1 group z-10">
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity absolute -top-8 bg-gray-800 text-white text-[10px] p-2 rounded pointer-events-none z-20 whitespace-nowrap shadow-lg">
                      <span className="font-bold">{item.dateStr}</span> ({item.dayLabel})<br/>
                      出席: <span className="text-blue-300">{item.rawAttendance}名</span> ({item.attendanceRate}%)<br/>
                      ログ: <span className="text-green-300">{item.rawLogin}名</span> ({item.loginRate}%)
                    </div>
                    <div className="w-2.5 sm:w-5 flex items-end gap-0.5 h-full">
                      <div className="w-full bg-blue-500 rounded-t-sm hover:bg-blue-600 transition-all duration-500 relative shadow-sm" style={{ height: `${item.attendanceRate}%` }}></div>
                      <div className="w-full bg-green-500 rounded-t-sm hover:bg-green-600 transition-all duration-500 relative shadow-sm -ml-full opacity-70" style={{ height: `${item.loginRate}%` }}></div>
                    </div>
                    <div className="text-[10px] font-bold text-gray-400 mt-1 text-center">{item.dayLabel}</div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* クイックアクション */}
          <div className="bg-slate-900 rounded-2xl shadow-lg text-white p-6 relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl -mr-16 -mt-16"></div>
            
            <div className="flex justify-between items-center mb-4 relative z-10">
              <h2 className="font-bold text-lg flex items-center gap-2">
                <Sparkles size={20} className="text-yellow-400"/> クイックアクション
              </h2>
              <button 
                onClick={() => setIsCustomizedModalOpen(true)}
                className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded-lg flex items-center gap-1 transition-colors"
              >
                <Edit3 size={12}/> カスタマイズ
              </button>
            </div>

            <div className="flex flex-wrap gap-3 relative z-10">
              {visibleQuickActions.map(path => {
                const action = visibleActions.find(a => a.id === path);
                if (!action) return null;
                const Icon = action.icon;
                return (
                  <Link 
                    key={path}
                    href={path} 
                    className="bg-white/10 hover:bg-white/20 backdrop-blur-sm border border-white/10 px-5 py-3 rounded-xl text-xs font-bold flex items-center gap-2 transition-all hover:scale-105 active:scale-95"
                  >
                    <Icon size={16}/> {action.title}
                  </Link>
                );
              })}
              
              {visibleQuickActions.length === 0 && (
                <button onClick={() => setIsCustomizedModalOpen(true)} className="text-slate-500 text-sm border border-dashed border-slate-700 px-4 py-2 rounded-xl hover:border-slate-500 hover:text-slate-300">
                  + アクションを追加
                </button>
              )}
            </div>
          </div>
        </div>

        {/* --- 右カラム (1/3) --- */}
        <div className="space-y-6">

          {/* 本日の講師配置 */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-5 border-b border-gray-100 bg-gradient-to-r from-indigo-50 to-blue-50">
              <h2 className="font-bold text-gray-800 flex items-center gap-2">
                <Briefcase className="text-indigo-500" size={20}/> 本日の講師配置
              </h2>
              <p className="text-[10px] text-gray-500 font-bold mt-1">シフト管理で登録された担当一覧</p>
            </div>
            <div className="divide-y divide-gray-50">
              {todayPlacements.length > 0 ? (
                todayPlacements.map(item => (
                  <div key={item.id} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-black text-gray-800 truncate">{item.teacher_name || '講師未設定'}</p>
                        <p className="mt-1 text-xs font-bold text-gray-500">
                          {item.note || '-'} {item.target_grade || ''} {item.target_subject || ''}{item.target_detail_subject ? `/${item.target_detail_subject}` : ''}
                        </p>
                        {item.target_place && <p className="mt-1 text-[10px] font-bold text-indigo-500">{item.target_place}</p>}
                      </div>
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black ${
                        item.role_type === 'main' ? 'bg-indigo-100 text-indigo-700' :
                        item.role_type === 'sub' ? 'bg-emerald-100 text-emerald-700' :
                        'bg-slate-100 text-slate-500'
                      }`}>
                        {item.role_type === 'main' ? '担当' : item.role_type === 'sub' ? '補助' : '全体'}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-8 text-center">
                  <div className="bg-slate-50 w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-2 text-slate-300">
                    <Briefcase size={22}/>
                  </div>
                  <p className="text-xs font-bold text-slate-400">本日の講師配置はまだありません</p>
                  <Link href="/master/shifts" className="mt-3 inline-flex items-center gap-1 rounded-xl bg-slate-900 px-3 py-2 text-xs font-black text-white">
                    シフト管理へ <ArrowRight size={12} />
                  </Link>
                </div>
              )}
            </div>
          </div>

          {/* 運営インサイト (修正済み) */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-5 border-b border-gray-100 bg-gradient-to-r from-orange-50 to-orange-100/50">
              <h2 className="font-bold text-gray-800 flex items-center gap-2">
                <CheckSquare className="text-orange-500" size={20}/> 運営インサイト
              </h2>
              <p className="text-[10px] text-gray-500 font-bold mt-1">アクションが必要な項目</p>
            </div>
            <div className="p-0 divide-y divide-gray-50">
              
              {/* 1. 未承認のコミュニティ投稿 */}
              {pendingCommunityCount > 0 && (
                <Link href="/master/community" className="block p-4 hover:bg-pink-50/50 transition-colors group">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="bg-pink-100 text-pink-500 p-2 rounded-lg relative">
                        <MessageCircle size={18}/>
                        <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-white"></span>
                      </div>
                      <div>
                        <p className="text-xs font-bold text-pink-600">投稿承認待ち</p>
                        <p className="text-sm font-bold text-gray-800">{pendingCommunityCount}件の投稿が確認待ちです</p>
                      </div>
                    </div>
                    <ArrowRight size={16} className="text-gray-300 group-hover:text-pink-400 transition-colors"/>
                  </div>
                </Link>
              )}

              {/* 2. 退塾リスク警告 */}
              {stats.alertCount > 0 && (
                <Link href="/master/stats" className="block p-4 hover:bg-red-50/50 transition-colors group">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="bg-red-100 text-red-500 p-2 rounded-lg"><AlertTriangle size={18}/></div>
                      <div>
                        <p className="text-xs font-bold text-red-600">退塾リスク警告</p>
                        <p className="text-sm font-bold text-gray-800">{stats.alertCount}名の生徒が要注意です</p>
                      </div>
                    </div>
                    <ArrowRight size={16} className="text-gray-300 group-hover:text-red-400 transition-colors"/>
                  </div>
                </Link>
              )}

              {/* 3. 録画承認待ち (Zoom連携があるもの) */}
              {recordingCheckCount > 0 && (
                <Link href="/master/recordings" className="block p-4 hover:bg-blue-50/50 transition-colors group">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="bg-blue-100 text-blue-500 p-2 rounded-lg"><Video size={18}/></div>
                      <div>
                        <p className="text-xs font-bold text-blue-600">録画の確認</p>
                        <p className="text-sm font-bold text-gray-800">Zoom連携データを確認してください</p>
                      </div>
                    </div>
                    <ArrowRight size={16} className="text-gray-300 group-hover:text-blue-400 transition-colors"/>
                  </div>
                </Link>
              )}

              {/* アラートなしの場合 */}
              {pendingCommunityCount === 0 && stats.alertCount === 0 && recordingCheckCount === 0 && (
                <div className="p-8 text-center">
                  <div className="bg-green-50 w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-2 text-green-500">
                    <Check size={24}/>
                  </div>
                  <p className="text-xs font-bold text-green-600">現在、緊急のアラートはありません</p>
                  <p className="text-[10px] text-gray-400 mt-1">すべて正常に稼働しています</p>
                </div>
              )}
            </div>
          </div>

          {/* リアルタイム生徒 */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden min-h-[300px]">
            <div className="p-5 border-b border-gray-100 flex justify-between items-center">
              <h2 className="font-bold text-gray-700 flex items-center gap-2">
                <MonitorPlay className="text-indigo-500" size={20}/> リアルタイム生徒
              </h2>
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
              </span>
            </div>
            <div className="p-4 space-y-3">
              {activeStudents.length > 0 ? (
                activeStudents.map((student) => (
                  <div key={student.id} className="flex items-center justify-between p-3 rounded-xl bg-gray-50 border border-gray-100 animate-in slide-in-from-right-2 duration-300">
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center text-sm font-bold text-gray-600 shadow-sm border border-gray-200">
                          {student.avatar || student.name.charAt(0)}
                        </div>
                        <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-white rounded-full"></div>
                      </div>
                      <div>
                        <p className="text-sm font-bold text-gray-800">{student.name}</p>
                        <p className="text-[10px] text-gray-400 font-mono">最終: {student.lastActivity}</p>
                      </div>
                    </div>
                    <span className="text-[10px] font-bold bg-green-100 text-green-600 px-2 py-0.5 rounded-full">Online</span>
                  </div>
                ))
              ) : (
                <div className="text-center py-12 text-gray-400 text-xs">
                  <div className="bg-gray-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-3"><Users size={24} className="opacity-20"/></div>
                  現在オンラインの生徒はいません
                </div>
              )}
            </div>
          </div>

        </div>
      </div>

      {/* カスタマイズモーダル */}
      {isCustomizedModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-5 border-b border-gray-100 flex justify-between items-center">
              <h3 className="font-bold text-lg text-gray-800">クイックアクション設定</h3>
              <button onClick={() => setIsCustomizedModalOpen(false)} className="p-1 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600"><X size={20}/></button>
            </div>
            <div className="p-5 max-h-[60vh] overflow-y-auto">
              <p className="text-xs text-gray-500 mb-4 font-bold">よく使う機能を最大6個まで選択してください</p>
              <div className="grid grid-cols-2 gap-3">
                {visibleActions.map(action => {
                  const isSelected = quickActions.includes(action.id);
                  const Icon = action.icon;
                  return (
                    <button
                      key={action.id}
                      onClick={() => toggleActionSelection(action.id)}
                      className={`
                        flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-all
                        ${isSelected 
                          ? 'border-indigo-500 bg-indigo-50 text-indigo-700' 
                          : 'border-gray-100 hover:border-gray-200 text-gray-600'
                        }
                      `}
                    >
                      <div className={`p-2 rounded-lg ${isSelected ? 'bg-indigo-100 text-indigo-600' : 'bg-gray-100 text-gray-400'}`}>
                        <Icon size={18} />
                      </div>
                      <span className="text-xs font-bold flex-1">{action.title}</span>
                      {isSelected && <Check size={16} className="text-indigo-600"/>}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="p-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-3">
              <button onClick={() => setIsCustomizedModalOpen(false)} className="px-4 py-2 text-xs font-bold text-gray-500 hover:bg-gray-200 rounded-lg">キャンセル</button>
              <button onClick={() => saveQuickActions(quickActions)} className="px-6 py-2 text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg shadow-sm">保存する</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
