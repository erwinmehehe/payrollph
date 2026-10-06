import { createHmac, timingSafeEqual } from "node:crypto";

export const WEBHOOK_EVENTS = [
  "payroll.released",
  "payroll.processed",
  "employee.onboarded",
  "employee.moved",
  "employee.offboarded",
  "leave.approved",
  "approval.decided",
  "automation.triggered",
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export function signWebhookPayload(secret: string, payload: string, timestamp: number) {
  const base = `${timestamp}.${payload}`;
  return `t=${timestamp},v1=${createHmac("sha256", secret).update(base).digest("hex")}`;
}

export function verifyWebhookSignature(secret: string, payload: string, header: string, toleranceSeconds = 300) {
  const parts = Object.fromEntries(
    header.split(",").map((piece) => piece.split("=") as [string, string]),
  );
  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp)) return false;
  if (Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(parts.v1 ?? "");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
