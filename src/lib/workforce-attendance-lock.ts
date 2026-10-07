import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  workforceAttendanceLockPolicies,
  workforceAttendancePeriodLocks,
} from "@/db/schema";
import { ensureWorkforceAttendanceControlSchema } from "@/lib/workforce-attendance-control-schema";

export type AttendanceLockType = "attendance" | "payroll_cutoff";
export type AttendanceMutationKind = "capture" | "correction";

export type AttendancePeriodLockLike = {
  id: number;
  periodStart: string | Date;
  periodEnd: string | Date;
  lockType: string;
  status: string;
};

function dateText(value: string | Date) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

export function attendanceMutationLock(
  locks: AttendancePeriodLockLike[],
  workDate: string,
  mutationKind: AttendanceMutationKind = "capture",
) {
  const candidates = locks.filter((lock) => {
    if (lock.status !== "locked") return false;
    if (dateText(lock.periodStart) > workDate || dateText(lock.periodEnd) < workDate) return false;
    if (mutationKind === "correction") return lock.lockType === "payroll_cutoff";
    return lock.lockType === "attendance" || lock.lockType === "payroll_cutoff";
  });

  return candidates.sort((a, b) => {
    const typePriority = (b.lockType === "payroll_cutoff" ? 1 : 0)
      - (a.lockType === "payroll_cutoff" ? 1 : 0);
    if (typePriority) return typePriority;
    return b.id - a.id;
  })[0] ?? null;
}

export function payrollCutoffLockForPeriod(
  locks: AttendancePeriodLockLike[],
  periodStart: string,
  periodEnd: string,
) {
  return locks
    .filter((lock) =>
      lock.status === "locked"
      && lock.lockType === "payroll_cutoff"
      && dateText(lock.periodStart) <= periodStart
      && dateText(lock.periodEnd) >= periodEnd
    )
    .sort((a, b) => b.id - a.id)[0] ?? null;
}

export async function loadActiveAttendanceLocks(organizationId: number) {
  await ensureWorkforceAttendanceControlSchema();
  return db.select().from(workforceAttendancePeriodLocks)
    .where(eq(workforceAttendancePeriodLocks.organizationId, organizationId))
    .orderBy(
      asc(workforceAttendancePeriodLocks.periodStart),
      asc(workforceAttendancePeriodLocks.periodEnd),
      asc(workforceAttendancePeriodLocks.id),
    )
    .then((rows) => rows.filter((row) => row.status === "locked"));
}

export async function loadAttendanceLockPolicy(organizationId: number) {
  await ensureWorkforceAttendanceControlSchema();
  const [row] = await db.select().from(workforceAttendanceLockPolicies)
    .where(eq(workforceAttendanceLockPolicies.organizationId, organizationId))
    .limit(1);
  return {
    requirePayrollCutoffLock: Boolean(row?.requirePayrollCutoffLock),
  };
}

export async function loadAttendanceCutoffGate(input: {
  organizationId: number;
  periodStart: string;
  periodEnd: string;
}) {
  const [policy, locks] = await Promise.all([
    loadAttendanceLockPolicy(input.organizationId),
    loadActiveAttendanceLocks(input.organizationId),
  ]);
  const lock = payrollCutoffLockForPeriod(locks, input.periodStart, input.periodEnd);
  const required = policy.requirePayrollCutoffLock;
  return {
    policy,
    gate: {
      required,
      allowed: !required || Boolean(lock),
      lockId: lock?.id ?? null,
      lockPeriodStart: lock ? dateText(lock.periodStart) : null,
      lockPeriodEnd: lock ? dateText(lock.periodEnd) : null,
    },
  };
}
