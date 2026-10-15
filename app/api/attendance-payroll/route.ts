import { createHash } from 'crypto';
import { NextRequest } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminBucket, adminDb } from '@/lib/firebase-admin';
import { canManageAttendanceSystem, getServerUser, jsonError } from '@/lib/server-auth';
import {
  calculateAttendancePayroll,
  normalizeRegularAttendanceIntervalRecord,
  normalizePersonCode,
  parseRateMasterCsv,
  parseRegularAttendanceCsv,
  regularAttendancePersonKey,
  type PayrollRateMaster,
  type PayrollWorkRecord,
  type RegularAttendanceInterval,
} from '@/lib/attendance-payroll';
import { parseRegularAttendanceXlsx } from '@/lib/attendance-xlsx';
import { parseLegacyAllowanceWorkbook, parseLegacyRateWorkbook } from '@/lib/legacy-xls';
import { isSemiDedicatedProfile } from '@/lib/employment-category';
import { getAllQueryDocuments } from '@/lib/server/firestore-pagination';
import { attendanceProgramMatches, normalizeAttendanceSegment } from '@/lib/attendance-work-detail';
import { buildScienceSocialWorkSummary, type ScienceSocialWorkInterval } from '@/lib/science-social-work-summary';
import {
  calculateIntegratedPayroll,
  DEFAULT_INDIVIDUAL_RATE_MAPPINGS,
  DEFAULT_PREMIUM_RULES,
  parseSchoolDistributionCsv,
  type IntegratedPayrollScope,
  type IndividualRateKey,
  type IndividualRateMapping,
  type PayrollAdjustment,
  type PremiumCalculationRule,
  type PremiumRuleKey,
  type SchoolDistributionEntry,
} from '@/lib/attendance-integrated-payroll';

export const runtime = 'nodejs';
// 月次の旧勤怠Excelは、解析後に1,000件前後の圧縮ドキュメントを
// Firestoreへ保存する。60秒では通信待ち中に打ち切られるため、このAPIだけ延長する。
export const maxDuration = 180;

const RATE_COLLECTION = 'attendance_payroll_rate_masters';
const REGULAR_COLLECTION = 'attendance_regular_imports';
const IMPORT_COLLECTION = 'attendance_import_batches';
const SCHOOL_DISTRIBUTION_COLLECTION = 'attendance_school_distribution_imports';
const ADJUSTMENT_COLLECTION = 'attendance_payroll_adjustments';
const SETTINGS_COLLECTION = 'attendance_payroll_settings';
const PREMIUM_RULES_DOCUMENT = 'premium_rules';
const INDIVIDUAL_RATE_MAPPING_DOCUMENT = 'individual_rate_mapping';
const MAX_CSV_BYTES = 2 * 1024 * 1024;
const MAX_XLSX_BYTES = 6 * 1024 * 1024;
// Vercel's request-body limit is 4.5 MB; leave room for multipart framing.
const MAX_DIRECT_XLS_BYTES = 4 * 1024 * 1024;
const LEGACY_XLS_CHUNK_BYTES = 2 * 1024 * 1024;
const MAX_LEGACY_XLS_CHUNKS = 6;
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

async function regularMonthDocumentIds(start: string, end: string) {
  const db = adminDb();
  return (await getAllQueryDocuments(db.collection(REGULAR_COLLECTION)
    .where('date', '>=', start)
    .where('date', '<=', end)
    // 削除対象の判定にはIDだけあればよい。intervals全件を取得しない。
    .select()))
    .map(doc => doc.id);
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
    // 同じ個人コードの氏名表記が異なっても別グループにしない。
    // 以前は別グループが同じFirestore IDを生成し、後の行で上書きする可能性があった。
    const key = regularAttendancePersonKey(item);
    groups.set(key, [...(groups.get(key) || []), item]);
  });
  const compacted: Array<{ id: string; data: Record<string, unknown> }> = [];
  groups.forEach(group => {
    group.sort((left, right) => [left.date, left.start_time, left.end_time, left.work_type || ''].join('\u001f')
      .localeCompare([right.date, right.start_time, right.end_time, right.work_type || ''].join('\u001f'), 'ja'));
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
            school_code: item.school_code || '',
            school_name: item.school_name || '',
            course_code: item.course_code || '',
            course_name: item.course_name || '',
            work_code: item.work_code || '',
            actual_minutes: Number(item.actual_minutes || 0),
            payroll_tier: item.payroll_tier || '',
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
  if (!canManageAttendanceSystem(user)) throw new Error('forbidden');
}

function legacyChunkFiles(uid: string, uploadId: string, count: number) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uploadId) ||
      !Number.isInteger(count) || count < 1 || count > MAX_LEGACY_XLS_CHUNKS) return null;
  return Array.from({ length: count }, (_, index) => adminBucket().file(`attendance_imports/${uid}/chunks/${uploadId}/${index}`));
}

function normalizePremiumRules(value: unknown): PremiumCalculationRule[] {
  const supplied = Array.isArray(value) ? value : [];
  return DEFAULT_PREMIUM_RULES.map(defaultRule => {
    const candidate = supplied.find(item => item && typeof item === 'object' && String((item as Record<string, unknown>).key || '') === defaultRule.key) as Record<string, unknown> | undefined;
    const multiplier = Number(candidate?.multiplier);
    const fixedAddition = Number(candidate?.fixed_hourly_addition);
    return {
      ...defaultRule,
      multiplier: Number.isFinite(multiplier) && multiplier >= 0 && multiplier <= 10 ? multiplier : defaultRule.multiplier,
      fixed_hourly_addition: Number.isFinite(fixedAddition) && fixedAddition >= -100_000 && fixedAddition <= 100_000 ? Math.sign(fixedAddition) * Math.ceil(Math.abs(fixedAddition) - 1e-9) : defaultRule.fixed_hourly_addition,
      rounding: 'ceil',
      enabled: candidate?.enabled === undefined ? defaultRule.enabled : Boolean(candidate.enabled),
    };
  });
}

function normalizeIndividualRateMappings(value: unknown): IndividualRateMapping[] {
  const supplied = Array.isArray(value) ? value : [];
  const validRateKeys = new Set(DEFAULT_INDIVIDUAL_RATE_MAPPINGS.map(item => item.rate_item_key));
  return DEFAULT_INDIVIDUAL_RATE_MAPPINGS.map(defaultMapping => {
    const candidate = supplied.find(item => item && typeof item === 'object' && String((item as Record<string, unknown>).attendance_key || '') === defaultMapping.attendance_key) as Record<string, unknown> | undefined;
    const rateItemKey = String(candidate?.rate_item_key || '') as IndividualRateKey;
    return { ...defaultMapping, rate_item_key: validRateKeys.has(rateItemKey) ? rateItemKey : defaultMapping.rate_item_key };
  });
}

export async function GET(request: NextRequest) {
  try {
    const user = await getServerUser(request);
    requireAttendanceManager(user);
    const { month, start, end } = monthRange(String(request.nextUrl.searchParams.get('month') || ''));
    const requestedScope = String(request.nextUrl.searchParams.get('scope') || 'combined');
    const scope: IntegratedPayrollScope = ['breakthrough', 'system', 'external', 'combined'].includes(requestedScope) ? requestedScope as IntegratedPayrollScope : 'combined';
    const requestedProgram = scope === 'breakthrough' ? 'breakthrough' : String(request.nextUrl.searchParams.get('program') || 'all');
    const program = ['all', 'normal', 'science_social', 'breakthrough'].includes(requestedProgram) ? requestedProgram : 'all';
    const db = adminDb();
    const [recordDocs, rateDocs, regularDocs, userDocs, schoolDistributionDocs, adjustmentDocs, premiumRuleDoc, individualRateMappingDoc] = await Promise.all([
      getAllQueryDocuments(db.collection('work_records').where('date', '>=', start).where('date', '<=', end)),
      getAllQueryDocuments(db.collection(RATE_COLLECTION).where('effective_from', '<=', end)),
      getAllQueryDocuments(db.collection(REGULAR_COLLECTION).where('date', '>=', start).where('date', '<=', end)),
      getAllQueryDocuments(db.collection('users').where('role', 'in', ['teacher', 'attendance_admin'])),
      getAllQueryDocuments(db.collection(SCHOOL_DISTRIBUTION_COLLECTION).where('month', '==', month)),
      getAllQueryDocuments(db.collection(ADJUSTMENT_COLLECTION).where('month', '==', month)),
      db.collection(SETTINGS_COLLECTION).doc(PREMIUM_RULES_DOCUMENT).get(),
      db.collection(SETTINGS_COLLECTION).doc(INDIVIDUAL_RATE_MAPPING_DOCUMENT).get(),
    ]);

    const userMap = new Map(userDocs.map(doc => [doc.id, doc.data()]));
    const records: PayrollWorkRecord[] = recordDocs.filter(doc => {
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
    const rates = rateDocs.map(doc => ({ id: doc.id, ...doc.data() } as PayrollRateMaster));
    const regularAttendance = regularDocs.flatMap(doc => {
      const data = doc.data();
      if (!data.compacted || !Array.isArray(data.intervals)) return [normalizeRegularAttendanceIntervalRecord({ id: doc.id, ...data })];
      return data.intervals.map((interval: Record<string, unknown>, index: number) => normalizeRegularAttendanceIntervalRecord(interval, {
        id: `${doc.id}_${index}`,
        person_code: String(data.person_code || data.personCode || data.employeeId || ''),
        person_name: String(data.person_name || data.personName || ''),
        normalized_name: String(data.normalized_name || data.normalizedName || ''),
        source_name: String(data.source_name || data.sourceName || data.source || ''),
      }));
    });
    const scienceSocialIntervals: ScienceSocialWorkInterval[] = records.flatMap(record =>
      (record.work_segments || []).flatMap((rawSegment, index) => {
        const segment = normalizeAttendanceSegment(rawSegment);
        if (segment.program !== 'science_social' || segment.type === 'break') return [];
        return [{
          id: `${record.id}_${index}`,
          teacher_id: record.teacher_id,
          person_code: record.person_code,
          person_name: record.teacher_name,
          date: record.date,
          start_time: segment.start,
          end_time: segment.end,
        }];
      })
    );
    const scienceSocialWorkSummary = buildScienceSocialWorkSummary(scienceSocialIntervals, regularAttendance);
    const detailedSystemAttendance: RegularAttendanceInterval[] = [];
    const legacyRecords = records.map(record => {
      const sourceSegments = Array.isArray(record.work_segments) ? record.work_segments : [];
      const scopedSegments = sourceSegments.filter(segment => attendanceProgramMatches(segment, program));
      scopedSegments.forEach((rawSegment, index) => {
        const segment = normalizeAttendanceSegment(rawSegment);
        if (!segment.payroll_tier) return;
        const [startHour, startMinute] = segment.start.split(':').map(Number);
        const [endHour, endMinute] = segment.end.split(':').map(Number);
        const rawMinutes = endHour * 60 + endMinute - (startHour * 60 + startMinute);
        const actualMinutes = Number.isFinite(rawMinutes) ? (rawMinutes <= 0 ? rawMinutes + 1440 : rawMinutes) : 0;
        detailedSystemAttendance.push({
          id: `${record.id}_${index}`,
          person_code: record.person_code,
          person_name: record.teacher_name,
          date: record.date,
          start_time: segment.start,
          end_time: segment.end,
          work_type: segment.type,
          school_code: record.school_code,
          school_name: record.school_name,
          course_name: segment.grade || segment.note || '',
          actual_minutes: actualMinutes,
          payroll_tier: segment.payroll_tier,
          attendance_program: segment.program,
          source_name: `新システム・${segment.program}`,
        });
      });
      return {
        ...record,
        work_segments: scopedSegments.filter(segment => !normalizeAttendanceSegment(segment).payroll_tier),
        transportation: program === 'all' || scopedSegments.length > 0 ? record.transportation : [],
      };
    });
    const scopedRegularAttendance = regularAttendance.filter(item => {
      if (program === 'all') return true;
      const label = `${item.course_code || ''} ${item.course_name || ''} ${item.work_code || ''} ${item.work_type || ''}`.normalize('NFKC');
      const inferredProgram = /突破ゼミ|突破/.test(label) ? 'breakthrough' : /理社講座|理社/.test(label) ? 'science_social' : 'normal';
      return inferredProgram === program;
    });
    const diagnosticResult = calculateAttendancePayroll({ month, scope: 'all', records: records.map(record => ({ ...record, work_segments: (record.work_segments || []).filter(segment => attendanceProgramMatches(segment, program)) })), rates, regularAttendance: scopedRegularAttendance });
    const systemResult = calculateAttendancePayroll({ month, scope: 'all', records: legacyRecords, rates, regularAttendance: scopedRegularAttendance });
    const schoolDistributions = schoolDistributionDocs.map(doc => ({ id: doc.id, ...doc.data() } as SchoolDistributionEntry));
    const adjustments = adjustmentDocs.map(doc => ({ id: doc.id, ...doc.data() } as PayrollAdjustment));
    const premiumRules = normalizePremiumRules(premiumRuleDoc.data()?.rules);
    const individualRateMappings = normalizeIndividualRateMappings(individualRateMappingDoc.data()?.mappings);
    const integrated = calculateIntegratedPayroll({
      month, scope, systemRows: systemResult.rows, systemAttendance: detailedSystemAttendance, systemTransportationRecords: legacyRecords, externalAttendance: scopedRegularAttendance, rates,
      schoolDistributions: program === 'all' ? schoolDistributions : [],
      adjustments: program === 'all' ? adjustments : [],
      premiumRules, individualRateMappings, alerts: diagnosticResult.alerts,
    });
    const totals = {
      people: integrated.rows.length,
      total_minutes: integrated.rows.reduce((sum, row) => sum + row.total_minutes, 0),
      total_payment: integrated.rows.reduce((sum, row) => sum + row.total_payment, 0),
      transportation_amount: integrated.rows.reduce((sum, row) => sum + row.transportation_amount, 0),
      gross_payment: integrated.rows.reduce((sum, row) => sum + row.gross_payment, 0),
      danger: integrated.alerts.filter(alert => alert.severity === 'danger').length,
      warning: integrated.alerts.filter(alert => alert.severity === 'warning').length,
      excluded_without_rate: integrated.excluded_without_rate,
    };
    return Response.json({
      ok: true,
      month, scope, program, rows: integrated.rows, alerts: integrated.alerts, totals, adjustments, premium_rules: premiumRules, individual_rate_mappings: individualRateMappings,
      science_social_work_summary: scienceSocialWorkSummary,
      imports: {
        rate_master_rows: rates.length,
        regular_attendance_rows: regularAttendance.length,
        school_distribution_rows: schoolDistributions.length,
        allowance_query_rows: new Set(adjustments.filter(item => item.source_type === 'q042').map(item => item.person_code || item.person_name)).size,
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
    if (request.headers.get('content-type')?.includes('application/octet-stream')) {
      const uploadId = String(request.headers.get('x-attendance-upload-id') || '');
      const count = Number(request.headers.get('x-attendance-chunk-count'));
      const index = Number(request.headers.get('x-attendance-chunk-index'));
      const files = legacyChunkFiles(user.uid, uploadId, count);
      if (!files || !Number.isInteger(index) || index < 0 || index >= count) {
        return Response.json({ ok: false, error: '取込ファイルの分割情報が不正です。' }, { status: 400 });
      }
      if (Number(request.headers.get('content-length') || 0) > LEGACY_XLS_CHUNK_BYTES) {
        return Response.json({ ok: false, error: 'Excelの各送信分は2MB以下にしてください。' }, { status: 413 });
      }
      const bytes = Buffer.from(await request.arrayBuffer());
      if (bytes.length < 1 || bytes.length > LEGACY_XLS_CHUNK_BYTES) {
        return Response.json({ ok: false, error: 'Excelの各送信分は2MB以下にしてください。' }, { status: 413 });
      }
      await files[index].save(bytes, { resumable: false, metadata: { contentType: 'application/octet-stream' } });
      return Response.json({ ok: true, received: index });
    }
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
      const isLegacyXls = file.name.toLowerCase().endsWith('.xls');
      const isRegularXlsx = file.name.toLowerCase().endsWith('.xlsx');
      if (isLegacyXls && (action === 'import_rate_master' || action === 'import_allowance_query')) {
        if (file.size > MAX_DIRECT_XLS_BYTES) return Response.json({ ok: false, error: '直接取込できる旧Excelファイルは4MB以下です。' }, { status: 413 });
        legacyRateBuffer = Buffer.from(await file.arrayBuffer());
      } else if (isRegularXlsx && action === 'import_regular_attendance') {
        if (file.size > MAX_XLSX_BYTES) return Response.json({ ok: false, error: '勤怠Excelは6MB以下にしてください。' }, { status: 413 });
        xlsxBuffer = Buffer.from(await file.arrayBuffer());
      } else {
        return Response.json({ ok: false, error: '取込種別とExcel形式が一致しません。' }, { status: 400 });
      }
    } else {
      const body = await request.json();
      action = String(body.action || '');
      csvText = String(body.csv_text || '');
      sourceName = String(body.source_name || 'import.csv').slice(0, 180);
      replaceMonth = body.replace_month !== false;
      const storagePath = String(body.storage_path || '');
      const chunkUploadId = String(body.chunk_upload_id || '');
      if (action === 'delete_upload_chunks') {
        const files = legacyChunkFiles(user.uid, chunkUploadId, Number(body.chunk_count));
        if (!files) return Response.json({ ok: false, error: '取込ファイルの分割情報が不正です。' }, { status: 400 });
        await Promise.all(files.map(file => file.delete({ ignoreNotFound: true })));
        return Response.json({ ok: true });
      }
      if (chunkUploadId) {
        if (!['import_rate_master', 'import_allowance_query', 'import_regular_attendance'].includes(action)) {
          return Response.json({ ok: false, error: '分割Excelの取込種別が不正です。' }, { status: 400 });
        }
        const files = legacyChunkFiles(user.uid, chunkUploadId, Number(body.chunk_count));
        if (!files) return Response.json({ ok: false, error: '取込ファイルの分割情報が不正です。' }, { status: 400 });
        try {
          const parts = await Promise.all(files.map(file => file.download().then(([bytes]) => bytes)));
          const totalBytes = parts.reduce((sum, part) => sum + part.length, 0);
          if (parts.some(part => part.length < 1 || part.length > LEGACY_XLS_CHUNK_BYTES)) {
            return Response.json({ ok: false, error: 'Excelファイルの分割データが不正です。' }, { status: 400 });
          }
          const combined = Buffer.concat(parts);
          if (action === 'import_regular_attendance') {
            if (!sourceName.toLowerCase().endsWith('.xlsx')) {
              return Response.json({ ok: false, error: '勤怠取込は.xlsxファイルを選択してください。' }, { status: 400 });
            }
            if (totalBytes > MAX_XLSX_BYTES) {
              return Response.json({ ok: false, error: '勤怠Excelは6MB以下にしてください。' }, { status: 413 });
            }
            xlsxBuffer = combined;
          } else {
            if (!sourceName.toLowerCase().endsWith('.xls')) {
              return Response.json({ ok: false, error: '旧Excelファイルは.xls形式を選択してください。' }, { status: 400 });
            }
            if (totalBytes > MAX_LEGACY_XLS_CHUNKS * LEGACY_XLS_CHUNK_BYTES) {
              return Response.json({ ok: false, error: '旧Excelファイルは12MB以下にしてください。' }, { status: 413 });
            }
            legacyRateBuffer = combined;
          }
        } finally {
          await Promise.all(files.map(file => file.delete({ ignoreNotFound: true }).catch(() => undefined)));
        }
      } else if (storagePath) {
        const expectedPrefix = `attendance_imports/${user.uid}/`;
        const isStoredXlsx = storagePath.toLowerCase().endsWith('.xlsx');
        const isStoredXls = storagePath.toLowerCase().endsWith('.xls');
        if (!storagePath.startsWith(expectedPrefix) || (!isStoredXls && !isStoredXlsx)) {
          return Response.json({ ok: false, error: '取込ファイルの保存先が不正です。' }, { status: 400 });
        }
        const temporaryFile = adminBucket().file(storagePath);
        try {
          const [metadata] = await temporaryFile.getMetadata();
          const fileSize = Number(metadata.size || 0);
          if (isStoredXlsx && fileSize > MAX_XLSX_BYTES) return Response.json({ ok: false, error: '勤怠Excelは6MB以下にしてください。' }, { status: 413 });
          if (isStoredXls && fileSize > 12 * 1024 * 1024) return Response.json({ ok: false, error: '旧Excelファイルは12MB以下にしてください。' }, { status: 413 });
          const [downloaded] = await temporaryFile.download();
          if (isStoredXlsx) xlsxBuffer = downloaded;
          else legacyRateBuffer = downloaded;
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
    if (action === 'save_premium_rules') {
      let submitted: unknown;
      try { submitted = JSON.parse(csvText || '[]'); } catch { return Response.json({ ok: false, error: '割増計算式の形式が不正です。' }, { status: 400 }); }
      const rules = normalizePremiumRules(submitted);
      const suppliedKeys = new Set((Array.isArray(submitted) ? submitted : []).map(item => String((item as Record<string, unknown>)?.key || '') as PremiumRuleKey));
      if (suppliedKeys.size !== DEFAULT_PREMIUM_RULES.length || DEFAULT_PREMIUM_RULES.some(rule => !suppliedKeys.has(rule.key))) {
        return Response.json({ ok: false, error: 'すべての割増区分の計算式を設定してください。' }, { status: 400 });
      }
      await db.collection(SETTINGS_COLLECTION).doc(PREMIUM_RULES_DOCUMENT).set({ rules, updated_by: user.uid, updated_at: FieldValue.serverTimestamp() }, { merge: true });
      return Response.json({ ok: true, premium_rules: rules });
    }
    if (action === 'save_individual_rate_mappings') {
      let submitted: unknown;
      try { submitted = JSON.parse(csvText || '[]'); } catch { return Response.json({ ok: false, error: '個別指導の単価紐付け形式が不正です。' }, { status: 400 }); }
      const suppliedKeys = new Set((Array.isArray(submitted) ? submitted : []).map(item => String((item as Record<string, unknown>)?.attendance_key || '') as IndividualRateKey));
      if (suppliedKeys.size !== DEFAULT_INDIVIDUAL_RATE_MAPPINGS.length || DEFAULT_INDIVIDUAL_RATE_MAPPINGS.some(mapping => !suppliedKeys.has(mapping.attendance_key))) {
        return Response.json({ ok: false, error: '個別指導6区分すべての単価紐付けを設定してください。' }, { status: 400 });
      }
      const mappings = normalizeIndividualRateMappings(submitted);
      await db.collection(SETTINGS_COLLECTION).doc(INDIVIDUAL_RATE_MAPPING_DOCUMENT).set({ mappings, updated_by: user.uid, updated_at: FieldValue.serverTimestamp() }, { merge: true });
      return Response.json({ ok: true, individual_rate_mappings: mappings });
    }
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

    if (action === 'import_allowance_query') {
      if (!legacyRateBuffer) return Response.json({ ok: false, error: 'Q042の.xlsファイルを選択してください。' }, { status: 400 });
      const parsed = parseLegacyAllowanceWorkbook(legacyRateBuffer);
      if (parsed.errors.length) return Response.json({ ok: false, error: 'Q042の形式を確認してください。', errors: parsed.errors.slice(0, 30) }, { status: 400 });
      const months = Array.from(new Set(parsed.data.map(item => item.month)));
      if (months.length !== 1) return Response.json({ ok: false, error: 'Q042は1支給月分ずつ取り込んでください。' }, { status: 400 });
      const existing = await getAllQueryDocuments(db.collection(ADJUSTMENT_COLLECTION).where('month', '==', months[0]));
      const staleIds = existing.filter(doc => doc.data().source_type === 'q042').map(doc => doc.id);
      if (staleIds.length) await deleteDocumentsByIds(ADJUSTMENT_COLLECTION, staleIds);
      const adjustmentItems: Array<{ id: string; data: Record<string, unknown> }> = [];
      parsed.data.forEach(item => {
        ([['special_2', item.special_2, '学校前配布等'], ['special_3', item.special_3, '理社講座'], ['transportation', item.transportation, '移動費']] as const).forEach(([category, amount, label]) => {
          if (!amount) return;
          adjustmentItems.push({ id: hashId('q042', item.month, item.person_code || item.person_name, category), data: {
            month: item.month, person_code: item.person_code, person_name: item.person_name, school_code: item.school_code,
            label, category, amount, reason: `Q042取込: ${sourceName}`, source_type: 'q042', imported_by: user.uid, imported_at: FieldValue.serverTimestamp(),
          } });
        });
      });
      await commitInChunks(adjustmentItems, ADJUSTMENT_COLLECTION);
      await importRef.set({ type: 'allowance_query', month: months[0], source_name: sourceName, row_count: parsed.data.length, adjustment_count: adjustmentItems.length, imported_by: user.uid, imported_at: FieldValue.serverTimestamp() });
      return Response.json({ ok: true, imported: parsed.data.length, month: months[0] });
    }

    if (action === 'import_regular_attendance') {
      const parsed = xlsxBuffer ? await parseRegularAttendanceXlsx(xlsxBuffer) : parseRegularAttendanceCsv(csvText);
      if (parsed.errors.length) return Response.json({ ok: false, error: '旧システム勤怠データの形式を確認してください。', errors: parsed.errors.slice(0, 50) }, { status: 400 });
      if (!parsed.data.length || parsed.data.length > MAX_REGULAR_ROWS) return Response.json({ ok: false, error: `取込件数は1〜${MAX_REGULAR_ROWS.toLocaleString()}件にしてください。` }, { status: 400 });
      const months = Array.from(new Set(parsed.data.map(item => item.date.slice(0, 7))));
      if (months.length !== 1) return Response.json({ ok: false, error: '旧システム勤怠データは1か月分ずつ取り込んでください。' }, { status: 400 });
      const { start, end } = monthRange(months[0]);
      const existingIds = replaceMonth ? await regularMonthDocumentIds(start, end) : [];
      const compacted = compactRegularAttendance(parsed.data, months[0], importRef.id, sourceName)
        .map(item => ({ data: { ...item.data, imported_at: FieldValue.serverTimestamp(), imported_by: user.uid }, id: item.id }));
      // 新データの全チャンク保存が成功するまで旧データは削除しない。
      // 再取込の途中失敗で対象月が空になることを防ぐ。
      await commitInChunks(compacted, REGULAR_COLLECTION);
      if (replaceMonth) {
        const expectedIds = new Set(compacted.map(item => item.id));
        const staleIds = existingIds.filter(id => !expectedIds.has(id));
        if (staleIds.length) await deleteDocumentsByIds(REGULAR_COLLECTION, staleIds);
      }
      await importRef.set({ type: 'regular_attendance', month: months[0], source_name: sourceName, row_count: parsed.data.length, stored_document_count: compacted.length, replace_month: replaceMonth, imported_by: user.uid, imported_at: FieldValue.serverTimestamp() });
      return Response.json({ ok: true, imported: parsed.data.length, month: months[0], skipped: parsed.warnings?.length || 0, warnings: parsed.warnings?.slice(0, 20) || [] });
    }

    if (action === 'import_school_distribution') {
      const parsed = parseSchoolDistributionCsv(csvText);
      if (parsed.errors.length) return Response.json({ ok: false, error: '校前配布申請の形式を確認してください。', errors: parsed.errors.slice(0, 20) }, { status: 400 });
      const existing = await getAllQueryDocuments(db.collection(SCHOOL_DISTRIBUTION_COLLECTION).where('month', '==', parsed.month));
      if (existing.length) await deleteDocumentsByIds(SCHOOL_DISTRIBUTION_COLLECTION, existing.map(doc => doc.id));
      await commitInChunks(parsed.data.map(item => ({
        id: hashId(item.month, item.person_code || item.person_name),
        data: { ...item, source_name: sourceName, imported_by: user.uid, imported_at: FieldValue.serverTimestamp() },
      })), SCHOOL_DISTRIBUTION_COLLECTION);
      await importRef.set({ type: 'school_distribution', month: parsed.month, source_name: sourceName, row_count: parsed.data.length, imported_by: user.uid, imported_at: FieldValue.serverTimestamp() });
      return Response.json({ ok: true, imported: parsed.data.length, month: parsed.month });
    }

    if (action === 'save_adjustment') {
      const body = JSON.parse(csvText || '{}');
      const adjustmentMonth = /^\d{4}-\d{2}$/.test(String(body.month || '')) ? String(body.month) : '';
      const category = String(body.category || '');
      const amount = Number(body.amount || 0);
      if (!adjustmentMonth || (!normalizePersonCode(body.person_code) && !String(body.person_name || '').trim()) || !['special_1', 'special_2', 'special_3', 'special_4', 'transportation'].includes(category) || !Number.isFinite(amount) || amount === 0 || !String(body.label || '').trim()) {
        return Response.json({ ok: false, error: '年月、個人コードまたは氏名、手当名、区分、金額を確認してください。' }, { status: 400 });
      }
      const adjustmentRef = body.id ? db.collection(ADJUSTMENT_COLLECTION).doc(String(body.id)) : db.collection(ADJUSTMENT_COLLECTION).doc();
      await adjustmentRef.set({
        month: adjustmentMonth, person_code: normalizePersonCode(body.person_code), person_name: String(body.person_name || '').trim(),
        label: String(body.label).trim().slice(0, 80), category, amount: Math.sign(amount) * Math.ceil(Math.abs(amount) - 1e-9), reason: String(body.reason || '').trim().slice(0, 300),
        updated_by: user.uid, updated_at: FieldValue.serverTimestamp(),
      }, { merge: true });
      return Response.json({ ok: true, id: adjustmentRef.id });
    }

    if (action === 'delete_adjustment') {
      const body = JSON.parse(csvText || '{}');
      if (!body.id) return Response.json({ ok: false, error: '削除対象がありません。' }, { status: 400 });
      await db.collection(ADJUSTMENT_COLLECTION).doc(String(body.id)).delete();
      return Response.json({ ok: true });
    }

    return Response.json({ ok: false, error: '未対応の取込種別です。' }, { status: 400 });
  } catch (error) {
    return jsonError(error);
  }
}
