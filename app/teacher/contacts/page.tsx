'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/app/context/AuthContext';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, doc, getDoc, limit } from 'firebase/firestore';
import { jstTodayKey } from '@/lib/lesson-deadline';
import { weekdayFromDateKey } from '@/lib/date-key';
import { fetchTeacherStudents } from '@/lib/teacher-students-client';
import { 
  Phone, Filter, CheckCircle, PhoneOff, CameraOff, RefreshCw, UserX 
} from 'lucide-react';
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
  const { user } = useAuth();
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

      // 3. PFレコード(今週の出席状況)を取得して除外リストを作成
      const pfQ = query(collection(db, 'pf_records'), where('week_number', '==', week));
      const lessonDate = latestDateForWeekday(filters.day || getTodayDayOfWeek());
      const [pfSnap, absenceSnap] = await Promise.all([
        getDocs(pfQ),
        // その日の欠席・遅刻連絡がある生徒は「連絡なし」ではないので一覧から外す（その日の連絡だけを読む）。
        getDocs(query(collection(db, 'requests'), where('target_date', '==', lessonDate), where('type', '==', 'absence'), limit(500)))
          .catch(error => { console.warn('Absence requests read failed:', error); return null; }),
      ]);
      const contactedIds = new Set<string>();
      absenceSnap?.forEach(d => {
        const data = d.data();
        if (['cancelled', 'canceled', 'rejected'].includes(String(data.status || ''))) return;
        [data.student_id, data.user_id].filter(Boolean).forEach(id => contactedIds.add(String(id)));
      });
      
      const statusMap = new Map(); // uid -> status
      pfSnap.forEach(d => {
        const data = d.data();
        statusMap.set(data.student_id, data.attendance_status);
      });

      // 4. フィルタリング実行 (未出席かつ未連絡のみ残す)
      const targetList = allStudents.filter((st: any) => {
        if (filters.day && st.day_of_week !== filters.day) return false;
        if (filters.grade && st.grade !== filters.grade) return false;
        if (st.absence_call_not_required) return false;
        if (contactedIds.has(String(st.uid || st.id || ''))) return false;

        const status = statusMap.get(st.uid);
        if (status === '出' || status === '欠' || status === '遅') return false;

        return true;
      });

      setStudents(targetList);
      await fetchCallMarks(targetList);

    } catch (e) {
      console.error("Fetch Error:", e);
      setStudents([]);
      setLoadError('生徒リストを読み込めませんでした。通信状況を確認して、もう一度お試しください。');
    } finally {
      setLoading(false);
    }
  };

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
      message: 'リストから消えます。',
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
      setStudents(prev => prev.filter(s => s.uid !== student.uid));

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
          title="未連絡・欠席確認リスト"
          description="Zoom不参加 ＆ 欠席連絡なしの生徒のみ表示"
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
          <EmptyState icon={CheckCircle} title="未確認の生徒はいません" description="全員出席済み、または欠席連絡済みです" />
        ) : (
          <div className="grid gap-4">
            {marksError && (
              <div role="alert" className="rounded-card border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
                {marksError}
              </div>
            )}
            {students.map((student) => {
              const callMark = callMarks[studentKey(student)];
              const isCalled = Boolean(callMark);
              const isMarking = markingId === studentKey(student);

              return (
                <div key={student.id} className={`flex flex-col items-start gap-4 rounded-card border p-5 shadow-sm transition-colors md:flex-row md:items-center ${isCalled ? 'border-line bg-slate-100 opacity-70' : 'border-rose-100 bg-surface ring-2 ring-rose-50'}`}>
                  
                  {/* 生徒情報 */}
                  <div className="flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-bold text-rose-700">
                        <UserX size={12} aria-hidden /> 未確認
                      </span>
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-bold text-fg-muted">
                        {student.grade}
                      </span>
                      <span className="text-xs font-bold text-fg-muted">
                        {student.day_of_week}曜
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

                  {/* アクションエリア */}
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
                        欠席確定 (リストから消去)
                      </Button>
                    </div>
                  </div>

                </div>
              );
            })}
          </div>
        )}

      </div>
    </div>
  );
}
