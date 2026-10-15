import assert from "node:assert/strict";
import test from "node:test";
import { BatchConflictError, importAttendance } from "../../lib/attendance/import-service";
import type { ApplyResult, AttendanceImportRepository, BatchStart } from "../../lib/attendance/repository";
import type { AttendanceRecord, ImportEnvelope, ImportResult } from "../../lib/attendance/types";

const active = {
  source_record_id: "A-1", person_code: "P-1", person_name: "Test User", date: "2026-08-01",
  start_time: "09:00", end_time: "18:00", work_type: "通常勤務", status: "active" as const, updated_at: "2026-08-01T12:00:00Z",
};

class MemoryRepository implements AttendanceImportRepository {
  batches = new Map<string, { hash: string; result?: ImportResult }>();
  records = new Map<string, AttendanceRecord>();
  failIds = new Set<string>();
  async startBatch(batchId: string, source: string, bodyHash: string): Promise<BatchStart> {
    const existing = this.batches.get(`${source}:${batchId}`);
    if (!existing) { this.batches.set(`${source}:${batchId}`, { hash: bodyHash }); return { state: "new" }; }
    if (existing.hash !== bodyHash) return { state: "conflict" };
    if (existing.result) return { state: "completed", result: existing.result };
    return { state: "processing" };
  }
  async applyRecord(source: string, record: AttendanceRecord): Promise<ApplyResult> {
    if (this.failIds.has(record.source_record_id)) throw new Error("simulated");
    const key = `${source}:${record.source_record_id}`;
    const previous = this.records.get(key);
    if (previous && Date.parse(previous.updated_at) >= Date.parse(record.updated_at)) return { stored: false, deleted: false, alerts: [] };
    this.records.set(key, record);
    return { stored: true, deleted: record.status === "deleted", alerts: [] };
  }
  async completeBatch(batchId: string, source: string, bodyHash: string, result: ImportResult): Promise<void> { this.batches.set(`${source}:${batchId}`, { hash: bodyHash, result }); }
  async failBatch(): Promise<void> {}
}

function envelope(batchId: string, records: unknown[]): ImportEnvelope {
  return { batch_id: batchId, source: "通常勤怠システム", sent_at: "2026-08-01T12:00:00Z", records };
}

test("stores valid rows while reporting invalid rows", async () => {
  const repository = new MemoryRepository();
  const input = envelope("08d562eb-20ce-4e64-a93a-3b86615674b3", [active, { ...active, source_record_id: "A-2", date: "bad" }]);
  const result = await importAttendance({ envelope: input, rawBody: JSON.stringify(input), repository });
  assert.deepEqual({ stored: result.stored_count, invalid: result.invalid_count }, { stored: 1, invalid: 1 });
});

test("returns the prior result for an identical completed batch and rejects batch id reuse", async () => {
  const repository = new MemoryRepository();
  const input = envelope("09fe7b25-2be9-4077-89ab-ddbe909fa42f", [active]);
  const rawBody = JSON.stringify(input);
  const first = await importAttendance({ envelope: input, rawBody, repository });
  const replay = await importAttendance({ envelope: input, rawBody, repository });
  assert.deepEqual(replay, first);
  const changed = envelope(input.batch_id, [{ ...active, person_name: "Changed" }]);
  await assert.rejects(() => importAttendance({ envelope: changed, rawBody: JSON.stringify(changed), repository }), BatchConflictError);
});

test("is idempotent by source and record id, then applies a newer update and deletion", async () => {
  const repository = new MemoryRepository();
  const first = envelope("f561254c-2538-456c-a49c-cbdb0840a039", [active]);
  assert.equal((await importAttendance({ envelope: first, rawBody: JSON.stringify(first), repository })).stored_count, 1);
  const duplicate = envelope("f561254c-2538-456c-a49c-cbdb0840a040", [active]);
  assert.equal((await importAttendance({ envelope: duplicate, rawBody: JSON.stringify(duplicate), repository })).stored_count, 0);
  const updated = envelope("f561254c-2538-456c-a49c-cbdb0840a041", [{ ...active, end_time: "19:00", updated_at: "2026-08-01T13:00:00Z" }]);
  assert.equal((await importAttendance({ envelope: updated, rawBody: JSON.stringify(updated), repository })).stored_count, 1);
  const deleted = envelope("f561254c-2538-456c-a49c-cbdb0840a042", [{ source_record_id: "A-1", status: "deleted", updated_at: "2026-08-01T14:00:00Z" }]);
  assert.equal((await importAttendance({ envelope: deleted, rawBody: JSON.stringify(deleted), repository })).deleted_count, 1);
});

test("continues after a per-record storage failure", async () => {
  const repository = new MemoryRepository();
  repository.failIds.add("A-bad");
  const input = envelope("64c1b1ea-e81e-4f5b-baa2-a1802c6a5b80", [{ ...active, source_record_id: "A-bad" }, { ...active, source_record_id: "A-good" }]);
  const result = await importAttendance({ envelope: input, rawBody: JSON.stringify(input), repository });
  assert.deepEqual({ stored: result.stored_count, invalid: result.invalid_count }, { stored: 1, invalid: 1 });
});
