'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { collection, getDocs, limit, query, orderBy } from 'firebase/firestore';
import { ArrowLeft, BookOpen, Calendar, CheckCircle, Loader2, RefreshCw, Users } from 'lucide-react';
import { db } from '@/lib/firebase';
import { getCourseSubjectGroup, normalizeCourseText } from '@/lib/course-text';

const normalize = normalizeCourseText;
const sameSubjectGroup = (left: unknown, right: unknown) => {
  const leftGroup = getCourseSubjectGroup(left);
  const rightGroup = getCourseSubjectGroup(right);
  if (leftGroup && rightGroup) return leftGroup === rightGroup;
  const a = normalize(left);
  const b = normalize(right);
  return !a || !b || a === b || a.includes(b) || b.includes(a);
};

type Row = {
  id: string;
  grade?: string;
  subject?: string;
  course_name?: string;
  title?: string;
  resolved_day?: string;
  resolved_slot?: string;
  resolved_unit?: string;
  unit?: string;
  matched_shift_ids?: string[];
};

export default function MasterCourseAllocationPage() {
  const [options, setOptions] = useState<Row[]>([]);
  const [schedules, setSchedules] = useState<any[]>([]);
  const [shifts, setShifts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [optionSnap, scheduleSnap, shiftSnap] = await Promise.all([
        getDocs(query(collection(db, 'course_registration_options'), limit(1000))),
        getDocs(query(collection(db, 'annual_curriculum_schedules'), limit(1500))),
        getDocs(query(collection(db, 'shift_assignments'), orderBy('target_date', 'desc'), limit(800))),
      ]);
      setOptions(optionSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Row)).filter(row => (row as any).is_active !== false));
      setSchedules(scheduleSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      setShifts(shiftSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const rows = useMemo(() => {
    return options.map(option => {
      const course = option.course_name || option.title || '';
      const unit = option.resolved_unit || option.unit || '';
      const relatedSchedules = schedules.filter(schedule => {
        const sameGrade = !option.grade || !schedule.grade || normalize(option.grade) === normalize(schedule.grade);
        const sameSubject = sameSubjectGroup(option.subject, [schedule.subject, schedule.course_name, schedule.title].filter(Boolean).join(' '));
        const courseHit = !course || normalize(schedule.course_name || schedule.title).includes(normalize(course)) || normalize(course).includes(normalize(schedule.course_name || schedule.title));
        const unitHit = !unit || normalize(schedule.unit).includes(normalize(unit)) || normalize(unit).includes(normalize(schedule.unit));
        return sameGrade && sameSubject && (courseHit || unitHit);
      });
      const relatedShifts = shifts.filter(shift => {
        if (Array.isArray(option.matched_shift_ids) && option.matched_shift_ids.includes(shift.id)) return true;
        const sameGrade = !option.grade || !shift.target_grade || normalize(option.grade) === normalize(shift.target_grade);
        const sameSubject = sameSubjectGroup(option.subject, [shift.target_subject, shift.target_detail_subject].filter(Boolean).join(' '));
        const courseHit = !course || normalize(shift.target_detail_subject || shift.target_subject).includes(normalize(course)) || normalize(course).includes(normalize(shift.target_detail_subject || shift.target_subject));
        const unitHit = !unit || normalize(shift.unit).includes(normalize(unit)) || normalize(unit).includes(normalize(shift.unit));
        return sameGrade && sameSubject && (courseHit || unitHit);
      });
      return { option, relatedSchedules, relatedShifts };
    });
  }, [options, schedules, shifts]);

  const linkedCount = rows.filter(row => row.relatedShifts.length > 0).length;

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link href="/master" className="rounded-full bg-white p-3 text-slate-500 shadow-sm"><ArrowLeft size={20} /></Link>
            <div>
              <h1 className="text-2xl font-black text-slate-900">講座割当管理</h1>
              <p className="text-sm font-bold text-slate-500">受講登録、年間予定、講師配置の紐づきを確認します。</p>
            </div>
          </div>
          <button onClick={load} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-black text-white">
            {loading ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />} 再読み込み
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl bg-white p-5 shadow-sm"><BookOpen className="mb-2 text-indigo-500" /><p className="text-xs font-black text-slate-400">講座候補</p><p className="text-2xl font-black">{options.length}</p></div>
          <div className="rounded-2xl bg-white p-5 shadow-sm"><Calendar className="mb-2 text-emerald-500" /><p className="text-xs font-black text-slate-400">年間予定</p><p className="text-2xl font-black">{schedules.length}</p></div>
          <div className="rounded-2xl bg-white p-5 shadow-sm"><CheckCircle className="mb-2 text-sky-500" /><p className="text-xs font-black text-slate-400">講師配置と一致</p><p className="text-2xl font-black">{linkedCount}</p></div>
        </div>

        <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4">
            <p className="text-sm font-black text-slate-700">割当一覧</p>
            <p className="mt-1 text-xs font-bold text-slate-400">ここで一致している講座だけが、生徒の参加ボタン判定に使われます。</p>
          </div>
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="sticky top-0 bg-slate-50 text-xs font-black text-slate-500">
                <tr><th className="p-4">講座</th><th className="p-4">曜日/時限</th><th className="p-4">単元</th><th className="p-4">年間予定</th><th className="p-4">講師配置</th><th className="p-4">状態</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map(({ option, relatedSchedules, relatedShifts }) => (
                  <tr key={option.id} className="align-top">
                    <td className="p-4 font-black text-slate-800">{[option.grade, option.subject, option.course_name || option.title].filter(Boolean).join(' ')}</td>
                    <td className="p-4 font-bold text-slate-500">{[option.resolved_day && `${option.resolved_day}曜`, option.resolved_slot].filter(Boolean).join(' ') || '-'}</td>
                    <td className="p-4 font-bold text-slate-500">{option.resolved_unit || option.unit || '-'}</td>
                    <td className="p-4 text-xs font-bold text-slate-500">{relatedSchedules.slice(0, 3).map(s => s.month_label || s.target_date || s.title).filter(Boolean).join(' / ') || '-'}</td>
                    <td className="p-4 text-xs font-bold text-slate-500">{relatedShifts.slice(0, 3).map(s => `${s.target_date || ''} ${s.target_detail_subject || s.target_subject || ''}`).join(' / ') || '-'}</td>
                    <td className="p-4">
                      <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-black ${relatedShifts.length ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                        <Users size={12} /> {relatedShifts.length ? '連動中' : '講師配置未一致'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
