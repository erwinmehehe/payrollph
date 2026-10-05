import {
  and,
  asc,
  eq,
  isNull,
  lte,
  sql,
} from "drizzle-orm";
import { db } from "@/db";
import {
  employeeLifecycleTransactions,
  employees,
  jobProfiles,
  positionAssignments,
  positions,
  schedulerState,
} from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";

export const EMPLOYEE_LIFECYCLE_CHANGE_TYPES = [
  "promotion",
  "transfer",
  "position_change",
  "manager_change",
  "employment_type_change",
] as const;

export type EmployeeLifecycleChangeType = (typeof EMPLOYEE_LIFECYCLE_CHANGE_TYPES)[number];

export type EmployeeLifecycleSnapshot = {
  employeeId: number;
  orgUnitId: number | null;
  title: string;
  employmentType: string;
  employeeStatus: string;
  positionAssignmentId: number | null;
  positionId: number | null;
  positionCode: string | null;
  jobProfileId: number | null;
  managerEmployeeId: number | null;
};

const SCHEDULER_JOB = "hcm-employee-lifecycle";
const SCHEDULER_INTERVAL_MS = 60 * 60 * 1000;
const LOCAL_CHECK_INTERVAL_MS = 60 * 1000;
let lastLocalCheck = 0;

export function manilaToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function previousIsoDate(dateText: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
    throw new Error("Date must use YYYY-MM-DD.");
  }
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function lifecycleChangeNeedsPosition(changeType: string) {
  return ["promotion", "transfer", "position_change"].includes(changeType);
}

export function lifecycleChangeNeedsManager(changeType: string) {
  return changeType === "manager_change";
}

export function lifecycleChangeNeedsEmploymentType(changeType: string) {
  return changeType === "employment_type_change";
}

export function lifecycleSnapshotMatches(
  expected: EmployeeLifecycleSnapshot,
  current: EmployeeLifecycleSnapshot,
) {
  return (
    expected.employeeId === current.employeeId
    && expected.orgUnitId === current.orgUnitId
    && expected.title === current.title
    && expected.employmentType === current.employmentType
    && expected.employeeStatus === current.employeeStatus
    && expected.positionAssignmentId === current.positionAssignmentId
    && expected.positionId === current.positionId
    && expected.positionCode === current.positionCode
    && expected.jobProfileId === current.jobProfileId
    && expected.managerEmployeeId === current.managerEmployeeId
  );
}

export async function loadEmployeeLifecycleSnapshot(
  organizationId: number,
  employeeId: number,
): Promise<EmployeeLifecycleSnapshot | null> {
  const [employee] = await db.select().from(employees).where(and(
    eq(employees.id, employeeId),
    eq(employees.organizationId, organizationId),
  )).limit(1);
  if (!employee) return null;

  const [assignment] = await db.select().from(positionAssignments).where(and(
    eq(positionAssignments.organizationId, organizationId),
    eq(positionAssignments.employeeId, employeeId),
    isNull(positionAssignments.effectiveUntil),
  )).orderBy(asc(positionAssignments.effectiveFrom), asc(positionAssignments.id)).limit(1);

  const [position] = assignment
    ? await db.select().from(positions).where(and(
        eq(positions.id, assignment.positionId),
        eq(positions.organizationId, organizationId),
      )).limit(1)
    : [];

  return {
    employeeId: employee.id,
    orgUnitId: employee.orgUnitId,
    title: employee.title,
    employmentType: employee.employmentType,
    employeeStatus: employee.status,
    positionAssignmentId: assignment?.id ?? null,
    positionId: position?.id ?? null,
    positionCode: position?.code ?? null,
    jobProfileId: position?.jobProfileId ?? null,
    managerEmployeeId: position?.managerEmployeeId ?? null,
  };
}

class LifecycleApplyConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LifecycleApplyConflict";
  }
}

async function applyLifecycleTransactionNow(transactionId: number, actor: string) {
  const [seed] = await db.select().from(employeeLifecycleTransactions)
    .where(eq(employeeLifecycleTransactions.id, transactionId))
    .limit(1);
  if (!seed) return { applied: false as const, skipped: true as const, reason: "missing" as const };

  const today = manilaToday();
  if (String(seed.effectiveDate) > today) {
    return { applied: false as const, skipped: true as const, reason: "not-due" as const };
  }

  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(4511, ${seed.employeeId})`);

      const [row] = await tx.select().from(employeeLifecycleTransactions).where(and(
        eq(employeeLifecycleTransactions.id, transactionId),
        eq(employeeLifecycleTransactions.organizationId, seed.organizationId),
      )).limit(1);
      if (!row) throw new LifecycleApplyConflict("Lifecycle transaction no longer exists.");
      if (row.status !== "scheduled") {
        return { applied: false as const, skipped: true as const, reason: "status" as const, status: row.status };
      }
      if (String(row.effectiveDate) > today) {
        return { applied: false as const, skipped: true as const, reason: "not-due" as const };
      }

      const [employee] = await tx.select().from(employees).where(and(
        eq(employees.id, row.employeeId),
        eq(employees.organizationId, row.organizationId),
      )).limit(1);
      if (!employee) throw new LifecycleApplyConflict("Employee no longer exists.");
      if (!["Active", "On leave"].includes(employee.status)) {
        throw new LifecycleApplyConflict(`Employee status ${employee.status} does not allow a lifecycle change.`);
      }

      const openAssignments = await tx.select().from(positionAssignments).where(and(
        eq(positionAssignments.organizationId, row.organizationId),
        eq(positionAssignments.employeeId, row.employeeId),
        isNull(positionAssignments.effectiveUntil),
      )).orderBy(asc(positionAssignments.effectiveFrom), asc(positionAssignments.id));
      if (openAssignments.length > 1) {
        throw new LifecycleApplyConflict("Employee has multiple active position assignments. Resolve the HCM data conflict first.");
      }

      const currentAssignment = openAssignments[0] ?? null;
      const [currentPosition] = currentAssignment
        ? await tx.select().from(positions).where(and(
            eq(positions.id, currentAssignment.positionId),
            eq(positions.organizationId, row.organizationId),
          )).limit(1)
        : [];

      const currentSnapshot: EmployeeLifecycleSnapshot = {
        employeeId: employee.id,
        orgUnitId: employee.orgUnitId,
        title: employee.title,
        employmentType: employee.employmentType,
        employeeStatus: employee.status,
        positionAssignmentId: currentAssignment?.id ?? null,
        positionId: currentPosition?.id ?? null,
        positionCode: currentPosition?.code ?? null,
        jobProfileId: currentPosition?.jobProfileId ?? null,
        managerEmployeeId: currentPosition?.managerEmployeeId ?? null,
      };

      const expectedSnapshot = row.beforeSnapshot as EmployeeLifecycleSnapshot;
      if (!lifecycleSnapshotMatches(expectedSnapshot, currentSnapshot)) {
        throw new LifecycleApplyConflict(
          "Employee org/position/manager state changed after this request was created. Recreate the lifecycle transaction from current data.",
        );
      }

      if (lifecycleChangeNeedsPosition(row.changeType)) {
        if (!row.targetPositionId) throw new LifecycleApplyConflict("Target position is required.");

        await tx.execute(sql`select pg_advisory_xact_lock(4512, ${row.targetPositionId})`);

        const [targetPosition] = await tx.select().from(positions).where(and(
          eq(positions.id, row.targetPositionId),
          eq(positions.organizationId, row.organizationId),
        )).limit(1);
        if (!targetPosition) throw new LifecycleApplyConflict("Target position no longer exists.");
        if (targetPosition.status !== "approved") {
          throw new LifecycleApplyConflict(
            `Target position must still be approved and vacant. Current status: ${targetPosition.status}.`,
          );
        }
        if (currentPosition?.id === targetPosition.id) {
          throw new LifecycleApplyConflict("Target position is already the employee's active position.");
        }

        const [occupied] = await tx.select({ id: positionAssignments.id }).from(positionAssignments).where(and(
          eq(positionAssignments.positionId, targetPosition.id),
          isNull(positionAssignments.effectiveUntil),
        )).limit(1);
        if (occupied) throw new LifecycleApplyConflict("Target position became occupied before this change took effect.");

        const [profile] = await tx.select().from(jobProfiles).where(and(
          eq(jobProfiles.id, targetPosition.jobProfileId),
          eq(jobProfiles.organizationId, row.organizationId),
        )).limit(1);
        if (!profile) throw new LifecycleApplyConflict("Target position's job profile no longer exists.");

        if (currentAssignment) {
          if (String(currentAssignment.effectiveFrom) >= String(row.effectiveDate)) {
            throw new LifecycleApplyConflict(
              "Current position assignment starts on or after the requested effective date. Resolve the assignment timeline first.",
            );
          }
          await tx.update(positionAssignments).set({
            effectiveUntil: previousIsoDate(String(row.effectiveDate)),
          }).where(eq(positionAssignments.id, currentAssignment.id));

          if (currentPosition) {
            await tx.update(positions).set({
              status: "approved",
              updatedAt: new Date(),
            }).where(eq(positions.id, currentPosition.id));
          }
        }

        await tx.insert(positionAssignments).values({
          organizationId: row.organizationId,
          positionId: targetPosition.id,
          employeeId: row.employeeId,
          effectiveFrom: String(row.effectiveDate),
          reason: row.reason,
          createdByUserId: row.decidedByUserId,
        });

        await tx.update(positions).set({
          status: "filled",
          updatedAt: new Date(),
        }).where(eq(positions.id, targetPosition.id));

        await tx.update(employees).set({
          orgUnitId: targetPosition.orgUnitId,
          title: profile.title,
          employmentType: targetPosition.employmentType,
        }).where(and(
          eq(employees.id, row.employeeId),
          eq(employees.organizationId, row.organizationId),
        ));
      } else if (lifecycleChangeNeedsManager(row.changeType)) {
        if (!currentPosition) {
          throw new LifecycleApplyConflict("Manager changes require an active position assignment.");
        }
        if (row.targetManagerEmployeeId === row.employeeId) {
          throw new LifecycleApplyConflict("An employee cannot be their own manager.");
        }
        if (row.targetManagerEmployeeId != null) {
          const [manager] = await tx.select().from(employees).where(and(
            eq(employees.id, row.targetManagerEmployeeId),
            eq(employees.organizationId, row.organizationId),
          )).limit(1);
          if (!manager || manager.status !== "Active") {
            throw new LifecycleApplyConflict("Target manager must still be an active employee in this organization.");
          }
        }
        await tx.update(positions).set({
          managerEmployeeId: row.targetManagerEmployeeId,
          updatedAt: new Date(),
        }).where(eq(positions.id, currentPosition.id));
      } else if (lifecycleChangeNeedsEmploymentType(row.changeType)) {
        const employmentType = String(row.targetEmploymentType ?? "").trim();
        if (!employmentType) throw new LifecycleApplyConflict("Target employment type is required.");

        await tx.update(employees).set({
          employmentType,
        }).where(and(
          eq(employees.id, row.employeeId),
          eq(employees.organizationId, row.organizationId),
        ));

        if (currentPosition) {
          await tx.update(positions).set({
            employmentType,
            updatedAt: new Date(),
          }).where(eq(positions.id, currentPosition.id));
        }
      } else {
        throw new LifecycleApplyConflict(`Unsupported lifecycle change type: ${row.changeType}.`);
      }

      const [updatedEmployee] = await tx.select().from(employees).where(and(
        eq(employees.id, row.employeeId),
        eq(employees.organizationId, row.organizationId),
      )).limit(1);
      const [updatedAssignment] = await tx.select().from(positionAssignments).where(and(
        eq(positionAssignments.organizationId, row.organizationId),
        eq(positionAssignments.employeeId, row.employeeId),
        isNull(positionAssignments.effectiveUntil),
      )).orderBy(asc(positionAssignments.effectiveFrom), asc(positionAssignments.id)).limit(1);
      const [updatedPosition] = updatedAssignment
        ? await tx.select().from(positions).where(and(
            eq(positions.id, updatedAssignment.positionId),
            eq(positions.organizationId, row.organizationId),
          )).limit(1)
        : [];

      const appliedSnapshot: EmployeeLifecycleSnapshot = {
        employeeId: updatedEmployee.id,
        orgUnitId: updatedEmployee.orgUnitId,
        title: updatedEmployee.title,
        employmentType: updatedEmployee.employmentType,
        employeeStatus: updatedEmployee.status,
        positionAssignmentId: updatedAssignment?.id ?? null,
        positionId: updatedPosition?.id ?? null,
        positionCode: updatedPosition?.code ?? null,
        jobProfileId: updatedPosition?.jobProfileId ?? null,
        managerEmployeeId: updatedPosition?.managerEmployeeId ?? null,
      };

      await tx.update(employeeLifecycleTransactions).set({
        status: "applied",
        appliedSnapshot,
        appliedAt: new Date(),
        appliedBy: actor,
        applyError: null,
        updatedAt: new Date(),
      }).where(eq(employeeLifecycleTransactions.id, row.id));

      return {
        applied: true as const,
        organizationId: row.organizationId,
        employeeId: row.employeeId,
        changeType: row.changeType,
        effectiveDate: String(row.effectiveDate),
        beforeSnapshot: currentSnapshot,
        appliedSnapshot,
      };
    });

    if (result.applied) {
      await recordAuditEvent({
        organizationId: result.organizationId,
        actor,
        action: "Employee lifecycle transaction applied",
        resource: `Employee #${result.employeeId} · ${result.changeType}`,
        metadata: {
          transactionId,
          employeeId: result.employeeId,
          changeType: result.changeType,
          effectiveDate: result.effectiveDate,
          beforeSnapshot: result.beforeSnapshot,
          appliedSnapshot: result.appliedSnapshot,
        },
      });
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Lifecycle transaction could not be applied.";
    await db.update(employeeLifecycleTransactions).set({
      status: "failed",
      applyError: message.slice(0, 4000),
      updatedAt: new Date(),
    }).where(and(
      eq(employeeLifecycleTransactions.id, transactionId),
      eq(employeeLifecycleTransactions.status, "scheduled"),
    ));

    await recordAuditEvent({
      organizationId: seed.organizationId,
      actor,
      action: "Employee lifecycle transaction failed",
      resource: `Employee #${seed.employeeId} · ${seed.changeType}`,
      metadata: {
        transactionId,
        employeeId: seed.employeeId,
        changeType: seed.changeType,
        effectiveDate: String(seed.effectiveDate),
        error: message,
      },
    });

    return { applied: false as const, skipped: false as const, error: message };
  }
}

export async function applyEmployeeLifecycleTransaction(transactionId: number, actor: string) {
  return applyLifecycleTransactionNow(transactionId, actor);
}

export async function runScheduledEmployeeLifecycleTransactions(options?: {
  force?: boolean;
  actor?: string;
}) {
  const force = options?.force === true;
  const now = new Date();

  if (!force && Date.now() - lastLocalCheck < LOCAL_CHECK_INTERVAL_MS) {
    return { skipped: true as const, reason: "local-interval" as const };
  }
  lastLocalCheck = Date.now();

  const [state] = await db.select().from(schedulerState)
    .where(eq(schedulerState.jobName, SCHEDULER_JOB))
    .limit(1);
  if (!force && state?.lastRunAt && now.getTime() - state.lastRunAt.getTime() < SCHEDULER_INTERVAL_MS) {
    return { skipped: true as const, reason: "scheduler-interval" as const, lastRunAt: state.lastRunAt };
  }

  const due = await db.select({ id: employeeLifecycleTransactions.id })
    .from(employeeLifecycleTransactions)
    .where(and(
      eq(employeeLifecycleTransactions.status, "scheduled"),
      lte(employeeLifecycleTransactions.effectiveDate, manilaToday()),
    ))
    .orderBy(asc(employeeLifecycleTransactions.effectiveDate), asc(employeeLifecycleTransactions.id))
    .limit(100);

  const results = [];
  for (const row of due) {
    results.push(await applyLifecycleTransactionNow(row.id, options?.actor ?? "System HCM scheduler"));
  }

  const payload = {
    at: now.toISOString(),
    due: due.length,
    applied: results.filter((result) => result.applied).length,
    failed: results.filter((result) => !result.applied && !result.skipped).length,
  };

  if (state) {
    await db.update(schedulerState).set({
      lastRunAt: now,
      lastResult: payload,
    }).where(eq(schedulerState.id, state.id));
  } else {
    await db.insert(schedulerState).values({
      jobName: SCHEDULER_JOB,
      lastRunAt: now,
      lastResult: payload,
    });
  }

  return { skipped: false as const, ...payload };
}
