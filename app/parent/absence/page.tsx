'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { addDoc, collection, doc, getDoc, serverTimestamp } from 'firebase/firestore';
import { ArrowLeft, CalendarCheck, CheckCircle, Clock, Loader2, MessageSquare, Send } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import { db } from '@/lib/firebase';

type Student = { id: string; student_name?: string; grade?: string };

export default function ParentAbsencePage() {
  const { user, profile } = useAuth();
  const router = useRouter();
  const [students, setStudents] = useState<Student[]>([]);
  const [studentId, setStudentId] = useState('');
  const [type, setType] = useState<'absent' | 'late'>('absent');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const loadStudents = async () => {
      if (!profile) return;
      setLoading(true);
      try {
        const linkedIds = Array.isArray(profile.student_ids) ? profile.student_ids.slice(0, 10) : [];
        const list: Student[] = [];
        for (const sid of linkedIds) {
          const snap = await getDoc(doc(db, 'users', sid));
          if (snap.exists()) list.push({ id: snap.id, ...snap.data() });
        }
        setStudents(list);
        setStudentId(list[0]?.id || '');
      } finally {
        setLoading(false);
      }
    };

    loadStudents();
  }, [profile]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !studentId) return;
    const student = students.find(s => s.id === studentId);
    setSubmitting(true);
    try {
      const contentPrefix = type === 'late' ? '【遅刻連絡】' : '【欠席連絡】';
      await addDoc(collection(db, 'requests'), {
        user_id: studentId,
        student_id: studentId,
        student_name: student?.student_name || '生徒',
        parent_id: user.uid,
        parent_name: profile?.parent_name || profile?.name || '保護者',
        type: 'absence',
        absence_type: type,
        target_date: date,
        content: `${contentPrefix}\n${reason}`,
        status: 'pending',
        created_at: serverTimestamp(),
      });
      setDone(true);
      setTimeout(() => router.push('/parent'), 1800);
    } catch (e) {
      console.error(e);
      alert('送信に失敗しました。');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="animate-spin text-indigo-500" /></div>;
  }

  if (done) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="rounded-[28px] bg-white p-10 text-center shadow-sm">
          <CheckCircle className="mx-auto mb-4 text-emerald-500" size={52} />
          <h2 className="text-2xl font-black text-slate-900">送信しました</h2>
          <p className="mt-2 text-sm font-bold text-slate-400">校舎・先生へ連絡内容を送信しました。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center gap-4">
        <Link href="/parent/messages" className="rounded-2xl bg-white p-3 text-slate-500 shadow-sm hover:text-indigo-600">
          <ArrowLeft size={22} />
        </Link>
        <div>
          <p className="text-xs font-black uppercase tracking-wider text-indigo-400">Absence Contact</p>
          <h1 className="text-2xl font-black text-slate-900">欠席・遅刻の連絡</h1>
        </div>
      </div>

      {students.length === 0 ? (
        <div className="rounded-2xl bg-white p-8 text-center text-sm font-bold text-slate-400 shadow-sm">
          紐づく生徒がないため送信できません。
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5 rounded-[28px] bg-white p-6 shadow-sm">
          <div>
            <label className="mb-2 block text-xs font-black text-slate-500">対象生徒</label>
            <select value={studentId} onChange={e => setStudentId(e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black outline-none focus:ring-2 focus:ring-indigo-100">
              {students.map(student => <option key={student.id} value={student.id}>{student.student_name || student.id}</option>)}
            </select>
          </div>

          <div>
            <label className="mb-2 flex items-center gap-2 text-xs font-black text-slate-500"><CalendarCheck size={14} /> 種類</label>
            <div className="grid grid-cols-2 gap-3">
              <button type="button" onClick={() => setType('absent')} className={`rounded-2xl border-2 p-4 font-black ${type === 'absent' ? 'border-rose-300 bg-rose-50 text-rose-600' : 'border-slate-100 bg-slate-50 text-slate-400'}`}>欠席</button>
              <button type="button" onClick={() => setType('late')} className={`rounded-2xl border-2 p-4 font-black ${type === 'late' ? 'border-amber-300 bg-amber-50 text-amber-600' : 'border-slate-100 bg-slate-50 text-slate-400'}`}>遅刻</button>
            </div>
          </div>

          <div>
            <label className="mb-2 flex items-center gap-2 text-xs font-black text-slate-500"><Clock size={14} /> 日付</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black outline-none focus:ring-2 focus:ring-indigo-100" />
          </div>

          <div>
            <label className="mb-2 flex items-center gap-2 text-xs font-black text-slate-500"><MessageSquare size={14} /> 理由</label>
            <textarea value={reason} onChange={e => setReason(e.target.value)} required className="min-h-36 w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-100" placeholder="理由や連絡事項を入力してください" />
          </div>

          <button disabled={submitting} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 py-4 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-60">
            <Send size={18} /> {submitting ? '送信中...' : '連絡する'}
          </button>
        </form>
      )}
    </div>
  );
}
