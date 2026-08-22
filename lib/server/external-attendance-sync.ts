import 'server-only';

import { createHash } from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import {
  extractExternalAttendancePage,
  normalizeExternalAttendanceRecord,
  type ExternalAttendanceFieldMap,
  type NormalizedExternalAttendance,
} from '@/lib/external-attendance';

const REGULAR_COLLECTION = 'attendance_regular_imports';
const STATE_COLLECTION = 'attendance_external_sync_state';
const RUN_COLLECTION = 'attendance_external_sync_runs';
const STATE_ID = 'default';
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_PAGES = 50;

type SyncOptions = { start: string; end: string; forceFull?: boolean; requestedBy: string };

type ExternalConfig = {
  enabled: boolean;
  url: string;
  token: string;
  authHeader: string;
  authScheme: string;
  sourceName: string;
  timeoutMs: number;
  recordsPath: string;
  cursorPath: string;
  fieldMap: ExternalAttendanceFieldMap;
  staticHeaders: Record<string, string>;
};

const hashId = (...parts: string[]) => createHash('sha256').update(parts.join('\u001f')).digest('hex').slice(0, 40);

function parseJsonObject<T extends Record<string, unknown>>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as T : fallback;
  } catch {
    return fallback;
  }
}

function config(): ExternalConfig {
  return {
    enabled: process.env.EXTERNAL_ATTENDANCE_SYNC_ENABLED === 'true',
    url: String(process.env.EXTERNAL_ATTENDANCE_API_URL || '').trim(),
    token: String(process.env.EXTERNAL_ATTENDANCE_API_TOKEN || '').trim(),
    authHeader: String(process.env.EXTERNAL_ATTENDANCE_API_AUTH_HEADER || 'Authorization').trim(),
    authScheme: String(process.env.EXTERNAL_ATTENDANCE_API_AUTH_SCHEME || 'Bearer').trim(),
    sourceName: String(process.env.EXTERNAL_ATTENDANCE_SOURCE_NAME || '外部勤怠システム').trim(),
    timeoutMs: Math.max(1000, Number(process.env.EXTERNAL_ATTENDANCE_API_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS),
    recordsPath: String(process.env.EXTERNAL_ATTENDANCE_RECORDS_PATH || '').trim(),
    cursorPath: String(process.env.EXTERNAL_ATTENDANCE_CURSOR_PATH || '').trim(),
    fieldMap: parseJsonObject<ExternalAttendanceFieldMap>(process.env.EXTERNAL_ATTENDANCE_FIELD_MAP, {}),
    staticHeaders: parseJsonObject<Record<string, string>>(process.env.EXTERNAL_ATTENDANCE_STATIC_HEADERS_JSON, {}),
  };
}

export function externalAttendanceConfigStatus() {
  const settings = config();
  const missing = [
    !settings.url && 'EXTERNAL_ATTENDANCE_API_URL',
    !settings.token && 'EXTERNAL_ATTENDANCE_API_TOKEN',
  ].filter(Boolean) as string[];
  let endpointHost = '';
  try { endpointHost = settings.url ? new URL(settings.url).host : ''; } catch { endpointHost = 'URL形式エラー'; }
  return {
    enabled: settings.enabled,
    configured: missing.length === 0 && endpointHost !== 'URL形式エラー',
    missing,
    endpoint_host: endpointHost,
    source_name: settings.sourceName,
  };
}

async function requestPage(settings: ExternalConfig, params: Record<string, string>) {
  const url = new URL(settings.url);
  Object.entries(params).forEach(([key, value]) => value && url.searchParams.set(key, value));
  const headers: Record<string, string> = { Accept: 'application/json', ...settings.staticHeaders };
  if (settings.token) headers[settings.authHeader] = settings.authScheme ? `${settings.authScheme} ${settings.token}` : settings.token;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), settings.timeoutMs);
  try {
    const response = await fetch(url, { headers, cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error(`external-attendance-http-${response.status}`);
    return extractExternalAttendancePage(await response.json(), settings.recordsPath, settings.cursorPath);
  } finally {
    clearTimeout(timeout);
  }
}

function requireConfigured(settings: ExternalConfig) {
  const status = externalAttendanceConfigStatus();
  if (!status.configured) throw new Error(`external-attendance-not-configured:${status.missing.join(',')}`);
}

export async function testExternalAttendanceConnection() {
  const settings = config();
  requireConfigured(settings);
  const page = await requestPage(settings, { limit: '1' });
  const sample = page.records[0] ? normalizeExternalAttendanceRecord(page.records[0], settings.fieldMap) : null;
  return {
    reachable: true,
    received_count: page.records.length,
    sample_valid: sample ? Boolean(sample.data) : null,
    sample_error: sample?.error || '',
  };
}

async function commitChanges(upserts: Array<{ id: string; data: Record<string, unknown> }>, deletes: string[]) {
  const db = adminDb();
  const operations = [
    ...upserts.map(item => ({ kind: 'set' as const, ...item })),
    ...deletes.map(id => ({ kind: 'delete' as const, id })),
  ];
  for (let offset = 0; offset < operations.length; offset += 400) {
    const batch = db.batch();
    operations.slice(offset, offset + 400).forEach(operation => {
      const ref = db.collection(REGULAR_COLLECTION).doc(operation.id);
      if (operation.kind === 'delete') batch.delete(ref);
      else batch.set(ref, operation.data, { merge: true });
    });
    await batch.commit();
  }
}

export async function syncExternalAttendance(options: SyncOptions) {
  const settings = config();
  requireConfigured(settings);
  const db = adminDb();
  const stateRef = db.collection(STATE_COLLECTION).doc(STATE_ID);
  const runRef = db.collection(RUN_COLLECTION).doc();
  const stateSnap = await stateRef.get();
  const state = stateSnap.data() || {};
  const startedAt = new Date().toISOString();
  await runRef.set({ status: 'running', start: options.start, end: options.end, requested_by: options.requestedBy, started_at: FieldValue.serverTimestamp() });

  try {
    let cursor = '';
    let pageCount = 0;
    const rawRecords: unknown[] = [];
    do {
      const query: Record<string, string> = { from: options.start, to: options.end, limit: '500' };
      if (cursor) query.cursor = cursor;
      if (!options.forceFull && state.last_successful_at) query.updated_since = String(state.last_successful_at);
      const page = await requestPage(settings, query);
      rawRecords.push(...page.records);
      cursor = page.nextCursor;
      pageCount += 1;
      if (pageCount >= MAX_PAGES && cursor) throw new Error('external-attendance-too-many-pages');
    } while (cursor);

    const normalized: NormalizedExternalAttendance[] = [];
    const errors: string[] = [];
    rawRecords.forEach(record => {
      const result = normalizeExternalAttendanceRecord(record, settings.fieldMap);
      if (result.data) normalized.push(result.data);
      else if (result.error) errors.push(result.error);
    });

    const upserts: Array<{ id: string; data: Record<string, unknown> }> = [];
    const deletes: string[] = [];
    normalized.forEach(item => {
      const id = hashId('external-attendance', settings.sourceName, item.external_record_id);
      if (item.deleted) {
        deletes.push(id);
        return;
      }
      if (item.date < options.start || item.date > options.end) return;
      upserts.push({
        id,
        data: {
          person_code: item.person_code,
          person_name: item.person_name,
          normalized_name: item.normalized_name,
          date: item.date,
          month: item.date.slice(0, 7),
          start_time: item.start_time,
          end_time: item.end_time,
          work_type: item.work_type || '',
          source_name: settings.sourceName,
          source_type: 'api_sync',
          external_record_id: item.external_record_id,
          external_status: item.status,
          external_updated_at: item.updated_at,
          source_payload_hash: hashId(JSON.stringify(item)),
          sync_run_id: runRef.id,
          synced_at: FieldValue.serverTimestamp(),
        },
      });
    });
    await commitChanges(upserts, deletes);

    const completedAt = new Date().toISOString();
    const result = {
      run_id: runRef.id,
      received_count: rawRecords.length,
      stored_count: upserts.length,
      deleted_count: deletes.length,
      invalid_count: errors.length,
      errors: errors.slice(0, 20),
      page_count: pageCount,
      started_at: startedAt,
      completed_at: completedAt,
    };
    await Promise.all([
      runRef.set({ ...result, status: errors.length ? 'completed_with_warnings' : 'completed', completed_at_server: FieldValue.serverTimestamp() }, { merge: true }),
      stateRef.set({ ...result, status: errors.length ? 'completed_with_warnings' : 'completed', last_successful_at: completedAt, updated_at: FieldValue.serverTimestamp() }, { merge: true }),
    ]);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await Promise.all([
      runRef.set({ status: 'failed', error: message, completed_at_server: FieldValue.serverTimestamp() }, { merge: true }),
      stateRef.set({ status: 'failed', last_error: message, updated_at: FieldValue.serverTimestamp() }, { merge: true }),
    ]);
    throw error;
  }
}

export async function getExternalAttendanceStatus(start: string, end: string) {
  const db = adminDb();
  const [stateSnap, countSnap] = await Promise.all([
    db.collection(STATE_COLLECTION).doc(STATE_ID).get(),
    db.collection(REGULAR_COLLECTION)
      .where('date', '>=', start)
      .where('date', '<=', end)
      .limit(5000)
      .get(),
  ]);
  const externalCount = countSnap.docs.filter(doc => doc.data().source_type === 'api_sync').length;
  return { config: externalAttendanceConfigStatus(), state: stateSnap.data() || null, selected_month_record_count: externalCount };
}
