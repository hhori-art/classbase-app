'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  BookOpenCheck,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock3,
} from 'lucide-react';
import { jstDateKey } from '@/lib/format';
import { EmptyState, ErrorState, ListSkeleton, PageHeader, StatusPill, type StatusTone } from '@/app/components/ui';
import { useAuth } from '@/app/context/AuthContext';
import { loadCourseRegistrationOptions } from '@/lib/client-course-options';
import { getCourseDay, getCourseSlot } from '@/app/components/CourseRegistrationCalendar';
import { normalizeGrade } from '@/lib/test-prep-registration';
import ReviewPeriodEntryCard from '@/app/components/ReviewPeriodEntryCard';

type TestPrepDefinition = {
  id: string;
  title: string;
  grade: string;
  subject: string;
  course_name: string;
  units: string[];
  start_date: string;
  end_date: string;
  registration_open_date: string;
  registration_close_date: string;
};

type TestPeriodSummary = {
  key: string;
  title: string;
  startDate: string;
  endDate: string;
  registrationOpenDate: string;
  registrationCloseDate: string;
  subjects: string[];
  courses: string[];
  definitionCount: number;
};

const formatDate = (value: string) => {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${Number(match[2])}/${Number(match[3])}` : value || '未設定';
};

type ReviewItem = { subject: string; grade: string };
type ReviewRange = { start_date: string; end_date: string; items: ReviewItem[] };

/**
 * 塾が設定したテスト対策（復習期間）の期間と重なり、その期間に同じ科目・学年の実施単元がある対策講座だけを表示する。
 * 期間の実施単元は、APIで生徒の学年（または全学年）に絞り込み済み。
 */
const withinReviewPeriods = (definition: TestPrepDefinition, ranges: ReviewRange[], studentGrade: string) => ranges.some(range => (
  Boolean(definition.start_date && definition.end_date) &&
  definition.start_date <= range.end_date && definition.end_date >= range.start_date &&
  range.items.some(item => {
    const itemGrade = String(item.grade || '').trim();
    const gradeOk = !itemGrade || itemGrade === '全学年' ||
      normalizeGrade(itemGrade) === normalizeGrade(definition.grade) ||
      normalizeGrade(itemGrade) === normalizeGrade(studentGrade);
    return item.subject === definition.subject && gradeOk;
  })
));

const definitionKey = (option: any) => String(option.test_prep_definition_id || '');

export default function StudentTestPrepPage() {
  const { user, profile } = useAuth();
  const [definitions, setDefinitions] = useState<TestPrepDefinition[]>([]);
  const [options, setOptions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  // プロフィールは読み込めたが学年が未登録のとき（読み込み中のスピナーのまま止まらないようにする）。
  const profileLoaded = Boolean(profile);
  const studentGrade = String(profile?.grade || '');
  const gradeMissing = Boolean(user && profileLoaded && !studentGrade);

  useEffect(() => {
    if (!user || !profileLoaded) return;
    if (!studentGrade) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    const loadReviewRanges = async (): Promise<ReviewRange[]> => {
      const response = await fetch('/api/review-periods', { headers: { Authorization: `Bearer ${await user.getIdToken()}` }, cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'review-periods-failed');
      return (Array.isArray(data.periods) ? data.periods : [])
        .map((period: any) => ({
          start_date: String(period.start_date || ''),
          end_date: String(period.end_date || ''),
          items: (Array.isArray(period.items) ? period.items : []).map((item: any) => ({ subject: String(item?.subject || ''), grade: String(item?.grade || '') })),
        }))
        .filter((range: ReviewRange) => range.start_date && range.end_date);
    };
    Promise.all([
      loadCourseRegistrationOptions({
        grade: studentGrade,
        getToken: forceRefresh => user.getIdToken(forceRefresh),
        force: reloadKey > 0,
      }),
      loadReviewRanges(),
    ]).then(([payload, reviewRanges]) => {
      if (cancelled) return;
      const allDefinitions: TestPrepDefinition[] = Array.isArray(payload.test_prep_definitions) ? payload.test_prep_definitions : [];
      setDefinitions(allDefinitions.filter(definition => withinReviewPeriods(definition, reviewRanges, studentGrade)));
      setOptions((Array.isArray(payload.options) ? payload.options : []).filter((option: any) => option.registration_type === 'test_prep'));
    }).catch(fetchError => {
      console.error('test prep list fetch failed:', fetchError);
      if (!cancelled) setError('テスト対策一覧を読み込めませんでした。');
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [profileLoaded, studentGrade, reloadKey, user]);

  const selectedIds = useMemo(() => new Set([
    ...(Array.isArray(profile?.selected_test_prep_course_ids) ? profile.selected_test_prep_course_ids : []),
    ...(Array.isArray(profile?.selected_test_prep_course_keys) ? profile.selected_test_prep_course_keys : []),
  ].map(String)), [profile?.selected_test_prep_course_ids, profile?.selected_test_prep_course_keys]);

  const cards = useMemo(() => definitions.map(definition => {
    const courseOptions = options.filter(option => definitionKey(option) === definition.id);
    const schedules = Array.from(new Set(courseOptions.map(option => {
      const day = getCourseDay(option);
      const slot = getCourseSlot(option);
      return [day ? `${day}曜` : '', slot].filter(Boolean).join(' ');
    }).filter(Boolean)));
    const registered = courseOptions.some(option => (
      selectedIds.has(String(option.id || '')) || selectedIds.has(String(option.stable_course_key || ''))
    ));
    return { definition, schedules, registered };
  }).sort((a, b) => `${a.definition.start_date}_${a.definition.subject}_${a.definition.course_name}`
    .localeCompare(`${b.definition.start_date}_${b.definition.subject}_${b.definition.course_name}`, 'ja', { numeric: true })), [definitions, options, selectedIds]);

  const periods = useMemo(() => {
    const grouped = new Map<string, {
      title: string;
      startDate: string;
      endDate: string;
      registrationOpenDate: string;
      registrationCloseDate: string;
      subjects: Set<string>;
      courses: Set<string>;
      definitionCount: number;
    }>();
    definitions.forEach(definition => {
      const key = [
        definition.title,
        definition.start_date,
        definition.end_date,
        definition.registration_open_date,
        definition.registration_close_date,
      ].join('__');
      const current = grouped.get(key) || {
        title: definition.title,
        startDate: definition.start_date,
        endDate: definition.end_date,
        registrationOpenDate: definition.registration_open_date,
        registrationCloseDate: definition.registration_close_date,
        subjects: new Set<string>(),
        courses: new Set<string>(),
        definitionCount: 0,
      };
      if (definition.subject) current.subjects.add(definition.subject);
      if (definition.course_name) current.courses.add(definition.course_name);
      current.definitionCount += 1;
      grouped.set(key, current);
    });
    return Array.from(grouped.entries()).map(([key, value]): TestPeriodSummary => ({
      key,
      title: value.title,
      startDate: value.startDate,
      endDate: value.endDate,
      registrationOpenDate: value.registrationOpenDate,
      registrationCloseDate: value.registrationCloseDate,
      subjects: Array.from(value.subjects).sort((a, b) => a.localeCompare(b, 'ja')),
      courses: Array.from(value.courses).sort((a, b) => a.localeCompare(b, 'ja')),
      definitionCount: value.definitionCount,
    })).sort((a, b) => `${a.startDate}_${a.title}`.localeCompare(`${b.startDate}_${b.title}`, 'ja', { numeric: true }));
  }, [definitions]);

  const today = jstDateKey();

  return (
    <main className="mx-auto max-w-3xl space-y-5 px-4 py-6">
      <PageHeader tone="hero" eyebrow="テスト対策" title="テスト期間一覧" description="自分の学年のテスト期間と対策講座を確認できます" icon={ClipboardList} backHref="/student" />

      <div className="flex items-start gap-3 rounded-card border border-amber-100 bg-amber-50 p-card">
        <BookOpenCheck className="mt-0.5 shrink-0 text-amber-600" size={25} aria-hidden />
        <div><p className="font-bold text-amber-900">ここで分かること</p><p className="mt-1 text-sm leading-relaxed text-amber-800">実施期間、受付期間、科目・単元、受講できる曜日と時間、登録済みかどうかをまとめて確認できます。</p></div>
      </div>

      {/* 復習期間の受付中だけ、受講設定への入口を出す */}
      <ReviewPeriodEntryCard />

      {gradeMissing && (
        <div className="rounded-card border border-amber-200 bg-warning-soft p-8 text-center">
          <h2 className="font-bold text-amber-900">学年未登録</h2>
          <p className="mt-2 text-sm text-amber-800">学年が登録されていないため、テスト対策を表示できません。所属校舎の先生に学年の登録を依頼してください。</p>
        </div>
      )}

      {!gradeMissing && loading && <ListSkeleton rows={4} />}

      {!gradeMissing && !loading && error && (
        <ErrorState title={error} onRetry={() => setReloadKey(value => value + 1)} />
      )}

      {!gradeMissing && !loading && !error && cards.length === 0 && (
        <EmptyState icon={CalendarDays} title="現在予定されているテスト期間はありません" description="塾がテスト対策の期間を設定すると、この画面に表示されます。" className="bg-surface py-14" />
      )}

      {!loading && !error && periods.length > 0 && (
        <section aria-labelledby="test-period-list-heading">
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <p className="text-xs font-bold text-accent">期間</p>
              <h2 id="test-period-list-heading" className="text-lg font-bold text-fg">テスト期間一覧</h2>
            </div>
            <StatusPill tone="accent">{periods.length}期間</StatusPill>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {periods.map(period => {
              const accepting = period.registrationOpenDate <= today && today <= period.registrationCloseDate;
              const ongoing = period.startDate <= today && today <= period.endDate;
              const upcoming = today < period.startDate;
              const status = accepting ? '受付中' : ongoing ? '実施中' : upcoming ? '今後実施' : '終了';
              const statusTone: StatusTone = accepting ? 'accent' : ongoing ? 'warning' : upcoming ? 'info' : 'neutral';
              return (
                <article key={period.key} className="cb-card p-card">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-bold leading-snug text-fg">{period.title}</h3>
                    <StatusPill tone={statusTone} className="shrink-0">{status}</StatusPill>
                  </div>
                  <p className="mt-3 flex items-center gap-2 text-sm font-bold text-fg"><CalendarDays size={16} className="text-accent" aria-hidden />{formatDate(period.startDate)}〜{formatDate(period.endDate)}</p>
                  <p className="mt-2 flex items-center gap-2 text-xs font-medium text-fg-muted"><Clock3 size={15} className="text-info" aria-hidden />受付 {formatDate(period.registrationOpenDate)}〜{formatDate(period.registrationCloseDate)}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {period.subjects.map(subject => <span key={subject} className="rounded-btn bg-accent-soft px-2.5 py-1 text-xs font-bold text-accent">{subject}</span>)}
                    <span className="rounded-btn bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">{period.courses.length}講座</span>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {!loading && !error && cards.length > 0 && (
        <section aria-labelledby="test-prep-detail-heading">
          <div className="mb-3">
            <p className="text-xs font-bold text-fg-muted">講座</p>
            <h2 id="test-prep-detail-heading" className="text-lg font-bold text-fg">講座別の詳細</h2>
          </div>
          <div className="space-y-4">
          {cards.map(({ definition, schedules, registered }) => {
            const ongoing = definition.start_date <= today && today <= definition.end_date;
            const accepting = definition.registration_open_date <= today && today <= definition.registration_close_date;
            return (
              <article key={definition.id} className="cb-card overflow-hidden">
                <div className="border-b border-line bg-accent-soft/60 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-accent px-3 py-0.5 text-xs font-bold text-accent-ink">{definition.grade} {definition.subject}</span>
                        {registered && <StatusPill tone="success" icon={<CheckCircle2 size={13} aria-hidden />}>登録済み</StatusPill>}
                        {!registered && accepting && <StatusPill tone="accent">受付中</StatusPill>}
                        {ongoing && <StatusPill tone="warning">実施中</StatusPill>}
                      </div>
                      <h2 className="mt-3 text-lg font-bold text-fg">{definition.title}</h2>
                      <p className="mt-1 text-sm font-bold text-accent">{definition.course_name}</p>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-2 text-xs font-medium text-fg-muted sm:grid-cols-2">
                    <p className="flex items-center gap-2 rounded-btn bg-surface px-3 py-2"><CalendarDays size={15} className="text-accent" aria-hidden />実施 {formatDate(definition.start_date)}〜{formatDate(definition.end_date)}</p>
                    <p className="flex items-center gap-2 rounded-btn bg-surface px-3 py-2"><Clock3 size={15} className="text-info" aria-hidden />受付 {formatDate(definition.registration_open_date)}〜{formatDate(definition.registration_close_date)}</p>
                  </div>
                </div>
                <div className="space-y-4 p-5">
                  <section><h3 className="text-xs font-bold text-fg-muted">対策する単元</h3><div className="mt-2 flex flex-wrap gap-2">{definition.units.length > 0 ? definition.units.map(unit => <span key={unit} className="rounded-btn bg-slate-100 px-3 py-2 text-xs font-medium text-fg">{unit}</span>) : <span className="text-xs text-fg-muted">単元は後日案内されます</span>}</div></section>
                  <section><h3 className="text-xs font-bold text-fg-muted">受講できる曜日・時間</h3><div className="mt-2 flex flex-wrap gap-2">{schedules.length > 0 ? schedules.map(schedule => <span key={schedule} className="rounded-btn bg-info-soft px-3 py-2 text-xs font-bold text-info">{schedule}</span>) : <span className="text-xs text-fg-muted">日時は後日案内されます</span>}</div></section>
                  <Link href="/student/change-request" className="flex min-h-11 items-center justify-between rounded-btn bg-accent px-4 py-3 text-sm font-bold text-accent-ink transition hover:bg-accent-hover">
                    <span>{registered ? '登録内容を確認・変更' : accepting ? 'この対策を登録' : '受講講座の登録画面を確認'}</span><ChevronRight size={18} aria-hidden />
                  </Link>
                </div>
              </article>
            );
          })}
          </div>
        </section>
      )}
    </main>
  );
}
