import { createHash } from "node:crypto";
import { authenticateAttendanceRequest } from "@/lib/attendance/auth";
import { attendanceConfig as config } from "@/lib/attendance/config";
import { FirestoreAttendanceImportRepository } from "@/lib/attendance/firestore-repository";
import { BatchConflictError, BatchProcessingError, importAttendance } from "@/lib/attendance/import-service";
import { EnvelopeValidationError, parseEnvelope } from "@/lib/attendance/validation";
import { adminDb } from "@/lib/firebase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function jsonError(status: number, code: string): Response {
  return Response.json({ ok: false, error: code }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > config.maxBodyBytes) return jsonError(413, "body_too_large");
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > config.maxBodyBytes) return jsonError(413, "body_too_large");
  const secret = process.env.ATTENDANCE_HMAC_SECRET;
  if (!secret || secret.length < 32) return jsonError(503, "integration_not_configured");
  const authenticated = authenticateAttendanceRequest({ headers: request.headers, body: rawBody, secret, toleranceSeconds: config.timestampToleranceSeconds });
  if (!authenticated.ok) return jsonError(401, "authentication_failed");

  try {
    const parsed: unknown = JSON.parse(rawBody);
    const envelope = parseEnvelope(parsed, config.maxRecords);
    const result = await importAttendance({ envelope, rawBody, repository: new FirestoreAttendanceImportRepository(adminDb()) });
    return Response.json(result, { headers: { "Cache-Control": "no-store", "X-Content-Hash": createHash("sha256").update(rawBody).digest("hex").slice(0, 12) } });
  } catch (error) {
    if (error instanceof SyntaxError) return jsonError(400, "invalid_json");
    if (error instanceof EnvelopeValidationError) return jsonError(error.code === "too_many_records" ? 413 : 422, error.code);
    if (error instanceof BatchConflictError) return jsonError(409, "batch_id_reused");
    if (error instanceof BatchProcessingError) return jsonError(409, "batch_processing");
    return jsonError(500, "import_failed");
  }
}
