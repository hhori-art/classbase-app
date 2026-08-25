import assert from "node:assert/strict";
import test from "node:test";
import { authenticateAttendanceRequest, signAttendanceBody } from "../../lib/attendance/auth";
import { timesOverlap } from "../../lib/attendance/overlap";
import { EnvelopeValidationError, parseEnvelope, validateRecord } from "../../lib/attendance/validation";

const now = 1_700_000_000;
const body = JSON.stringify({ ok: true });
const secret = "a-secret-that-is-long-enough-for-production";

function headers(timestamp = String(now), signature = signAttendanceBody(timestamp, body, secret)): Headers {
  return new Headers({
    "x-attendance-timestamp": timestamp,
    "x-attendance-signature": signature,
    "x-attendance-source": "windows-sync",
  });
}

test("accepts a valid HMAC and rejects a wrong signature", () => {
  assert.deepEqual(authenticateAttendanceRequest({ headers: headers(), body, secret, nowSeconds: now, toleranceSeconds: 300 }), { ok: true });
  assert.equal(authenticateAttendanceRequest({ headers: headers(String(now), "0".repeat(64)), body, secret, nowSeconds: now, toleranceSeconds: 300 }).ok, false);
});

test("rejects an expired timestamp", () => {
  assert.deepEqual(authenticateAttendanceRequest({ headers: headers(String(now - 301)), body, secret, nowSeconds: now, toleranceSeconds: 300 }), { ok: false, reason: "expired_timestamp" });
});

const active = {
  source_record_id: "A-1", person_code: "P-1", person_name: "Test User", date: "2026-08-01",
  start_time: "22:00", end_time: "06:00", work_type: "通常勤務", status: "active", updated_at: "2026-08-01T12:00:00Z",
};

test("validates normal and overnight records", () => {
  assert.equal(validateRecord(active, 0).record?.status, "active");
  assert.equal(timesOverlap("22:00", "06:00", "23:00", "23:30"), true);
  assert.equal(timesOverlap("22:00", "06:00", "08:00", "09:00"), false);
});

test("validates detailed lesson and break segments", () => {
  const detailed = {
    ...active,
    work_type: "授業・休憩",
    work_segments: [
      { start: "10:00", end: "11:20", type: "lesson", note: "夏期授業（80）", minutes: 80, course_code: "0360", course_name: "夏期授業（80）", work_code: null, work_name: null, school_code: "0321", school_name: "AC明石" },
      { start: "11:20", end: "11:30", type: "break", note: "休憩", minutes: 10, course_code: null, course_name: null, work_code: "016", work_name: "休憩", school_code: "0321", school_name: "AC明石" },
    ],
  };
  const result = validateRecord(detailed, 0);
  assert.equal(result.error, undefined);
  if (result.record?.status !== "active") assert.fail("active record expected");
  assert.equal(result.record.work_segments[0].type, "lesson");
  assert.equal(validateRecord({ ...detailed, work_segments: [{ ...detailed.work_segments[0], type: "unknown" }] }, 0).error?.code, "invalid_work_segments");
});

test("accepts deletion and rejects missing and invalid date/time fields", () => {
  assert.equal(validateRecord({ source_record_id: "A-1", status: "deleted", updated_at: "2026-08-01T12:00:00Z" }, 0).record?.status, "deleted");
  assert.equal(validateRecord({ ...active, person_code: "" }, 1).error?.code, "required");
  assert.equal(validateRecord({ ...active, date: "2026-02-30" }, 2).error?.code, "invalid_date");
  assert.equal(validateRecord({ ...active, start_time: "25:00" }, 3).error?.code, "invalid_time");
});

test("enforces the 500-record request limit", () => {
  assert.throws(() => parseEnvelope({ batch_id: "83c0cb40-f559-4c18-9f10-a5c554fcc897", source: "source", sent_at: "2026-08-01T12:00:00Z", records: Array(501).fill(active) }, 500), (error: unknown) => error instanceof EnvelopeValidationError && error.code === "too_many_records");
});
