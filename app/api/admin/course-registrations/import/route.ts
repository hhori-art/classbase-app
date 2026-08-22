import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, isAdminLike, jsonError } from '@/lib/server-auth';
import { enrichCourseOptionsWithShifts } from '@/lib/course-registration-match';
import { getCourseSubjectGroup, normalizeCourseText, toAsciiDigits } from '@/lib/course-text';

export const runtime = 'nodejs';

const DAYS = ['月', '火', '水', '木', '金', '土'];
const NEXT_COLUMNS = DAYS.map(day => `次期${day}`);
const CURRENT_COLUMNS = DAYS;
const SECOND_PERIOD_COLUMNS = DAYS.map(day => `2p${day}`);

const safeDocPart = (value: string) => value.replace(/[^\p{Letter}\p{Number}_-]+/gu, '_').slice(0, 120) || 'csv';

const normalizeGrade = (value: unknown) => {
  const raw = toAsciiDigits(String(value || '').normalize('NFKC'));
  if (raw.includes('3')) return '中3';
  if (raw.includes('2')) return '中2';
  if (raw.includes('1')) return '中1';
  return raw.trim();
};

const normalizeText = normalizeCourseText;

const stripTermSuffix = (value: string) => normalizeText(value)
  .replace(/(?:1期|2期|3期|4期|一期|二期|三期|四期)+$/i, '');

const subjectGroup = (value: unknown) => {
  return getCourseSubjectGroup(value);
};

const parseCsv = (text: string) => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(cell.trim());
      cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(cell.trim());
      if (row.some(value => value !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }

  row.push(cell.trim());
  if (row.some(value => value !== '')) rows.push(row);

  const [rawHeaders = [], ...body] = rows;
  const headers = rawHeaders.map((header, index) => {
    const normalized = String(header || '').replace(/^\uFEFF/, '').trim();
    // MemberMasterは先頭の生徒ID列の見出しが空欄で出力される。
    if (!normalized && index === 0) return 'id';
    return normalized || `__unnamed_${index}`;
  });

  return body.map(values => Object.fromEntries(headers.map((header, index) => [
    header,
    values[index] || '',
  ])));
};

const parseSlot = (value: unknown, fallback = '') => {
  const text = toAsciiDigits(String(value || fallback || '').normalize('NFKC'));
  if (/1\s*(限|時間目|時限|コマ)?/.test(text)) return '1時間目';
  if (/2\s*(限|時間目|時限|コマ)?/.test(text)) return '2時間目';
  return fallback;
};

type CsvEntry = {
  day: string;
  slot: string;
  label: string;
  normalizedLabel: string;
  grade: string;
  subject: string;
};

const parseCellEntries = (raw: string, day: string, fallbackSlot = ''): CsvEntry[] => {
  const text = String(raw || '').trim();
  if (!text) return [];

  return text
    .split(/\n|、|，|,/)
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const match = part.match(/([12１２])\s*(?:限|時間目|時限|コマ)?\s*[:：]\s*(.+)$/);
      const slot = parseSlot(match?.[1] || '', fallbackSlot);
      const label = String(match?.[2] || part).trim();
      const normalizedLabel = stripTermSuffix(label)
        .replace(/中学[123]年?/g, '')
        .replace(/中[123]/g, '');
      return {
        day,
        slot,
        label,
        normalizedLabel,
        grade: normalizeGrade(label),
        subject: subjectGroup(label),
      };
    })
    .filter(entry => entry.slot && entry.label);
};

const parseRegistrationEntries = (row: Record<string, string>) => {
  const nextEntries = NEXT_COLUMNS.flatMap((column, index) => parseCellEntries(row[column], DAYS[index]));
  if (nextEntries.length > 0) return nextEntries;

  const currentEntries = CURRENT_COLUMNS.flatMap((column, index) => parseCellEntries(row[column], DAYS[index]));
  const secondPeriodEntries = SECOND_PERIOD_COLUMNS.flatMap((column, index) => parseCellEntries(row[column], DAYS[index], '2時間目'));
  return [...currentEntries, ...secondPeriodEntries];
};

const optionTermKey = (option: any) => String(option.term || option.term_label || '').trim();

const getOptionDay = (option: any) => String(option.resolved_day || option.day || option.day_of_week || '').replace('曜日', '').trim();

const getOptionSlot = (option: any) => parseSlot(option.resolved_slot || option.slot || option.time_slot || option.period || '');

const optionSearchTexts = (option: any) => [
  option.subject,
  option.course_name,
  option.title,
  option.resolved_unit,
  option.unit,
  ...(Array.isArray(option.matched_detail_subjects) ? option.matched_detail_subjects : []),
  ...(Array.isArray(option.matched_units) ? option.matched_units : []),
  ...(Array.isArray(option.curriculum_units) ? option.curriculum_units : []),
].map(stripTermSuffix).filter(Boolean);

const optionMatchesEntry = (option: any, entry: CsvEntry, fallbackGrade = '') => {
  if (getOptionDay(option) !== entry.day) return 0;
  if (getOptionSlot(option) !== entry.slot) return 0;

  const optionGrade = normalizeGrade(option.grade);
  const wantedGrade = entry.grade || fallbackGrade;
  if (entry.grade && optionGrade !== entry.grade) return 0;

  let score = 20;
  if (wantedGrade && optionGrade === wantedGrade) score += 8;

  const optionSubject = subjectGroup(option.subject || option.course_name || option.title);
  if (entry.subject && optionSubject && optionSubject !== entry.subject) return 0;
  if (entry.subject && optionSubject === entry.subject) score += 8;

  const label = entry.normalizedLabel;
  const texts = optionSearchTexts(option);
  if (!label) return score;

  const exact = texts.some(text => text === label);
  if (exact) return score + 40;

  const contains = texts.some(text => text.includes(label) || label.includes(text));
  if (contains) return score + 25;

  const compactLabel = label.replace(/通常|対策|標準|発展/g, '');
  if (compactLabel && compactLabel !== label) {
    const loose = texts.some(text => text.includes(compactLabel) || compactLabel.includes(text.replace(/通常|対策|標準|発展/g, '')));
    if (loose) return score + 15;
  }

  return 0;
};

const matchEntryToOptionIds = (entry: CsvEntry, options: any[], fallbackGrade = '') => {
  const scored = options
    .map(option => ({ option, score: optionMatchesEntry(option, entry, fallbackGrade) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || String(a.option.id).localeCompare(String(b.option.id), 'ja'));

  const best = scored[0];
  if (!best) return { ids: [] as string[], matched: null as any, score: 0 };

  const bestGroupKey = [
    best.option.grade || '',
    best.option.subject || '',
    best.option.course_name || best.option.title || '',
    getOptionDay(best.option),
    getOptionSlot(best.option),
  ].join('__');

  const ids = scored
    .filter(item => item.score >= Math.max(20, best.score - 8))
    .filter(item => [
      item.option.grade || '',
      item.option.subject || '',
      item.option.course_name || item.option.title || '',
      getOptionDay(item.option),
      getOptionSlot(item.option),
    ].join('__') === bestGroupKey)
    .map(item => String(item.option.id || '').trim())
    .filter(Boolean);

  return { ids: Array.from(new Set(ids)), matched: best.option, score: best.score };
};

const buildCourseOptions = async (year: number) => {
  const db = adminDb();
  const [optionSnap, curriculumSnap, shiftSnap] = await Promise.all([
    db.collection('course_registration_options').limit(1000).get(),
    db.collection('annual_curriculum_schedules').limit(1500).get(),
    db.collection('shift_assignments')
      .where('target_date', '>=', `${year}-04-01`)
      .where('target_date', '<=', `${year + 1}-03-31`)
      .orderBy('target_date', 'asc')
      .limit(5000)
      .get(),
  ]);

  return enrichCourseOptionsWithShifts(
    optionSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter((option: any) => option.is_active !== false),
    curriculumSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })),
    shiftSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })),
  ).filter((option: any) => !option.year || Number(option.year) === year);
};

const buildStudentMap = async () => {
  const snap = await adminDb().collection('users').where('role', '==', 'student').get();
  const map = new Map<string, { id: string; data: FirebaseFirestore.DocumentData }>();
  snap.docs.forEach(doc => {
    const data = doc.data();
    [
      doc.id,
      data.lifetime_id,
      data.login_id,
      data.student_id,
      data.id,
      String(data.email || '').split('@')[0],
    ].map(value => String(value || '').trim()).filter(Boolean).forEach(key => {
      if (!map.has(key)) map.set(key, { id: doc.id, data });
    });
  });
  return map;
};

export async function POST(request: NextRequest) {
  try {
    const actor = await getServerUser(request);
    if (!isAdminLike(actor)) throw new Error('forbidden');

    const body = await request.json();
    const csvText = String(body.csv_text || '').replace(/^\uFEFF/, '');
    const year = Number(body.year || new Date().getFullYear());
    const term = String(body.term || '').trim() || 'term2';
    const dryRun = body.dry_run === true;
    if (!csvText.trim()) {
      return Response.json({ ok: false, error: 'csv_text is required' }, { status: 400 });
    }

    const rows = parseCsv(csvText);
    const students = await buildStudentMap();
    const allOptions = await buildCourseOptions(year);
    const termOptions = allOptions.filter((option: any) => !optionTermKey(option) || optionTermKey(option) === term);

    const results: any[] = [];
    const registrations: {
      studentId: string;
      student: FirebaseFirestore.DocumentData;
      selectedCourseIds: string[];
      entries: CsvEntry[];
      matchedLabels: string[];
      clearOnly: boolean;
    }[] = [];

    rows.forEach((row, index) => {
      const rawId = String(row.id || row.ID || row['生涯番号'] || row['ログインID'] || '').trim();
      const entries = parseRegistrationEntries(row);
      if (!rawId) return;

      const studentRecord = students.get(rawId);
      if (!studentRecord) {
        results.push({ row: index + 2, id: rawId, name: row.name || row['氏名'] || '', status: 'student_not_found', entries: entries.map(entry => entry.label) });
        return;
      }

      const student = studentRecord.data;
      if (entries.length === 0) {
        registrations.push({
          studentId: studentRecord.id,
          student,
          selectedCourseIds: [],
          entries: [],
          matchedLabels: [],
          clearOnly: true,
        });
        results.push({
          row: index + 2,
          id: rawId,
          uid: studentRecord.id,
          name: student.student_name || student.name || row.name || '',
          status: 'cleared',
          selected_course_count: 0,
          matched: [],
          unmatched: [],
        });
        return;
      }

      const studentGrade = normalizeGrade(student.grade || row.grade);
      const selectedIds = new Set<string>();
      const matchedLabels: string[] = [];
      const unmatched: string[] = [];

      entries.forEach(entry => {
        const candidateOptions = termOptions.filter((option: any) => {
          const optionGrade = normalizeGrade(option.grade);
          if (entry.grade) return optionGrade === entry.grade;
          if (studentGrade) return optionGrade === studentGrade || subjectGroup(entry.label) === '社会';
          return true;
        });
        const matched = matchEntryToOptionIds(entry, candidateOptions, studentGrade);
        if (matched.ids.length === 0) {
          unmatched.push(`${entry.day}曜 ${entry.slot}: ${entry.label}`);
          return;
        }
        matched.ids.forEach(id => selectedIds.add(id));
        matchedLabels.push(`${entry.day}曜 ${entry.slot}: ${entry.label}`);
      });

      if (selectedIds.size === 0) {
        results.push({ row: index + 2, id: rawId, name: row.name || row['氏名'] || student.name || student.student_name || '', status: 'no_course_matched', unmatched });
        return;
      }

      registrations.push({
        studentId: studentRecord.id,
        student,
        selectedCourseIds: Array.from(selectedIds),
        entries,
        matchedLabels,
        clearOnly: false,
      });
      results.push({
        row: index + 2,
        id: rawId,
        uid: studentRecord.id,
        name: student.student_name || student.name || row.name || '',
        status: unmatched.length > 0 ? 'partial' : 'matched',
        selected_course_count: selectedIds.size,
        matched: matchedLabels,
        unmatched,
      });
    });

    if (!dryRun && registrations.length > 0) {
      const db = adminDb();
      let batch = db.batch();
      let opCount = 0;
      const commitIfNeeded = async (force = false) => {
        if (opCount > 0 && (force || opCount >= 420)) {
          await batch.commit();
          batch = db.batch();
          opCount = 0;
        }
      };

      for (const item of registrations) {
        const studentRef = db.collection('users').doc(item.studentId);
        const registrationRef = db.collection('course_registrations').doc(`csv_${safeDocPart(item.studentId)}_${year}_${safeDocPart(term)}`);
        const school = item.student.school_id || item.student.school || item.student.classroom || null;
        const parentId = String(item.student.parent_uid || (Array.isArray(item.student.parent_ids) ? item.student.parent_ids[0] : '') || '');

        const existingSnap = await db.collection('course_registrations')
          .where('student_id', '==', item.studentId)
          .limit(100)
          .get()
          .catch(() => null);
        existingSnap?.docs.forEach(docSnap => {
          if (!item.clearOnly && docSnap.id === registrationRef.id) return;
          batch.set(docSnap.ref, {
            is_current: false,
            current: false,
            overwritten_by_csv_at: FieldValue.serverTimestamp(),
            updated_at: FieldValue.serverTimestamp(),
          }, { merge: true });
          opCount += 1;
        });
        await commitIfNeeded();

        if (item.clearOnly) {
          batch.set(studentRef, {
            active_course_registration_id: FieldValue.delete(),
            selected_course_ids: [],
            selected_course_labels: [],
            course_registration_status: 'empty',
            course_registration_updated_at: FieldValue.serverTimestamp(),
          }, { merge: true });
          opCount += 1;
          await commitIfNeeded();
          continue;
        }

        const payload = {
          request_id: `csv_import_${year}_${term}`,
          parent_id: parentId || null,
          parent_name: item.student.parent_name || '',
          student_id: item.studentId,
          student_name: item.student.student_name || item.student.name || '',
          grade: item.student.grade || '',
          school,
          year,
          term,
          selected_course_ids: item.selectedCourseIds,
          selected_course_labels: item.matchedLabels,
          status: 'active',
          approval_status: 'not_required',
          is_current: true,
          current: true,
          selected_by_admin: true,
          selected_by_csv: true,
          updated_by: actor.uid,
          updated_by_role: actor.role,
          updated_at: FieldValue.serverTimestamp(),
          created_at: FieldValue.serverTimestamp(),
        };
        batch.set(registrationRef, payload, { merge: true });
        batch.set(studentRef, {
          active_course_registration_id: registrationRef.id,
          selected_course_ids: item.selectedCourseIds,
          selected_course_labels: item.matchedLabels,
          course_registration_status: 'active',
          course_registration_updated_at: FieldValue.serverTimestamp(),
        }, { merge: true });
        opCount += 2;
        await commitIfNeeded();
      }

      batch.create(db.collection('action_logs').doc(), {
        action: 'admin_course_registration_csv_imported',
        actor_id: actor.uid,
        actor_role: actor.role,
        target_type: 'course_registration',
        metadata: {
          year,
          term,
          row_count: rows.length,
          imported_count: registrations.length,
          cleared_count: registrations.filter(item => item.clearOnly).length,
          dry_run: false,
        },
        created_at: FieldValue.serverTimestamp(),
      });
      opCount += 1;
      await commitIfNeeded(true);
    }

    const statusCounts = results.reduce((acc, result) => {
      acc[result.status] = (acc[result.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return Response.json({
      ok: true,
      dry_run: dryRun,
      year,
      term,
      rows: rows.length,
      imported: dryRun ? 0 : registrations.length,
      cleared: dryRun ? 0 : registrations.filter(item => item.clearOnly).length,
      matched: registrations.filter(item => !item.clearOnly).length,
      status_counts: statusCounts,
      results: results.slice(0, 200),
    });
  } catch (error) {
    return jsonError(error);
  }
}
