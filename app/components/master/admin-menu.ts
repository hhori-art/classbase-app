import {
  Activity, AlertTriangle, Archive, BarChart2, Bell, BookOpen, BookOpenCheck, Briefcase, Calendar, CalendarRange,
  CheckSquare, ClipboardList, Clock, Database, DollarSign, FileText, GraduationCap, History, Home, Inbox, KeyRound, Languages,
  ListChecks, Megaphone, Palette, MessageCircle, Printer, Send, Settings, ShieldCheck, ShoppingBag, Sparkles, Train, UserSearch, UsersRound, Video,
  type LucideIcon, MessageSquareWarning } from 'lucide-react';
import {
  hasAdminAppPermission,
  isConfigurableAdminRole,
  isMasterOnlyAdminPath,
  isSchoolAdminAllowedPath,
  type AdminAppId,
} from '@/lib/admin-app-permissions';
import { isDedicatedAttendanceApproverProfile } from '@/lib/employment-category';

// 管理画面のメニュー定義。サイドバーとホームの両方で使う。
// 表示はページの場所ではなく「ログイン中の権限」だけで決める（ページを移っても項目が増減しない）。

export type AdminMenuItem = {
  /** portal_visibility.admin のキー（設定画面で個別に非表示にできる）。 */
  key: string;
  title: string;
  description: string;
  icon: LucideIcon;
  href: string;
  /** global は権限に関係なく表示。 */
  app: AdminAppId | 'global';
  /** サイドバーに対応待ちの件数を出す項目（/api/admin/inbox-counts のキー）。 */
  badgeKey?: AdminBadgeKey;
};

/** サイドバーに件数を出すキー。 */
export type AdminBadgeKey = 'parentInquiries' | 'requests' | 'safetyAlerts' | 'detailApprovals' | 'passwordRecovery';

export type AdminMenuSection = {
  id: string;
  title: string;
  icon: LucideIcon;
  /** ホーム画面のカードの色。 */
  tone: 'indigo' | 'sky' | 'emerald' | 'amber' | 'violet' | 'rose' | 'slate';
  items: AdminMenuItem[];
};

export const ADMIN_MENU: AdminMenuSection[] = [
  {
    id: 'home', title: 'ホーム', icon: Home, tone: 'slate',
    items: [
      { key: 'dashboard', title: 'ホーム', description: '使える管理機能の一覧', icon: Home, href: '/master', app: 'global' },
      { key: 'attendanceApprovalReturn', title: '勤怠承認へ戻る', description: '講師画面の勤怠承認', icon: CheckSquare, href: '/teacher/attendance-approvals', app: 'global' },
      { key: 'notifications', title: '自分への通知', description: '自分宛ての通知を確認', icon: Bell, href: '/master/notifications', app: 'global' },
      { key: 'manual', title: '操作マニュアル', description: 'この権限で使う手順', icon: BookOpen, href: '/manual', app: 'global' },
    ],
  },
  {
    id: 'accounts', title: 'アカウント', icon: ShieldCheck, tone: 'slate',
    items: [
      { key: 'accountManagement', title: '校舎別アカウント管理', description: '全ロールの作成・状態・パスワード', icon: UsersRound, href: '/master/accounts/sso', app: 'global' },
      { key: 'idSheets', title: 'ID書面・印刷', description: '講師・管理者の一括登録と書面印刷', icon: Printer, href: '/master/users', app: 'global' },
      { key: 'accessControl', title: '管理者の権限設定', description: '管理アプリごとの利用権限', icon: ShieldCheck, href: '/master/access-control', app: 'global' },
      { key: 'passwordRecovery', title: 'パスワード再設定の依頼', description: 'メールを使えない人の再設定', icon: KeyRound, href: '/master/accounts/recovery', app: 'global', badgeKey: 'passwordRecovery' },
      { key: 'archive', title: '利用停止・アーカイブ', description: '退塾・退職者をまとめて停止', icon: Archive, href: '/master/delete', app: 'global' },
    ],
  },
  {
    id: 'science_social', title: '理社講座', icon: GraduationCap, tone: 'indigo',
    items: [
      { key: 'scienceSocialHome', title: 'ダッシュボード', description: '参加率・提出率と要確認の生徒', icon: Activity, href: '/master/science-social', app: 'science_social' },
      { key: 'studentOverview', title: '生徒の総合ページ', description: '生徒を検索して状況を1画面で確認', icon: UserSearch, href: '/master/students', app: 'science_social' },
      { key: 'schoolStudents', title: '校舎別 生徒管理', description: '生徒の登録・CSV取込・ID書面', icon: GraduationCap, href: '/master/school-students', app: 'science_social' },
      { key: 'monthlySchedules', title: '月間予定', description: '授業日・休講日・行事', icon: Calendar, href: '/master/monthly-schedules', app: 'science_social' },
      { key: 'shifts', title: 'シフト配置・提出確認', description: '講師の配置とZoom', icon: CalendarRange, href: '/master/shifts', app: 'science_social' },
      { key: 'substitutions', title: '代行依頼', description: '代行の募集と締切', icon: Megaphone, href: '/master/substitutions', app: 'science_social' },
      { key: 'registrationTasks', title: '受講登録の依頼', description: '保護者への講座登録依頼', icon: ClipboardList, href: '/master/registration-tasks', app: 'science_social' },
      { key: 'courseAllocation', title: '講座割当の確認', description: '配置とZoomの準備状況', icon: ListChecks, href: '/master/course-allocation', app: 'science_social' },
      { key: 'curriculum', title: 'カリキュラム', description: 'タームと単元', icon: BookOpen, href: '/master/curriculum', app: 'science_social' },
      { key: 'reviewPeriods', title: 'テスト対策（復習期間）', description: '期間・単元・対策講座の受講登録', icon: BookOpenCheck, href: '/master/review-periods', app: 'science_social' },
      { key: 'recordings', title: '授業録画', description: '録画の承認・公開', icon: Video, href: '/master/recordings', app: 'science_social' },
      { key: 'lessonLanguage', title: '授業の発言チェック', description: '文字起こしからNGワードを検知', icon: MessageSquareWarning, href: '/master/lesson-language', app: 'science_social' },
      { key: 'slides', title: '授業スライド', description: 'スライドとAIクエスト', icon: FileText, href: '/master/slides', app: 'science_social' },
      { key: 'rewards', title: 'コイン・景品', description: 'コイン・景品・ガチャ・発送', icon: ShoppingBag, href: '/master/rewards', app: 'science_social' },
      { key: 'stats', title: '講座運用分析', description: '開始率・退会率・レポート送信', icon: BarChart2, href: '/master/stats', app: 'science_social' },
    ],
  },
  {
    id: 'contact', title: '連絡・申請', icon: MessageCircle, tone: 'sky',
    items: [
      { key: 'inbox', title: '対応待ち', description: '連絡・申請・アラートなどをまとめて確認', icon: Inbox, href: '/master/inbox', app: 'global' },
      { key: 'announcements', title: 'お知らせ配信', description: 'アプリ内のお知らせ掲示', icon: Megaphone, href: '/master/announcements', app: 'science_social' },
      { key: 'line', title: '通知を送る', description: 'LINE・アプリ内・メールで個別送信', icon: Send, href: '/master/line', app: 'science_social' },
      { key: 'parentInquiries', title: '教室への連絡', description: '保護者からの連絡と返信', icon: MessageCircle, href: '/master/parent-inquiries', app: 'science_social', badgeKey: 'parentInquiries' },
      { key: 'safetyAlerts', title: 'AIチャット安全アラート', description: '自傷・いじめ等の心配な会話の対応', icon: AlertTriangle, href: '/master/safety-alerts', app: 'science_social', badgeKey: 'safetyAlerts' },
      { key: 'requests', title: '生徒・保護者からの申請', description: '欠席・振替・変更の対応', icon: CheckSquare, href: '/master/requests', app: 'science_social', badgeKey: 'requests' },
      { key: 'community', title: '交流掲示板', description: '投稿の確認・非表示', icon: MessageCircle, href: '/master/community', app: 'science_social' },
    ],
  },
  {
    id: 'eiken', title: 'Booster', icon: Languages, tone: 'emerald',
    items: [
      { key: 'eiken', title: 'Booster 管理', description: '英検講座・課題・LIVE授業', icon: Languages, href: '/master/eiken', app: 'eiken' },
    ],
  },
  {
    id: 'online_school', title: 'オンライン校', icon: Sparkles, tone: 'violet',
    items: [
      { key: 'onlineSchool', title: 'オンライン校 管理', description: '10分学習の実施状況・問題', icon: Sparkles, href: '/master/online-school', app: 'online_school' },
    ],
  },
  {
    id: 'attendance', title: '勤怠', icon: Briefcase, tone: 'amber',
    items: [
      { key: 'detailApprovals', title: '勤務実績の承認', description: '実績と打刻修正の承認', icon: CheckSquare, href: '/master/attendance-approvals', app: 'attendance', badgeKey: 'detailApprovals' },
      { key: 'attendance', title: '勤怠一覧・集計', description: '勤務記録の検索・修正・出力', icon: Briefcase, href: '/master/attendance', app: 'attendance' },
      { key: 'attendancePayroll', title: '給与計算・勤怠出力', description: '給与計算とCSV出力', icon: DollarSign, href: '/master/attendance/payroll', app: 'attendance' },
      { key: 'commuterPasses', title: '講師の通勤定期', description: '定期の確認・更新・削除', icon: Train, href: '/master/attendance/commuter-passes', app: 'attendance' },
      { key: 'attendanceDiagnostics', title: '勤怠ミス候補', description: 'シフトと打刻の不一致', icon: AlertTriangle, href: '/master/attendance/diagnostics', app: 'attendance' },
      { key: 'dedicatedClaims', title: '専任の勤怠', description: '時間外の予定・報告・月の報告書・講習の授業の承認', icon: Clock, href: '/master/attendance/dedicated', app: 'attendance' },
      { key: 'employeeLessons', title: '専任の授業実績', description: '専任の授業実績を入力', icon: BookOpen, href: '/master/attendance/employee-lessons', app: 'attendance' },
      { key: 'attendanceInsights', title: '勤務実態分析', description: '曜日・職員ごとの勤務時間', icon: BarChart2, href: '/master/attendance/insights', app: 'attendance' },
      { key: 'attendanceSettings', title: '勤怠の設定', description: '交通費マスタ・給与の単価と割増', icon: Settings, href: '/master/attendance/settings', app: 'attendance' },
    ],
  },
  {
    // 設定は「使う管理者」ごとに分ける：理社講座の設定は理社講座の権限、勤怠の設定は勤怠セクション、全体の設定はマスターだけ。
    id: 'settings', title: '理社講座の設定・データ', icon: Settings, tone: 'slate',
    items: [
      { key: 'imports', title: 'CSV一括登録', description: 'PF・シフト・予定・カリキュラム・スライドの取込', icon: Database, href: '/master/imports', app: 'science_social' },
      { key: 'surveySettings', title: 'アンケート設定', description: '授業後アンケート', icon: ListChecks, href: '/master/survey-settings', app: 'science_social' },
    ],
  },
  {
    id: 'system', title: 'システム設定（マスター）', icon: ShieldCheck, tone: 'slate',
    items: [
      { key: 'settings', title: 'システム設定', description: 'Zoom・授業ボタン・表示・通知チャネル・メンテナンス', icon: Settings, href: '/master/settings', app: 'global' },
      { key: 'auditLogs', title: '操作ログ', description: '管理者の重要な操作の記録', icon: History, href: '/master/audit-logs', app: 'global' },
      { key: 'uiGuide', title: 'UIガイド', description: '共通の色・形・文字・部品の見本', icon: Palette, href: '/master/ui-guide', app: 'global' },
    ],
  },
];

// 校舎管理者（理社講座）が使う項目。サーバー側の許可（SCHOOL_ADMIN_ALLOWED_PATHS）と合わせる。
const SCHOOL_ADMIN_KEYS = new Set(['dashboard', 'notifications', 'manual', 'scienceSocialHome', 'schoolStudents', 'monthlySchedules', 'shifts', 'rewards']);

export type AdminViewer = {
  isMaster: boolean;
  isSchoolAdmin: boolean;
  isDedicatedApprover: boolean;
  canUseShifts: boolean;
};

export function adminViewerOf(profile: Record<string, any> | null | undefined): AdminViewer {
  const role = profile?.role;
  const isMaster = role === 'master';
  const isDedicatedApprover = Boolean(profile && isDedicatedAttendanceApproverProfile(profile));
  return {
    isMaster,
    isSchoolAdmin: isConfigurableAdminRole(role) && !isMaster,
    isDedicatedApprover,
    canUseShifts: Boolean(profile && (hasAdminAppPermission(role, profile, 'science_social') || isDedicatedApprover)),
  };
}

/** ログイン中の権限で使えるメニューだけを返す（空のセクションは除く）。 */
export function visibleAdminMenu(profile: Record<string, any> | null | undefined, adminVisibility: Record<string, boolean | undefined> = {}) {
  if (!profile) return [];
  const viewer = adminViewerOf(profile);
  const canSee = (item: AdminMenuItem) => {
    if (item.key === 'attendanceApprovalReturn') return viewer.isDedicatedApprover;
    // 校舎管理者の制限は理社講座（と共通）の項目だけ。勤怠・Booster・オンライン校は付けた権限どおりに出す。
    if (viewer.isSchoolAdmin && item.app !== 'global' && item.app !== 'science_social') {
      return !isMasterOnlyAdminPath(item.href) && hasAdminAppPermission(profile.role, profile, item.app);
    }
    if (viewer.isSchoolAdmin) {
      if (!SCHOOL_ADMIN_KEYS.has(item.key)) return false;
      // 理社講座の権限を外した校舎管理者（勤怠だけ等）には、理社講座の画面を出さない（開くとホームへ戻されるため）。
      if (item.app === 'science_social' && !hasAdminAppPermission(profile.role, profile, 'science_social')) return false;
      if (item.href.startsWith('/master') && !isSchoolAdminAllowedPath(item.href)) return false;
      if (item.key === 'shifts' && !viewer.canUseShifts) return false;
      return item.app === 'global' || adminVisibility[item.key] !== false;
    }
    if (isMasterOnlyAdminPath(item.href) && !viewer.isMaster) return false;
    if (item.key === 'shifts') return viewer.canUseShifts;
    // 表示設定（portal_visibility.admin）は校舎管理者のメニューだけに使う。
    // 勤怠管理者などは「管理者の権限設定」で付けたアプリの項目をそのまま表示する。
    return item.app === 'global' || hasAdminAppPermission(profile.role, profile, item.app);
  };
  return ADMIN_MENU
    .map(section => ({ ...section, items: section.items.filter(canSee) }))
    .filter(section => section.items.length > 0);
}

/** 現在のパスに一番長く一致するメニュー項目の href。 */
export function activeAdminHref(sections: AdminMenuSection[], pathname: string) {
  return sections.flatMap(section => section.items)
    .filter(item => {
      const path = item.href.split('?')[0];
      return pathname === path || (path !== '/master' && pathname.startsWith(`${path}/`));
    })
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
}

/** パスに対応するメニュー項目とその分野（ページ見出しの既定値に使う）。完全一致がなければ一番長い前方一致の分野だけ返す。 */
export function adminMenuEntryForPath(pathname: string): { item?: AdminMenuItem; section?: AdminMenuSection } {
  const path = pathname.split('?')[0].replace(/\/$/, '') || '/';
  for (const section of ADMIN_MENU) {
    const item = section.items.find(entry => entry.href.split('?')[0] === path);
    if (item) return { item, section };
  }
  const prefix = ADMIN_MENU
    .flatMap(section => section.items.map(item => ({ item, section })))
    .filter(({ item }) => item.href !== '/master' && path.startsWith(`${item.href.split('?')[0]}/`))
    .sort((a, b) => b.item.href.length - a.item.href.length)[0];
  return prefix ? { section: prefix.section } : {};
}
