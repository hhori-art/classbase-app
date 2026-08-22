'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { ArrowLeft, CheckSquare, Clock, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/app/context/AuthContext';

type CorrectionRequest = {
  id: string;
  work_record_id?: string | null;
  request_type?: string;
  teacher_id: string;
  teacher_name?: string;
  target_date?: string | null;
  requested_start_time?: string | null;
  requested_end_time?: string | null;
  reason?: string;
  status?: string;
  created_at?: any;
};

type WorkRecord = {
  id: string;
  teacher_id?: string;
  teacher_name?: string;
  date?: string;
  start_time?: string;
  end_time?: string;
};

type TeacherInfo = {
  name?: string;
};

export default function AttendanceCorrectionsPage() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<CorrectionRequest[]>([]);
  const [records, setRecords] = useState<Record<string, WorkRecord>>({});
  const [teachers, setTeachers] = useState<Record<string, TeacherInfo>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [processingId, setProcessingId] = useState('');

  const isThisMonthRequest = (item: CorrectionRequest) => {
    const key = item.target_date || item.requested_start_time || item.requested_end_time;
    if (!key) return true;
    const date = new Date(key);
    if (Number.isNaN(date.getTime())) return true;
    const now = new Date();
    return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  };

  const visibleRequests = useMemo(() => {
    return requests.filter(item => {
      if (!showAllHistory && !isThisMonthRequest(item)) return false;
      if (filter !== 'all' && (item.status || 'pending') !== 'pending') return false;
      return true;
    });
  }, [filter, requests, showAllHistory]);

  const loadData = async () => {
    setLoading(true);
    try {
      const reqSnap = await getDocs(query(collection(db, 'attendance_correction_requests'), orderBy('created_at', 'desc'), limit(100)));
      const reqs = reqSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as CorrectionRequest));
      setRequests(reqs);

      const workIds = Array.from(new Set(reqs.map(item => item.work_record_id).filter(Boolean)));
      const nextRecords: Record<string, WorkRecord> = {};
      for (let i = 0; i < workIds.length; i += 10) {
        const chunk = workIds.slice(i, i + 10);
        const snap = await getDocs(query(collection(db, 'work_records'), where('__name__', 'in', chunk)));
        snap.docs.forEach(doc => {
          nextRecords[doc.id] = { id: doc.id, ...doc.data() } as WorkRecord;
        });
      }
      setRecords(nextRecords);

      const teacherIds = Array.from(new Set(reqs.map(item => item.teacher_id).filter(Boolean)));
      const nextTeachers: Record<string, TeacherInfo> = {};
      for (let i = 0; i < teacherIds.length; i += 10) {
        const chunk = teacherIds.slice(i, i + 10);
        const snap = await getDocs(query(collection(db, 'users'), where('__name__', 'in', chunk)));
        snap.docs.forEach(doc => {
          const data = doc.data();
          nextTeachers[doc.id] = { name: data.name || data.student_name || data.displayName || '講師未設定' };
        });
      }
      setTeachers(nextTeachers);
    } catch (e) {
      console.warn('Attendance correction load failed:', e);
      setRequests([]);
      setRecords({});
      setTeachers({});
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const review = async (requestId: string, status: 'approved' | 'rejected') => {
    const label = status === 'approved' ? '承認' : '却下';
    if (!confirm(`この打刻修正依頼を${label}しますか？`)) return;
    setProcessingId(requestId);
    try {
      const token = await user?.getIdToken();
      if (!token) throw new Error('ログイン情報を確認できません。再ログインしてください。');
      const res = await fetch('/api/attendance-corrections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'review', request_id: requestId, status }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        const message = data.error === 'work_record_id is missing on correction request'
          ? '対象の勤務記録が見つかりません。この依頼は古い形式か壊れているため、勤務記録から再申請してください。'
          : data.error === 'target_date is missing on correction request'
          ? '申請日が記録されていないため反映できません。却下して再申請してください。'
          : data.error || 'failed';
        throw new Error(message);
      }
      await loadData();
    } catch (e: any) {
      alert(`修正依頼の${label}に失敗しました: ${e.message || e}`);
    } finally {
      setProcessingId('');
    }
  };

  const formatDateTime = (value?: string | null) => {
    if (!value) return '変更なし';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '変更なし';
    return d.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const statusLabel = (status?: string) => {
    if (status === 'approved') return '承認済み';
    if (status === 'rejected') return '却下済み';
    if (status === 'superseded') return '再申請により更新済み';
    return '承認待ち';
  };

  return (
    <div className="space-y-6">
      <section className="rounded-[28px] bg-slate-950 p-6 text-white shadow-xl">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <Link href="/master/attendance" className="rounded-full bg-white/10 p-3 text-white hover:bg-white/20">
              <ArrowLeft size={20} />
            </Link>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.25em] text-amber-300">Attendance Approval</p>
              <h1 className="text-2xl font-black">打刻修正依頼の承認</h1>
              <p className="mt-1 text-sm font-bold text-slate-300">講師から送信された出退勤時刻の修正依頼を確認します。</p>
            </div>
          </div>
          <button onClick={loadData} className="flex w-fit items-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-black text-slate-950 hover:bg-amber-50">
            <RefreshCw size={18} /> 更新
          </button>
        </div>
      </section>

      <div className="flex flex-col gap-3 rounded-3xl bg-white p-4 shadow-sm md:flex-row md:items-center md:justify-between">
        <div className="flex gap-2">
          <button onClick={() => setFilter('pending')} className={`rounded-2xl px-4 py-2 text-sm font-black ${filter === 'pending' ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-500'}`}>
            承認待ち
          </button>
          <button onClick={() => setFilter('all')} className={`rounded-2xl px-4 py-2 text-sm font-black ${filter === 'all' ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-500'}`}>
            全て
          </button>
        </div>
        <button onClick={() => setShowAllHistory(prev => !prev)} className="w-fit rounded-2xl border border-slate-200 px-4 py-2 text-sm font-black text-slate-600 hover:bg-slate-50">
          {showAllHistory ? '当月だけ表示' : '過去の履歴をすべて見る'}
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="animate-spin text-amber-500" size={36} /></div>
      ) : visibleRequests.length === 0 ? (
        <div className="rounded-3xl border-2 border-dashed border-slate-200 bg-white py-16 text-center">
          <CheckSquare className="mx-auto text-slate-200" size={52} />
          <p className="mt-3 text-sm font-black text-slate-400">表示する打刻修正依頼はありません</p>
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {visibleRequests.map(item => {
            const rec = item.work_record_id ? records[item.work_record_id] : undefined;
            const teacher = teachers[item.teacher_id];
            const status = item.status || 'pending';
            const isMissingClock = item.request_type === 'missing_clock' || !item.work_record_id;
            return (
              <article key={item.id} className="rounded-3xl border border-slate-100 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-lg font-black text-slate-900">{teacher?.name || item.teacher_name || rec?.teacher_name || '講師未設定'}</p>
                      {isMissingClock && <span className="rounded-full bg-rose-50 px-2 py-1 text-[10px] font-black text-rose-600">打刻なし新規</span>}
                    </div>
                    <p className="mt-1 text-xs font-bold text-slate-400">{rec?.date || item.target_date || '日付未取得'} / 申請ID: {item.id.slice(0, 8)}</p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-[10px] font-black ${
                    status === 'approved' ? 'bg-emerald-100 text-emerald-700' :
                    status === 'rejected' || status === 'superseded' ? 'bg-slate-100 text-slate-500' :
                    'bg-amber-100 text-amber-700'
                  }`}>
                    {statusLabel(status)}
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <TimeBox label={isMissingClock ? '現在の出勤' : '現在の出勤'} value={isMissingClock ? '記録なし' : formatDateTime(rec?.start_time)} muted />
                  <TimeBox label="修正後の出勤" value={formatDateTime(item.requested_start_time)} />
                  <TimeBox label={isMissingClock ? '現在の退勤' : '現在の退勤'} value={isMissingClock ? '記録なし' : formatDateTime(rec?.end_time)} muted />
                  <TimeBox label="修正後の退勤" value={formatDateTime(item.requested_end_time)} />
                </div>

                <div className="mt-3 rounded-2xl bg-slate-50 p-3">
                  <p className="text-[10px] font-black text-slate-400">理由</p>
                  <p className="mt-1 text-sm font-bold leading-relaxed text-slate-700">{item.reason || '理由未入力'}</p>
                </div>

                {status === 'pending' && (
                  <div className="mt-4 flex justify-end gap-2">
                    <button onClick={() => review(item.id, 'rejected')} disabled={processingId === item.id} className="flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-black text-slate-500 hover:bg-slate-50 disabled:opacity-50">
                      <XCircle size={16} /> 却下
                    </button>
                    <button onClick={() => review(item.id, 'approved')} disabled={processingId === item.id} className="flex items-center gap-2 rounded-2xl bg-amber-500 px-4 py-3 text-sm font-black text-white hover:bg-amber-600 disabled:opacity-50">
                      {processingId === item.id ? <Loader2 className="animate-spin" size={16} /> : <Clock size={16} />} 承認して反映
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TimeBox({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={`rounded-2xl p-3 ${muted ? 'bg-slate-50' : 'bg-indigo-50'}`}>
      <p className={`text-[10px] font-black ${muted ? 'text-slate-400' : 'text-indigo-400'}`}>{label}</p>
      <p className={`mt-1 text-sm font-black ${muted ? 'text-slate-700' : 'text-indigo-700'}`}>{value}</p>
    </div>
  );
}
