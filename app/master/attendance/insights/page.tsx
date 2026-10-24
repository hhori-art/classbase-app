'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import AdminPageHeader from '@/app/components/master/AdminPageHeader';
import {
  BarChart3, CalendarDays, CheckCircle2, Clock3, Download,
  Filter, RefreshCw, Search, UserRoundCheck, UsersRound,
} from 'lucide-react';
import { Button, ErrorState, Skeleton } from '@/app/components/ui';
import { jstDateKey } from '@/lib/format';
import type { LucideIcon } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import { userErrorMessage } from '@/lib/user-error';

type Program = 'all' | 'normal' | 'science_social' | 'breakthrough';
type Source = 'combined' | 'system' | 'external';
type Availability = 'all' | 'worked' | 'not_worked';

type WeekdayCell = { weekday: number; label: string; total_minutes: number; system_minutes: number; external_minutes: number; work_days: number; last_work_date: string };
type TeacherRow = {
  person_key: string; teacher_id: string; person_code: string; teacher_name: string; school: string;
  total_minutes: number; system_minutes: number; external_minutes: number; work_days: number;
  average_minutes_per_work_day: number; last_work_date: string; zero_weekdays: number[]; weekdays: WeekdayCell[];
};

const programLabels: Record<Program, string> = { all: 'すべての勤務', normal: '通常勤務', science_social: '理社講座', breakthrough: '突破ゼミ' };
const sourceLabels: Record<Source, string> = { combined: '新・旧システム合算', system: '新システムのみ', external: '旧システムのみ' };
const weekdayOrder = [1, 2, 3, 4, 5, 6, 0];
const weekdayLabels = ['日', '月', '火', '水', '木', '金', '土'];
const hours = (value: number) => {
  const safe = Math.max(0, Number(value || 0));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return h ? `${h}時間${m ? `${m}分` : ''}` : `${m}分`;
};
const decimalHours = (value: number) => `${(Number(value || 0) / 60).toFixed(1)}h`;
const csvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
const shiftMonth = (month: string, amount: number) => {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + amount, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
};

export default function AttendanceInsightsPage() {
  const { user } = useAuth();
  const currentMonth = jstDateKey().slice(0, 7);
  // 旧システムの履歴も初期表示で確認できるよう、当月だけでなく直近3か月を表示する。
  // 勤怠一覧から開いたときは、見ていた月（?month=）までの3か月にする。
  const [from, setFrom] = useState(() => shiftMonth(currentMonth, -2));
  const [to, setTo] = useState(currentMonth);
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('month') || '';
    if (!/^\d{4}-\d{2}$/.test(requested)) return;
    setTo(requested);
    setFrom(shiftMonth(requested, -2));
  }, []);
  const [program, setProgram] = useState<Program>('all');
  const [source, setSource] = useState<Source>('combined');
  const [school, setSchool] = useState('all');
  const [search, setSearch] = useState('');
  const [selectedWeekday, setSelectedWeekday] = useState(1);
  const [availability, setAvailability] = useState<Availability>('all');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError('');
    try {
      const token = await user.getIdToken();
      const params = new URLSearchParams({ from, to, program, source });
      const response = await fetch(`/api/attendance-insights?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || '分析データを取得できませんでした。');
      setData(body);
    } catch (caught) {
      console.error(caught);
      setError(userErrorMessage(caught, '分析データを取得できませんでした。'));
    } finally {
      setLoading(false);
    }
  }, [from, program, source, to, user]);

  useEffect(() => { void load(); }, [load]);

  const allTeachers = useMemo<TeacherRow[]>(() => data?.teachers || [], [data]);
  const schools = useMemo(() => Array.from(new Set(allTeachers.map(row => row.school))).sort((a, b) => a.localeCompare(b, 'ja')), [allTeachers]);
  const normalizedSearch = search.normalize('NFKC').toLowerCase().replace(/[\s　]/g, '');
  const scopedTeachers = useMemo(() => allTeachers.filter(row => {
    if (school !== 'all' && row.school !== school) return false;
    if (!normalizedSearch) return true;
    return `${row.person_code}${row.teacher_name}${row.school}`.normalize('NFKC').toLowerCase().replace(/[\s　]/g, '').includes(normalizedSearch);
  }), [allTeachers, normalizedSearch, school]);
  const candidates = useMemo(() => scopedTeachers.filter(row => !row.weekdays?.some(day => day.weekday === selectedWeekday && day.total_minutes > 0)), [scopedTeachers, selectedWeekday]);
  const visibleTeachers = useMemo(() => scopedTeachers.filter(row => {
    const worked = row.weekdays?.some(day => day.weekday === selectedWeekday && day.total_minutes > 0);
    return availability === 'all' || (availability === 'worked' ? worked : !worked);
  }), [availability, scopedTeachers, selectedWeekday]);
  const filteredSummary = useMemo(() => ({
    people: visibleTeachers.length,
    total: visibleTeachers.reduce((sum, row) => sum + row.total_minutes, 0),
    workDays: visibleTeachers.reduce((sum, row) => sum + row.work_days, 0),
    average: visibleTeachers.length ? Math.round(visibleTeachers.reduce((sum, row) => sum + row.total_minutes, 0) / visibleTeachers.length) : 0,
    both: visibleTeachers.filter(row => row.system_minutes > 0 && row.external_minutes > 0).length,
  }), [visibleTeachers]);
  const weekdayTotals = useMemo(() => weekdayOrder.map(weekday => ({
    weekday,
    label: weekdayLabels[weekday],
    total: visibleTeachers.reduce((sum, row) => sum + (row.weekdays?.find(day => day.weekday === weekday)?.total_minutes || 0), 0),
    people: visibleTeachers.filter(row => (row.weekdays?.find(day => day.weekday === weekday)?.total_minutes || 0) > 0).length,
  })), [visibleTeachers]);
  const maxWeekdayMinutes = Math.max(1, ...weekdayTotals.map(row => row.total));

  const exportCsv = () => {
    const header = ['職員番号', '氏名', '所属校', '総勤務分', '勤務日数', '1勤務日平均分', '新システム分', '旧システム分', ...weekdayOrder.map(day => `${weekdayLabels[day]}曜分`), '勤務実績のない曜日'];
    const rows = visibleTeachers.map(row => [
      row.person_code, row.teacher_name, row.school, row.total_minutes, row.work_days, row.average_minutes_per_work_day,
      row.system_minutes, row.external_minutes,
      ...weekdayOrder.map(day => row.weekdays?.find(item => item.weekday === day)?.total_minutes || 0),
      weekdayOrder.filter(day => row.zero_weekdays?.includes(day)).map(day => `${weekdayLabels[day]}曜`).join('・'),
    ]);
    const content = `\uFEFF${[header, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n')}`;
    const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `勤務実績分析_${from}_${to}_${programLabels[program]}_${sourceLabels[source]}.csv`; link.click(); URL.revokeObjectURL(url);
  };

  const setRecentMonths = (months: number) => {
    const end = new Date(`${currentMonth}-01T00:00:00+09:00`);
    const start = new Date(end); start.setMonth(start.getMonth() - (months - 1));
    const value = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`;
    setFrom(value); setTo(currentMonth);
  };

  const kpis: Array<{ label: string; value: string; Icon: LucideIcon; tone: string }> = [
    { label: '対象職員', value: `${filteredSummary.people}人`, Icon: UsersRound, tone: 'text-accent bg-accent-soft' },
    { label: '総勤務時間', value: hours(filteredSummary.total), Icon: Clock3, tone: 'text-cyan-700 bg-cyan-50' },
    { label: '職員1人あたり', value: hours(filteredSummary.average), Icon: UserRoundCheck, tone: 'text-emerald-700 bg-emerald-50' },
    { label: '延べ勤務日数', value: `${filteredSummary.workDays}日`, Icon: CalendarDays, tone: 'text-amber-700 bg-amber-50' },
    { label: '新旧両方に実績', value: `${filteredSummary.both}人`, Icon: CheckCircle2, tone: 'text-violet-700 bg-violet-50' },
  ];

  return <main className="text-slate-900">
    <div className="space-y-5">
      <AdminPageHeader
        description="勤務配置を考えるための分析です。職員ごとの勤務量と曜日の偏りを、新・旧システムをまたいで確認できます。"
        backHref="/master/attendance"
        actions={<>
          <Button variant="secondary" icon={<RefreshCw size={16} aria-hidden />} onClick={() => void load()} loading={loading}>再読み込み</Button>
          <Button onClick={exportCsv} disabled={!visibleTeachers.length} icon={<Download size={16} aria-hidden />}>表示中をCSV出力</Button>
        </>}
      />

      <section aria-label="分析条件" className="rounded-card border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="mb-4 flex items-center gap-2"><Filter size={18} className="text-accent" /><h2 className="font-bold">分析条件</h2><span className="text-xs font-bold text-slate-400">変更すると自動で再集計します</span></div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          <label className="grid gap-1 text-xs font-bold text-slate-500"><span>開始月</span><input type="month" value={from} max={to} onChange={event => setFrom(event.target.value)} className="min-h-11 rounded-btn border border-slate-200 px-3 text-sm font-bold text-slate-900" /></label>
          <label className="grid gap-1 text-xs font-bold text-slate-500"><span>終了月</span><input type="month" value={to} min={from} onChange={event => setTo(event.target.value)} className="min-h-11 rounded-btn border border-slate-200 px-3 text-sm font-bold text-slate-900" /></label>
          <label className="grid gap-1 text-xs font-bold text-slate-500"><span>データ元</span><select value={source} onChange={event => setSource(event.target.value as Source)} className="min-h-11 rounded-btn border border-slate-200 px-3 text-sm font-bold">{(Object.keys(sourceLabels) as Source[]).map(value => <option key={value} value={value}>{sourceLabels[value]}</option>)}</select></label>
          <label className="grid gap-1 text-xs font-bold text-slate-500"><span>勤務区分</span><select value={program} onChange={event => setProgram(event.target.value as Program)} className="min-h-11 rounded-btn border border-slate-200 px-3 text-sm font-bold">{(Object.keys(programLabels) as Program[]).map(value => <option key={value} value={value}>{programLabels[value]}</option>)}</select></label>
          <label className="grid gap-1 text-xs font-bold text-slate-500"><span>所属校</span><select value={school} onChange={event => setSchool(event.target.value)} className="min-h-11 rounded-btn border border-slate-200 px-3 text-sm font-bold"><option value="all">すべての所属校</option>{schools.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
          <label className="grid gap-1 text-xs font-bold text-slate-500"><span>確認する曜日</span><select value={selectedWeekday} onChange={event => setSelectedWeekday(Number(event.target.value))} className="min-h-11 rounded-btn border border-slate-200 px-3 text-sm font-bold">{weekdayOrder.map(day => <option key={day} value={day}>{weekdayLabels[day]}曜日</option>)}</select></label>
          <label className="grid gap-1 text-xs font-bold text-slate-500"><span>職員検索</span><span className="relative"><Search size={15} className="absolute left-3 top-3.5 text-slate-400" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="氏名・職員番号" className="min-h-11 w-full rounded-btn border border-slate-200 pl-9 pr-3 text-sm font-bold" /></span></label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2"><span className="text-xs font-bold text-slate-400">期間:</span>{[1, 3, 6, 12].map(months => <button key={months} onClick={() => setRecentMonths(months)} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-bold text-slate-600 min-h-9 hover:border-accent/40 hover:text-accent">直近{months}か月</button>)}</div>
      </section>

      {loading ? <div className="space-y-3" aria-busy="true" aria-label="勤務実績を集計しています"><Skeleton className="h-12 w-full" /><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{[0, 1, 2, 3, 4].map(index => <Skeleton key={index} className="h-28" />)}</div><Skeleton className="h-72 w-full" /></div> : error ? <ErrorState title="分析データを読み込めませんでした" message={error} onRetry={() => void load()} /> : <>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-card border border-slate-200 bg-white px-4 py-3 text-xs font-bold text-slate-600 shadow-sm">
          <span>取得件数</span>
          <span className="text-accent">新システム {Number(data?.source_counts?.system_records || 0).toLocaleString()}件</span>
          <span className="text-emerald-700">旧システム {Number(data?.source_counts?.external_intervals || 0).toLocaleString()}件</span>
          {!data?.source_counts?.external_intervals && source !== 'system' && <span className="text-amber-700">選択期間には旧システムの勤務実績がありません。期間を広げてください。</span>}
        </div>
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {kpis.map(({ label, value, Icon, tone }) => <article key={label} className="rounded-card border border-slate-200 bg-white p-4 shadow-sm"><div className={`grid h-10 w-10 place-items-center rounded-btn ${tone}`}><Icon size={20} /></div><p className="mt-4 text-xs font-bold text-slate-400">{label}</p><p className="mt-1 text-2xl font-black">{value}</p></article>)}
        </section>

        <section className="grid gap-5 xl:grid-cols-[1.35fr_1fr]">
          <article className="rounded-card border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="flex items-center gap-2 text-lg font-bold"><BarChart3 size={20} className="text-accent" />曜日別の勤務量</h2><p className="mt-1 text-xs font-bold text-slate-400">曜日ごとの総時間と勤務した職員数です。</p></div><div className="flex gap-2"><span className="rounded-full bg-accent-soft px-3 py-1 text-xs font-bold text-accent">棒＝総勤務時間</span><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">人数も併記</span></div></div>
            <div className="mt-6 grid min-h-64 grid-cols-7 items-end gap-2 sm:gap-3">{weekdayTotals.map(row => <button key={row.weekday} onClick={() => setSelectedWeekday(row.weekday)} className="group flex h-full min-w-0 flex-col justify-end text-center" aria-label={`${row.label}曜日 ${decimalHours(row.total)} ${row.people}人`}><span className="mb-2 text-xs font-bold text-slate-700">{decimalHours(row.total)}</span><div className={`mx-auto w-full max-w-16 rounded-t-xl transition ${selectedWeekday === row.weekday ? 'bg-accent ring-4 ring-accent/20' : 'bg-cyan-400 group-hover:bg-cyan-500'}`} style={{ height: `${Math.max(row.total ? 12 : 2, row.total / maxWeekdayMinutes * 150)}px` }} /><span className={`mt-2 text-sm font-bold ${selectedWeekday === row.weekday ? 'text-accent' : 'text-slate-700'}`}>{row.label}</span><span className="text-xs font-bold text-slate-400">{row.people}人</span></button>)}</div>
          </article>

          <article className="rounded-card border border-amber-200 bg-amber-50 p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold text-amber-700">勤務依頼の検討候補</p><h2 className="mt-1 text-xl font-black text-amber-950">{weekdayLabels[selectedWeekday]}曜日に実績がない職員</h2><p className="mt-1 text-xs font-bold leading-relaxed text-amber-800">選択期間の実績から抽出しています。実際の勤務可否は本人へ確認してください。</p></div><span className="shrink-0 rounded-full bg-white px-3 py-1 text-sm font-bold text-amber-800 ring-1 ring-amber-200">{candidates.length}人</span></div>
            <div className="mt-4 max-h-64 space-y-2 overflow-y-auto pr-1">{candidates.slice(0, 30).map(row => <div key={row.person_key} className="flex items-center justify-between gap-3 rounded-btn bg-white px-3 py-2.5 ring-1 ring-amber-100"><div className="min-w-0"><p className="truncate text-sm font-bold">{row.teacher_name}</p><p className="truncate text-xs font-bold text-slate-400">{row.person_code || '番号未設定'}・{row.school}</p></div><div className="shrink-0 text-right"><p className="text-xs font-bold text-slate-700">合計 {decimalHours(row.total_minutes)}</p><p className="text-xs font-bold text-slate-400">{row.work_days}日勤務</p></div></div>)}{!candidates.length && <div className="rounded-card border-2 border-dashed border-amber-200 bg-white/70 p-8 text-center text-sm font-bold text-amber-700">該当する職員はいません</div>}</div>
          </article>
        </section>

        <section className="rounded-card border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-100 p-5 lg:flex-row lg:items-center lg:justify-between"><div><h2 className="text-lg font-bold">職員別・曜日別の勤務状況</h2><p className="mt-1 text-xs font-bold text-slate-400">濃い色ほど勤務時間が長く、赤い「実績なし」は選択期間中にその曜日の記録がない状態です。</p></div><div className="flex flex-wrap gap-2">{([
            ['all', '全員'], ['worked', `${weekdayLabels[selectedWeekday]}曜に勤務あり`], ['not_worked', `${weekdayLabels[selectedWeekday]}曜に実績なし`],
          ] as [Availability, string][]).map(([value, label]) => <button key={value} onClick={() => setAvailability(value)} aria-pressed={availability === value} className={`min-h-9 rounded-full px-3 py-2 text-xs font-bold ${availability === value ? 'bg-accent text-accent-ink' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{label}</button>)}</div></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[1180px] text-left text-xs"><thead className="sticky top-0 z-10 bg-slate-100 text-slate-500"><tr><th className="sticky left-0 z-20 min-w-56 bg-slate-100 px-4 py-3 font-bold">職員</th><th className="px-3 py-3 font-bold">総勤務</th><th className="px-3 py-3 font-bold">日数</th>{weekdayOrder.map(day => <th key={day} className={`min-w-28 px-2 py-3 text-center font-bold ${selectedWeekday === day ? 'bg-accent-soft text-accent' : ''}`}>{weekdayLabels[day]}曜日</th>)}<th className="px-3 py-3 font-bold">新システム</th><th className="px-3 py-3 font-bold">旧システム</th></tr></thead><tbody className="divide-y divide-slate-100">{visibleTeachers.map(row => <tr key={row.person_key} className="hover:bg-slate-50"><td className="sticky left-0 z-[5] bg-white px-4 py-3"><p className="font-bold text-slate-900">{row.teacher_name}</p><p className="mt-1 text-xs font-bold text-slate-400">{row.person_code || '番号未設定'}・{row.school}</p></td><td className="px-3 py-3"><p className="font-bold">{hours(row.total_minutes)}</p><p className="text-xs text-slate-400">平均 {hours(row.average_minutes_per_work_day)}/日</p></td><td className="px-3 py-3 font-bold">{row.work_days}日</td>{weekdayOrder.map(day => { const cell = row.weekdays?.find(item => item.weekday === day); const value = cell?.total_minutes || 0; const intensity = Math.min(1, value / Math.max(60, row.total_minutes / 3)); return <td key={day} className={`px-2 py-2 ${selectedWeekday === day ? 'bg-accent-soft/50' : ''}`}><div className={`rounded-btn border px-2 py-2 text-center ${value ? 'border-cyan-200 text-cyan-950' : 'border-rose-100 bg-rose-50 text-rose-600'}`} style={value ? { backgroundColor: `rgba(34, 211, 238, ${0.12 + intensity * 0.45})` } : undefined}><p className="font-bold">{value ? decimalHours(value) : '実績なし'}</p><p className="mt-0.5 text-xs font-bold opacity-70">{value ? `${cell?.work_days || 0}日` : '—'}</p></div></td>; })}<td className="px-3 py-3 font-bold text-accent">{decimalHours(row.system_minutes)}</td><td className="px-3 py-3 font-bold text-emerald-700">{decimalHours(row.external_minutes)}</td></tr>)}{!visibleTeachers.length && <tr><td colSpan={12} className="p-12 text-center font-bold text-slate-400">現在の条件に該当する勤務実績はありません</td></tr>}</tbody></table></div>
        </section>

        <section className="rounded-card border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-lg font-bold">所属校別の勤務時間</h2><p className="mt-1 text-xs font-bold text-slate-400">所属校フィルターと勤務区分・データ元の条件を反映しています。</p><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[760px] text-left text-xs"><thead className="bg-slate-100 text-slate-500"><tr>{['所属校', '総勤務', '新システム', '旧システム', '授業', '事務', 'サポート'].map(label => <th key={label} className="px-4 py-3 font-bold">{label}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{(data?.schools || []).filter((row: any) => school === 'all' || row.school === school).map((row: any) => <tr key={row.school}><td className="px-4 py-3 font-bold">{row.school}</td><td className="px-4 py-3 font-bold">{hours(row.total_minutes)}</td><td className="px-4 py-3 text-accent">{hours(row.system_minutes)}</td><td className="px-4 py-3 text-emerald-700">{hours(row.external_minutes)}</td><td className="px-4 py-3">{hours(row.lesson_minutes)}</td><td className="px-4 py-3">{hours(row.office_minutes)}</td><td className="px-4 py-3">{hours(row.support_minutes)}</td></tr>)}</tbody></table></div></section>

        <div className="rounded-card border border-cyan-200 bg-cyan-50 p-4 text-xs font-bold leading-relaxed text-cyan-950"><strong>集計方法:</strong> 「新・旧システム合算」では、同じ職員・同じ日付の重複時間帯を1回だけ数えます。新・旧それぞれの列は各システム単独の時間なので、移行期間中は2列の合計が「総勤務」を上回る場合があります。「実績なし」は勤務不可を意味せず、勤務依頼前の確認候補として利用してください。</div>
      </>}
    </div>
  </main>;
}
