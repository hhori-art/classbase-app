'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, BellRing, BookOpenCheck, CalendarDays, X } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import { loadCourseRegistrationOptions } from '@/lib/client-course-options';

type RegistrationRequest = {
  id: string;
  title: string;
  period_start: string;
  period_end: string;
  course_option_ids: string[];
  is_fallback?: boolean;
};

const todayInJapan = () => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

export default function StudentCourseRegistrationPrompt({ mode = 'home' }: { mode?: 'home' | 'notification' }) {
  const { user, profile } = useAuth();
  const [requests, setRequests] = useState<RegistrationRequest[]>([]);
  const [courseCounts, setCourseCounts] = useState<Record<string, number>>({});
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    if (!user || !profile?.grade) return;
    let cancelled = false;
    loadCourseRegistrationOptions({
      grade: String(profile.grade),
      getToken: forceRefresh => user.getIdToken(forceRefresh),
    }).then(payload => {
      if (cancelled) return;
      const today = todayInJapan();
      const answered = new Set((Array.isArray(payload.answered_request_ids) ? payload.answered_request_ids : []).map(String));
      const allRequests = (Array.isArray(payload.registration_requests) ? payload.registration_requests : []) as RegistrationRequest[];
      const active = allRequests
        .filter((item: RegistrationRequest) => !answered.has(String(item.id)))
        .filter((item: RegistrationRequest) => (!item.period_start || item.period_start <= today) && (!item.period_end || today <= item.period_end));
      const options = Array.isArray(payload.options) ? payload.options : [];
      const summaries = Array.isArray(payload.registration_summaries) ? payload.registration_summaries : [];
      const profileSelections = [profile?.selected_course_ids, profile?.selected_course_keys, profile?.selected_courses]
        .some(value => Array.isArray(value) && value.length > 0);
      const hasRegistration = profileSelections || summaries.some((item: any) => {
        const values = [item.selected_course_ids, item.selected_course_keys, item.selected_course_labels, item.course_ids];
        return item?.active !== false && values.some(value => Array.isArray(value) && value.length > 0);
      });
      let candidates = active;
      if (candidates.length === 0 && !hasRegistration) {
        const nearest = allRequests
          .filter(item => !answered.has(String(item.id)))
          .sort((a, b) => {
            const aPast = Boolean(a.period_end && a.period_end < today);
            const bPast = Boolean(b.period_end && b.period_end < today);
            if (aPast !== bPast) return aPast ? -1 : 1;
            return aPast
              ? String(b.period_end || '').localeCompare(String(a.period_end || ''))
              : String(a.period_start || '').localeCompare(String(b.period_start || ''));
          });
        if (nearest[0]) candidates = [{ ...nearest[0], is_fallback: true }];
      }
      const counts = Object.fromEntries(candidates.map((item: RegistrationRequest) => [
        item.id,
        options.filter((option: any) => !option.registration_request_id || String(option.registration_request_id) === String(item.id)).length,
      ]));
      const visible = candidates.filter((item: RegistrationRequest) => Number(counts[item.id] || 0) > 0);
      setCourseCounts(counts);
      setRequests(visible);
      if (mode === 'home' && visible[0]) {
        const dismissed = sessionStorage.getItem(`course-registration-prompt:${visible[0].id}`) === 'dismissed';
        setShowModal(!dismissed);
      }
    }).catch(error => console.warn('course registration prompt fetch failed:', error));
    return () => { cancelled = true; };
  }, [mode, profile?.grade, profile?.selected_course_ids, profile?.selected_course_keys, profile?.selected_courses, user]);

  const request = requests[0];
  const registrationHref = useMemo(() => request && !request.is_fallback ? `/student/change-request?request=${encodeURIComponent(request.id)}` : '/student/change-request', [request]);
  if (!request) return null;

  const closeModal = () => {
    sessionStorage.setItem(`course-registration-prompt:${request.id}`, 'dismissed');
    setShowModal(false);
  };
  const notificationCard = (
    <Link href={registrationHref} className="mb-5 flex items-center gap-4 rounded-3xl border-2 border-indigo-200 bg-gradient-to-r from-indigo-50 to-sky-50 p-5 text-left shadow-sm transition hover:border-indigo-400 hover:shadow-md">
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-indigo-600 text-white"><BellRing size={23} /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-black uppercase tracking-wider text-indigo-500">{request.is_fallback ? '未登録のためご案内しています' : '受付中・応答が必要です'}</span>
        <span className="mt-1 block text-base font-black text-slate-900">{request.title}</span>
        <span className="mt-1 block text-xs font-bold text-slate-500">{request.is_fallback ? '直近の受付期間' : '期限'} {request.period_end || '-'}　選択候補 {courseCounts[request.id] || 0}件</span>
      </span>
      <ArrowRight className="shrink-0 text-indigo-600" size={22} />
    </Link>
  );

  if (mode === 'notification') return notificationCard;
  return (
    <>
      <div className="relative z-20 mx-auto w-full max-w-6xl px-4 pt-4 sm:px-6">{notificationCard}</div>
      {showModal ? (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="course-registration-title">
          <div className="w-full max-w-md overflow-hidden rounded-[32px] bg-white shadow-2xl">
            <div className="relative bg-gradient-to-br from-indigo-600 to-sky-500 p-7 text-white">
              <button type="button" onClick={closeModal} aria-label="閉じる" className="absolute right-4 top-4 rounded-full bg-white/15 p-2 hover:bg-white/25"><X size={20} /></button>
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-white/20"><BookOpenCheck size={30} /></span>
              <p className="mt-5 text-xs font-black uppercase tracking-[0.18em] text-indigo-100">Course Registration</p>
              <h2 id="course-registration-title" className="mt-2 text-2xl font-black">{request.title}</h2>
              <p className="mt-2 text-sm font-bold text-indigo-50">{request.is_fallback ? '受付期間は終了していますが、未登録のため直近の講座を登録できます。' : '現在受付中です。自分が受講する講座と曜日・時間を選んでください。'}</p>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-slate-50 p-4"><CalendarDays className="text-indigo-500" size={20} /><p className="mt-2 text-[10px] font-black text-slate-400">登録期限</p><p className="mt-1 text-sm font-black text-slate-800">{request.period_end || '-'}</p></div>
                <div className="rounded-2xl bg-slate-50 p-4"><BookOpenCheck className="text-emerald-500" size={20} /><p className="mt-2 text-[10px] font-black text-slate-400">講座候補</p><p className="mt-1 text-sm font-black text-slate-800">{courseCounts[request.id] || 0}件</p></div>
              </div>
              <Link href={registrationHref} className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-5 py-4 text-base font-black text-white shadow-lg shadow-indigo-200 hover:bg-indigo-700">
                {request.is_fallback ? '直近の講座を登録する' : '今すぐ講座を登録する'} <ArrowRight size={20} />
              </Link>
              <button type="button" onClick={closeModal} className="mt-3 w-full py-2 text-xs font-black text-slate-400 hover:text-slate-600">後で登録する</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
