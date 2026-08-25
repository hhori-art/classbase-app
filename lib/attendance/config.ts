function integerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid ${name}`);
  return value;
}

function listEnv(name: string, fallback: string[]): string[] {
  const values = (process.env[name] ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  return values.length > 0 ? values : fallback;
}

export const attendanceConfig = {
  maxBodyBytes: integerEnv("ATTENDANCE_MAX_BODY_BYTES", 1_048_576),
  maxRecords: integerEnv("ATTENDANCE_MAX_RECORDS", 500),
  timestampToleranceSeconds: integerEnv("ATTENDANCE_TIMESTAMP_TOLERANCE_SECONDS", 300),
  importCollection: process.env.ATTENDANCE_IMPORT_COLLECTION ?? "attendance_regular_imports",
  batchCollection: process.env.ATTENDANCE_BATCH_COLLECTION ?? "attendance_integration_batches",
  historyCollection: process.env.ATTENDANCE_HISTORY_COLLECTION ?? "attendance_integration_history",
  alertCollection: process.env.ATTENDANCE_ALERT_COLLECTION ?? "attendance_integration_alerts",
  employeeCollection: process.env.ATTENDANCE_EMPLOYEE_COLLECTION ?? "users",
  systemCollection: process.env.ATTENDANCE_SYSTEM_COLLECTION ?? "work_records",
  employeeCodeFields: listEnv("ATTENDANCE_EMPLOYEE_CODE_FIELDS", ["lifetime_id", "staff_id", "staffId", "employee_id", "employeeId", "teacher_code"]),
  employeeNameFields: listEnv("ATTENDANCE_EMPLOYEE_NAME_FIELDS", ["name", "teacher_name", "displayName", "display_name", "student_name"]),
};
