import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import crypto from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { canManageShifts, getServerUser, jsonError } from '@/lib/server-auth';
import { canonicalPeriodForGradeSubject, fixedPeriodForGradeCourse } from '@/lib/course-registration-match';
import { isValidShiftDate, normalizeShiftCourseIdentity, normalizeShiftGrade, normalizeShiftIdentityText, normalizeShiftPeriod, normalizeShiftSubject, redirectedShiftDetailFromTeacher, shiftTeacherNameAfterChange, validateShiftSyncStructure } from '@/lib/shift-sync-normalization';

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
  // URLのクエリはブラウザ履歴やアクセスログに残るため、同期用秘密値は専用ヘッダーだけで受け取る。
  const requestSecret = request.headers.get('x-shift-sync-secret') || '';
  if (configured && safeEqual(requestSecret, configured)) return { uid: 'gas-sync', role: 'system' };
  if (requestSecret && !configured) throw new Error('shift-sync-secret-not-configured');
  if (configured && requestSecret) throw new Error('shift-sync-secret-mismatch');

  const user = await getServerUser(request);
  if (!canManageShifts(user)) throw new Error('forbidden');
  return { uid: user.uid, role: user.role };
}

function clean(value: unknown) {
  return String(value ?? '').replace(/\r/g, '\n').trim();
}

function validDateRange(startDate: string, endDate: string) {
  if (!isValidShiftDate(startDate) || !isValidShiftDate(endDate) || startDate > endDate) return false;
  return new Date(`${endDate}T00:00:00Z`).getTime() - new Date(`${startDate}T00:00:00Z`).getTime() <= 370 * 24 * 60 * 60 * 1000;
}

function periodLabel(period: unknown) {
  return normalizeShiftPeriod(period) || 1;
}

function periodFromShift(data: FirebaseFirestore.DocumentData) {
  const isLegacyCorrectionDate = clean(data.target_date) === '2026-09-11';
  // Google配置表から保存した明示時限を最優先する。通常カリキュラムの
  // 固定時限は、旧データなど時限情報がない場合だけ補完に使う。
  const explicitPeriod = normalizeShiftPeriod(data.period)
    || normalizeShiftPeriod(data.target_period)
    || normalizeShiftPeriod(data.note);
  if (explicitPeriod && !isLegacyCorrectionDate) return explicitPeriod;
  const fixedCoursePeriod = fixedPeriodForGradeCourse(
    data.target_grade || data.grade,
    data.target_detail_subject || data.detail_subject,
  );
  if (fixedCoursePeriod) return fixedCoursePeriod;
  const canonicalPeriod = canonicalPeriodForGradeSubject(
    data.target_grade || data.grade,
    data.target_subject || data.subject || data.target_detail_subject || data.detail_subject,
    data.target_detail_subject || data.detail_subject,
  );
  // 配置表の結合セルや行ずれで時限だけが壊れても、既知の時間割を優先する。
  if (canonicalPeriod) return canonicalPeriod;
  if (explicitPeriod) return explicitPeriod;
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

function sourceRow(shift: SyncShift) {
  return Number(shift.source_row || 0) || 0;
}

function blockKey(shift: SyncShift, rowOffset = 0) {
  const row = sourceRow(shift) + rowOffset;
  if (!row) return '';
  return `${clean(shift.target_date)}:${row}`;
}

function inferBlockPeriods(shifts: SyncShift[]) {
  const candidates = new Map<string, Set<1 | 2>>();
  shifts.forEach(shift => {
    if ((shift.role_type || 'main') !== 'main') return;
    const key = blockKey(shift);
    const period = canonicalPeriodForGradeSubject(shift.grade, shift.subject || shift.detail_subject, shift.detail_subject);
    if (!key || !period) return;
    const values = candidates.get(key) || new Set<1 | 2>();
    values.add(period);
    candidates.set(key, values);
  });

  const periods = new Map<string, 1 | 2>();
  candidates.forEach((values, key) => {
    if (values.size === 1) periods.set(key, [...values][0]);
  });
  return periods;
}

function resolvedPeriodForShift(shift: SyncShift, blockPeriods: Map<string, 1 | 2>) {
  const roleType = shift.role_type || 'main';
  const key = blockKey(shift, roleType === 'sub' ? -1 : 0);
  const explicitPeriod = normalizeShiftPeriod(shift.period);
  const isLegacyCorrectionDate = clean(shift.target_date) === '2026-09-11';
  if (explicitPeriod && !isLegacyCorrectionDate) return explicitPeriod;
  const fixedCoursePeriod = fixedPeriodForGradeCourse(shift.grade, shift.detail_subject);
  if (fixedCoursePeriod) return fixedCoursePeriod;
  const canonicalPeriod = canonicalPeriodForGradeSubject(
    shift.grade,
    shift.subject || shift.detail_subject,
    shift.detail_subject,
  );
  if (canonicalPeriod) return canonicalPeriod;
  return explicitPeriod
    || (key ? blockPeriods.get(key) : null)
    || periodFromValue(shift.period);
}

function redirectedMainKey(shift: SyncShift, detail: unknown, period: 1 | 2) {
  return [
    clean(shift.target_date),
    period,
    normalizeShiftGrade(shift.grade),
    normalizeShiftSubject(shift.subject),
    normalizeShiftCourseIdentity(detail),
  ].join(':');
}

function parentClassKey(shift: SyncShift, period: 1 | 2) {
  return [
    clean(shift.target_date),
    period,
    normalizeShiftGrade(shift.grade),
    normalizeShiftSubject(shift.subject),
    normalizeShiftCourseIdentity(shift.detail_subject),
  ].join(':');
}

function duplicateKeyForData(data: FirebaseFirestore.DocumentData) {
  const roleType = clean(data.role_type) || 'main';
  const period = periodFromShift(data);
  if (roleType === 'main') {
    const meetingId = clean(data.target_meeting_id || data.meeting_id).replace(/\D/g, '');
    return [
      clean(data.target_date),
      period,
      normalizeShiftGrade(data.target_grade),
      normalizeShiftSubject(data.target_subject),
      meetingId ? `meeting:${meetingId}` : normalizeShiftCourseIdentity(data.target_detail_subject),
      'main',
    ].join('_');
  }
  if (roleType === 'sub') {
    return [
      clean(data.target_date),
      period,
      normalizeShiftGrade(data.target_grade),
      normalizeShiftSubject(data.target_subject),
      normalizeShiftCourseIdentity(data.target_detail_subject),
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

function duplicateKeyForShift(shift: SyncShift, teacher: { id: string; name: string } | undefined, period: 1 | 2) {
  const roleType = shift.role_type || 'main';
  if (roleType === 'main') {
    const meetingId = clean(shift.meeting_id).replace(/\D/g, '');
    return [
      clean(shift.target_date),
      period,
      normalizeShiftGrade(shift.grade),
      normalizeShiftSubject(shift.subject),
      meetingId ? `meeting:${meetingId}` : normalizeShiftCourseIdentity(shift.detail_subject),
      'main',
    ].join('_');
  }
  if (roleType === 'sub') {
    return [
      clean(shift.target_date),
      period,
      normalizeShiftGrade(shift.grade),
      normalizeShiftSubject(shift.subject),
      normalizeShiftCourseIdentity(shift.detail_subject),
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
  const aliasCandidates = new Map<string, Map<string, { id: string; name: string }>>();
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
      const teacher = { id: doc.id, name: displayName || name };
      map.set(name, teacher);
      map.set(name.replace(/\s+/g, ''), teacher);
      map.set(normalizeName(name), teacher);
      const surname = name.trim().split(/[\s　]+/)[0];
      const alias = normalizeName(surname);
      if (alias && alias !== normalizeName(name)) {
        if (!aliasCandidates.has(alias)) aliasCandidates.set(alias, new Map());
        aliasCandidates.get(alias)!.set(doc.id, teacher);
      }
    });
  });
  // 姓だけの記載は、同姓の講師が1人に確定できる場合だけ安全に紐付ける。
  aliasCandidates.forEach((candidates, alias) => {
    if (candidates.size === 1 && !map.has(alias)) map.set(alias, [...candidates.values()][0]);
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
    const replace = body.replace === true;
    const forceOverwrite = body.force_overwrite === true;

    if (!sourceSpreadsheetId || !sourceSheetName) {
      return NextResponse.json({ ok: false, error: 'source_spreadsheet_id and source_sheet_name are required' }, { status: 400 });
    }
    if (!/^[A-Za-z0-9_-]{3,160}$/.test(sourceSpreadsheetId) || sourceSheetName.length > 120 || /[\u0000-\u001f]/.test(sourceSheetName)) {
      return NextResponse.json({ ok: false, error: '同期元のスプレッドシートIDまたはシート名が不正です。' }, { status: 400 });
    }
    if (!shifts.length) {
      return NextResponse.json({ ok: false, error: 'shifts is empty' }, { status: 400 });
    }
    if (shifts.length > 5000) {
      return NextResponse.json({ ok: false, error: '配置は1回5,000件以内で同期してください。' }, { status: 413 });
    }
    const structure = validateShiftSyncStructure(shifts);
    if (!structure.valid) {
      return NextResponse.json({ ok: false, error: '配置データの構造を確認してください。同期は実行されていません。', errors: structure.errors.slice(0, 50) }, { status: 400 });
    }

    let validShifts = shifts
      .filter(shift => clean(shift.target_date))
      .map(shift => ({
        ...shift,
        grade: shift.role_type === 'general' ? null : normalizeShiftGrade(shift.grade),
        subject: shift.role_type === 'general' ? null : normalizeShiftSubject(shift.subject),
      }))
      .filter(shift => shift.role_type === 'general' || (clean(shift.grade) && clean(shift.subject)));
    if (!validShifts.length) {
      return NextResponse.json({ ok: false, error: 'valid target_date is missing' }, { status: 400 });
    }

    const db = adminDb();
    const incomingDates = [...new Set(validShifts.map(shift => clean(shift.target_date)))];
    const lockSnaps = await db.getAll(...incomingDates.map(date => db.collection('shift_sync_locks').doc(date)));
    const lockedDates = new Set(lockSnaps
      .filter(snapshot => snapshot.exists && snapshot.data()?.active === true)
      .map(snapshot => snapshot.id));
    validShifts = validShifts.filter(shift => !lockedDates.has(clean(shift.target_date)));
    if (!validShifts.length) {
      return NextResponse.json({ ok: true, incoming: 0, created: 0, updated: 0, deleted: 0, skipped: shifts.length, locked_dates: [...lockedDates] });
    }

    const dates = validShifts.map(s => clean(s.target_date)).sort();
    // 検索・置換範囲は受信した配置日から導出し、任意の広い期間を読ませない。
    const startDate = dates[0];
    const endDate = dates[dates.length - 1];
    if (!validDateRange(startDate, endDate)) {
      return NextResponse.json({ ok: false, error: '同期対象期間は実在する日付の370日以内にしてください。' }, { status: 400 });
    }
    const incomingDateSet = new Set(dates);
    const datesWithMainClasses = new Set(validShifts
      .filter(shift => (shift.role_type || 'main') === 'main')
      .map(shift => clean(shift.target_date)));
    if (datesWithMainClasses.size === 0) {
      return NextResponse.json({ ok: false, error: 'main class shifts are missing; sync was not applied' }, { status: 422 });
    }

    const teachers = await teacherMap();
    const blockPeriods = inferBlockPeriods(validShifts);
    const mainTeacherByDateDetail = new Map<string, string>();
    validShifts.forEach(shift => {
      if ((shift.role_type || 'main') !== 'main') return;
      const teacherName = clean(shift.teacher_name);
      if (!teacherName || redirectedShiftDetailFromTeacher(teacherName, shift.detail_subject)) return;
      const key = redirectedMainKey(shift, shift.detail_subject, resolvedPeriodForShift(shift, blockPeriods));
      mainTeacherByDateDetail.set(key, teacherName);
    });
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
    const existingById = new Map<string, ExistingShiftDoc>();
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
      existingById.set(doc.id, { id: doc.id, ref: doc.ref, data });
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
    let correctedPeriodCount = 0;
    let cleanedLegacyCount = 0;
    let batch = db.batch();
    let batchCount = 0;
    const retainedRefPaths = new Set<string>();
    const mainRefByClassKey = new Map<string, string>();

    const commit = async () => {
      if (!batchCount) return;
      await batch.commit();
      batch = db.batch();
      batchCount = 0;
    };

    // 補助行が主担当行より先に送られても parent_id を確実に設定できるよう、
    // 日付・時限ごとに主担当を先に処理する。
    const orderedShifts = validShifts.slice().sort((a, b) => {
      const dateDiff = clean(a.target_date).localeCompare(clean(b.target_date));
      if (dateDiff) return dateDiff;
      const periodDiff = resolvedPeriodForShift(a, blockPeriods) - resolvedPeriodForShift(b, blockPeriods);
      if (periodDiff) return periodDiff;
      const roleRank = (role: unknown) => role === 'main' || !role ? 0 : role === 'sub' ? 1 : 2;
      return roleRank(a.role_type) - roleRank(b.role_type);
    });

    for (const shift of orderedShifts) {
      const roleType = shift.role_type || 'main';
      const rawTeacherCell = clean(shift.teacher_name);
      const redirectedDetail = roleType === 'main' ? redirectedShiftDetailFromTeacher(rawTeacherCell, shift.detail_subject) : '';
      const period = resolvedPeriodForShift(shift, blockPeriods);
      const teacherNameRaw = redirectedDetail
        ? mainTeacherByDateDetail.get(redirectedMainKey(shift, redirectedDetail, period)) || '未定'
        : rawTeacherCell;
      if (!teacherNameRaw && roleType !== 'main') {
        skipped++;
        continue;
      }

      const teacherNameForLookup = shiftTeacherNameAfterChange(teacherNameRaw);
      const normalizedTeacher = normalizeName(teacherNameForLookup);
      const teacher = teachers.get(normalizedTeacher);
      const unresolvedMain = !teacherNameForLookup ||
        ['未', '未定', '―', '-', 'ー', '⇒', 'nan', 'Nan'].includes(teacherNameForLookup) ||
        /^[\d\s]+$/.test(teacherNameForLookup);
      // サポート欄は講師アカウントと一致した人だけを取り込む。
      // 欄外の教室番号等が全体サポートとして保存されるのを防ぐ。
      if (roleType !== 'main' && !teacher) {
        skipped++;
        continue;
      }
      if (teacherNameRaw && !teacher && !unresolvedMain) missingTeacherCount++;

      const syncKey = buildSyncKey({ ...shift, source_spreadsheet_id: sourceSpreadsheetId, source_sheet_name: sourceSheetName });
      const explicitPeriod = normalizeShiftPeriod(shift.period);
      if (explicitPeriod && explicitPeriod !== period) correctedPeriodCount++;
      const duplicateKey = duplicateKeyForShift(shift, teacher, period);
      const existingBySyncKey = existingByKey.get(syncKey);
      const existingByCsvKey = existingByDuplicateKey.get(duplicateKey);
      const existing = existingByCsvKey || existingBySyncKey;
      const deterministicId = docIdFromSyncKey(syncKey);
      const occupied = existingById.get(deterministicId);
      // 過去の重複統合で、別sync_keyの文書が本来の決定的IDを占有している場合がある。
      // 同じIDへ再作成して後続行に上書きされないよう、衝突時だけ退避IDを採番する。
      const newId = occupied && clean(occupied.data.sync_key) !== syncKey
        ? docIdFromSyncKey(`${syncKey}:recreated`)
        : deterministicId;
      const ref = existing ? existing.ref : db.collection('shift_assignments').doc(newId);
      if (roleType === 'main') mainRefByClassKey.set(parentClassKey(shift, period), ref.id);
      const parentId = roleType === 'sub'
        ? mainRefByClassKey.get(parentClassKey(shift, period)) || null
        : null;
      retainedRefPaths.add(ref.path);
      const incomingNote = clean(shift.note);
      const normalizedNote = incomingNote
        ? incomingNote.replace(/^【[１２12]限】/, `【${period}限】`)
        : `【${period}限】${roleType === 'general' ? '全体サポート' : ''}`;

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
        parent_id: parentId,
        target_grade: roleType === 'general' ? null : clean(shift.grade),
        target_subject: roleType === 'general' ? null : clean(shift.subject),
        target_detail_subject: roleType === 'general' ? null : clean(shift.detail_subject),
        target_place: roleType === 'general' ? null : clean(shift.place),
        target_meeting_id: roleType === 'main' ? clean(shift.meeting_id) : null,
        target_signin_address: roleType === 'main' ? clean(shift.signin_address) : null,
        unit: roleType === 'main' ? clean(shift.unit) : null,
        note: normalizedNote,
        synced_by: actor.uid,
        synced_by_role: actor.role,
        synced_at: FieldValue.serverTimestamp(),
        updated_at: FieldValue.serverTimestamp(),
        created_at: existing ? existing.data.created_at || FieldValue.serverTimestamp() : FieldValue.serverTimestamp(),
        sync_repair_preserve: FieldValue.delete(),
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
          note: normalizedNote,
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
            note: normalizedNote,
          },
        });
      }
      existingById.set(ref.id, { id: ref.id, ref, data: { sync_key: syncKey } });
      batchCount++;
      if (batchCount >= 400) await commit();
    }

    if (replace) {
      for (const doc of existingSnap.docs) {
        const data = doc.data();
        const targetDate = clean(data.target_date);
        // start/end の間にあるだけの未送信日を削除しない。GASが部分送信した場合も
        // 当日配置を残し、参加ボタンが全消失する事故を防ぐ。
        if (!incomingDateSet.has(targetDate) || !datesWithMainClasses.has(targetDate) || lockedDates.has(targetDate) || retainedRefPaths.has(doc.ref.path) || data.sync_repair_preserve === true) continue;
        batch.delete(doc.ref);
        deleted++;
        batchCount++;
        if (batchCount >= 400) await commit();
      }
    }

    if (forceOverwrite) {
      const archiveBatchId = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      for (const doc of rangeSnap.docs) {
        const data = doc.data();
        const targetDate = clean(data.target_date);
        const roleType = clean(data.role_type) || 'main';
        // GASを正として入れ直す場合、対象日に残る旧CSV・旧GASの授業／補助だけを整理する。
        // 手動の全体サポートと、今回の同期でGoogle配置へ移行した文書は保持する。
        if (!incomingDateSet.has(targetDate) || lockedDates.has(targetDate) || roleType === 'general') continue;
        if (clean(data.source_spreadsheet_id) || retainedRefPaths.has(doc.ref.path)) continue;
        const archiveRef = db.collection('shift_assignment_archives').doc(`${archiveBatchId}_${doc.id}`);
        batch.set(archiveRef, {
          ...data,
          original_id: doc.id,
          archived_reason: 'google_sheet_force_overwrite',
          archived_batch_id: archiveBatchId,
          archived_at: FieldValue.serverTimestamp(),
          archived_by: actor.uid,
        });
        batch.delete(doc.ref);
        deleted++;
        cleanedLegacyCount++;
        batchCount += 2;
        if (batchCount >= 400) await commit();
      }
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
      corrected_period_count: correctedPeriodCount,
      cleaned_legacy_count: cleanedLegacyCount,
      actor_id: actor.uid,
      actor_role: actor.role,
      created_at: FieldValue.serverTimestamp(),
    });

    await db.collection('system_status').doc('shift_sync').set({
      ok: true,
      source_spreadsheet_id: sourceSpreadsheetId,
      source_sheet_name: sourceSheetName,
      start_date: startDate,
      end_date: endDate,
      incoming_dates: Array.from(incomingDateSet),
      incoming: validShifts.length,
      created,
      updated,
      deleted,
      skipped,
      missing_teacher_count: missingTeacherCount,
      corrected_period_count: correctedPeriodCount,
      cleaned_legacy_count: cleanedLegacyCount,
      last_success_at: FieldValue.serverTimestamp(),
    }, { merge: true });
    // 受講登録の候補のキャッシュは、配置が実際に変わったときだけ作り直す（GAS が数分ごとに同期しても毎回作り直さない）。
    if (created + updated + deleted + cleanedLegacyCount > 0) revalidateTag('course-registration-options');

    return NextResponse.json({ ok: true, incoming: validShifts.length, created, updated, deleted, skipped, missing_teacher_count: missingTeacherCount, corrected_period_count: correctedPeriodCount, cleaned_legacy_count: cleanedLegacyCount, locked_dates: [...lockedDates] });
  } catch (error) {
    // こちらのコード（forbidden など）以外の中身は見せない。
    return jsonError(error);
  }
}

export async function GET(request: NextRequest) {
  try {
    await assertAllowed(request);
    const sourceSpreadsheetId = clean(request.nextUrl.searchParams.get('source_spreadsheet_id'));
    const sourceSheetName = clean(request.nextUrl.searchParams.get('source_sheet_name'));
    const startDate = clean(request.nextUrl.searchParams.get('start_date'));
    const endDate = clean(request.nextUrl.searchParams.get('end_date'));

    if (!validDateRange(startDate, endDate)) {
      return NextResponse.json({ ok: false, error: 'start_date and end_date must be valid and within 370 days' }, { status: 400 });
    }
    if ((sourceSpreadsheetId || sourceSheetName) && (!sourceSpreadsheetId || !sourceSheetName || !/^[A-Za-z0-9_-]{3,160}$/.test(sourceSpreadsheetId) || sourceSheetName.length > 120 || /[\u0000-\u001f]/.test(sourceSheetName))) {
      return NextResponse.json({ ok: false, error: 'invalid source spreadsheet filters' }, { status: 400 });
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
  } catch (error) {
    // こちらのコード（forbidden など）以外の中身は見せない。
    return jsonError(error);
  }
}
