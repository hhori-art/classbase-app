import { createHash } from 'crypto';
import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminBucket, adminDb } from '@/lib/firebase-admin';
import { canManageAttendance, getServerUser, jsonError } from '@/lib/server-auth';
import {
  calculateAttendancePayroll,
  parseRateMasterCsv,
  parseRegularAttendanceCsv,
  type PayrollRateMaster,
  type PayrollWorkRecord,
  type RegularAttendanceInterval,
} from '@/lib/attendance-payroll';
import { parseRegularAttendanceXlsx } from '@/lib/attendance-xlsx';
import { parseLegacyRateWorkbook } from '@/lib/legacy-xls';
import { isSemiDedicatedProfile } from '@/lib/employment-category';

export const runtime = 'nodejs';
export const maxDuration = 60;

const RATE_COLLECTION = 'attendance_payroll_rate_masters';
const REGULAR_COLLECTION = 'attendance_regular_imports';
const IMPORT_COLLECTION = 'attendance_import_batches';
const MAX_CSV_BYTES = 2 * 1024 * 1024;
const MAX_XLSX_BYTES = 6 * 1024 * 1024;
const MAX_RATE_ROWS = 5000;
const MAX_REGULAR_ROWS = 100_000;

const todayJst = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

function monthRange(raw: string) {
  const month = /^\d{4}-\d{2}$/.test(raw) ? raw : todayJst().slice(0, 7);
  const [year, m] = month.split('-').map(Number);
  const lastDay = new Date(year, m, 0).getDate();
  return { month, start: `${month}-01`, end: `${month}-${String(lastDay).padStart(2, '0')}` };
}

const hashId = (...parts: string[]) => createHash('sha256').update(parts.join('\u001f')).digest('hex').slice(0, 40);

async function commitInChunks(
  items: Array<{ id: string; data: Record<string, unknown> }>,
  collectionName: string,
) {
  const db = adminDb();
  for (let offset = 0; offset < items.length; offset += 400) {
    const batch = db.batch();
    items.slice(offset, offset + 400).forEach(item => batch.set(db.collection(collectionName).doc(item.id), item.data, { merge: true }));
    await batch.commit();
  }
}

async function deleteRegularMonth(start: string, end: string) {
  const db = adminDb();
  while (true) {
    const snapshot = await db.collection(REGULAR_COLLECTION)
      .where('date', '>=', start)
      .where('date', '<=', end)
      .limit(400)
      .get();
    if (snapshot.empty) return;
    const batch = db.batch();
    snapshot.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    if (snapshot.size < 400) return;
  }
}

async function deleteDocumentsByIds(collectionName: string, ids: string[]) {
  const db = adminDb();
  for (let offset = 0; offset < ids.length; offset += 400) {
    const batch = db.batch();
    ids.slice(offset, offset + 400).forEach(id => batch.delete(db.collection(collectionName).doc(id)));
    await batch.commit();
  }
}

function compactRegularAttendance(
  items: RegularAttendanceInterval[],
  month: string,
  importBatchId: string,
  sourceName: string,
) {
  const groups = new Map<string, RegularAttendanceInterval[]>();
  items.forEach(item => {
    const personKey = item.person_code || item.normalized_name || item.person_name;
    const key = `${personKey}\u001f${item.person_name}`;
    groups.set(key, [...(groups.get(key) || []), item]);
  });
  const compacted: Array<{ id: string; data: Record<string, unknown> }> = [];
  groups.forEach(group => {
    for (let offset = 0; offset < group.length; offset += 250) {
      const intervals = group.slice(offset, offset + 250);
      const first = intervals[0];
      const shard = Math.floor(offset / 250);
      compacted.push({
        id: hashId(first.person_code || first.normalized_name || first.person_name, month, String(shard)),
        data: {
          person_code: first.person_code,
          person_name: first.person_name,
          normalized_name: first.normalized_name,
          date: `${month}-01`,
          month,
          compacted: true,
          intervals: intervals.map(item => ({
            date: item.date,
            start_time: item.start_time,
            end_time: item.end_time,
            work_type: item.work_type || '',
          })),
          source_name: sourceName,
          import_batch_id: importBatchId,
        },
      });
    }
  });
  return compacted;
}

function requireAttendanceManager(user: Awaited<ReturnType<typeof getServerUser>>) {
  if (!canManageAttendance(user)) throw new Error('forbidden');
}

export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireAttendanceManager(user);
    const { month, start, end } = monthRange(String(request.nextUrl.searchParams.get('month') || ''));
    const scope = request.nextUrl.searchParams.get('scope') === 'all' ? 'all' : 'breakthrough';
    const db = adminDb();
    const [recordSnap, rateSnap, regularSnap, userSnap] = await Promise.all([
      db.collection('work_records').where('date', '>=', start).where('date', '<=', end).limit(5000).get(),
      db.collection(RATE_COLLECTION).where('effective_from', '<=', end).limit(5000).get(),
      db.collection(REGULAR_COLLECTION).where('date', '>=', start).where('date', '<=', end).limit(5000).get(),
      db.collection('users').where('role', 'in', ['teacher', 'attendance_admin']).limit(5000).get(),
    ]);

    const userMap = new Map(userSnap.docs.map(doc => [doc.id, doc.data()]));
    const records: PayrollWorkRecord[] = recordSnap.docs.filter(doc => {
      const profile = userMap.get(String(doc.data().teacher_id || '')) || {};
      return isSemiDedicatedProfile(profile);
    }).map(doc => {
      const data = doc.data();
      const profile = userMap.get(String(data.teacher_id || '')) || {};
      return {
        id: doc.id,
        teacher_id: String(data.teacher_id || ''),
        teacher_name: String(data.teacher_name || profile.name || profile.teacher_name || ''),
        person_code: String(profile.lifetime_id || profile.staff_id || profile.staffId || profile.employee_id || profile.employeeId || profile.teacher_code || ''),
        school_code: String(profile.school_code || profile.schoolCode || profile.school_id || profile.school_number || ''),
        school_name: String(profile.school_name || profile.schoolName || profile.school || profile.classroom || profile.affiliation || profile.department || ''),
        tp_serial: String(profile.tp_serial || profile.tpSerial || profile.tp_number || profile.tpNumber || profile.tp || ''),
        date: String(data.date || ''),
        attendance_kind: String(data.attendance_kind || 'normal'),
        start_time: data.start_time || null,
        end_time: data.end_time || null,
        work_segments: Array.isArray(data.work_segments) ? data.work_segments : [],
        transportation: Array.isArray(data.transportation) ? data.transportation : [],
      };
    });
    const rates = rateSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as PayrollRateMaster));
    const regularAttendance = regularSnap.docs.flatMap(doc => {
      const data = doc.data();
      if (!data.compacted || !Array.isArray(data.intervals)) return [{ id: doc.id, ...data } as RegularAttendanceInterval];
      return data.intervals.map((interval: Record<string, unknown>, index: number) => ({
        id: `${doc.id}_${index}`,
        person_code: String(data.person_code || ''),
        person_name: String(data.person_name || ''),
        normalized_name: String(data.normalized_name || ''),
        date: String(interval.date || ''),
        start_time: String(interval.start_time || ''),
        end_time: String(interval.end_time || ''),
        work_type: String(interval.work_type || ''),
        source_name: String(data.source_name || ''),
      }));
    });
    const result = calculateAttendancePayroll({ month, scope, records, rates, regularAttendance });

    return Response.json({
      ok: true,
      ...result,
      imports: {
        rate_master_rows: rates.length,
        regular_attendance_rows: regularAttendance.length,
      },
    }, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireAttendanceManager(user);
    const isMultipart = request.headers.get('content-type')?.includes('multipart/form-data');
    let action = '';
    let csvText = '';
    let sourceName = 'import.csv';
    let replaceMonth = true;
    let xlsxBuffer: Buffer | null = null;
    let legacyRateBuffer: Buffer | null = null;
    if (isMultipart) {
      const form = await request.formData();
      action = String(form.get('action') || '');
      sourceName = String(form.get('source_name') || 'import.xlsx').slice(0, 180);
      replaceMonth = String(form.get('replace_month') || 'true') !== 'false';
      const file = form.get('file');
      if (!(file instanceof File)) return Response.json({ ok: false, error: '取込ファイルを選択してください。' }, { status: 400 });
      if (file.size > MAX_XLSX_BYTES) return Response.json({ ok: false, error: 'Excelは6MB以下にしてください。' }, { status: 413 });
      if (!file.name.toLowerCase().endsWith('.xlsx')) return Response.json({ ok: false, error: 'Excelは.xlsx形式のみ対応しています。' }, { status: 400 });
      xlsxBuffer = Buffer.from(await file.arrayBuffer());
    } else {
      const body = await request.json();
      action = String(body.action || '');
      csvText = String(body.csv_text || '');
      sourceName = String(body.source_name || 'import.csv').slice(0, 180);
      replaceMonth = body.replace_month !== false;
      const storagePath = String(body.storage_path || '');
      if (storagePath) {
        const expectedPrefix = `attendance_imports/${user.uid}/`;
        if (!storagePath.startsWith(expectedPrefix) || !storagePath.toLowerCase().endsWith('.xls')) {
          return Response.json({ ok: false, error: '単価ファイルの保存先が不正です。' }, { status: 400 });
        }
        const temporaryFile = adminBucket().file(storagePath);
        try {
          const [metadata] = await temporaryFile.getMetadata();
          if (Number(metadata.size || 0) > 12 * 1024 * 1024) return Response.json({ ok: false, error: '旧Excelファイルは12MB以下にしてください。' }, { status: 413 });
          [legacyRateBuffer] = await temporaryFile.download();
        } finally {
          await temporaryFile.delete({ ignoreNotFound: true }).catch(() => undefined);
        }
      }
      if (Buffer.byteLength(csvText, 'utf8') > MAX_CSV_BYTES) {
        return Response.json({ ok: false, error: 'CSVは2MB以下にしてください。' }, { status: 413 });
      }
    }

    const db = adminDb();
    const importRef = db.collection(IMPORT_COLLECTION).doc();
    if (action === 'import_rate_master') {
      const parsed = legacyRateBuffer ? parseLegacyRateWorkbook(legacyRateBuffer) : parseRateMasterCsv(csvText);
      if (parsed.errors.length) return Response.json({ ok: false, error: '単価マスターの形式を確認してください。', errors: parsed.errors.slice(0, 50) }, { status: 400 });
      if (!parsed.data.length || parsed.data.length > MAX_RATE_ROWS) return Response.json({ ok: false, error: `取込件数は1〜${MAX_RATE_ROWS}件にしてください。` }, { status: 400 });
      const isLegacyRateImport = parsed.format === 'legacy_rate_sheet';
      let staleRateIds: string[] = [];
      if (isLegacyRateImport) {
        const effectiveDates = Array.from(new Set(parsed.data.map(rate => rate.effective_from)));
        if (effectiveDates.length !== 1) return Response.json({ ok: false, error: '原本の単価シートは1支給月分ずつ取り込んでください。' }, { status: 400 });
        const expectedIds = new Set(parsed.data.map(rate => hashId(rate.person_code || rate.normalized_name || rate.person_name, rate.effective_from)));
        const existing = await db.collection(RATE_COLLECTION).where('effective_from', '==', effectiveDates[0]).get();
        staleRateIds = existing.docs.filter(doc => !expectedIds.has(doc.id)).map(doc => doc.id);
      }
      await commitInChunks(parsed.data.map(rate => ({
        id: hashId(rate.person_code || rate.normalized_name || rate.person_name, rate.effective_from),
        data: { ...rate, source_name: sourceName, imported_at: FieldValue.serverTimestamp(), imported_by: user.uid },
      })), RATE_COLLECTION);
      if (staleRateIds.length) await deleteDocumentsByIds(RATE_COLLECTION, staleRateIds);
      await importRef.set({ type: 'rate_master', source_name: sourceName, row_count: parsed.data.length, source_format: parsed.format, replaced_effective_month: isLegacyRateImport ? parsed.data[0].effective_from.slice(0, 7) : null, imported_by: user.uid, imported_at: FieldValue.serverTimestamp() });
      return Response.json({ ok: true, imported: parsed.data.length });
    }

    if (action === 'import_regular_attendance') {
      const parsed = xlsxBuffer ? await parseRegularAttendanceXlsx(xlsxBuffer) : parseRegularAttendanceCsv(csvText);
      if (parsed.errors.length) return Response.json({ ok: false, error: '通常勤怠データの形式を確認してください。', errors: parsed.errors.slice(0, 50) }, { status: 400 });
      if (!parsed.data.length || parsed.data.length > MAX_REGULAR_ROWS) return Response.json({ ok: false, error: `取込件数は1〜${MAX_REGULAR_ROWS.toLocaleString()}件にしてください。` }, { status: 400 });
      const months = Array.from(new Set(parsed.data.map(item => item.date.slice(0, 7))));
      if (months.length !== 1) return Response.json({ ok: false, error: '通常勤怠データは1か月分ずつ取り込んでください。' }, { status: 400 });
      const { start, end } = monthRange(months[0]);
      if (replaceMonth) await deleteRegularMonth(start, end);
      const compacted = compactRegularAttendance(parsed.data, months[0], importRef.id, sourceName)
        .map(item => ({ data: { ...item.data, imported_at: FieldValue.serverTimestamp(), imported_by: user.uid }, id: item.id }));
      await commitInChunks(compacted, REGULAR_COLLECTION);
      await importRef.set({ type: 'regular_attendance', month: months[0], source_name: sourceName, row_count: parsed.data.length, stored_document_count: compacted.length, replace_month: replaceMonth, imported_by: user.uid, imported_at: FieldValue.serverTimestamp() });
      return Response.json({ ok: true, imported: parsed.data.length, month: months[0] });
    }

    return Response.json({ ok: false, error: '未対応の取込種別です。' }, { status: 400 });
  } catch (error) {
    return jsonError(error);
  }
}
