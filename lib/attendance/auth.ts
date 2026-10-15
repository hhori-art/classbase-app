import { createHmac, timingSafeEqual } from "node:crypto";

export type AuthenticationFailure = "missing_headers" | "invalid_timestamp" | "expired_timestamp" | "invalid_source" | "invalid_signature";

export function signAttendanceBody(timestamp: string, body: string, secret: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex");
}

export function authenticateAttendanceRequest(input: {
  headers: Headers;
  body: string;
  secret: string;
  nowSeconds?: number;
  toleranceSeconds: number;
}): { ok: true } | { ok: false; reason: AuthenticationFailure } {
  const timestamp = input.headers.get("x-attendance-timestamp");
  const signature = input.headers.get("x-attendance-signature");
  const source = input.headers.get("x-attendance-source");
  if (!timestamp || !signature || !source) return { ok: false, reason: "missing_headers" };
  if (!/^\d{10}$/.test(timestamp)) return { ok: false, reason: "invalid_timestamp" };
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > input.toleranceSeconds) return { ok: false, reason: "expired_timestamp" };
  if (source !== "windows-sync") return { ok: false, reason: "invalid_source" };
  if (!/^[a-f0-9]{64}$/i.test(signature)) return { ok: false, reason: "invalid_signature" };
  const expected = Buffer.from(signAttendanceBody(timestamp, input.body, input.secret), "hex");
  const provided = Buffer.from(signature, "hex");
  return expected.length === provided.length && timingSafeEqual(expected, provided)
    ? { ok: true }
    : { ok: false, reason: "invalid_signature" };
}
