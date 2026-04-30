import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { getServerUser, isAdminLike } from '@/lib/server-auth';

export const runtime = 'nodejs';

type SyncShift = {
  sync_key?: string;
  source_spreadsheet_id?: string;
  source_sheet_name?: string;
  source_row?: number;
  source_col?: number;
  target_date: string;
  period?: number | string;
  role_type?: 'main' | 'sub' | 'general';
  teacher_name?: string;
  grade?: string | null;
  subject?: string | null;
  detail_subject?: string | null;
  place?: string | null;
  unit?: string | null;
  meeting_id?: string | null;
  signin_address?: string | null;
  note?: string | null;
};

function syncSecret() {
  return process.env.SHIFT_SYNC_SECRET || process.env.SECRET_KEY || '';
}

function safeEqual(a: string, b: string) {
  if (!a || !b) return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

async function assertAllowed(request: NextRequest) {
  const configured = syncSecret();
  const requestSecret = request.headers.get('x-shift-sync-secret') || request.nextUrl.searchParams.get('secret') || '';
  if (configured && safeEqual(requestSecret, configured)) return { uid: 'gas-sync', role: 'system' };

  const user = await getServerUser(request);
  if (!isAdminLike(user)) throw new Error('forbidden');
  return { uid: user.uid, role: user.role };
}

function clean(value: unknown) {
  return String(value ?? '').replace(/\r/g, '\n').trim();
}

function periodLabel(period: unknown) {
  const raw = clean(period);
  if (raw.includes('2') || raw.includes('２')) return 2;
  return 1;
}

function normalizeName(value: unknown) {
  return clean(value).replace(/\s+/g, '').replace(/先生$/, '');
}

function buildSyncKey(shift: SyncShift) {
  if (shift.sync_key) return clean(shift.sync_key);
  const source = [
    shift.source_spreadsheet_id,
    shift.source_sheet_name,
    shift.source_row,
    shift.source_col,
    shift.role_type || 'main',
  ].map(v => clean(v)).join(':');
  if (source.replace(/:/g, '')) return source;
  return [
    shift.target_date,
    periodLabel(shift.period),
    shift.role_type || 'main',
    shift.grade,
    shift.subject,
    shift.detail_subject,
    shift.place,
  ].map(v => clean(v)).join(':');
}

async function teacherMap() {
  const snap = await adminDb().collection('users').where('role', '==', 'teacher').get();
  const map = new Map<string, { id: string; name: string }>();
  snap.docs.forEach(doc => {
    const data = doc.data();
    const name = clean(data.name || data.display_name || data.teacher_name);
    if (name) map.set(normalizeName(name), { id: doc.id, name });
  });
  return map;
}

async function deleteSourceRange(sourceSpreadsheetId: string, sourceSheetName: string, startDate: string, endDate: string) {
  const db = adminDb();
  let q: FirebaseFirestore.Query = db.collection('shift_assignments')
    .where('source_spreadsheet_id', '==', sourceSpreadsheetId)
    .where('source_sheet_name', '==', sourceSheetName)
    .where('target_date', '>=', startDate)
    .where('target_date', '<=', endDate);

  const snap = await q.get();
  let deleted = 0;
  for (let i = 0; i < snap.docs.length; i += 400) {
    const batch = db.batch();
    snap.docs.slice(i, i + 400).forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    deleted += snap.docs.slice(i, i + 400).length;
  }
  return deleted;
}

export async function POST(request: NextRequest) {
  try {
    const actor = await assertAllowed(request);
    const body = await request.json();
    const shifts = Array.isArray(body.shifts) ? body.shifts as SyncShift[] : [];
    const sourceSpreadsheetId = clean(body.source_spreadsheet_id);
    const sourceSheetName = clean(body.source_sheet_name);
    const replace = body.replace === true;
    const dryRun = body.dry_run === true;

    if (!sourceSpreadsheetId || !sourceSheetName) {
      return NextResponse.json({ ok: false, error: 'source_spreadsheet_id and source_sheet_name are required' }, { status: 400 });
    }
    if (!shifts.length) {
      return NextResponse.json({ ok: false, error: 'shifts is empty' }, { status: 400 });
    }

    const validShifts = shifts.filter(shift => clean(shift.target_date));
    if (!validShifts.length) {
      return NextResponse.json({ ok: false, error: 'valid target_date is missing' }, { status: 400 });
    }

    const dates = validShifts.map(s => clean(s.target_date)).sort();
    const startDate = clean(body.start_date) || dates[0];
    const endDate = clean(body.end_date) || dates[dates.length - 1];

    const teachers = await teacherMap();
    const db = adminDb();
    const existingSnap = await db.collection('shift_assignments')
      .where('source_spreadsheet_id', '==', sourceSpreadsheetId)
      .where('source_sheet_name', '==', sourceSheetName)
      .where('target_date', '>=', startDate)
      .where('target_date', '<=', endDate)
      .get();

    const existingByKey = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
    existingSnap.docs.forEach(doc => {
      const data = doc.data();
      if (data.sync_key) existingByKey.set(String(data.sync_key), doc);
    });

    if (dryRun) {
      return NextResponse.json({
        ok: true,
        dry_run: true,
        incoming: validShifts.length,
        existing: existingSnap.size,
        start_date: startDate,
        end_date: endDate,
      });
    }

    let deleted = 0;
    if (replace) {
      deleted = await deleteSourceRange(sourceSpreadsheetId, sourceSheetName, startDate, endDate);
      existingByKey.clear();
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;
    let missingTeacherCount = 0;
    let batch = db.batch();
    let batchCount = 0;

    const commit = async () => {
      if (!batchCount) return;
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
    };

    for (const shift of validShifts) {
      const roleType = shift.role_type || 'main';
      const teacherNameRaw = clean(shift.teacher_name);
      if (!teacherNameRaw && roleType !== 'main') {
        skipped++;
        continue;
      }

      const normalizedTeacher = normalizeName(teacherNameRaw);
      const teacher = teachers.get(normalizedTeacher);
      const unresolvedMain = !teacherNameRaw || ['未', '未定', '―', '-', '⇒'].includes(teacherNameRaw);
      if (teacherNameRaw && !teacher && !unresolvedMain) missingTeacherCount++;

      const syncKey = buildSyncKey({ ...shift, source_spreadsheet_id: sourceSpreadsheetId, source_sheet_name: sourceSheetName });
      const existing = existingByKey.get(syncKey);
      const ref = existing ? existing.ref : db.collection('shift_assignments').doc();
      const period = periodLabel(shift.period);

      batch.set(ref, {
        sync_key: syncKey,
        sync_source: 'google_sheet',
        source_spreadsheet_id: sourceSpreadsheetId,
        source_sheet_name: sourceSheetName,
        source_row: Number(shift.source_row || 0) || null,
        source_col: Number(shift.source_col || 0) || null,
        user_id: teacher?.id || '',
        teacher_name: teacher?.name || teacherNameRaw || (roleType === 'main' ? '未定' : ''),
        target_date: clean(shift.target_date),
        role_type: roleType,
        target_grade: roleType === 'general' ? null : clean(shift.grade),
        target_subject: roleType === 'general' ? null : clean(shift.subject),
        target_detail_subject: roleType === 'general' ? null : clean(shift.detail_subject),
        target_place: roleType === 'general' ? null : clean(shift.place),
        target_meeting_id: roleType === 'main' ? clean(shift.meeting_id) : null,
        target_signin_address: roleType === 'main' ? clean(shift.signin_address) : null,
        unit: roleType === 'main' ? clean(shift.unit) : null,
        note: clean(shift.note) || `【${period}限】${roleType === 'general' ? '全体サポート' : ''}`,
        synced_by: actor.uid,
        synced_by_role: actor.role,
        synced_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
        created_at: existing ? existing.data().created_at || FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
      }, { merge: true });

      if (existing) updated++;
      else created++;
      batchCount++;
      if (batchCount >= 400) await commit();
    }

    await commit();

    await db.collection('shift_sync_logs').add({
      source_spreadsheet_id: sourceSpreadsheetId,
      source_sheet_name: sourceSheetName,
      start_date: startDate,
      end_date: endDate,
      incoming: validShifts.length,
      created,
      updated,
      deleted,
      skipped,
      missing_teacher_count: missingTeacherCount,
      actor_id: actor.uid,
      actor_role: actor.role,
      created_at: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ ok: true, incoming: validShifts.length, created, updated, deleted, skipped, missing_teacher_count: missingTeacherCount });
  } catch (error: any) {
    console.error('shift sync POST error:', error);
    return NextResponse.json({ ok: false, error: error.message || 'sync failed' }, { status: error.message === 'forbidden' ? 403 : 400 });
  }
}

export async function GET(request: NextRequest) {
  try {
    await assertAllowed(request);
    const sourceSpreadsheetId = clean(request.nextUrl.searchParams.get('source_spreadsheet_id'));
    const sourceSheetName = clean(request.nextUrl.searchParams.get('source_sheet_name'));
    const startDate = clean(request.nextUrl.searchParams.get('start_date'));
    const endDate = clean(request.nextUrl.searchParams.get('end_date'));

    if (!startDate || !endDate) {
      return NextResponse.json({ ok: false, error: 'start_date and end_date are required' }, { status: 400 });
    }

    let q: FirebaseFirestore.Query = adminDb().collection('shift_assignments')
      .where('target_date', '>=', startDate)
      .where('target_date', '<=', endDate);

    if (sourceSpreadsheetId) q = q.where('source_spreadsheet_id', '==', sourceSpreadsheetId);
    if (sourceSheetName) q = q.where('source_sheet_name', '==', sourceSheetName);

    const snap = await q.get();
    const shifts = snap.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        sync_key: data.sync_key || '',
        source_row: data.source_row || null,
        source_col: data.source_col || null,
        target_date: data.target_date || '',
        period: String(data.note || '').includes('2') || String(data.note || '').includes('２') ? 2 : 1,
        role_type: data.role_type || 'main',
        teacher_name: data.teacher_name || '',
        grade: data.target_grade || '',
        subject: data.target_subject || '',
        detail_subject: data.target_detail_subject || '',
        place: data.target_place || '',
        unit: data.unit || '',
        meeting_id: data.target_meeting_id || '',
        signin_address: data.target_signin_address || '',
      };
    });

    return NextResponse.json({ ok: true, count: shifts.length, shifts });
  } catch (error: any) {
    console.error('shift sync GET error:', error);
    return NextResponse.json({ ok: false, error: error.message || 'export failed' }, { status: error.message === 'forbidden' ? 403 : 400 });
  }
}
