'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowLeft, BarChart3, BookCheck, CalendarDays, CheckCircle2, ClipboardCheck, RefreshCw, Search, School, Users } from 'lucide-react';
import { Button, ErrorState, ListSkeleton, buttonClass } from '@/app/components/ui';
import AdminTabs from '@/app/components/master/AdminTabs';
import { formatShortDate } from '@/lib/format';
import { auth } from '@/lib/firebase';
import PfMonoxerImportPanel from '@/app/components/PfMonoxerImportPanel';
import ParentHomeworkView from '@/app/components/parent/ParentHomeworkView';
import AdminPageHeader from '@/app/components/master/AdminPageHeader';
import { useAuth } from '@/app/context/AuthContext';
import { jstTodayKey } from '@/lib/lesson-deadline';

type Audience = 'admin' | 'teacher' | 'parent';
type StudentMetric = {
  id: string;
  student_name: string;
  lifetime_id: string;
  grade: string;
  school: string;
  attendance_present: number;
  attendance_absent: number;
  attendance_late: number;
  attendance_total: number;
  attendance_rate: number | null;
  homework_completed: number;
  homework_total: number;
  homework_rate: number | null;
  quiz_completed: number;
  quiz_total: number;
  quiz_rate: number | null;
  quiz_average_score: number | null;
  alert_count: number;
  /** Monoxer 宿題回数ログ（累計）から出した、この期間の宿題の学習回数 */
  study?: {
    measured: boolean;
    period_count: number | null;
    books_studied: number | null;
    total_count: number | null;
    last_snapshot_date: string | null;
    previous_snapshot_date: string | null;
    books?: Array<{ book_id: string; name: string; count: number; gained: number | null }>;
  };
};

type DashboardData = {
  range: { start: string; end: string; label: string };
  schools: string[];
  classes: Array<{ key: string; label: string; grade: string; subject: string; school: string }>;
  students: StudentMetric[];
  summary: {
    student_count: number; attendance_rate: number | null; homework_rate: number | null; quiz_rate: number | null; alert_count: number;
    study_measured_students?: number; study_active_rate?: number | null; study_period_count?: number | null;
  };
};

const audienceText = {
  admin: { title: 'PF 学習状況ダッシュボード', subtitle: '校舎・週次・月次で、出席・宿題・小テストをまとめて確認', back: '/master' },
  teacher: { title: '担当クラス PF', subtitle: '担当クラスの出欠とMonoxer学習状況を、要確認の生徒から確認', back: '/teacher/work' },
  parent: { title: '宿題・小テストの状況', subtitle: '出席・宿題提出・小テストの状況をまとめて確認', back: '/parent/pf' },
} as const;

const displayRate = (value: number | null) => value === null ? '―' : `${value}%`;
const rateColor = (value: number | null) => value === null ? 'text-slate-400' : value >= 80 ? 'text-emerald-600' : value >= 70 ? 'text-amber-600' : 'text-rose-600';

function SummaryCard({ label, value, detail, icon, color }: { label: string; value: string; detail: string; icon: React.ReactNode; color: string }) {
  return (
    <div className="rounded-card border border-line bg-surface p-5 shadow-card">
      <div className={`flex h-10 w-10 items-center justify-center rounded-btn ${color}`}>{icon}</div>
      <p className="mt-4 text-xs font-bold text-slate-500">{label}</p>
      <p className="mt-1 text-3xl font-black tracking-tight text-slate-900">{value}</p>
      <p className="mt-1 text-xs font-medium text-slate-400">{detail}</p>
    </div>
  );
}

function ProgressCell({ value, completed, total, label }: { value: number | null; completed: number; total: number; label: string }) {
  return (
    <div className="min-w-[130px]">
      <div className="flex items-center justify-between gap-2">
        <span className={`text-sm font-bold ${rateColor(value)}`}>{displayRate(value)}</span>
        <span className="text-xs font-medium text-slate-400">{completed}/{total}</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${value === null ? 'bg-slate-200' : value >= 80 ? 'bg-emerald-500' : value >= 70 ? 'bg-amber-500' : 'bg-rose-500'}`} style={{ width: `${value ?? 0}%` }} />
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
}

function StudyCell({ study }: { study: NonNullable<StudentMetric['study']> }) {
  return (
    <div className="min-w-[130px]">
      {study.measured
        ? <span className={`text-sm font-bold ${study.period_count ? 'text-emerald-600' : 'text-rose-600'}`}>+{study.period_count}回</span>
        : <span className="text-xs font-bold text-slate-400">前回の取込なし</span>}
      <p className="mt-1 text-xs font-medium text-slate-400">累計 {study.total_count}回{study.last_snapshot_date ? `（${formatShortDate(study.last_snapshot_date)}時点）` : ''}</p>
    </div>
  );
}

type PfProgressDashboardProps = {
  audience: Audience;
  schoolDashboard?: boolean;
  /** 管理画面のレイアウト内に埋め込む（外枠・背景・戻るボタンを出さず、共通見出しを使う）。 */
  embedded?: boolean;
  /** Monoxer/PF 取込パネルを表示する（schoolDashboard でも表示）。 */
  showImportPanel?: boolean;
};

/** 保護者には管理用の表ではなく、お子さまごとのカード表示（ParentHomeworkView）を出す。 */
export default function PfProgressDashboard(props: PfProgressDashboardProps) {
  if (props.audience === 'parent') return <ParentHomeworkView />;
  return <StaffPfProgressDashboard {...props} />;
}

function StaffPfProgressDashboard({
  audience,
  schoolDashboard = false,
  embedded = false,
  showImportPanel = false,
}: PfProgressDashboardProps) {
  const copy = schoolDashboard
    ? { title: '校舎運営ダッシュボード', subtitle: '自校舎の授業参加・宿題提出・小テスト実施を、要確認の生徒から確認', back: '/master' }
    : audienceText[audience];
  const { user, loading: authLoading } = useAuth();
  const [period, setPeriod] = useState<'week' | 'month'>('week');
  const [anchor, setAnchor] = useState(() => jstTodayKey());
  const [school, setSchool] = useState('');
  const [studentId, setStudentId] = useState('');
  const [search, setSearch] = useState('');
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [parentStudents, setParentStudents] = useState<Array<{ id: string; student_name: string }>>([]);

  const load = useCallback(async () => {
    const currentUser = user || auth.currentUser;
    if (!currentUser) {
      if (!authLoading) {
        setError('ログイン情報を確認できませんでした。');
        setLoading(false);
      }
      return;
    }
    setLoading(true);
    setError('');
    try {
      const token = await currentUser.getIdToken();
      const params = new URLSearchParams({ period, anchor });
      if (school) params.set('school', school);
      if (studentId) params.set('student_id', studentId);
      const response = await fetch(`/api/pf/dashboard?${params}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'PFデータの取得に失敗しました');
      setData(payload);
      if (audience === 'parent' && !studentId) {
        setParentStudents((payload.students || []).map((student: StudentMetric) => ({ id: student.id, student_name: student.student_name })));
      }
    } catch (loadError) {
      console.error(loadError);
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [user, authLoading, period, anchor, school, studentId, refreshKey, audience]);

  useEffect(() => { load(); }, [load]);

  const students = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return [...(data?.students || [])]
      .filter(student => !keyword || [student.student_name, student.lifetime_id, student.grade, student.school].some(value => String(value || '').toLowerCase().includes(keyword)))
      .sort((a, b) => b.alert_count - a.alert_count || (a.attendance_rate ?? 101) - (b.attendance_rate ?? 101) || a.student_name.localeCompare(b.student_name, 'ja'));
  }, [data?.students, search]);

  return (
    <div className={embedded ? 'text-slate-800' : 'min-h-screen bg-slate-50 px-4 py-5 text-slate-800 sm:px-6 lg:px-8'}>
      <div className={embedded ? 'space-y-5' : 'mx-auto max-w-7xl space-y-5'}>
        {embedded ? <>
          <AdminPageHeader
            description={copy.subtitle}
            actions={<Button variant="secondary" onClick={() => setRefreshKey(value => value + 1)} loading={loading} icon={<RefreshCw size={16} aria-hidden />}>再読み込み</Button>}
          />
          <div className="flex flex-wrap items-center gap-3">
            <AdminTabs size="sm" ariaLabel="集計の単位" value={period} onChange={setPeriod} tabs={[{ id: 'week', label: '週次' }, { id: 'month', label: '月次' }]} />
            <label className="flex min-h-10 items-center gap-2 rounded-input border border-line bg-surface px-4 py-2"><CalendarDays size={16} className="text-accent" aria-hidden /><input type="date" aria-label="集計の基準日" value={anchor} onChange={event => setAnchor(event.target.value)} className="bg-transparent text-xs font-bold text-slate-700 outline-none" /></label>
            {audience === 'admin' && data && data.schools.length > 1 && <label className="flex min-h-10 items-center gap-2 rounded-input border border-line bg-surface px-4 py-2"><School size={16} className="text-accent" aria-hidden /><select aria-label="校舎" value={school} onChange={event => setSchool(event.target.value)} className="bg-surface text-xs font-bold text-slate-700 outline-none"><option value="">全校舎</option>{data.schools.map(value => <option key={value}>{value}</option>)}</select></label>}
            {data?.range && <span className="rounded-full bg-accent-soft px-4 py-2 text-xs font-bold text-accent">集計期間 {data.range.label}</span>}
          </div>
        </> : (
          <header className="overflow-hidden rounded-hero bg-slate-950 p-6 text-white shadow-xl sm:p-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-4">
                <Link href={copy.back} aria-label="戻る" title="戻る" className="mt-1 rounded-btn bg-white/10 p-2.5 hover:bg-white/20"><ArrowLeft size={20} aria-hidden /></Link>
                <div>
                  <div className="flex items-center gap-2 text-indigo-300"><BarChart3 size={18} /><span className="text-xs font-bold uppercase tracking-[0.18em]">Progress Follow-up</span></div>
                  <h1 className="mt-2 text-2xl font-black sm:text-3xl">{copy.title}</h1>
                  <p className="mt-2 max-w-2xl text-sm font-bold text-slate-300">{copy.subtitle}</p>
                </div>
              </div>
              <button type="button" onClick={() => setRefreshKey(value => value + 1)} className="inline-flex min-h-10 items-center gap-2 rounded-btn bg-white/10 px-4 py-2 text-xs font-bold hover:bg-white/20"><RefreshCw size={15} aria-hidden /> 再読み込み</button>
            </div>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <div className="flex rounded-2xl bg-white/10 p-1">
                {(['week', 'month'] as const).map(value => <button key={value} type="button" onClick={() => setPeriod(value)} className={`rounded-xl px-5 py-2 text-xs font-bold ${period === value ? 'bg-white text-slate-900' : 'text-slate-300'}`}>{value === 'week' ? '週次' : '月次'}</button>)}
              </div>
              <label className="flex items-center gap-2 rounded-2xl bg-white/10 px-4 py-2"><CalendarDays size={16} className="text-indigo-300" /><input type="date" value={anchor} onChange={event => setAnchor(event.target.value)} className="bg-transparent text-xs font-bold text-white outline-none [color-scheme:dark]" /></label>
              {audience === 'admin' && data && data.schools.length > 1 && <label className="flex items-center gap-2 rounded-2xl bg-white/10 px-4 py-2"><School size={16} className="text-indigo-300" /><select value={school} onChange={event => setSchool(event.target.value)} className="bg-slate-900 text-xs font-bold text-white outline-none"><option value="">全校舎</option>{data.schools.map(value => <option key={value}>{value}</option>)}</select></label>}
              {audience === 'parent' && parentStudents.length > 1 && <select value={studentId} onChange={event => setStudentId(event.target.value)} className="rounded-2xl bg-white/10 px-4 py-2 text-xs font-bold text-white outline-none"><option value="">全員</option>{parentStudents.map(student => <option className="text-slate-900" key={student.id} value={student.id}>{student.student_name}</option>)}</select>}
              {data?.range && <span className="rounded-full bg-indigo-500/20 px-4 py-2 text-xs font-bold text-indigo-100">集計期間 {data.range.label}</span>}
            </div>
          </header>
        )}

        {((audience === 'admin' && !schoolDashboard) || showImportPanel) && <PfMonoxerImportPanel onImported={() => setRefreshKey(value => value + 1)} />}

        {error && <ErrorState message={error} onRetry={() => setRefreshKey(value => value + 1)} />}
        {loading ? <ListSkeleton rows={5} /> : data && <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <SummaryCard label={schoolDashboard ? '確認対象の生徒' : '対象生徒'} value={`${data.summary.student_count}名`} detail={schoolDashboard ? '自校舎の生徒' : audience === 'teacher' ? '担当クラスの対象者' : '現在の表示範囲'} icon={<Users size={20} />} color="bg-slate-100 text-slate-700" />
            <SummaryCard label={schoolDashboard ? '授業参加率' : '出席率'} value={displayRate(data.summary.attendance_rate)} detail="遅刻は参加として集計" icon={<CheckCircle2 size={20} />} color="bg-sky-50 text-sky-600" />
            {data.summary.study_measured_students
              ? <SummaryCard label="宿題に取り組んだ生徒" value={displayRate(data.summary.study_active_rate ?? null)} detail={`Monoxer学習回数 期間合計 +${data.summary.study_period_count ?? 0}回`} icon={<BookCheck size={20} />} color="bg-emerald-50 text-emerald-600" />
              : <SummaryCard label="宿題提出率" value={displayRate(data.summary.homework_rate)} detail="Monoxer CSV集計（回数ログは2回目の取込から集計）" icon={<BookCheck size={20} />} color="bg-emerald-50 text-emerald-600" />}
            <SummaryCard label="小テスト実施率" value={displayRate(data.summary.quiz_rate)} detail="Monoxer CSV集計" icon={<ClipboardCheck size={20} />} color="bg-accent-soft text-accent" />
            <SummaryCard label="要確認" value={`${data.summary.alert_count}件`} detail="基準未満の項目数" icon={<AlertTriangle size={20} />} color="bg-rose-50 text-rose-600" />
          </section>

          {schoolDashboard ? <section className="grid gap-3 sm:grid-cols-3">
            <Link href="/master/school-students" className={buttonClass('secondary', 'lg', 'justify-start')}>校舎別生徒管理を見る</Link>
            <Link href="/master/monthly-schedules" className={buttonClass('secondary', 'lg', 'justify-start')}>月間予定を見る</Link>
            <Link href="/master/shifts" className={buttonClass('secondary', 'lg', 'justify-start')}>シフト配置を見る</Link>
          </section> : null}

          {audience === 'teacher' && data.classes.length > 0 && <section className="rounded-card border border-line bg-surface p-5 shadow-card"><h2 className="text-sm font-bold text-slate-800">今週の担当クラス</h2><div className="mt-3 flex flex-wrap gap-2">{data.classes.map(item => <span key={item.key} className="rounded-full bg-accent-soft px-3 py-2 text-xs font-bold text-accent">{item.label}</span>)}</div></section>}

          <section className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5">
              <div><h2 className="text-base font-bold">生徒別状況</h2><p className="mt-1 text-xs font-medium text-slate-500">要確認の項目がある生徒を上位に表示します。</p></div>
              <label className="flex min-h-10 items-center gap-2 rounded-input border border-line bg-surface px-4 py-2 focus-within:border-accent"><Search size={16} className="text-slate-400" aria-hidden /><input aria-label="生徒を検索" value={search} onChange={event => setSearch(event.target.value)} placeholder="氏名・ID・校舎" className="w-40 bg-transparent text-xs font-bold outline-none" /></label>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-left">
                <thead className="bg-slate-50 text-xs font-bold text-slate-500"><tr><th className="px-5 py-4">生徒</th><th className="px-4 py-4">出欠</th><th className="px-4 py-4">出席率</th><th className="px-4 py-4">宿題（Monoxer）</th><th className="px-4 py-4">小テスト実施率</th><th className="px-4 py-4">平均得点</th><th className="px-4 py-4 text-center">確認</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {students.map(student => <tr key={student.id} className={student.alert_count ? 'bg-rose-50/30' : 'hover:bg-slate-50'}>
                    <td className="px-5 py-4"><p className="font-bold text-slate-900">{student.student_name}</p><p className="mt-1 text-xs font-medium text-slate-400">{[student.school, student.grade, student.lifetime_id].filter(Boolean).join(' / ')}</p></td>
                    <td className="px-4 py-4 text-xs font-bold"><span className="text-sky-600">出 {student.attendance_present}</span><span className="ml-3 text-amber-600">遅 {student.attendance_late}</span><span className="ml-3 text-rose-600">欠 {student.attendance_absent}</span></td>
                    <td className="px-4 py-4"><ProgressCell value={student.attendance_rate} completed={student.attendance_present + student.attendance_late} total={student.attendance_total} label="出席率" /></td>
                    <td className="px-4 py-4">{student.study && student.study.total_count !== null
                      ? <StudyCell study={student.study} />
                      : <ProgressCell value={student.homework_rate} completed={student.homework_completed} total={student.homework_total} label="宿題提出率" />}</td>
                    <td className="px-4 py-4"><ProgressCell value={student.quiz_rate} completed={student.quiz_completed} total={student.quiz_total} label="小テスト実施率" /></td>
                    <td className={`px-4 py-4 text-sm font-bold ${rateColor(student.quiz_average_score)}`}>{displayRate(student.quiz_average_score)}</td>
                    <td className="px-4 py-4 text-center">{student.alert_count ? <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-3 py-1 text-xs font-bold text-rose-600"><AlertTriangle size={13} aria-hidden /> {student.alert_count}</span> : <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600"><CheckCircle2 size={14} aria-hidden /> 良好</span>}</td>
                  </tr>)}
                  {students.length === 0 && <tr><td colSpan={7} className="px-5 py-16 text-center text-sm font-bold text-slate-500">この期間の対象データはありません。<span className="mt-1 block text-xs font-medium text-slate-400">期間や校舎、検索の条件を変えてみてください。</span></td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </>}
      </div>
    </div>
  );
}
