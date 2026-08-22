import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, jsonError } from '@/lib/server-auth';

export const runtime = 'nodejs';

const termLabel = (term: string) => (
  term === 'term1' ? '第I期' :
  term === 'term2' ? '第II期' :
  term === 'term3' ? '第III期' :
  term === 'summer_special' ? '夏期講習' :
  'その他'
);

const defaultTerms = (year: number) => [
  { id: 'term1', year, label: '第I期', start_week: 1, end_week: 16, start_date: '', end_date: '', registration_opens_at: '', grades: [], includes_ss: false },
  { id: 'term2', year, label: '第II期', start_week: 17, end_week: 30, start_date: '', end_date: '', registration_opens_at: '', grades: [], includes_ss: true },
  { id: 'term3', year, label: '第III期', start_week: 31, end_week: 45, start_date: '', end_date: '', registration_opens_at: '', grades: [], includes_ss: false },
];

const normalizeGrade = (value: unknown) => {
  const raw = String(value || '').replace(/[０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
  if (raw.includes('3')) return '中3';
  if (raw.includes('2')) return '中2';
  if (raw.includes('1')) return '中1';
  return raw.trim();
};

const normalizeGrades = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(normalizeGrade).filter(Boolean)));
};

const termAppliesToGrade = (term: any, grade: unknown) => {
  const grades = normalizeGrades(term.grades);
  if (grades.length === 0) return true;
  const normalizedGrade = normalizeGrade(grade);
  return Boolean(normalizedGrade && grades.includes(normalizedGrade));
};

const termDocId = (year: number, term: any) => {
  const grades = normalizeGrades(term.grades);
  const gradeKey = grades.length > 0 ? `_${grades.join('_')}` : '';
  return `${year}_${term.id}${gradeKey}`.replace(/[^\p{Letter}\p{Number}_-]+/gu, '_').slice(0, 180);
};

const normalizeTermSettings = (terms: any[], year: number) => {
  const withoutLegacySummer = terms
    .filter(term => String(term.id || '') !== 'summer_special')
    .map(term => ({ ...term, year, includes_ss: term.includes_ss === true }));

  if (withoutLegacySummer.length === 0) return defaultTerms(year);

  if (withoutLegacySummer.some(term => term.includes_ss)) return withoutLegacySummer;

  const secondTermIndexes = withoutLegacySummer
    .map((term, index) => ({ term, index }))
    .filter(({ term }) => term.id === 'term2')
    .map(({ index }) => index);
  const targetIndexes = secondTermIndexes.length > 0
    ? new Set(secondTermIndexes)
    : new Set(withoutLegacySummer.length > 0 ? [0] : []);

  return withoutLegacySummer.map((term, index) => ({
    ...term,
    includes_ss: targetIndexes.has(index),
  }));
};

const weekNumber = (value: unknown) => {
  const raw = String(value || '').replace(/[０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
  if (raw === 'SS') return 0;
  const no = Number(raw.replace(/[^\d]/g, ''));
  return Number.isFinite(no) ? no : 0;
};

const resolveTerm = (week: unknown, terms: any[], grade?: unknown) => {
  const rawWeek = String(week || '').trim().toUpperCase();
  const no = weekNumber(week);
  const applicableTerms = terms
    .filter(term => termAppliesToGrade(term, grade))
    .sort((a, b) => normalizeGrades(b.grades).length - normalizeGrades(a.grades).length);
  if (rawWeek === 'SS') {
    return applicableTerms.find(term => term.includes_ss === true)
      || applicableTerms.find(term => term.id === 'term2')
      || applicableTerms[0]
      || null;
  }
  const found = applicableTerms.find(term => {
    return no > 0 && no >= Number(term.start_week || 0) && no <= Number(term.end_week || 0);
  });
  return found || applicableTerms.find(term => term.id === 'term1') || applicableTerms[0] || terms.find(term => term.id === 'term1') || terms[0];
};

const dateMinusDays = (date: string, days: number) => {
  if (!date) return '';
  const d = new Date(`${date}T00:00:00+09:00`);
  if (Number.isNaN(d.getTime())) return '';
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
};

export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    if (!['master', 'admin'].includes(user.role)) throw new Error('forbidden');

    const year = Number(request.nextUrl.searchParams.get('year') || new Date().getFullYear());
    const db = adminDb();
    const [termSnap, lessonSnap, curriculumSnap] = await Promise.all([
      db.collection('curriculum_terms').where('year', '==', year).get(),
      db.collection('annual_lesson_schedules').where('year', '==', year).get(),
      db.collection('annual_curriculum_schedules').where('year', '==', year).limit(1000).get(),
    ]);

    const lessons = lessonSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const weekDates = new Map<string, string[]>();
    lessons.forEach((item: any) => {
      const rawWeek = String(item.week_no || item.lesson_no || '').trim().toUpperCase();
      const week = rawWeek === 'SS' ? 'SS' : String(weekNumber(rawWeek) || '');
      const date = String(item.start_date || item.target_date || '');
      if (!week || !date) return;
      if (!weekDates.has(week)) weekDates.set(week, []);
      weekDates.get(week)!.push(date);
    });

    const storedTerms: any[] = termSnap.empty ? defaultTerms(year) : termSnap.docs.map(doc => {
      const data = doc.data();
      return { ...data, id: data.id || doc.id.replace(`${year}_`, '') };
    });
    const terms = normalizeTermSettings(storedTerms, year);
    const hydratedTerms = terms.map(term => {
      const dates: string[] = [];
      for (let week = Number(term.start_week || 0); week <= Number(term.end_week || 0); week += 1) {
        dates.push(...(weekDates.get(String(week)) || []));
      }
      if (term.includes_ss) dates.push(...(weekDates.get('SS') || []));
      dates.sort();
      const startDate = term.start_date || dates[0] || '';
      const endDate = term.end_date || dates[dates.length - 1] || '';
      return {
        ...term,
        label: term.label || termLabel(term.id),
        start_date: startDate,
        end_date: endDate,
        registration_opens_at: term.registration_opens_at || dateMinusDays(startDate, 7),
        linked_lesson_count: dates.length,
      };
    });

    return Response.json({
      ok: true,
      terms: hydratedTerms,
      curriculum: curriculumSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })),
      lesson_count: lessons.length,
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    if (user.role !== 'master') throw new Error('forbidden');

    const body = await request.json();
    const year = Number(body.year || new Date().getFullYear());
    const terms = Array.isArray(body.terms) ? body.terms : [];
    if (terms.length === 0) return Response.json({ ok: false, error: 'terms is required' }, { status: 400 });

    const db = adminDb();
    let batch = db.batch();
    let writes = 0;
    const commit = async () => {
      if (writes > 0) {
        await batch.commit();
        batch = db.batch();
        writes = 0;
      }
    };

    const normalizedTerms = normalizeTermSettings(terms.map((term: any) => ({
      id: String(term.id || '').trim(),
      year,
      label: String(term.label || termLabel(String(term.id || ''))),
      grades: normalizeGrades(term.grades),
      start_week: Number(term.start_week || 0),
      end_week: Number(term.end_week || 0),
      start_date: String(term.start_date || ''),
      end_date: String(term.end_date || ''),
      registration_opens_at: String(term.registration_opens_at || ''),
      includes_ss: term.includes_ss === true,
      updated_at: FieldValue.serverTimestamp(),
    })).filter((term: any) => term.id), year);

    if (body.replace_terms === true) {
      const currentSnap = await db.collection('curriculum_terms').where('year', '==', year).get();
      const keepIds = new Set(normalizedTerms.map((term: any) => termDocId(year, term)));
      for (const doc of currentSnap.docs) {
        if (!keepIds.has(doc.id)) {
          batch.delete(doc.ref);
          writes += 1;
          if (writes >= 400) await commit();
        }
      }
    }

    for (const term of normalizedTerms) {
      batch.set(db.collection('curriculum_terms').doc(termDocId(year, term)), term, { merge: true });
      writes += 1;
    }

    const [curriculumSnap, existingOptionSnap] = await Promise.all([
      db.collection('annual_curriculum_schedules').where('year', '==', year).get(),
      db.collection('course_registration_options').where('year', '==', year).get(),
    ]);
    const optionUpdates = new Map<string, any>();
    for (const doc of curriculumSnap.docs) {
      const data: any = doc.data();
      const term = resolveTerm(data.week_no || data.lesson_no, normalizedTerms, data.grade);
      if (!term) continue;
      batch.set(doc.ref, {
        term: term.id,
        term_label: term.label,
        term_start_date: term.start_date || null,
        registration_opens_at: term.registration_opens_at || dateMinusDays(term.start_date, 7) || null,
        updated_at: FieldValue.serverTimestamp(),
      }, { merge: true });
      writes += 1;
      const optionId = `${year}_${term.id}_${data.grade || ''}_${data.subject || ''}_${data.course_name || data.subject || '講座'}`.replace(/[^\p{Letter}\p{Number}_-]+/gu, '_').slice(0, 140);
      optionUpdates.set(optionId, {
        year,
        term: term.id,
        term_label: term.label,
        term_start_date: term.start_date || null,
        registration_opens_at: term.registration_opens_at || dateMinusDays(term.start_date, 7) || null,
        grade: data.grade || '',
        subject: data.subject || '',
        course_name: data.course_name || data.subject || '講座',
        title: `${term.label} ${data.grade || ''} ${data.course_name || data.subject || '講座'}`,
        is_active: true,
        source: 'curriculum_terms',
        updated_at: FieldValue.serverTimestamp(),
      });
      if (writes >= 400) await commit();
    }

    for (const doc of existingOptionSnap.docs) {
      const data = doc.data();
      const shouldRemove = data.term === 'summer_special'
        || (data.source === 'curriculum_terms' && !optionUpdates.has(doc.id));
      if (shouldRemove) {
        batch.delete(doc.ref);
        writes += 1;
        if (writes >= 400) await commit();
      }
    }

    for (const [id, payload] of optionUpdates) {
      batch.set(db.collection('course_registration_options').doc(id), payload, { merge: true });
      writes += 1;
      if (writes >= 400) await commit();
    }

    await commit();
    revalidateTag('course-registration-options');
    return Response.json({ ok: true, updated_terms: normalizedTerms.length, updated_curriculum: curriculumSnap.size, updated_options: optionUpdates.size });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    if (user.role !== 'master') throw new Error('forbidden');
    const body = await request.json();
    const id = String(body.id || '');
    if (!id) return Response.json({ ok: false, error: 'id is required' }, { status: 400 });
    const updates: Record<string, any> = {};
    ['unit', 'course_name', 'subject', 'grade', 'week_no', 'term', 'term_label', 'month_label'].forEach(key => {
      if (body[key] !== undefined) updates[key] = body[key];
    });
    updates.updated_at = FieldValue.serverTimestamp();
    await adminDb().collection('annual_curriculum_schedules').doc(id).set(updates, { merge: true });
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
