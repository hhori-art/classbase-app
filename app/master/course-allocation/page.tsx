'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, getDocs, limit, orderBy, query, startAfter, where, type QueryConstraint, type QueryDocumentSnapshot, type QuerySnapshot } from 'firebase/firestore';
import { AlertTriangle, BookOpen, CheckCircle2, Clock3, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { db } from '@/lib/firebase';
import { jstSchoolYear } from '@/lib/date-key';
import { buildRegistrationClassOptions } from '@/lib/course-registration-match';
import { CourseOpeningMap } from '@/app/components/CourseRegistrationCalendar';
import AdminPageHeader from '@/app/components/master/AdminPageHeader';
import { Button, EmptyState, ErrorState, ListSkeleton, StatusPill } from '@/app/components/ui';
import { formatDateTime } from '@/lib/format';

const clean = (value: unknown) => String(value || '').trim();
const timestampLabel = (value: any) => {
  if (!value) return '未確認';
  return formatDateTime(value, { withYear: true }) || '未確認';
};

// 今年度（4月〜翌3月）の講師配置をページ単位で取得する。上限は誤設定時の暴走防止用。
const SHIFT_PAGE_SIZE = 1000;
const SHIFT_MAX_PAGES = 10;

const loadSchoolYearShifts = async () => {
  const year = jstSchoolYear();
  const start = `${year}-04-01`;
  const end = `${year + 1}-03-31`;
  const items: any[] = [];
  let cursor: QueryDocumentSnapshot | null = null;
  let truncated = false;
  for (let page = 0; page < SHIFT_MAX_PAGES; page += 1) {
    // target_date の単一フィールド範囲検索のみ（複合インデックス不要）
    const constraints: QueryConstraint[] = [
      where('target_date', '>=', start),
      where('target_date', '<=', end),
      orderBy('target_date', 'asc'),
      ...(cursor ? [startAfter(cursor)] : []),
      limit(SHIFT_PAGE_SIZE),
    ];
    const snap: QuerySnapshot = await getDocs(query(collection(db, 'shift_assignments'), ...constraints));
    items.push(...snap.docs.map(item => ({ id: item.id, ...item.data() })));
    if (snap.docs.length < SHIFT_PAGE_SIZE) return { items, truncated };
    cursor = snap.docs[snap.docs.length - 1];
    if (page === SHIFT_MAX_PAGES - 1) truncated = true;
  }
  return { items, truncated };
};

export default function MasterCourseAllocationPage() {
  const [options, setOptions] = useState<any[]>([]);
  const [schedules, setSchedules] = useState<any[]>([]);
  const [shifts, setShifts] = useState<any[]>([]);
  const [syncStatus, setSyncStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [shiftTruncated, setShiftTruncated] = useState(false);
  const [search, setSearch] = useState('');
  const [grade, setGrade] = useState('すべて');
  const [status, setStatus] = useState('すべて');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [optionSnap, scheduleSnap, shiftResult, statusSnap] = await Promise.all([
        getDocs(query(collection(db, 'course_registration_options'), limit(1000))),
        getDocs(query(collection(db, 'annual_curriculum_schedules'), limit(2000))),
        loadSchoolYearShifts(),
        getDoc(doc(db, 'system_status', 'shift_sync')).catch(() => null),
      ]);
      setOptions(optionSnap.docs.map(item => ({ id: item.id, ...item.data() })).filter((item: any) => item.is_active !== false));
      setSchedules(scheduleSnap.docs.map(item => ({ id: item.id, ...item.data() })));
      setShifts(shiftResult.items);
      setShiftTruncated(shiftResult.truncated);
      setSyncStatus(statusSnap?.exists() ? statusSnap.data() : null);
    } catch (e) {
      console.error(e);
      setError('講座・講師配置の読み込みに失敗しました。通信状態を確認して再読み込みしてください。');
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
    <div>
      <div className="space-y-6">
        <AdminPageHeader
          description="生徒に見える講座と、参加ボタンまでを1画面で確認します。"
          actions={<Button variant="secondary" icon={<RefreshCw size={16} aria-hidden />} onClick={load} loading={loading}>再読み込み</Button>}
        />

        {error && (
          <ErrorState message={error} onRetry={load} />
        )}
        {!error && shiftTruncated && (
          <div className="rounded-card border border-amber-200 bg-amber-50 p-4 text-xs font-bold text-amber-800">今年度の講師配置が多いため、先頭{SHIFT_PAGE_SIZE * SHIFT_MAX_PAGES}件までで判定しています。年度後半の講座が「配置待ち」と表示される場合があります。</div>
        )}

        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-card border border-emerald-100 bg-emerald-50 p-5"><ShieldCheck className="mb-3 text-emerald-600" aria-hidden /><p className="text-xs font-bold text-emerald-700">参加ボタン表示可能</p><p className="mt-1 text-3xl font-black text-emerald-950">{readyCount}<span className="ml-1 text-sm">講座</span></p></div>
          <div className={`rounded-card border p-5 ${warningCount ? 'border-amber-100 bg-amber-50' : 'border-slate-100 bg-white'}`}><AlertTriangle className={`mb-3 ${warningCount ? 'text-amber-600' : 'text-slate-400'}`} /><p className="text-xs font-bold text-slate-600">確認が必要</p><p className="mt-1 text-3xl font-black text-slate-950">{warningCount}<span className="ml-1 text-sm">講座</span></p></div>
          <div className="rounded-card border border-sky-100 bg-white p-5"><Clock3 className="mb-3 text-sky-600" /><p className="text-xs font-bold text-slate-500">GAS最終成功</p><p className="mt-2 text-sm font-bold text-slate-900">{timestampLabel(syncStatus?.last_success_at)}</p><p className="mt-1 text-xs font-bold text-slate-400">{syncStatus ? `${syncStatus.incoming || 0}件受信 / 時限補正${syncStatus.corrected_period_count || 0}件` : '次回同期から記録します'}</p></div>
        </section>

        <section className="rounded-card bg-white p-4 shadow-sm sm:p-5">
          <div className="grid gap-3 md:grid-cols-[minmax(220px,1fr)_160px_180px]">
            <label className="relative"><Search className="absolute left-3 top-3 text-slate-400" size={18} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="講座名・科目・曜日で検索" className="min-h-11 w-full rounded-input border border-line pl-10 pr-3 text-sm font-bold outline-none focus:border-accent" /></label>
            <select aria-label="学年で絞り込む" value={grade} onChange={event => setGrade(event.target.value)} className="min-h-11 rounded-input border border-line px-3 text-sm font-bold"><option>すべて</option><option>中1</option><option>中2</option><option>中3</option></select>
            <select aria-label="参加判定で絞り込む" value={status} onChange={event => setStatus(event.target.value)} className="min-h-11 rounded-input border border-line px-3 text-sm font-bold"><option>すべて</option><option>参加可能</option><option>Zoom未設定</option><option>配置待ち</option></select>
          </div>
        </section>

        <CourseOpeningMap
          options={filteredRows.map(row => row.option)}
          title="現在の週間開講状況"
          description="上の学年・参加判定・検索条件に合わせて、開講曜日と時限を表示しています。"
        />

        <section className="overflow-hidden rounded-card bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div><p className="font-bold text-slate-800">生徒に表示される講座</p><p className="mt-1 text-xs font-bold text-slate-400">講師配置から生成した曜日・時限だけを表示しています。</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">{filteredRows.length}件</span></div>
          <div className="max-h-[68vh] overflow-auto">
            <table className="w-full min-w-[850px] text-left text-sm">
              <thead className="sticky top-0 bg-slate-50 text-xs font-bold text-slate-500"><tr><th className="p-4">講座</th><th className="p-4">開講</th><th className="p-4">配置確認</th><th className="p-4">参加判定</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRows.map(({ option, matchedShifts, state }) => (
                  <tr key={option.id} className="align-top hover:bg-slate-50/70">
                    <td className="p-4"><p className="font-bold text-slate-900">{[option.grade, option.subject, option.course_name || option.title].filter(Boolean).join(' ')}</p><p className="mt-1 text-xs font-bold text-slate-400">{option.term_label || option.term || '期未設定'}</p></td>
                    <td className="p-4"><span className="rounded-btn bg-accent-soft px-3 py-2 font-bold text-accent">{option.resolved_day || '-'}曜 {clean(option.resolved_slot).replace('時間目', '限') || '-'}</span></td>
                    <td className="p-4 text-xs font-bold text-slate-600">{matchedShifts.slice(0, 2).map((item: any) => `${item.target_date} ${item.teacher_name || '講師未定'}`).join(' / ') || '講師配置なし'}{matchedShifts.length > 2 ? ` ほか${matchedShifts.length - 2}件` : ''}</td>
                    <td className="p-4"><StatusPill tone={state === '参加可能' ? 'success' : 'warning'} icon={state === '参加可能' ? <CheckCircle2 size={13} aria-hidden /> : <AlertTriangle size={13} aria-hidden />}>{state}</StatusPill></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {loading && filteredRows.length === 0 && <div className="p-5"><ListSkeleton rows={4} /></div>}
            {!loading && !error && filteredRows.length === 0 && <div className="p-5"><EmptyState icon={BookOpen} title="条件に合う講座はありません" description={rows.length ? '検索語や学年・参加判定の絞り込みを変えてみてください。' : '講座が登録されると、ここに一覧で出ます。'} /></div>}
          </div>
        </section>
      </div>
    </div>
  );
}
