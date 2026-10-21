export type AttendanceLockRow = {
  id: number; periodStart: string; periodEnd: string;
  lockType: "attendance" | "payroll_cutoff"; status: "locked" | "unlocked";
  reason: string; lockedBy: string; lockedAt: string;
};
export type AttendanceLockRead = {
  organizationId: number; canManage: boolean;
  policy: { requirePayrollCutoffLock: boolean }; locks: AttendanceLockRow[];
};
const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const text = (v: unknown) => typeof v === "string" && v.trim().length > 0;
function isoDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const parsed = new Date(v + "T00:00:00Z");
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === v;
}
function lock(v: unknown): v is AttendanceLockRow {
  return record(v) && id(v.id) && isoDate(v.periodStart) && isoDate(v.periodEnd) &&
    v.periodEnd >= v.periodStart &&
    (v.lockType === "attendance" || v.lockType === "payroll_cutoff") &&
    (v.status === "locked" || v.status === "unlocked") &&
    text(v.reason) && text(v.lockedBy) && text(v.lockedAt);
}
export function parseVerifiedAttendanceLocks(value: unknown, organizationId: number): AttendanceLockRead | null {
  if (!id(organizationId) || !record(value) || value.organizationId !== organizationId ||
      typeof value.canManage !== "boolean" || !record(value.policy) ||
      typeof value.policy.requirePayrollCutoffLock !== "boolean" ||
      !Array.isArray(value.locks) || !value.locks.every(lock)) return null;
  const locks = value.locks as AttendanceLockRow[];
  if (new Set(locks.map(v => v.id)).size !== locks.length) return null;
  return value as AttendanceLockRead;
}
export async function readVerifiedAttendanceLocks(
  organizationId: number, fetcher: typeof fetch = fetch, signal?: AbortSignal,
): Promise<AttendanceLockRead> {
  if (!id(organizationId)) throw Error("Attendance lock status unavailable. Retry.");
  const response = await fetcher("/api/workforce/attendance-locks?organizationId=" + organizationId,
    { cache: "no-store", signal });
  if (!response.ok) throw Error("Attendance lock status unavailable. Retry.");
  let body: unknown;
  try { body = await response.json(); }
  catch { throw Error("Attendance lock response unreadable. Retry."); }
  const verified = parseVerifiedAttendanceLocks(body, organizationId);
  if (!verified) throw Error("Attendance locks incomplete or for a different employer. Retry.");
  return verified;
}
