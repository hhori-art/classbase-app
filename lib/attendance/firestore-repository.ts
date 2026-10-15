import { createHash } from "node:crypto";
import type { DocumentSnapshot, Firestore, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { attendanceConfig as config } from "./config";
import { timesOverlap } from "./overlap";
import type { ApplyResult, AttendanceImportRepository, BatchStart } from "./repository";
import type { ActiveAttendanceRecord, AttendanceRecord, ImportResult } from "./types";

type EmployeeMatch = { id: string; method: "code" | "name" };

function stableId(source: string, id: string): string {
  return createHash("sha256").update(`${source}\0${id}`, "utf8").digest("hex");
}

function normalizedName(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
}

function batchDocId(source: string, batchId: string): string {
  return stableId(source, batchId);
}

function contentHash(record: AttendanceRecord): string {
  return createHash("sha256").update(JSON.stringify(record), "utf8").digest("hex");
}

function alreadyApplied(snapshot: DocumentSnapshot, record: AttendanceRecord): boolean {
  if (!snapshot.exists) return false;
  const existing = Date.parse(String(snapshot.get("sourceUpdatedAt") ?? ""));
  const incoming = Date.parse(record.updated_at);
  if (!Number.isFinite(existing)) return false;
  if (existing > incoming) return true;
  return existing === incoming && snapshot.get("contentHash") === contentHash(record);
}

function timeValue(value: unknown): string | null {
  if (typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return value;
  let date: Date | null = null;
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) date = new Date(value);
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") date = value.toDate();
  if (!date || !Number.isFinite(date.getTime())) return null;
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return `${String(jst.getUTCHours()).padStart(2, "0")}:${String(jst.getUTCMinutes()).padStart(2, "0")}`;
}

export class FirestoreAttendanceImportRepository implements AttendanceImportRepository {
  private readonly employeeCache = new Map<string, Promise<EmployeeMatch | null>>();

  constructor(private readonly db: Firestore) {}

  async startBatch(batchId: string, source: string, bodyHash: string): Promise<BatchStart> {
    const ref = this.db.collection(config.batchCollection).doc(batchDocId(source, batchId));
    return this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (snapshot.exists) {
        const data = snapshot.data()!;
        if (data.bodyHash !== bodyHash) return { state: "conflict" } as const;
        if (data.status === "completed") return { state: "completed", result: data.result as ImportResult } as const;
        if (data.status === "processing") return { state: "processing" } as const;
      }
      transaction.set(ref, {
        batchId,
        source,
        bodyHash,
        status: "processing",
        startedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return { state: "new" } as const;
    });
  }

  private findEmployee(record: ActiveAttendanceRecord): Promise<EmployeeMatch | null> {
    const key = `${record.person_code}\0${normalizedName(record.person_name)}`;
    const cached = this.employeeCache.get(key);
    if (cached) return cached;
    const result = this.findEmployeeUncached(record);
    this.employeeCache.set(key, result);
    return result;
  }

  private async findEmployeeUncached(record: ActiveAttendanceRecord): Promise<EmployeeMatch | null> {
    const numericCode = /^\d+$/.test(record.person_code) ? Number(record.person_code) : null;
    const codeValues: Array<string | number> = numericCode === null ? [record.person_code] : [record.person_code, numericCode];
    for (const field of config.employeeCodeFields) {
      const matches = new Map<string, QueryDocumentSnapshot>();
      for (const value of codeValues) {
        const snapshot = await this.db.collection(config.employeeCollection).where(field, "==", value).limit(5).get();
        snapshot.docs.forEach((document) => matches.set(document.id, document));
      }
      if (matches.size === 1) return { id: [...matches.keys()][0], method: "code" };
      if (matches.size > 1) {
        const wanted = normalizedName(record.person_name);
        const named = [...matches.values()].filter((document) => config.employeeNameFields.some((nameField) =>
          normalizedName(String(document.get(nameField) ?? "")) === wanted
        ));
        return named.length === 1 ? { id: named[0].id, method: "code" } : null;
      }
    }

    const wanted = normalizedName(record.person_name);
    const matches = new Map<string, QueryDocumentSnapshot>();
    for (const field of config.employeeNameFields) {
      const snapshot = await this.db.collection(config.employeeCollection).where(field, "==", record.person_name).limit(5).get();
      snapshot.docs.forEach((document) => {
        if (normalizedName(String(document.get(field) ?? "")) === wanted) matches.set(document.id, document);
      });
    }
    return matches.size === 1 ? { id: [...matches.keys()][0], method: "name" } : null;
  }

  private async findOverlaps(record: ActiveAttendanceRecord, employeeId: string | null): Promise<QueryDocumentSnapshot[]> {
    if (!employeeId || !record.start_time || !record.end_time) return [];
    const existing = await this.db.collection(config.systemCollection)
      .where("teacher_id", "==", employeeId)
      .where("date", "==", record.date)
      .get();
    return existing.docs.filter((document) => {
      const start = timeValue(document.get("start_time"));
      const end = timeValue(document.get("end_time"));
      return start !== null && end !== null && timesOverlap(record.start_time!, record.end_time!, start, end);
    });
  }

  async applyRecord(source: string, record: AttendanceRecord): Promise<ApplyResult> {
    const id = stableId(source, record.source_record_id);
    const ref = this.db.collection(config.importCollection).doc(id);
    if (record.status === "deleted") {
      const applied = await this.db.runTransaction(async (transaction) => {
        const existing = await transaction.get(ref);
        if (alreadyApplied(existing, record)) return false;
        transaction.set(ref, {
          source,
          sourceRecordId: record.source_record_id,
          status: "deleted",
          sourceUpdatedAt: record.updated_at,
          contentHash: contentHash(record),
          updatedAt: FieldValue.serverTimestamp(),
          createdAt: existing.exists ? existing.get("createdAt") : FieldValue.serverTimestamp(),
        }, { merge: true });
        return true;
      });
      if (!applied) return { stored: false, deleted: false, alerts: [] };
      await Promise.all(["employee_unmatched", "time_overlap"].map((code) =>
        this.db.collection(config.alertCollection).doc(`${id}_${code}`).set({ active: false, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
      ));
      return { stored: true, deleted: true, alerts: [] };
    }

    // Most manual full-month runs are idempotent replays. Avoid employee and
    // overlap queries when Firestore already has the same or newer source row;
    // the transaction below still rechecks to keep concurrent updates safe.
    const current = await ref.get();
    if (alreadyApplied(current, record)) return { stored: false, deleted: false, alerts: [] };

    const employee = await this.findEmployee(record);
    const overlaps = await this.findOverlaps(record, employee?.id ?? null);
    const alertCodes: string[] = [];
    if (!employee) alertCodes.push("employee_unmatched");
    if (overlaps.length > 0) alertCodes.push("time_overlap");
    const applied = await this.db.runTransaction(async (transaction) => {
      const existing = await transaction.get(ref);
      if (alreadyApplied(existing, record)) return false;
      transaction.set(ref, {
        source,
        sourceRecordId: record.source_record_id,
        personCode: record.person_code,
        personName: record.person_name,
        employeeId: employee?.id ?? null,
        employeeMatchMethod: employee?.method ?? null,
        date: record.date,
        startTime: record.start_time,
        endTime: record.end_time,
        workType: record.work_type,
        workSegments: record.work_segments,
        status: "active",
        sourceUpdatedAt: record.updated_at,
        contentHash: contentHash(record),
        alertCodes,
        updatedAt: FieldValue.serverTimestamp(),
        createdAt: existing.exists ? existing.get("createdAt") : FieldValue.serverTimestamp(),
      }, { merge: true });
      return true;
    });
    if (!applied) return { stored: false, deleted: false, alerts: [] };

    for (const code of ["employee_unmatched", "time_overlap"]) {
      await this.db.collection(config.alertCollection).doc(`${id}_${code}`).set({
        importRecordId: id,
        source,
        sourceRecordId: record.source_record_id,
        personCode: record.person_code,
        personName: record.person_name,
        employeeId: employee?.id ?? null,
        date: record.date,
        startTime: record.start_time,
        endTime: record.end_time,
        code,
        active: alertCodes.includes(code),
        contexts: code === "time_overlap" ? ["attendance_mistakes", "payroll"] : ["attendance_mistakes"],
        relatedRecordIds: code === "time_overlap" ? overlaps.map((item) => item.id) : [],
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    return { stored: true, deleted: false, alerts: alertCodes };
  }

  async completeBatch(batchId: string, source: string, bodyHash: string, result: ImportResult): Promise<void> {
    const id = batchDocId(source, batchId);
    const data = {
      batchId,
      source,
      bodyHash,
      status: "completed",
      result,
      completedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    await Promise.all([
      this.db.collection(config.batchCollection).doc(id).set(data, { merge: true }),
      this.db.collection(config.historyCollection).doc(id).set(data, { merge: true }),
    ]);
  }

  async failBatch(batchId: string, source: string, bodyHash: string): Promise<void> {
    await this.db.collection(config.batchCollection).doc(batchDocId(source, batchId)).set({
      batchId,
      source,
      bodyHash,
      status: "failed",
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }
}
