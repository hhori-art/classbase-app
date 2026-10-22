'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, BellRing, BookOpenCheck, CalendarDays } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import { loadCourseRegistrationOptions } from '@/lib/client-course-options';
import { formatDate, jstDateKey } from '@/lib/format';
import { Button, ButtonLink, Modal } from '@/app/components/ui';

type RegistrationRequest = {
  id: string;
  title: string;
  period_start: string;
  period_end: string;
  course_option_ids: string[];
  is_fallback?: boolean;
};

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
      const today = jstDateKey();
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
  const periodEndText = request.period_end ? formatDate(request.period_end) : '-';
  const notificationCard = (
    <Link href={registrationHref} className="cb-card mb-5 flex items-center gap-4 !border-2 !border-accent/30 p-card text-left transition hover:!border-accent focus-visible:outline-none focus-visible:!ring-2 focus-visible:ring-accent">
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-btn bg-accent text-accent-ink"><BellRing size={23} aria-hidden /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-bold tracking-wide text-accent">{request.is_fallback ? '未登録のためご案内しています' : '受付中・応答が必要です'}</span>
        <span className="mt-1 block text-base font-bold text-fg">{request.title}</span>
        <span className="mt-1 block text-xs text-fg-muted">{request.is_fallback ? '直近の受付期間' : '期限'} {periodEndText}　選択候補 {courseCounts[request.id] || 0}件</span>
      </span>
      <ArrowRight className="shrink-0 text-accent" size={22} aria-hidden />
    </Link>
  );

  if (mode === 'notification') return notificationCard;
  return (
    <>
      <div className="relative z-20 mx-auto w-full max-w-6xl px-4 pt-4 sm:px-6">{notificationCard}</div>
      <Modal
        open={showModal}
        onClose={closeModal}
        title={request.title}
        description={request.is_fallback ? '受付期間は終了していますが、未登録のため直近の講座を登録できます。' : '現在受付中です。自分が受講する講座と曜日・時間を選んでください。'}
        footer={(
          <>
            <Button variant="ghost" onClick={closeModal}>後で登録する</Button>
            <ButtonLink href={registrationHref}>
              {request.is_fallback ? '直近の講座を登録する' : '今すぐ講座を登録する'} <ArrowRight size={20} aria-hidden />
            </ButtonLink>
          </>
        )}
      >
        <div className="flex items-center gap-3 rounded-card bg-accent p-4 text-accent-ink">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-btn bg-white/20"><BookOpenCheck size={26} aria-hidden /></span>
          <p className="text-sm font-bold">講座の登録</p>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="rounded-card bg-canvas p-4"><CalendarDays className="text-accent" size={20} aria-hidden /><p className="mt-2 text-xs font-bold text-fg-muted">登録期限</p><p className="mt-1 text-sm font-bold text-fg">{periodEndText}</p></div>
          <div className="rounded-card bg-canvas p-4"><BookOpenCheck className="text-success" size={20} aria-hidden /><p className="mt-2 text-xs font-bold text-fg-muted">講座候補</p><p className="mt-1 text-sm font-bold text-fg">{courseCounts[request.id] || 0}件</p></div>
        </div>
      </Modal>
    </>
  );
}
