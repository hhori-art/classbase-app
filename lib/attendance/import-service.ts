import { createHash } from "node:crypto";
import type { AttendanceImportRepository } from "./repository";
import type { ImportEnvelope, ImportResult } from "./types";
import { validateRecord } from "./validation";

export class BatchConflictError extends Error {}
export class BatchProcessingError extends Error {}

// A Windows sync request contains at most 100 records. Process one request in
// a single bounded wave so a full-month replay completes before the function
// URL can be displaced by an unrelated production deployment.
const IMPORT_CONCURRENCY = 100;

export async function importAttendance(input: {
  envelope: ImportEnvelope;
  rawBody: string;
  repository: AttendanceImportRepository;
}): Promise<ImportResult> {
  const bodyHash = createHash("sha256").update(input.rawBody, "utf8").digest("hex");
  const start = await input.repository.startBatch(input.envelope.batch_id, input.envelope.source, bodyHash);
  if (start.state === "completed") return start.result;
  if (start.state === "conflict") throw new BatchConflictError("batch_id_reused");
  if (start.state === "processing") throw new BatchProcessingError("batch_processing");

  const errors: ImportResult["errors"] = [];
  let stored = 0;
  let deleted = 0;
  try {
    for (let offset = 0; offset < input.envelope.records.length; offset += IMPORT_CONCURRENCY) {
      const results = await Promise.all(input.envelope.records.slice(offset, offset + IMPORT_CONCURRENCY).map(async (rawRecord, chunkIndex) => {
        const index = offset + chunkIndex;
        const validated = validateRecord(rawRecord, index);
        if (!validated.record) return { stored: false, deleted: false, error: validated.error! };
        try {
          const applied = await input.repository.applyRecord(input.envelope.source, validated.record);
          return { ...applied, error: undefined };
        } catch {
          return { stored: false, deleted: false, error: { index, code: "storage_error" } as const };
        }
      }));
      for (const result of results) {
        if (result.stored) stored += 1;
        if (result.deleted) deleted += 1;
        if (result.error) errors.push(result.error);
      }
    }
    const result: ImportResult = {
      ok: true,
      received_count: input.envelope.records.length,
      stored_count: stored,
      deleted_count: deleted,
      invalid_count: errors.length,
      errors,
    };
    await input.repository.completeBatch(input.envelope.batch_id, input.envelope.source, bodyHash, result);
    return result;
  } catch (error) {
    await input.repository.failBatch(input.envelope.batch_id, input.envelope.source, bodyHash);
    throw error;
  }
}
