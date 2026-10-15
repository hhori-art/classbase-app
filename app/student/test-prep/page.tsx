'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowLeft,
  BookOpenCheck,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import { loadCourseRegistrationOptions } from '@/lib/client-course-options';
import { getCourseDay, getCourseSlot } from '@/app/components/CourseRegistrationCalendar';

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

const todayInJapan = () => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

const formatDate = (value: string) => {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${Number(match[2])}/${Number(match[3])}` : value || '未設定';
};

const definitionKey = (option: any) => String(option.test_prep_definition_id || '');

export default function StudentTestPrepPage() {
  const { user, profile } = useAuth();
  const [definitions, setDefinitions] = useState<TestPrepDefinition[]>([]);
  const [options, setOptions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!user || !profile?.grade) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    loadCourseRegistrationOptions({
      grade: String(profile.grade),
      getToken: forceRefresh => user.getIdToken(forceRefresh),
      force: reloadKey > 0,
    }).then(payload => {
      if (cancelled) return;
      setDefinitions(Array.isArray(payload.test_prep_definitions) ? payload.test_prep_definitions : []);
      setOptions((Array.isArray(payload.options) ? payload.options : []).filter((option: any) => option.registration_type === 'test_prep'));
    }).catch(fetchError => {
      console.error('test prep list fetch failed:', fetchError);
      if (!cancelled) setError('テスト対策一覧を読み込めませんでした。');
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [profile?.grade, reloadKey, user]);

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

  const today = todayInJapan();

  return (
    <main className="min-h-screen bg-slate-50 px-4 pb-32 pt-5 sm:px-6">
      <div className="mx-auto max-w-3xl">
        <header className="mb-6 flex items-center gap-4">
          <Link href="/student" aria-label="ホームへ戻る" className="rounded-2xl border border-slate-200 bg-white p-3 text-slate-500 shadow-sm transition hover:text-amber-600">
            <ArrowLeft size={22} />
          </Link>
          <div>
            <p className="text-xs font-black text-amber-600">TEST PREP</p>
            <h1 className="text-2xl font-black text-slate-900">テスト期間一覧</h1>
            <p className="mt-1 text-xs font-bold text-slate-500">自分の学年のテスト期間と対策講座を確認できます</p>
          </div>
        </header>

        <div className="mb-6 rounded-3xl bg-gradient-to-br from-amber-500 to-orange-500 p-5 text-white shadow-lg shadow-amber-100">
          <div className="flex items-start gap-3">
            <BookOpenCheck className="mt-0.5 shrink-0" size={25} />
            <div><p className="font-black">ここで分かること</p><p className="mt-1 text-sm font-bold leading-relaxed text-white/90">実施期間、受付期間、科目・単元、受講できる曜日と時間、登録済みかどうかをまとめて確認できます。</p></div>
          </div>
        </div>

        {loading && <div className="flex min-h-64 items-center justify-center"><Loader2 className="animate-spin text-amber-500" size={38} /></div>}

        {!loading && error && (
          <div className="rounded-3xl border border-rose-100 bg-white p-8 text-center shadow-sm">
            <AlertCircle className="mx-auto text-rose-500" size={36} />
            <p className="mt-3 font-black text-slate-800">{error}</p>
            <button type="button" onClick={() => setReloadKey(value => value + 1)} className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-black text-white"><RefreshCw size={16} />もう一度読み込む</button>
          </div>
        )}

        {!loading && !error && cards.length === 0 && (
          <div className="rounded-3xl border-2 border-dashed border-slate-200 bg-white px-6 py-14 text-center">
            <CalendarDays className="mx-auto text-slate-300" size={42} />
            <h2 className="mt-4 font-black text-slate-700">現在公開中のテスト対策はありません</h2>
            <p className="mt-2 text-sm font-bold text-slate-400">対策が追加されると、この画面に表示されます。</p>
          </div>
        )}

        {!loading && !error && periods.length > 0 && (
          <section className="mb-7" aria-labelledby="test-period-list-heading">
            <div className="mb-3 flex items-end justify-between gap-3">
              <div>
                <p className="text-xs font-black text-amber-600">PERIODS</p>
                <h2 id="test-period-list-heading" className="text-lg font-black text-slate-900">テスト期間一覧</h2>
              </div>
              <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-black text-amber-800">{periods.length}期間</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {periods.map(period => {
                const accepting = period.registrationOpenDate <= today && today <= period.registrationCloseDate;
                const ongoing = period.startDate <= today && today <= period.endDate;
                const upcoming = today < period.startDate;
                const status = accepting ? '受付中' : ongoing ? '実施中' : upcoming ? '今後実施' : '終了';
                const statusStyle = accepting
                  ? 'bg-blue-100 text-blue-700'
                  : ongoing
                    ? 'bg-orange-100 text-orange-700'
                    : upcoming
                      ? 'bg-violet-100 text-violet-700'
                      : 'bg-slate-100 text-slate-500';
                return (
                  <article key={period.key} className="rounded-3xl border border-amber-100 bg-white p-5 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="font-black leading-snug text-slate-900">{period.title}</h3>
                      <span className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-black ${statusStyle}`}>{status}</span>
                    </div>
                    <p className="mt-3 flex items-center gap-2 text-sm font-black text-slate-700"><CalendarDays size={16} className="text-amber-500" />{formatDate(period.startDate)}〜{formatDate(period.endDate)}</p>
                    <p className="mt-2 flex items-center gap-2 text-xs font-bold text-slate-500"><Clock3 size={15} className="text-blue-500" />受付 {formatDate(period.registrationOpenDate)}〜{formatDate(period.registrationCloseDate)}</p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {period.subjects.map(subject => <span key={subject} className="rounded-lg bg-amber-50 px-2.5 py-1 text-[11px] font-black text-amber-800">{subject}</span>)}
                      <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-black text-slate-600">{period.courses.length}講座</span>
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
              <p className="text-xs font-black text-slate-400">COURSES</p>
              <h2 id="test-prep-detail-heading" className="text-lg font-black text-slate-900">講座別の詳細</h2>
            </div>
            <div className="space-y-4">
            {cards.map(({ definition, schedules, registered }) => {
              const ongoing = definition.start_date <= today && today <= definition.end_date;
              const accepting = definition.registration_open_date <= today && today <= definition.registration_close_date;
              return (
                <article key={definition.id} className="overflow-hidden rounded-3xl border border-amber-100 bg-white shadow-sm">
                  <div className="border-b border-amber-100 bg-amber-50/70 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-amber-500 px-3 py-1 text-[11px] font-black text-white">{definition.grade} {definition.subject}</span>
                          {registered && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-[11px] font-black text-emerald-700"><CheckCircle2 size={13} />登録済み</span>}
                          {!registered && accepting && <span className="rounded-full bg-blue-100 px-3 py-1 text-[11px] font-black text-blue-700">受付中</span>}
                          {ongoing && <span className="rounded-full bg-orange-100 px-3 py-1 text-[11px] font-black text-orange-700">実施中</span>}
                        </div>
                        <h2 className="mt-3 text-lg font-black text-slate-900">{definition.title}</h2>
                        <p className="mt-1 text-sm font-black text-amber-800">{definition.course_name}</p>
                      </div>
                    </div>
                    <div className="mt-4 grid gap-2 text-xs font-bold text-slate-600 sm:grid-cols-2">
                      <p className="flex items-center gap-2 rounded-xl bg-white px-3 py-2"><CalendarDays size={15} className="text-amber-500" />実施 {formatDate(definition.start_date)}〜{formatDate(definition.end_date)}</p>
                      <p className="flex items-center gap-2 rounded-xl bg-white px-3 py-2"><Clock3 size={15} className="text-blue-500" />受付 {formatDate(definition.registration_open_date)}〜{formatDate(definition.registration_close_date)}</p>
                    </div>
                  </div>
                  <div className="space-y-4 p-5">
                    <section><h3 className="text-xs font-black text-slate-400">対策する単元</h3><div className="mt-2 flex flex-wrap gap-2">{definition.units.length > 0 ? definition.units.map(unit => <span key={unit} className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700">{unit}</span>) : <span className="text-xs font-bold text-slate-400">単元は後日案内されます</span>}</div></section>
                    <section><h3 className="text-xs font-black text-slate-400">受講できる曜日・時間</h3><div className="mt-2 flex flex-wrap gap-2">{schedules.length > 0 ? schedules.map(schedule => <span key={schedule} className="rounded-xl bg-blue-50 px-3 py-2 text-xs font-black text-blue-700">{schedule}</span>) : <span className="text-xs font-bold text-slate-400">日時は後日案内されます</span>}</div></section>
                    <Link href="/student/change-request" className="flex items-center justify-between rounded-2xl bg-slate-900 px-4 py-3 text-sm font-black text-white transition hover:bg-slate-800">
                      <span>{registered ? '登録内容を確認・変更' : accepting ? 'この対策を登録' : '受講講座の登録画面を確認'}</span><ChevronRight size={18} />
                    </Link>
                  </div>
                </article>
              );
            })}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
