import { NextRequest } from 'next/server';
import { unstable_cache } from 'next/cache';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError } from '@/lib/server-auth';
import { enrichCourseOptionsWithShifts } from '@/lib/course-registration-match';
import { canStudentRegisterCourseOption, normalizeCourseGrade } from '@/lib/course-registration-rules';

export const runtime = 'nodejs';

const toAsciiDigits = (value: string) => value.replace(/[０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xfee0));

const currentCourseYear = () => {
  const now = new Date();
  return now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
};

const courseYearDateRange = (year: number) => ({
  start: `${year}-04-01`,
  end: `${year + 1}-03-31`,
});

const todayInJapan = () => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

const getOptionTermKey = (option: any) => {
  if (!option) return '';
  const year = Number(option.year || new Date().getFullYear());
  const term = String(option.term || option.term_label || 'term').trim() || 'term';
  return `${year}__${term}`;
};

const normalizeDateKey = (value: any) => {
  if (!value) return '';
  if (typeof value?.toDate === 'function') return value.toDate().toISOString().slice(0, 10);
  const raw = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
};

const normalizeWeekKey = (value: any) => toAsciiDigits(String(value || '').normalize('NFKC')).trim();

const buildTermDateRanges = (curriculumRows: any[], lessonRows: any[]) => {
  const datesByWeek = lessonRows.reduce((acc, row) => {
    const week = normalizeWeekKey(row.week_no || row.lesson_no);
    const dates = [
      row.start_date,
      row.end_date,
      row.target_date,
    ].map(normalizeDateKey).filter(Boolean);
    if (!week || dates.length === 0) return acc;
    if (!acc[week]) acc[week] = [];
    acc[week].push(...dates);
    return acc;
  }, {} as Record<string, string[]>);

  const rangeDates = curriculumRows.reduce((acc, row) => {
    const key = getOptionTermKey(row);
    if (!key) return acc;
    const week = normalizeWeekKey(row.week_no || row.lesson_no);
    const dates = [
      row.start_date,
      row.end_date,
      row.target_date,
      ...(datesByWeek[week] || []),
    ].map(normalizeDateKey).filter(Boolean);
    if (dates.length === 0) return acc;
    if (!acc[key]) acc[key] = [];
    acc[key].push(...dates);
    return acc;
  }, {} as Record<string, string[]>);

  return Object.fromEntries((Object.entries(rangeDates) as [string, string[]][]).map(([key, dates]) => {
    const sorted = Array.from(new Set(dates)).sort();
    return [key, { start: sorted[0], end: sorted[sorted.length - 1] }];
  })) as Record<string, { start: string; end: string }>;
};

const getRowsForYear = async (collectionName: string, year: number, rowLimit: number) => {
  const db = adminDb();
  const yearSnap = await db.collection(collectionName)
    .where('year', '==', year)
    .limit(rowLimit)
    .get();
  if (!yearSnap.empty) return yearSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  // 年度フィールドがない旧データだけが残っている環境向けの互換処理。
  const legacySnap = await db.collection(collectionName).limit(rowLimit).get();
  return legacySnap.docs
    .map(doc => ({ id: doc.id, ...doc.data() } as any))
    .filter(row => !row.year || Number(row.year) === year);
};

const getCachedCourseOptions = unstable_cache(async (requestedGrade: string, year: number) => {
    const range = courseYearDateRange(year);
    const db = adminDb();

    const [allOptions, allCurriculumRows, lessonRows] = await Promise.all([
      getRowsForYear('course_registration_options', year, 1000),
      getRowsForYear('annual_curriculum_schedules', year, 2000),
      getRowsForYear('annual_lesson_schedules', year, 2000),
    ]);

    const rawOptions = allOptions
      .filter((option: any) => option.is_active !== false);
    const curriculumRows = allCurriculumRows
      .filter((row: any) => !requestedGrade || canStudentRegisterCourseOption(requestedGrade, row));
    const termRanges = buildTermDateRanges(
      curriculumRows.filter((row: any) => canStudentRegisterCourseOption(requestedGrade, row)),
      lessonRows,
    );
    const today = todayInJapan();
    const activeRanges = Object.values(termRanges).filter(termRange => termRange.start <= today && today <= termRange.end);
    const shiftRange = activeRanges.length > 0 ? {
      start: activeRanges.map(termRange => termRange.start).sort()[0],
      end: activeRanges.map(termRange => termRange.end).sort().at(-1)!,
    } : range;
    const shiftSnap = await db.collection('shift_assignments')
      .where('target_date', '>=', shiftRange.start)
      .where('target_date', '<=', shiftRange.end)
      .orderBy('target_date', 'asc')
      .limit(5000)
      .get();
    const allShiftRows = shiftSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const shiftRows = allShiftRows
      .filter((row: any) => !requestedGrade || canStudentRegisterCourseOption(requestedGrade, row));
    const options = enrichCourseOptionsWithShifts(rawOptions, curriculumRows, shiftRows, termRanges)
      .filter((option: any) => canStudentRegisterCourseOption(requestedGrade, option));

    const payload = {
      ok: true,
      grade: requestedGrade,
      year,
      options,
      term_ranges: termRanges,
      source_counts: {
        options: rawOptions.length,
        curriculum: curriculumRows.length,
        lessons: lessonRows.length,
        shifts: shiftRows.length,
        shifts_before_grade_filter: allShiftRows.length,
        shift_range: shiftRange,
        returned: options.length,
      },
    };
    return payload;
}, ['course-registration-options-v4'], {
  revalidate: 300,
  tags: ['course-registration-options'],
});

export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    const requestedGrade = normalizeCourseGrade(request.nextUrl.searchParams.get('grade') || user.profile.grade);
    const year = Number(request.nextUrl.searchParams.get('year') || currentCourseYear());
    const payload = await getCachedCourseOptions(requestedGrade, year);
    return Response.json(payload, {
      headers: { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=240' },
    });
  } catch (error) {
    return jsonError(error);
  }
}
