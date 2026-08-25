import type { AttendanceRecord, AttendanceWorkSegment, ImportEnvelope, ImportError } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export class EnvelopeValidationError extends Error {
  constructor(public readonly code: string) { super(code); }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validIso(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = DATE.exec(value);
  if (!match) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() + 1 === Number(match[2]) && date.getUTCDate() === Number(match[3]);
}

function text(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function nullableText(value: unknown, max: number): value is string | null {
  return value === null || (typeof value === "string" && value.length <= max);
}

function validateWorkSegments(value: unknown): AttendanceWorkSegment[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) return null;
  const segments: AttendanceWorkSegment[] = [];
  for (const item of value) {
    if (!isObject(item) || typeof item.start !== "string" || !TIME.test(item.start) || typeof item.end !== "string" || !TIME.test(item.end)) return null;
    if (!["lesson", "office", "support", "break"].includes(String(item.type))) return null;
    if (!text(item.note, 200)) return null;
    if (item.minutes !== null && (!Number.isInteger(item.minutes) || Number(item.minutes) < 0 || Number(item.minutes) > 1440)) return null;
    for (const field of ["course_code", "work_code", "school_code"] as const) if (!nullableText(item[field], 50)) return null;
    for (const field of ["course_name", "work_name", "school_name"] as const) if (!nullableText(item[field], 200)) return null;
    segments.push({
      start: item.start,
      end: item.end,
      type: item.type as AttendanceWorkSegment["type"],
      note: item.note,
      minutes: item.minutes === null ? null : Number(item.minutes),
      course_code: item.course_code as string | null,
      course_name: item.course_name as string | null,
      work_code: item.work_code as string | null,
      work_name: item.work_name as string | null,
      school_code: item.school_code as string | null,
      school_name: item.school_name as string | null,
    });
  }
  return segments;
}

export function parseEnvelope(value: unknown, maxRecords: number): ImportEnvelope {
  if (!isObject(value)) throw new EnvelopeValidationError("invalid_json_shape");
  if (!UUID.test(String(value.batch_id ?? ""))) throw new EnvelopeValidationError("invalid_batch_id");
  if (!text(value.source, 100)) throw new EnvelopeValidationError("invalid_source");
  if (!validIso(value.sent_at)) throw new EnvelopeValidationError("invalid_sent_at");
  if (!Array.isArray(value.records)) throw new EnvelopeValidationError("records_required");
  if (value.records.length > maxRecords) throw new EnvelopeValidationError("too_many_records");
  return { batch_id: value.batch_id as string, source: value.source, sent_at: value.sent_at, records: value.records };
}

export function validateRecord(value: unknown, index: number): { record?: AttendanceRecord; error?: ImportError } {
  if (!isObject(value)) return { error: { index, code: "invalid_record" } };
  if (!text(value.source_record_id, 200)) return { error: { index, code: "required", field: "source_record_id" } };
  if (!validIso(value.updated_at)) return { error: { index, code: "invalid_datetime", field: "updated_at" } };
  if (value.status === "deleted") {
    return { record: { source_record_id: value.source_record_id, status: "deleted", updated_at: value.updated_at } };
  }
  if (value.status !== "active") return { error: { index, code: "invalid_enum", field: "status" } };
  for (const field of ["person_code", "person_name", "work_type"] as const) {
    if (!text(value[field], 200)) return { error: { index, code: "required", field } };
  }
  if (!validDate(value.date)) return { error: { index, code: "invalid_date", field: "date" } };
  for (const field of ["start_time", "end_time"] as const) {
    if (value[field] !== null && (typeof value[field] !== "string" || !TIME.test(value[field] as string))) {
      return { error: { index, code: "invalid_time", field } };
    }
  }
  if ((value.start_time === null) !== (value.end_time === null)) return { error: { index, code: "incomplete_time_range" } };
  const workSegments = validateWorkSegments(value.work_segments);
  if (workSegments === null) return { error: { index, code: "invalid_work_segments", field: "work_segments" } };
  return { record: {
    source_record_id: value.source_record_id,
    person_code: value.person_code as string,
    person_name: value.person_name as string,
    date: value.date,
    start_time: value.start_time as string | null,
    end_time: value.end_time as string | null,
    work_type: value.work_type as string,
    work_segments: workSegments,
    status: "active",
    updated_at: value.updated_at,
  } };
}
