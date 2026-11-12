'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/app/context/AuthContext';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, doc, getDoc, limit } from 'firebase/firestore';
import { jstTodayKey } from '@/lib/lesson-deadline';
import { weekdayFromDateKey } from '@/lib/date-key';
import { fetchTeacherStudents } from '@/lib/teacher-students-client';
import { 
  Phone, Filter, CheckCircle, PhoneOff, CameraOff, RefreshCw, UserX, Video 
} from 'lucide-react';
import { activeAbsencesByStudent, classifyRosterStudent, ROSTER_STATUS_LABELS, summarizeRoster, zoomCheckedForLessons, type RosterAbsence, type RosterResult, type RosterStatus } from '@/lib/today-roster';
import { periodFromShift } from '@/lib/student-course-schedule';
import { Button, Card, EmptyState, ErrorState, ListSkeleton, PageHeader, useConfirm, useToast } from '@/app/components/ui';

// フィルタリング用の型
type FilterState = {
  day: string;
  grade: string;
};

type CallMark = {
  student_id: string;
  date: string;
  teacher_id: string;
  teacher_name: string;
  marked_at: string;
  note?: string;
};

const studentKey = (student: any) => String(student?.uid || student?.id || '');

const formatMarkedAt = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' });
};

// 今日の曜日を取得するヘルパー ('日'~'土' -> '日','月'...)
const getTodayDayOfWeek = () => weekdayFromDateKey(jstTodayKey());

// 選んだ曜日の直近の授業日（今日を含めて過去7日以内、日本時間）。
const latestDateForWeekday = (weekday: string) => {
  const today = jstTodayKey();
  const [year, month, day] = today.split('-').map(Number);
  for (let offset = 0; offset < 7; offset += 1) {
    const date = new Date(Date.UTC(year, month - 1, day - offset)).toISOString().slice(0, 10);
    if (weekdayFromDateKey(date) === weekday) return date;
  }
  return today;
};

export default function TeacherContactsPage() {
  const { user, profile } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [marksError, setMarksError] = useState('');
  const [markingId, setMarkingId] = useState('');
  const [students, setStudents] = useState<any[]>([]); 
  const [currentWeek, setCurrentWeek] = useState('1');
  
  // 曜日リスト
  const days = ['月', '火', '水', '木', '金', '土'];
  
  // 初期値: 今日の曜日
  const [filters, setFilters] = useState<FilterState>({
    day: getTodayDayOfWeek(), 
    grade: ''
  });

  // 各生徒の入力状態 (備考)
  const [inputNotes, setInputNotes] = useState<{[key:string]: string}>({});
  
  // 当日の名簿の材料：欠席・遅刻の連絡、講師の出欠記録、授業ボタンを押した記録、Zoom の参加者。
  const [absences, setAbsences] = useState<Map<string, RosterAbsence>>(new Map());
  const [manualAttendance, setManualAttendance] = useState<Map<string, string>>(new Map());
  const [clickedIds, setClickedIds] = useState<Set<string>>(new Set());
  const [lessonDate, setLessonDate] = useState(jstTodayKey());
  // Zoom を確かめ終えた時限と、そこで見つかった生徒（同じ日のうちは、確かめるたびに足していく）。
  const [zoom, setZoom] = useState<{ checkedPeriods: Set<number>; inZoom: Set<string>; checkedAt: string; message: string }>({ checkedPeriods: new Set(), inZoom: new Set(), checkedAt: '', message: '' });
  // 生徒ごとの今日の授業（時間割と同じ判定。何限か）。取れなかった生徒は入らない。
  const [lessonsToday, setLessonsToday] = useState<Record<string, Array<{ period: number; label: string }>>>({});
  const [zoomLoading, setZoomLoading] = useState(false);
  const [zoomProgress, setZoomProgress] = useState('');
  const [statusFilter, setStatusFilter] = useState<'call' | 'all' | RosterStatus>('call');

  // 電話済み記録（サーバー保存。日付＋生徒単位で全講師に共有）
  const [callMarks, setCallMarks] = useState<{[key:string]: CallMark}>({});

  useEffect(() => {
    fetchTargetStudents();
  }, [filters]); 

  const fetchCallMarks = async (targetStudents: any[]) => {
    setMarksError('');
    const ids = Array.from(new Set(targetStudents.map(studentKey).filter(Boolean))).slice(0, 300);
    if (!user || ids.length === 0) { setCallMarks({}); return; }
    try {
      const token = await user.getIdToken();
      const params = new URLSearchParams({ date: jstTodayKey(), student_ids: ids.join(',') });
      const res = await fetch(`/api/teacher/contact-call-marks?${params.toString()}`, {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || 'call-marks-load-failed');
      const next: {[key:string]: CallMark} = {};
      (Array.isArray(data.marks) ? data.marks : []).forEach((mark: CallMark) => { if (mark.student_id) next[mark.student_id] = mark; });
      setCallMarks(next);
    } catch (e) {
      console.error('Call marks load failed:', e);
      setCallMarks({});
      setMarksError('電話済みの記録を読み込めませんでした。他の講師が電話済みの可能性があります。「リスト更新」で再読み込みしてください。');
    }
  };

  const fetchTargetStudents = async () => {
    setLoading(true);
    setLoadError('');
    try {
      // 1. 現在の週番号を取得
      const settingsSnap = await getDoc(doc(db, 'settings', 'global'));
      const data = settingsSnap.data();
      const week = (data && data.current_week) ? data.current_week : '1';
      
      setCurrentWeek(week);

      // 2. 全生徒を取得
      const allStudents = await fetchTeacherStudents();

      // 3. 講師の出欠記録（今週）、その日の欠席・遅刻連絡、授業ボタンを押した記録（入室ではない）
      const pfQ = query(collection(db, 'pf_records'), where('week_number', '==', week));
      const date = latestDateForWeekday(filters.day || getTodayDayOfWeek());
      const [pfSnap, absenceSnap, clickSnap] = await Promise.all([
        getDocs(pfQ),
        getDocs(query(collection(db, 'requests'), where('target_date', '==', date), where('type', '==', 'absence'), limit(500)))
          .catch(error => { console.warn('Absence requests read failed:', error); return null; }),
        getDocs(query(collection(db, 'attendance'), where('target_date', '==', date), limit(1000)))
          .catch(error => { console.warn('Class button records read failed:', error); return null; }),
      ]);
      setAbsences(activeAbsencesByStudent(absenceSnap ? absenceSnap.docs.map(d => d.data()) : []));
      const statusMap = new Map<string, string>();
      pfSnap.forEach(d => {
        const data = d.data();
        statusMap.set(String(data.student_id || ''), String(data.attendance_status || ''));
      });
      setManualAttendance(statusMap);
      const clicked = new Set<string>();
      clickSnap?.forEach(d => {
        const data = d.data();
        if (Array.isArray(data.participations) && data.participations.length > 0) [data.user_id, data.student_id].filter(Boolean).forEach(id => clicked.add(String(id)));
      });
      setClickedIds(clicked);
      // 日付が変わったら、前に確かめた Zoom の結果は使わない。
      setZoom(current => (date === lessonDate ? current : { checkedPeriods: new Set(), inZoom: new Set(), checkedAt: '', message: '' }));
      setLessonDate(date);

      // 4. その曜日・学年の生徒を全員出す（状態は下の名簿で分ける）
      const targetList = allStudents.filter((st: any) => {
        if (filters.day && st.day_of_week !== filters.day) return false;
        if (filters.grade && st.grade !== filters.grade) return false;
        return true;
      });

      setStudents(targetList);
      // 今日の名簿なら、生徒ごとの今日の授業（何限か）を時間割から取る。
      if (date === jstTodayKey()) void fetchLessonsToday(targetList);
      else setLessonsToday({});
      await fetchCallMarks(targetList);

    } catch (e) {
      console.error("Fetch Error:", e);
      setStudents([]);
      setLoadError('生徒リストを読み込めませんでした。通信状況を確認して、もう一度お試しください。');
    } finally {
      setLoading(false);
    }
  };

  const fetchLessonsToday = async (targetStudents: any[]) => {
    if (!user) return;
    const ids = Array.from(new Set(targetStudents.map(studentKey).filter(Boolean))).slice(0, 200);
    if (!ids.length) { setLessonsToday({}); return; }
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/teacher/today-roster?student_ids=${encodeURIComponent(ids.join(','))}`, { cache: 'no-store', headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error('today-roster-failed');
      setLessonsToday(data.lessons || {});
    } catch (e) {
      console.warn('Today lessons load failed:', e);
      setLessonsToday({});
    }
  };

  // Zoom の参加者一覧を、今日の授業（ミーティングIDのあるもの）ごとに確かめる。
  // ある時限の授業をすべて確かめられたときだけ、その時限を「確かめた」とする。
  // 会議がまだ開いていない授業や、確かめられなかった授業のある時限の生徒は「未確認」のまま（推測で未入室にしない）。
  const checkZoom = async () => {
    if (!user || zoomLoading) return;
    if (lessonDate !== jstTodayKey()) {
      toast.info('Zoom の入室は、今日の授業だけ確かめられます。');
      return;
    }
    setZoomLoading(true);
    try {
      const mySchools = new Set([profile?.school_id, profile?.school_code, profile?.school, ...(Array.isArray(profile?.school_ids) ? profile.school_ids : [])].map(value => String(value || '').trim()).filter(Boolean));
      const allSchools = profile?.role === 'master';
      const shiftSnap = await getDocs(query(collection(db, 'shift_assignments'), where('target_date', '==', lessonDate), limit(200)));
      // 自分の担当、または自分の校舎の授業だけ（ほかの校舎の授業は確かめられないので数えない）。
      const shifts = shiftSnap.docs
        .map(d => ({ id: d.id, ...(d.data() as Record<string, any>) }) as Record<string, any> & { id: string })
        .filter(shift => String(shift.target_meeting_id || '').trim())
        .filter(shift => allSchools || shift.user_id === user.uid || [shift.school_id, shift.school_code, shift.school_name, shift.school, shift.classroom].some(value => mySchools.has(String(value || '').trim())));
      if (!shifts.length) {
        setZoom(current => ({ ...current, message: '今日の授業にZoomのミーティングIDが見つかりません。' }));
        return;
      }
      const token = await user.getIdToken();
      const found = new Set<string>();
      const periodState = new Map<number, { ok: number; total: number }>();
      // 3件ずつ並べて確かめる（Zoom の権限によっては1件に数十秒かかる）。
      const targets = shifts.slice(0, 20);
      let cursor = 0;
      let done = 0;
      setZoomProgress(`0/${targets.length}`);
      await Promise.all(Array.from({ length: Math.min(3, targets.length) }, async () => {
        while (cursor < targets.length) {
          const shift = targets[cursor++];
          const period = Number(periodFromShift(shift)) || 0;
          const state = periodState.get(period) || { ok: 0, total: 0 };
          state.total += 1;
          periodState.set(period, state);
          const res = await fetch('/api/get-zoom-live-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ meetingId: String(shift.target_meeting_id).replace(/\s+/g, ''), shiftId: shift.id, include_left: true }),
          }).catch(() => null);
          const data = await res?.json().catch(() => ({}));
          done += 1;
          setZoomProgress(`${done}/${targets.length}`);
          if (!res?.ok || !data?.success) continue;
          state.ok += 1;
          (Array.isArray(data.participants) ? data.participants : []).forEach((participant: any) => { if (participant.matched_id) found.add(String(participant.matched_id)); });
        }
      }));
      const newlyChecked = [...periodState.entries()].filter(([period, state]) => period > 0 && state.ok === state.total).map(([period]) => period);
      const unchecked = [...periodState.entries()].filter(([period, state]) => period > 0 && state.ok < state.total).map(([period]) => `${period}限`);
      const checkedAt = new Date().toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' });
      setZoom(current => ({
        checkedPeriods: new Set([...current.checkedPeriods, ...newlyChecked]),
        inZoom: new Set([...current.inZoom, ...found]),
        checkedAt,
        message: unchecked.length
          ? `${unchecked.join('・')}の授業は確かめられませんでした（会議がまだ始まっていない・終わった、または担当外）。その時限の生徒は「未確認」のままです。`
          : '',
      }));
    } catch (e) {
      console.error('Zoom check failed:', e);
      toast.error('Zoom の入室を確かめられませんでした。もう一度お試しください。');
    } finally {
      setZoomLoading(false);
    }
  };

  const roster = students.map(student => {
    const id = studentKey(student);
    const lessons = lessonsToday[id];
    const result: RosterResult = classifyRosterStudent({
      manualAttendance: manualAttendance.get(id),
      absence: absences.get(id) || null,
      hasLessonToday: lessons ? lessons.length > 0 : undefined,
      zoomChecked: zoomCheckedForLessons(lessons?.map(lesson => lesson.period), zoom.checkedPeriods),
      inZoom: zoom.inZoom.has(id),
      classButtonClicked: clickedIds.has(id),
      callNotRequired: Boolean(student.absence_call_not_required),
    });
    return { student, result, lessons };
  });
  const zoomChecked = zoom.checkedPeriods.size > 0;
  const rosterSummary = summarizeRoster(roster.map(item => item.result));
  const visibleRoster = roster.filter(({ result }) => (
    statusFilter === 'all' ? true : statusFilter === 'call' ? result.needsCall : result.status === statusFilter
  ));

  const handleMarkCalled = async (student: any) => {
    const key = studentKey(student);
    if (!key || markingId) return;
    const note = inputNotes[student.uid] || '';
    const ok = await confirm({ title: `${student.student_name} さんを電話済みとして記録しますか？`, confirmLabel: '記録する' });
    if (!ok) return;

    setMarkingId(key);
    try {
      const token = await user?.getIdToken();
      const res = await fetch('/api/teacher/contact-call-marks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          student_id: key,
          date: jstTodayKey(),
          note,
          // 電話したときの名簿の状態（不要な電話がどれだけ減ったかを測るため）。
          roster_status: roster.find(item => studentKey(item.student) === key)?.result.status || '',
          zoom_checked: zoomChecked,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.mark) {
        // 他の講師が先に電話済みにしていた
        setCallMarks(prev => ({ ...prev, [key]: data.mark }));
        const markedAt = formatMarkedAt(data.mark.marked_at);
        toast.info(`${data.mark.teacher_name || '他の講師'}${markedAt ? `が${markedAt}に` : 'が'}すでに電話済みにしています。`);
        return;
      }
      if (!res.ok || !data.ok) throw new Error(data.error || 'contact-save-failed');

      if (data.mark) setCallMarks(prev => ({ ...prev, [key]: data.mark }));
      toast.success('電話記録を保存しました');
    } catch (e) {
      console.error(e);
      toast.error('電話記録を保存できませんでした。もう一度お試しください。');
    } finally {
      setMarkingId('');
    }
  };

  const handleConfirmAbsence = async (student: any) => {
    const note = inputNotes[student.uid] || '電話確認による欠席';
    const ok = await confirm({
      title: `${student.student_name} さんを「欠席」として確定しますか？`,
      message: '「欠席記録あり」に移ります。',
      tone: 'danger',
      confirmLabel: '欠席確定',
    });
    if (!ok) return;

    try {
      const token = await user?.getIdToken();
      const res = await fetch('/api/teacher/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          action: 'confirm_absence',
          student_id: student.uid || student.id,
          student_name: student.student_name,
          note,
          week: currentWeek,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || 'absence-confirm-failed');

      toast.success('欠席登録しました');
      setManualAttendance(prev => new Map(prev).set(studentKey(student), '欠'));

    } catch (e) {
      console.error(e);
      toast.error('欠席登録できませんでした。もう一度お試しください。');
    }
  };

  const segment = (active: boolean) =>
    `min-h-9 rounded-btn px-3 text-xs font-bold transition-colors ${active ? 'bg-surface text-accent shadow-sm' : 'text-fg-muted hover:text-fg'}`;

  return (
    <div className="px-4 py-5 sm:px-6">
      <div className="mx-auto max-w-4xl space-y-6">
        
        <PageHeader
          tone="plain"
          title="今日の対応名簿"
          description="Zoomの入室と欠席連絡を照らし合わせ、確認電話が必要な生徒だけを絞り込みます"
          icon={Phone}
          backHref="/teacher/work"
        />

        {/* フィルターバー */}
        <Card className="flex flex-wrap items-end gap-4">
          <div className="mb-1 flex w-full items-center gap-2 text-sm font-bold text-fg-muted md:w-auto">
            <Filter size={16} aria-hidden /> 今日の曜日: <span className="text-lg text-accent">{getTodayDayOfWeek()}</span>
          </div>
          
          <div>
            <span className="mb-1 block text-xs font-bold text-fg-muted">曜日絞り込み</span>
            <div className="flex flex-wrap rounded-btn bg-slate-100 p-1" role="group" aria-label="曜日絞り込み">
              <button
                 type="button"
                 onClick={() => setFilters({...filters, day: ''})}
                 aria-pressed={filters.day === ''}
                 className={segment(filters.day === '')}
              >
                全て
              </button>
              {days.map(d => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setFilters({...filters, day: d})}
                  aria-pressed={filters.day === d}
                  className={segment(filters.day === d)}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          <div className="ml-auto">
            <Button
              variant="secondary"
              onClick={fetchTargetStudents}
              loading={loading}
              icon={<RefreshCw size={16} aria-hidden />}
            >
              リスト更新
            </Button>
          </div>
        </Card>

        {/* 生徒リスト */}
        {loading ? (
          <ListSkeleton rows={4} />
        ) : loadError ? (
          <ErrorState title="リストを読み込めませんでした" message={loadError} onRetry={fetchTargetStudents} />
        ) : students.length === 0 ? (
          <EmptyState icon={CheckCircle} title="この曜日の生徒はいません" description="曜日や学年の絞り込みを変えてください" />
        ) : (
          <div className="grid gap-4">
            <Card className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-fg">{lessonDate.slice(5).replace('-', '/')} の名簿（{students.length}名）</p>
                  <p className="text-xs font-bold text-fg-muted">
                    {zoomChecked
                      ? `Zoom の入室を ${zoom.checkedAt} に確かめました（${[...zoom.checkedPeriods].sort().map(period => `${period}限`).join('・')}）。`
                      : 'Zoom の入室をまだ確かめていません。確かめるまで、連絡のない生徒は「未確認」です（授業ボタンを押しただけでは入室に数えません）。'}
                  </p>
                </div>
                <Button
                  variant={zoomChecked ? 'secondary' : 'primary'}
                  onClick={checkZoom}
                  loading={zoomLoading}
                  disabled={lessonDate !== jstTodayKey()}
                  icon={<Video size={16} aria-hidden />}
                >
                  {zoomLoading && zoomProgress ? `確かめています ${zoomProgress}` : zoomChecked ? 'Zoom の入室を確かめ直す' : 'Zoom の入室を確かめる'}
                </Button>
              </div>
              {zoom.message && <p role="status" className="rounded-btn bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">{zoom.message}</p>}
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="名簿の絞り込み">
                {([
                  ['call', `確認電話が必要 ${rosterSummary.needsCall}`],
                  ['no_contact', `${ROSTER_STATUS_LABELS.no_contact} ${rosterSummary.counts.no_contact}`],
                  ['unconfirmed', `${ROSTER_STATUS_LABELS.unconfirmed} ${rosterSummary.counts.unconfirmed}`],
                  ['absence_notified', `${ROSTER_STATUS_LABELS.absence_notified} ${rosterSummary.counts.absence_notified}`],
                  ['joined', `${ROSTER_STATUS_LABELS.joined} ${rosterSummary.counts.joined}`],
                  ['absent_recorded', `${ROSTER_STATUS_LABELS.absent_recorded} ${rosterSummary.counts.absent_recorded}`],
                  ['no_lesson', `${ROSTER_STATUS_LABELS.no_lesson} ${rosterSummary.counts.no_lesson}`],
                  ['all', `すべて ${students.length}`],
                ] as Array<[typeof statusFilter, string]>).map(([value, label]) => (
                  <button key={value} type="button" onClick={() => setStatusFilter(value)} aria-pressed={statusFilter === value}
                    className={`min-h-9 rounded-full border px-3 text-xs font-bold ${statusFilter === value ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-surface text-fg-muted hover:text-fg'}`}>
                    {label}
                  </button>
                ))}
              </div>
            </Card>
            {visibleRoster.length === 0 && (
              <EmptyState
                icon={CheckCircle}
                title={statusFilter === 'call' ? (zoomChecked ? '確認電話が必要な生徒はいません' : 'まず Zoom の入室を確かめてください') : 'この区分の生徒はいません'}
                description={statusFilter === 'call' && !zoomChecked ? '授業が始まってから「Zoom の入室を確かめる」を押すと、連絡がなく入室していない生徒だけが残ります。' : undefined}
              />
            )}
            {marksError && (
              <div role="alert" className="rounded-card border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
                {marksError}
              </div>
            )}
            {visibleRoster.map(({ student, result, lessons }) => {
              const callMark = callMarks[studentKey(student)];
              const tone = result.status === 'no_contact' ? 'bg-rose-100 text-rose-700'
                : result.status === 'unconfirmed' ? 'bg-slate-200 text-slate-700'
                  : result.status === 'joined' ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-sky-100 text-sky-700';
              const isCalled = Boolean(callMark);
              const isMarking = markingId === studentKey(student);

              return (
                <div key={student.id} className={`flex flex-col items-start gap-4 rounded-card border p-5 shadow-sm transition-colors md:flex-row md:items-center ${isCalled ? 'border-line bg-slate-100 opacity-70' : result.needsCall ? 'border-rose-100 bg-surface ring-2 ring-rose-50' : 'border-line bg-surface'}`}>
                  
                  {/* 生徒情報 */}
                  <div className="flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${tone}`}>
                        <UserX size={12} aria-hidden /> {ROSTER_STATUS_LABELS[result.status]}
                      </span>
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-bold text-fg-muted">
                        {student.grade}
                      </span>
                      <span className="text-xs font-bold text-fg-muted">
                        {lessons?.length ? lessons.map(lesson => `${lesson.period}限 ${lesson.label}`).join('・') : `${student.day_of_week}曜`}
                      </span>
                      {student.camera_off_requested && (
                        <span className="flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-bold text-indigo-700">
                          <CameraOff size={12} aria-hidden /> カメラオフ希望
                        </span>
                      )}
                    </div>
                    
                    <h3 className="mb-2 flex items-center gap-2 text-xl font-bold text-fg">
                      {student.student_name}
                      {student.phone_number && (
                        <a href={`tel:${student.phone_number}`} aria-label={`${student.student_name} さんに電話する`} className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 transition-colors hover:bg-emerald-100">
                          <Phone size={18} aria-hidden />
                        </a>
                      )}
                    </h3>
                    
                    {result.notes.length > 0 && (
                      <p className="mb-2 text-xs font-bold text-fg-muted">{result.notes.join('・')}</p>
                    )}
                    <div className="inline-flex items-center gap-1 rounded-input border border-line bg-canvas px-2 py-1 font-mono text-xs text-fg-muted">
                      <Phone size={12} aria-hidden /> {student.phone_number || '電話番号なし'}
                    </div>
                    {callMark && (
                      <p className="mt-2 flex items-center gap-1 text-xs font-bold text-fg-muted">
                        <CheckCircle size={12} className="text-emerald-600" aria-hidden />
                        {callMark.teacher_name || '講師'}が{formatMarkedAt(callMark.marked_at) ? `${formatMarkedAt(callMark.marked_at)}に` : ''}電話済み
                        {callMark.note ? <span className="font-normal">（{callMark.note}）</span> : null}
                      </p>
                    )}
                  </div>

                  {/* アクションエリア（入室済みの生徒には出さない） */}
                  {result.status !== 'joined' && (
                  <div className="flex w-full flex-col gap-2 md:w-[60%]">
                    <textarea
                      aria-label={`${student.student_name} さんの電話の結果・備考`}
                      placeholder="電話の結果・備考 (例: 母対応、風邪で欠席)"
                      className="min-h-[60px] w-full rounded-input border border-line bg-canvas px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                      value={inputNotes[student.uid] || ''}
                      onChange={(e) => setInputNotes({...inputNotes, [student.uid]: e.target.value})}
                    />
                    
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <button
                        type="button"
                        onClick={() => handleMarkCalled(student)}
                        disabled={isCalled || isMarking}
                        className={`flex min-h-11 flex-1 items-center justify-center gap-1 rounded-btn px-3 text-sm font-bold transition-colors ${
                          isCalled 
                            ? 'cursor-not-allowed bg-slate-200 text-fg-muted' 
                            : 'border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100'
                        }`}
                      >
                        {isCalled ? <><CheckCircle size={16} aria-hidden /> 電話済</> : isMarking ? <><RefreshCw size={16} className="motion-safe:animate-spin" aria-hidden /> 保存中...</> : <><PhoneOff size={16} aria-hidden /> 電話のみ(留守等)</>}
                      </button>
                      
                      <Button
                        variant="danger"
                        className="flex-1"
                        onClick={() => handleConfirmAbsence(student)}
                        icon={<UserX size={16} aria-hidden />}
                      >
                        欠席確定
                      </Button>
                    </div>
                  </div>
                  )}

                </div>
              );
            })}
          </div>
        )}

      </div>
    </div>
  );
}
