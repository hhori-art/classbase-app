'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { collection, doc, getDoc, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { AlertTriangle, ArrowLeft, BookOpen, CheckCircle2, Clock3, Loader2, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { db } from '@/lib/firebase';
import { buildRegistrationClassOptions } from '@/lib/course-registration-match';
import { CourseOpeningMap } from '@/app/components/CourseRegistrationCalendar';

const clean = (value: unknown) => String(value || '').trim();
const timestampLabel = (value: any) => {
  if (!value) return '未確認';
  const date = value?.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? '未確認' : date.toLocaleString('ja-JP');
};

export default function MasterCourseAllocationPage() {
  const [options, setOptions] = useState<any[]>([]);
  const [schedules, setSchedules] = useState<any[]>([]);
  const [shifts, setShifts] = useState<any[]>([]);
  const [syncStatus, setSyncStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [grade, setGrade] = useState('すべて');
  const [status, setStatus] = useState('すべて');

  const load = async () => {
    setLoading(true);
    try {
      const [optionSnap, scheduleSnap, shiftSnap, statusSnap] = await Promise.all([
        getDocs(query(collection(db, 'course_registration_options'), limit(1000))),
        getDocs(query(collection(db, 'annual_curriculum_schedules'), limit(2000))),
        getDocs(query(collection(db, 'shift_assignments'), orderBy('target_date', 'desc'), limit(1200))),
        getDoc(doc(db, 'system_status', 'shift_sync')).catch(() => null),
      ]);
      setOptions(optionSnap.docs.map(item => ({ id: item.id, ...item.data() })).filter((item: any) => item.is_active !== false));
      setSchedules(scheduleSnap.docs.map(item => ({ id: item.id, ...item.data() })));
      setShifts(shiftSnap.docs.map(item => ({ id: item.id, ...item.data() })));
      setSyncStatus(statusSnap?.exists() ? statusSnap.data() : null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const rows = useMemo(() => {
    const shiftById = new Map(shifts.map(item => [String(item.id), item]));
    return buildRegistrationClassOptions(options, schedules, shifts).map(option => {
      const matchedShifts = (Array.isArray(option.matched_shift_ids) ? option.matched_shift_ids : [])
        .map((id: unknown) => shiftById.get(String(id)))
        .filter(Boolean);
      const hasMeeting = matchedShifts.some((item: any) => clean(item.target_meeting_id || item.meeting_id || item.target_join_url));
      const state = matchedShifts.length === 0 ? '配置待ち' : hasMeeting ? '参加可能' : 'Zoom未設定';
      return { option, matchedShifts, state };
    });
  }, [options, schedules, shifts]);

  const filteredRows = useMemo(() => rows.filter(row => {
    if (grade !== 'すべて' && clean(row.option.grade) !== grade) return false;
    if (status !== 'すべて' && row.state !== status) return false;
    const needle = search.normalize('NFKC').replace(/\s/g, '').toLowerCase();
    if (!needle) return true;
    return [row.option.grade, row.option.subject, row.option.course_name, row.option.resolved_day, row.option.resolved_slot]
      .join('').normalize('NFKC').replace(/\s/g, '').toLowerCase().includes(needle);
  }), [grade, rows, search, status]);

  const readyCount = rows.filter(row => row.state === '参加可能').length;
  const warningCount = rows.length - readyCount;

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <Link href="/master" aria-label="管理画面へ戻る" className="rounded-full bg-white p-3 text-slate-500 shadow-sm"><ArrowLeft size={20} /></Link>
            <div><h1 className="text-2xl font-black text-slate-900">講座登録・GAS連携</h1><p className="mt-1 text-sm font-bold text-slate-500">生徒に見える講座と、参加ボタンまでを1画面で確認します。</p></div>
          </div>
          <button onClick={load} disabled={loading} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-black text-white disabled:opacity-50">{loading ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />} 最新状態を読み込む</button>
        </header>

        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-3xl border border-emerald-100 bg-emerald-50 p-5"><ShieldCheck className="mb-3 text-emerald-600" /><p className="text-xs font-black text-emerald-700">参加ボタン表示可能</p><p className="mt-1 text-3xl font-black text-emerald-950">{readyCount}<span className="ml-1 text-sm">講座</span></p></div>
          <div className={`rounded-3xl border p-5 ${warningCount ? 'border-amber-100 bg-amber-50' : 'border-slate-100 bg-white'}`}><AlertTriangle className={`mb-3 ${warningCount ? 'text-amber-600' : 'text-slate-400'}`} /><p className="text-xs font-black text-slate-600">確認が必要</p><p className="mt-1 text-3xl font-black text-slate-950">{warningCount}<span className="ml-1 text-sm">講座</span></p></div>
          <div className="rounded-3xl border border-sky-100 bg-white p-5"><Clock3 className="mb-3 text-sky-600" /><p className="text-xs font-black text-slate-500">GAS最終成功</p><p className="mt-2 text-sm font-black text-slate-900">{timestampLabel(syncStatus?.last_success_at)}</p><p className="mt-1 text-xs font-bold text-slate-400">{syncStatus ? `${syncStatus.incoming || 0}件受信 / 時限補正${syncStatus.corrected_period_count || 0}件` : '次回同期から記録します'}</p></div>
        </section>

        <section className="rounded-3xl bg-white p-4 shadow-sm sm:p-5">
          <div className="grid gap-3 md:grid-cols-[minmax(220px,1fr)_160px_180px]">
            <label className="relative"><Search className="absolute left-3 top-3 text-slate-400" size={18} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="講座名・科目・曜日で検索" className="min-h-11 w-full rounded-xl border border-slate-200 pl-10 pr-3 text-sm font-bold outline-none focus:border-indigo-400" /></label>
            <select aria-label="学年で絞り込む" value={grade} onChange={event => setGrade(event.target.value)} className="min-h-11 rounded-xl border border-slate-200 px-3 text-sm font-black"><option>すべて</option><option>中1</option><option>中2</option><option>中3</option></select>
            <select aria-label="参加判定で絞り込む" value={status} onChange={event => setStatus(event.target.value)} className="min-h-11 rounded-xl border border-slate-200 px-3 text-sm font-black"><option>すべて</option><option>参加可能</option><option>Zoom未設定</option><option>配置待ち</option></select>
          </div>
        </section>

        <CourseOpeningMap
          options={filteredRows.map(row => row.option)}
          title="現在の週間開講状況"
          description="上の学年・参加判定・検索条件に合わせて、開講曜日と時限を表示しています。"
        />

        <section className="overflow-hidden rounded-3xl bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><p className="font-black text-slate-800">生徒に表示される講座</p><p className="mt-1 text-xs font-bold text-slate-400">講師配置から生成した曜日・時限だけを表示しています。</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">{filteredRows.length}件</span></div>
          <div className="max-h-[68vh] overflow-auto">
            <table className="w-full min-w-[850px] text-left text-sm">
              <thead className="sticky top-0 bg-slate-50 text-xs font-black text-slate-500"><tr><th className="p-4">講座</th><th className="p-4">開講</th><th className="p-4">配置確認</th><th className="p-4">参加判定</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRows.map(({ option, matchedShifts, state }) => (
                  <tr key={option.id} className="align-top hover:bg-slate-50/70">
                    <td className="p-4"><p className="font-black text-slate-900">{[option.grade, option.subject, option.course_name || option.title].filter(Boolean).join(' ')}</p><p className="mt-1 text-xs font-bold text-slate-400">{option.term_label || option.term || '期未設定'}</p></td>
                    <td className="p-4"><span className="rounded-lg bg-indigo-50 px-3 py-2 font-black text-indigo-700">{option.resolved_day || '-'}曜 {clean(option.resolved_slot).replace('時間目', '限') || '-'}</span></td>
                    <td className="p-4 text-xs font-bold text-slate-600">{matchedShifts.slice(0, 2).map((item: any) => `${item.target_date} ${item.teacher_name || '講師未定'}`).join(' / ') || '講師配置なし'}{matchedShifts.length > 2 ? ` ほか${matchedShifts.length - 2}件` : ''}</td>
                    <td className="p-4"><span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-black ${state === '参加可能' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{state === '参加可能' ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}{state}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!loading && filteredRows.length === 0 && <div className="p-10 text-center"><BookOpen className="mx-auto mb-3 text-slate-300" /><p className="font-black text-slate-400">条件に合う講座はありません</p></div>}
          </div>
        </section>
      </div>
    </div>
  );
}
