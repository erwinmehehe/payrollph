import { and, desc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  attendanceCorrectionRequests,
  attendanceExceptionEvents,
  workforceAttendanceLockPolicies,
  workforceAttendancePeriodLocks,
} from "@/db/schema";
import { assertOrganizationRole, getAccess, PEOPLE_PAYROLL_ROLES } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { ensureWorkforceAttendanceControlSchema } from "@/lib/workforce-attendance-control-schema";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
const MAX_LOCK_DAYS = 62;

function validDate(value: string) {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function periodDays(start: string, end: string) {
  return Math.floor(
    (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS,
  ) + 1;
}

async function authorizeCompanyWide(userId: number, organizationId: number) {
  const denied = await assertOrganizationRole(
    userId,
    organizationId,
    PEOPLE_PAYROLL_ROLES,
    "Only People or Payroll administrators can manage attendance locks.",
  );
  if (denied) return denied;
  const access = await getAccess(userId, organizationId);
  if (!access?.companyWide) {
    return Response.json({
      error: "Attendance and payroll-cutoff locks apply company-wide and require company-wide access.",
    }, { status: 403 });
  }
  return null;
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const denied = await authorizeCompanyWide(user.id, organizationId);
  if (denied) return denied;
  await ensureWorkforceAttendanceControlSchema();

  const [policyRows, locks] = await Promise.all([
    db.select().from(workforceAttendanceLockPolicies)
      .where(eq(workforceAttendanceLockPolicies.organizationId, organizationId))
      .limit(1),
    db.select().from(workforceAttendancePeriodLocks)
      .where(eq(workforceAttendancePeriodLocks.organizationId, organizationId))
      .orderBy(desc(workforceAttendancePeriodLocks.periodStart), desc(workforceAttendancePeriodLocks.id)),
  ]);

  return Response.json({
    policy: {
      requirePayrollCutoffLock: Boolean(policyRows[0]?.requirePayrollCutoffLock),
    },
    locks,
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const action = String(body.action ?? "").trim();
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const denied = await authorizeCompanyWide(user.id, organizationId);
  if (denied) return denied;
  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: `workforce-attendance-lock-${action || "mutation"}`,
    resourceId: organizationId,
    limit: 20,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  await ensureWorkforceAttendanceControlSchema();

  if (action === "set_policy") {
    const requirePayrollCutoffLock = body.requirePayrollCutoffLock === true;
    const now = new Date();
    const [policy] = await db.insert(workforceAttendanceLockPolicies).values({
      organizationId,
      requirePayrollCutoffLock,
      updatedBy: user.name,
      updatedByUserId: user.id,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: workforceAttendanceLockPolicies.organizationId,
      set: {
        requirePayrollCutoffLock,
        updatedBy: user.name,
        updatedByUserId: user.id,
        updatedAt: now,
      },
    }).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Attendance cutoff policy updated",
      resource: "Workforce attendance controls",
      metadata: { requirePayrollCutoffLock },
    });
    return Response.json({ policy });
  }

  if (action === "lock_period") {
    const periodStart = String(body.periodStart ?? "").trim();
    const periodEnd = String(body.periodEnd ?? "").trim();
    const lockType = String(body.lockType ?? "").trim();
    const reason = String(body.reason ?? "").trim().slice(0, 240);
    if (
      !validDate(periodStart)
      || !validDate(periodEnd)
      || periodEnd < periodStart
      || periodDays(periodStart, periodEnd) > MAX_LOCK_DAYS
      || !["attendance", "payroll_cutoff"].includes(lockType)
      || !reason
    ) {
      return Response.json({
        error: "Provide a valid period up to 62 days, lockType attendance/payroll_cutoff, and a reason.",
      }, { status: 400 });
    }

    if (lockType === "payroll_cutoff") {
      const [pending] = await db.select({ id: attendanceCorrectionRequests.id })
        .from(attendanceCorrectionRequests)
        .where(and(
          eq(attendanceCorrectionRequests.organizationId, organizationId),
          eq(attendanceCorrectionRequests.status, "pending"),
          gte(attendanceCorrectionRequests.workDate, periodStart),
          lte(attendanceCorrectionRequests.workDate, periodEnd),
        ))
        .limit(1);
      if (pending) {
        return Response.json({
          error: "Resolve pending attendance corrections before locking the payroll cutoff.",
          code: "ATTENDANCE_CORRECTIONS_PENDING",
        }, { status: 409 });
      }

      const [blocker] = await db.select({ id: attendanceExceptionEvents.id })
        .from(attendanceExceptionEvents)
        .where(and(
          eq(attendanceExceptionEvents.organizationId, organizationId),
          eq(attendanceExceptionEvents.status, "open"),
          eq(attendanceExceptionEvents.severity, "blocker"),
          gte(attendanceExceptionEvents.workDate, periodStart),
          lte(attendanceExceptionEvents.workDate, periodEnd),
        ))
        .limit(1);
      if (blocker) {
        return Response.json({
          error: "Resolve blocking attendance exceptions before locking the payroll cutoff.",
          code: "ATTENDANCE_BLOCKERS_OPEN",
        }, { status: 409 });
      }
    }

    const now = new Date();
    const [lock] = await db.insert(workforceAttendancePeriodLocks).values({
      organizationId,
      periodStart,
      periodEnd,
      lockType,
      status: "locked",
      reason,
      lockedBy: user.name,
      lockedByUserId: user.id,
      lockedAt: now,
      unlockedBy: null,
      unlockedByUserId: null,
      unlockReason: null,
      unlockedAt: null,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [
        workforceAttendancePeriodLocks.organizationId,
        workforceAttendancePeriodLocks.periodStart,
        workforceAttendancePeriodLocks.periodEnd,
        workforceAttendancePeriodLocks.lockType,
      ],
      set: {
        status: "locked",
        reason,
        lockedBy: user.name,
        lockedByUserId: user.id,
        lockedAt: now,
        unlockedBy: null,
        unlockedByUserId: null,
        unlockReason: null,
        unlockedAt: null,
        updatedAt: now,
      },
    }).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: lockType === "payroll_cutoff"
        ? "Payroll attendance cutoff locked"
        : "Attendance capture locked",
      resource: `${periodStart} → ${periodEnd}`,
      metadata: { attendanceLockId: lock.id, lockType, reason },
    });
    return Response.json({ lock }, { status: 201 });
  }

  if (action === "unlock_period") {
    const lockId = Number(body.lockId);
    const unlockReason = String(body.unlockReason ?? "").trim().slice(0, 240);
    if (!Number.isInteger(lockId) || !unlockReason) {
      return Response.json({ error: "lockId and unlockReason are required." }, { status: 400 });
    }

    const [existing] = await db.select().from(workforceAttendancePeriodLocks).where(and(
      eq(workforceAttendancePeriodLocks.id, lockId),
      eq(workforceAttendancePeriodLocks.organizationId, organizationId),
    )).limit(1);
    if (!existing) return Response.json({ error: "Attendance lock not found." }, { status: 404 });
    if (existing.status !== "locked") {
      return Response.json({ error: "Only an active attendance lock can be unlocked." }, { status: 409 });
    }

    const now = new Date();
    const [lock] = await db.update(workforceAttendancePeriodLocks).set({
      status: "unlocked",
      unlockedBy: user.name,
      unlockedByUserId: user.id,
      unlockReason,
      unlockedAt: now,
      updatedAt: now,
    }).where(and(
      eq(workforceAttendancePeriodLocks.id, lockId),
      eq(workforceAttendancePeriodLocks.status, "locked"),
    )).returning();

    if (!lock) {
      return Response.json({ error: "Attendance lock changed while it was being unlocked." }, { status: 409 });
    }

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: existing.lockType === "payroll_cutoff"
        ? "Payroll attendance cutoff unlocked"
        : "Attendance capture unlocked",
      resource: `${existing.periodStart} → ${existing.periodEnd}`,
      metadata: { attendanceLockId: lock.id, lockType: existing.lockType, unlockReason },
    });
    return Response.json({ lock });
  }

  return Response.json({ error: "Unsupported attendance-lock action." }, { status: 400 });
}
