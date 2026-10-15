'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowLeft, BarChart3, BookCheck, CalendarDays, CheckCircle2, ClipboardCheck, Loader2, RefreshCw, Search, School, Users } from 'lucide-react';
import { auth } from '@/lib/firebase';
import PfMonoxerImportPanel from '@/app/components/PfMonoxerImportPanel';
import { useAuth } from '@/app/context/AuthContext';

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
};

type DashboardData = {
  range: { start: string; end: string; label: string };
  schools: string[];
  classes: Array<{ key: string; label: string; grade: string; subject: string; school: string }>;
  students: StudentMetric[];
  summary: { student_count: number; attendance_rate: number | null; homework_rate: number | null; quiz_rate: number | null; alert_count: number };
};

const audienceText = {
  admin: { title: 'PF 学習状況ダッシュボード', subtitle: '校舎・週次・月次で、出席・宿題・小テストをまとめて確認', back: '/master' },
  teacher: { title: '担当クラス PF', subtitle: '担当クラスの出欠とMonoxer学習状況を、要確認の生徒から確認', back: '/teacher/work' },
  parent: { title: 'お子さまの学習状況', subtitle: '出席・宿題提出・小テストの状況をまとめて確認', back: '/parent' },
} as const;

const displayRate = (value: number | null) => value === null ? '―' : `${value}%`;
const rateColor = (value: number | null) => value === null ? 'text-slate-400' : value >= 80 ? 'text-emerald-600' : value >= 70 ? 'text-amber-600' : 'text-red-600';

function SummaryCard({ label, value, detail, icon, color }: { label: string; value: string; detail: string; icon: React.ReactNode; color: string }) {
  return (
    <div className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
      <div className={`flex h-10 w-10 items-center justify-center rounded-2xl ${color}`}>{icon}</div>
      <p className="mt-4 text-xs font-black text-slate-400">{label}</p>
      <p className="mt-1 text-3xl font-black tracking-tight text-slate-900">{value}</p>
      <p className="mt-1 text-[11px] font-bold text-slate-400">{detail}</p>
    </div>
  );
}

function ProgressCell({ value, completed, total, label }: { value: number | null; completed: number; total: number; label: string }) {
  return (
    <div className="min-w-[130px]">
      <div className="flex items-center justify-between gap-2">
        <span className={`text-sm font-black ${rateColor(value)}`}>{displayRate(value)}</span>
        <span className="text-[10px] font-bold text-slate-400">{completed}/{total}</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${value === null ? 'bg-slate-200' : value >= 80 ? 'bg-emerald-500' : value >= 70 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${value ?? 0}%` }} />
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
}

export default function PfProgressDashboard({ audience, schoolDashboard = false }: { audience: Audience; schoolDashboard?: boolean }) {
  const copy = schoolDashboard
    ? { title: '校舎運営ダッシュボード', subtitle: '自校舎の授業参加・宿題提出・小テスト実施を、要確認の生徒から確認', back: '/master' }
    : audienceText[audience];
  const { user, loading: authLoading } = useAuth();
  const [period, setPeriod] = useState<'week' | 'month'>('week');
  const [anchor, setAnchor] = useState(new Date().toISOString().slice(0, 10));
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
    <div className="min-h-screen bg-slate-50 px-4 py-5 text-slate-800 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="overflow-hidden rounded-[32px] bg-slate-950 p-6 text-white shadow-xl sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <Link href={copy.back} className="mt-1 rounded-2xl bg-white/10 p-2.5 hover:bg-white/20"><ArrowLeft size={20} /></Link>
              <div>
                <div className="flex items-center gap-2 text-indigo-300"><BarChart3 size={18} /><span className="text-xs font-black uppercase tracking-[0.18em]">Progress Follow-up</span></div>
                <h1 className="mt-2 text-2xl font-black sm:text-3xl">{copy.title}</h1>
                <p className="mt-2 max-w-2xl text-sm font-bold text-slate-300">{copy.subtitle}</p>
              </div>
            </div>
            <button type="button" onClick={() => setRefreshKey(value => value + 1)} className="inline-flex items-center gap-2 rounded-2xl bg-white/10 px-4 py-2 text-xs font-black hover:bg-white/20"><RefreshCw size={15} /> 更新</button>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <div className="flex rounded-2xl bg-white/10 p-1">
              {(['week', 'month'] as const).map(value => <button key={value} type="button" onClick={() => setPeriod(value)} className={`rounded-xl px-5 py-2 text-xs font-black ${period === value ? 'bg-white text-slate-900' : 'text-slate-300'}`}>{value === 'week' ? '週次' : '月次'}</button>)}
            </div>
            <label className="flex items-center gap-2 rounded-2xl bg-white/10 px-4 py-2"><CalendarDays size={16} className="text-indigo-300" /><input type="date" value={anchor} onChange={event => setAnchor(event.target.value)} className="bg-transparent text-xs font-black text-white outline-none [color-scheme:dark]" /></label>
            {audience === 'admin' && data && data.schools.length > 1 && <label className="flex items-center gap-2 rounded-2xl bg-white/10 px-4 py-2"><School size={16} className="text-indigo-300" /><select value={school} onChange={event => setSchool(event.target.value)} className="bg-slate-900 text-xs font-black text-white outline-none"><option value="">全校舎</option>{data.schools.map(value => <option key={value}>{value}</option>)}</select></label>}
            {audience === 'parent' && parentStudents.length > 1 && <select value={studentId} onChange={event => setStudentId(event.target.value)} className="rounded-2xl bg-white/10 px-4 py-2 text-xs font-black text-white outline-none"><option value="">全員</option>{parentStudents.map(student => <option className="text-slate-900" key={student.id} value={student.id}>{student.student_name}</option>)}</select>}
            {data?.range && <span className="rounded-full bg-indigo-500/20 px-4 py-2 text-xs font-black text-indigo-100">集計期間 {data.range.label}</span>}
          </div>
        </header>

        {audience === 'admin' && !schoolDashboard && <PfMonoxerImportPanel onImported={() => setRefreshKey(value => value + 1)} />}

        {error && <div className="rounded-2xl border border-red-100 bg-red-50 p-4 text-sm font-black text-red-600">{error}</div>}
        {loading ? <div className="flex min-h-64 items-center justify-center"><Loader2 size={36} className="animate-spin text-indigo-600" /></div> : data && <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <SummaryCard label={schoolDashboard ? '確認対象の生徒' : '対象生徒'} value={`${data.summary.student_count}名`} detail={schoolDashboard ? '自校舎の生徒' : audience === 'teacher' ? '担当クラスの対象者' : '現在の表示範囲'} icon={<Users size={20} />} color="bg-slate-100 text-slate-700" />
            <SummaryCard label={schoolDashboard ? '授業参加率' : '出席率'} value={displayRate(data.summary.attendance_rate)} detail="遅刻は参加として集計" icon={<CheckCircle2 size={20} />} color="bg-blue-50 text-blue-600" />
            <SummaryCard label="宿題提出率" value={displayRate(data.summary.homework_rate)} detail="Monoxer CSV集計" icon={<BookCheck size={20} />} color="bg-emerald-50 text-emerald-600" />
            <SummaryCard label="小テスト実施率" value={displayRate(data.summary.quiz_rate)} detail="Monoxer CSV集計" icon={<ClipboardCheck size={20} />} color="bg-violet-50 text-violet-600" />
            <SummaryCard label="要確認" value={`${data.summary.alert_count}件`} detail="基準未満の項目数" icon={<AlertTriangle size={20} />} color="bg-red-50 text-red-600" />
          </section>

          {schoolDashboard ? <section className="grid gap-3 sm:grid-cols-3">
            <Link href="/master/school-students" className="rounded-2xl border border-indigo-100 bg-indigo-50 p-4 text-sm font-black text-indigo-800 hover:border-indigo-300">校舎別生徒管理を見る</Link>
            <Link href="/master/monthly-schedules" className="rounded-2xl border border-sky-100 bg-sky-50 p-4 text-sm font-black text-sky-800 hover:border-sky-300">月間予定を見る</Link>
            <Link href="/master/shifts" className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm font-black text-emerald-800 hover:border-emerald-300">シフト配置を見る</Link>
          </section> : null}

          {audience === 'teacher' && data.classes.length > 0 && <section className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm"><h2 className="text-sm font-black text-slate-800">今週の担当クラス</h2><div className="mt-3 flex flex-wrap gap-2">{data.classes.map(item => <span key={item.key} className="rounded-full bg-indigo-50 px-3 py-2 text-xs font-black text-indigo-700">{item.label}</span>)}</div></section>}

          <section className="overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5">
              <div><h2 className="text-base font-black">生徒別状況</h2><p className="mt-1 text-xs font-bold text-slate-400">要確認の項目がある生徒を上位に表示します。</p></div>
              <label className="flex items-center gap-2 rounded-2xl bg-slate-100 px-4 py-2"><Search size={16} className="text-slate-400" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="氏名・ID・校舎" className="w-40 bg-transparent text-xs font-bold outline-none" /></label>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-left">
                <thead className="bg-slate-50 text-[11px] font-black text-slate-500"><tr><th className="px-5 py-4">生徒</th><th className="px-4 py-4">出欠</th><th className="px-4 py-4">出席率</th><th className="px-4 py-4">宿題提出率</th><th className="px-4 py-4">小テスト実施率</th><th className="px-4 py-4">平均得点</th><th className="px-4 py-4 text-center">確認</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {students.map(student => <tr key={student.id} className={student.alert_count ? 'bg-red-50/30' : 'hover:bg-slate-50'}>
                    <td className="px-5 py-4"><p className="font-black text-slate-900">{student.student_name}</p><p className="mt-1 text-[11px] font-bold text-slate-400">{[student.school, student.grade, student.lifetime_id].filter(Boolean).join(' / ')}</p></td>
                    <td className="px-4 py-4 text-xs font-bold"><span className="text-blue-600">出 {student.attendance_present}</span><span className="ml-3 text-amber-600">遅 {student.attendance_late}</span><span className="ml-3 text-red-600">欠 {student.attendance_absent}</span></td>
                    <td className="px-4 py-4"><ProgressCell value={student.attendance_rate} completed={student.attendance_present + student.attendance_late} total={student.attendance_total} label="出席率" /></td>
                    <td className="px-4 py-4"><ProgressCell value={student.homework_rate} completed={student.homework_completed} total={student.homework_total} label="宿題提出率" /></td>
                    <td className="px-4 py-4"><ProgressCell value={student.quiz_rate} completed={student.quiz_completed} total={student.quiz_total} label="小テスト実施率" /></td>
                    <td className={`px-4 py-4 text-sm font-black ${rateColor(student.quiz_average_score)}`}>{displayRate(student.quiz_average_score)}</td>
                    <td className="px-4 py-4 text-center">{student.alert_count ? <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-3 py-1 text-xs font-black text-red-600"><AlertTriangle size={13} /> {student.alert_count}</span> : <span className="inline-flex items-center gap-1 text-xs font-black text-emerald-600"><CheckCircle2 size={14} /> 良好</span>}</td>
                  </tr>)}
                  {students.length === 0 && <tr><td colSpan={7} className="px-5 py-16 text-center text-sm font-black text-slate-400">この期間の対象データはありません。</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </>}
      </div>
    </div>
  );
}
