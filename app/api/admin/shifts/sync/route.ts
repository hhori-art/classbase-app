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

type ExistingShiftDoc = {
  id: string;
  ref: FirebaseFirestore.DocumentReference;
  data: FirebaseFirestore.DocumentData;
};

function syncSecret() {
  return process.env.SHIFT_SYNC_SECRET || process.env.CLASSBASE_SYNC_SECRET || process.env.SECRET_KEY || '';
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
  if (requestSecret && !configured) throw new Error('shift-sync-secret-not-configured');
  if (configured && requestSecret) throw new Error('shift-sync-secret-mismatch');

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

function periodFromShift(data: FirebaseFirestore.DocumentData) {
  if (data.period) return periodLabel(data.period);
  if (data.target_period) return periodLabel(data.target_period);
  const note = String(data.note || '');
  if (note.includes('2') || note.includes('２')) return 2;
  return 1;
}

function normalizeName(value: unknown) {
  return clean(value)
    .replace(/^【遠】/, '')
    .replace(/^遠隔[:：]?/, '')
    .replace(/^オンライン[:：]?/, '')
    .replace(/\r?\n/g, ' ')
    .replace(/先生(?:\s*)$/g, '')
    .replace(/様(?:\s*)$/g, '')
    .replace(/[　\s]/g, '')
    .replace(/[()（）【】\[\]・･]/g, '')
    .toLowerCase();
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

function docIdFromSyncKey(syncKey: string) {
  return crypto.createHash('sha1').update(syncKey).digest('hex');
}

function periodFromValue(value: unknown) {
  const raw = clean(value);
  if (raw) return periodLabel(raw);
  return 1;
}

function duplicateKeyForData(data: FirebaseFirestore.DocumentData) {
  const roleType = clean(data.role_type) || 'main';
  const period = periodFromShift(data);
  if (roleType === 'main') {
    return [
      clean(data.target_date),
      period,
      clean(data.target_grade),
      clean(data.target_subject),
      clean(data.target_detail_subject),
      'main',
    ].join('_');
  }
  if (roleType === 'sub') {
    return [
      clean(data.target_date),
      period,
      clean(data.user_id || data.teacher_name),
      'sub',
    ].join('_');
  }
  if (roleType === 'general') {
    return [
      clean(data.target_date),
      period,
      clean(data.user_id || data.teacher_name),
      'general',
    ].join('_');
  }
  return '';
}

function duplicateKeyForShift(shift: SyncShift, teacher?: { id: string; name: string }) {
  const roleType = shift.role_type || 'main';
  const period = periodFromValue(shift.period);
  if (roleType === 'main') {
    return [
      clean(shift.target_date),
      period,
      clean(shift.grade),
      clean(shift.subject),
      clean(shift.detail_subject),
      'main',
    ].join('_');
  }
  if (roleType === 'sub') {
    return [
      clean(shift.target_date),
      period,
      clean(teacher?.id || shift.teacher_name),
      'sub',
    ].join('_');
  }
  if (roleType === 'general') {
    return [
      clean(shift.target_date),
      period,
      clean(teacher?.id || shift.teacher_name),
      'general',
    ].join('_');
  }
  return '';
}

async function teacherMap() {
  const snap = await adminDb().collection('users').where('role', '==', 'teacher').get();
  const map = new Map<string, { id: string; name: string }>();
  snap.docs.forEach(doc => {
    const data = doc.data();
    const names = [
      data.student_name,
      data.name,
      data.display_name,
      data.displayName,
      data.teacher_name,
    ].map(clean).filter(Boolean);
    const displayName = names[0] || '';
    names.forEach(name => {
      map.set(name, { id: doc.id, name: displayName || name });
      map.set(name.replace(/\s+/g, ''), { id: doc.id, name: displayName || name });
      map.set(normalizeName(name), { id: doc.id, name: displayName || name });
    });
  });
  return map;
}

export async function POST(request: NextRequest) {
  try {
    const actor = await assertAllowed(request);
    const body = await request.json();
    const shifts = Array.isArray(body.shifts) ? body.shifts as SyncShift[] : [];
    const sourceSpreadsheetId = clean(body.source_spreadsheet_id);
    const sourceSheetName = clean(body.source_sheet_name);
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
      .get();
    const rangeSnap = await db.collection('shift_assignments')
      .where('target_date', '>=', startDate)
      .where('target_date', '<=', endDate)
      .get();

    const existingByKey = new Map<string, ExistingShiftDoc>();
    const existingByDuplicateKey = new Map<string, ExistingShiftDoc>();
    existingSnap.docs.forEach(doc => {
      const data = doc.data();
      const targetDate = clean(data.target_date);
      if (targetDate < startDate || targetDate > endDate) return;
      if (data.sync_key) {
        const syncKey = String(data.sync_key);
        if (!existingByKey.has(syncKey)) existingByKey.set(syncKey, { id: doc.id, ref: doc.ref, data });
      }
    });
    rangeSnap.docs.forEach(doc => {
      const data = doc.data();
      const duplicateKey = duplicateKeyForData(data);
      const current = duplicateKey ? existingByDuplicateKey.get(duplicateKey) : null;
      const currentIsGoogleSync = !!clean(current?.data.source_spreadsheet_id);
      const nextIsGoogleSync = !!clean(data.source_spreadsheet_id);
      if (duplicateKey && (!current || (currentIsGoogleSync && !nextIsGoogleSync))) {
        existingByDuplicateKey.set(duplicateKey, { id: doc.id, ref: doc.ref, data });
      }
      if (data.sync_key) {
        const syncKey = String(data.sync_key);
        if (!existingByKey.has(syncKey)) existingByKey.set(syncKey, { id: doc.id, ref: doc.ref, data });
      }
    });

    if (dryRun) {
      return NextResponse.json({
        ok: true,
        dry_run: true,
        incoming: validShifts.length,
        existing: rangeSnap.size,
        existing_google_sheet: existingSnap.size,
        start_date: startDate,
        end_date: endDate,
      });
    }

    let deleted = 0;

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

      const teacherNameForLookup = teacherNameRaw.includes('⇒') ? clean(teacherNameRaw.split('⇒').pop()) : teacherNameRaw;
      const normalizedTeacher = normalizeName(teacherNameForLookup);
      const teacher = teachers.get(normalizedTeacher);
      const unresolvedMain = !teacherNameForLookup ||
        ['未', '未定', '―', '-', 'ー', '⇒', 'nan', 'Nan'].includes(teacherNameForLookup) ||
        /^[\d\s]+$/.test(teacherNameForLookup);
      if (teacherNameRaw && !teacher && !unresolvedMain) missingTeacherCount++;

      const syncKey = buildSyncKey({ ...shift, source_spreadsheet_id: sourceSpreadsheetId, source_sheet_name: sourceSheetName });
      const duplicateKey = duplicateKeyForShift(shift, teacher);
      const existingBySyncKey = existingByKey.get(syncKey);
      const existingByCsvKey = existingByDuplicateKey.get(duplicateKey);
      const existing = existingByCsvKey || existingBySyncKey;
      const ref = existing ? existing.ref : db.collection('shift_assignments').doc(docIdFromSyncKey(syncKey));
      const period = periodLabel(shift.period);

      batch.set(ref, {
        sync_key: syncKey,
        sync_source: 'google_sheet',
        source_spreadsheet_id: sourceSpreadsheetId,
        source_sheet_name: sourceSheetName,
        source_row: Number(shift.source_row || 0) || null,
        source_col: Number(shift.source_col || 0) || null,
        user_id: teacher?.id || '',
        teacher_name: teacher?.name || teacherNameForLookup || (roleType === 'main' ? '未定' : ''),
        target_date: clean(shift.target_date),
        period,
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
        created_at: existing ? existing.data.created_at || FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
      }, { merge: true });

      if (existing) updated++;
      else created++;
      existingByKey.set(syncKey, {
        id: ref.id,
        ref,
        data: {
          sync_key: syncKey,
          target_date: clean(shift.target_date),
          role_type: roleType,
          target_grade: roleType === 'general' ? null : clean(shift.grade),
          target_subject: roleType === 'general' ? null : clean(shift.subject),
          target_detail_subject: roleType === 'general' ? null : clean(shift.detail_subject),
          user_id: teacher?.id || '',
          teacher_name: teacher?.name || teacherNameForLookup || '',
          period,
          note: clean(shift.note),
        },
      });
      if (duplicateKey) {
        existingByDuplicateKey.set(duplicateKey, {
          id: ref.id,
          ref,
          data: {
            target_date: clean(shift.target_date),
            role_type: roleType,
            target_grade: roleType === 'general' ? null : clean(shift.grade),
            target_subject: roleType === 'general' ? null : clean(shift.subject),
            target_detail_subject: roleType === 'general' ? null : clean(shift.detail_subject),
            user_id: teacher?.id || '',
            teacher_name: teacher?.name || teacherNameForLookup || '',
            period,
            note: clean(shift.note),
          },
        });
      }
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

    let q: FirebaseFirestore.Query = adminDb().collection('shift_assignments');
    if (sourceSpreadsheetId && sourceSheetName) {
      q = q.where('source_spreadsheet_id', '==', sourceSpreadsheetId).where('source_sheet_name', '==', sourceSheetName);
    } else {
      q = q.where('target_date', '>=', startDate).where('target_date', '<=', endDate);
    }
    const snap = await q.get();
    const shifts = snap.docs.filter(doc => {
      const data = doc.data();
      const targetDate = clean(data.target_date);
      if (targetDate < startDate || targetDate > endDate) return false;
      if (sourceSpreadsheetId && clean(data.source_spreadsheet_id) !== sourceSpreadsheetId) return false;
      if (sourceSheetName && clean(data.source_sheet_name) !== sourceSheetName) return false;
      return true;
    }).map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        sync_key: data.sync_key || '',
        source_spreadsheet_id: data.source_spreadsheet_id || '',
        source_sheet_name: data.source_sheet_name || '',
        source_row: data.source_row || null,
        source_col: data.source_col || null,
        target_date: data.target_date || '',
        period: periodFromShift(data),
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
    }).sort((a, b) => {
      const dateDiff = String(a.target_date).localeCompare(String(b.target_date));
      if (dateDiff) return dateDiff;
      const rowDiff = Number(a.source_row || 0) - Number(b.source_row || 0);
      if (rowDiff) return rowDiff;
      const colDiff = Number(a.source_col || 0) - Number(b.source_col || 0);
      if (colDiff) return colDiff;
      return String(a.role_type).localeCompare(String(b.role_type));
    });

    return NextResponse.json({ ok: true, count: shifts.length, shifts });
  } catch (error: any) {
    console.error('shift sync GET error:', error);
    return NextResponse.json({ ok: false, error: error.message || 'export failed' }, { status: error.message === 'forbidden' ? 403 : 400 });
  }
}
