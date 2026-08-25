import type { AttendanceRecord, ImportResult } from "./types";

export type BatchStart = { state: "new" } | { state: "completed"; result: ImportResult } | { state: "conflict" | "processing" };
export type ApplyResult = { stored: boolean; deleted: boolean; alerts: string[] };

export interface AttendanceImportRepository {
  startBatch(batchId: string, source: string, bodyHash: string): Promise<BatchStart>;
  applyRecord(source: string, record: AttendanceRecord): Promise<ApplyResult>;
  completeBatch(batchId: string, source: string, bodyHash: string, result: ImportResult): Promise<void>;
  failBatch(batchId: string, source: string, bodyHash: string): Promise<void>;
}
