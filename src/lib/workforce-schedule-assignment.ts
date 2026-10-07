import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  employeeScheduleAssignments,
  employees,
  schedulePatterns,
  workforceScheduleGuardrailPolicies,
} from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import {
  DEFAULT_SCHEDULE_GUARDRAIL_POLICY,
  evaluateScheduleGuardrails,
  scheduleGuardrailBlocksMutation,
  type ScheduleGuardrailPolicy,
} from "@/lib/workforce-schedule-guardrails";
import { selectEffectiveScheduleAssignment } from "@/lib/workforce-scheduling";
import { resolveEmployeeScheduleWindow } from "@/lib/workforce-schedule-window";
import { markTimesheetsStaleForEmployeeRange } from "@/lib/workforce-timesheet-server";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class GovernedScheduleAssignmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GovernedScheduleAssignmentError";
  }
}

function phBusinessDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function addDays(dateText: string, days: number) {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function schedulePolicy(row: typeof workforceScheduleGuardrailPolicies.$inferSelect | undefined): ScheduleGuardrailPolicy {
  if (!row) return DEFAULT_SCHEDULE_GUARDRAIL_POLICY;
  return {
    minimumRestMinutes: row.minimumRestMinutes,
    maxConsecutiveWorkingDays: row.maxConsecutiveWorkingDays,
    rollingSevenDayMinutes: row.rollingSevenDayMinutes,
    enforcementMode: row.enforcementMode === "block" ? "block" : "advisory",
    active: row.active,
  };
}

function effectiveAssignment(
  rows: Array<typeof employeeScheduleAssignments.$inferSelect>,
  effectiveFrom: string,
) {
  return selectEffectiveScheduleAssignment(
    rows.map((row) => ({
      id: row.id,
      patternId: row.patternId,
      effectiveFrom: String(row.effectiveFrom),
      effectiveUntil: row.effectiveUntil ? String(row.effectiveUntil) : null,
      anchorDate: String(row.anchorDate),
      workLocationOrgUnitId: row.workLocationOrgUnitId,
      worksiteId: row.worksiteId,
    })),
    effectiveFrom,
  );
}

export async function assignEmployeeScheduleGoverned(input: {
  organizationId: number;
  employeeId: number;
  patternId: number;
  effectiveFrom: string;
  reason: string;
  sourceKey: string;
  actor?: string;
}) {
  if (
    !Number.isInteger(input.organizationId)
    || !Number.isInteger(input.employeeId)
    || !Number.isInteger(input.patternId)
    || !ISO_DATE.test(input.effectiveFrom)
  ) {
    throw new GovernedScheduleAssignmentError("A valid organization, employee, schedule pattern and YYYY-MM-DD effective date are required.");
  }

  const today = phBusinessDate();
  if (input.effectiveFrom < today) {
    throw new GovernedScheduleAssignmentError(
      "Automation cannot create a retroactive schedule assignment. Use today or a future effective date.",
    );
  }

  const sourceKey = input.sourceKey.trim().slice(0, 120);
  if (!sourceKey) {
    throw new GovernedScheduleAssignmentError("A stable automation source key is required.");
  }
  const reason = input.reason.trim().slice(0, 240);
  if (!reason) throw new GovernedScheduleAssignmentError("Schedule assignment reason is required.");

  const [employee, pattern, policyRow, assignments] = await Promise.all([
    db.select().from(employees).where(and(
      eq(employees.id, input.employeeId),
      eq(employees.organizationId, input.organizationId),
    )).limit(1).then((rows) => rows[0] ?? null),
    db.select().from(schedulePatterns).where(and(
      eq(schedulePatterns.id, input.patternId),
      eq(schedulePatterns.organizationId, input.organizationId),
      eq(schedulePatterns.active, true),
    )).limit(1).then((rows) => rows[0] ?? null),
    db.select().from(workforceScheduleGuardrailPolicies)
      .where(eq(workforceScheduleGuardrailPolicies.organizationId, input.organizationId))
      .limit(1)
      .then((rows) => rows[0]),
    db.select().from(employeeScheduleAssignments).where(and(
      eq(employeeScheduleAssignments.organizationId, input.organizationId),
      eq(employeeScheduleAssignments.employeeId, input.employeeId),
    )).orderBy(asc(employeeScheduleAssignments.effectiveFrom), asc(employeeScheduleAssignments.id)),
  ]);

  if (!employee) throw new GovernedScheduleAssignmentError("Employee not found in this organization.");
  if (!pattern) throw new GovernedScheduleAssignmentError("Active schedule pattern not found in this organization.");

  const exactExisting = assignments.find((row) =>
    row.patternId === input.patternId
    && String(row.effectiveFrom) === input.effectiveFrom
    && row.createdBy === sourceKey
  );
  if (exactExisting) {
    return {
      assignment: exactExisting,
      idempotent: true,
      guardrailIssues: [],
      staleTimesheetIds: [] as number[],
      auditWarning: null as string | null,
    };
  }

  const current = effectiveAssignment(assignments, input.effectiveFrom);
  if (current) {
    throw new GovernedScheduleAssignmentError(
      `Schedule assignment #${current.id} already applies on ${input.effectiveFrom}. Automation will not silently replace an existing schedule.`,
    );
  }

  const guardrailPolicy = schedulePolicy(policyRow);
  const prospectiveDays = await resolveEmployeeScheduleWindow({
    organizationId: input.organizationId,
    employeeId: input.employeeId,
    startDate: addDays(input.effectiveFrom, -7),
    endDate: addDays(input.effectiveFrom, 13),
    prospectiveAssignment: {
      id: Number.MAX_SAFE_INTEGER,
      patternId: input.patternId,
      effectiveFrom: input.effectiveFrom,
      effectiveUntil: null,
      anchorDate: input.effectiveFrom,
      workLocationOrgUnitId: employee.orgUnitId,
      worksiteId: null,
    },
  });
  const guardrailIssues = evaluateScheduleGuardrails({
    days: prospectiveDays,
    policy: guardrailPolicy,
  });
  if (scheduleGuardrailBlocksMutation(guardrailIssues)) {
    throw new GovernedScheduleAssignmentError(
      "WFM schedule guardrails blocked this automated schedule assignment.",
    );
  }

  const mutation = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(4311, ${input.employeeId})`);

    const latest = await tx.select().from(employeeScheduleAssignments).where(and(
      eq(employeeScheduleAssignments.organizationId, input.organizationId),
      eq(employeeScheduleAssignments.employeeId, input.employeeId),
    )).orderBy(asc(employeeScheduleAssignments.effectiveFrom), asc(employeeScheduleAssignments.id));

    const retryExisting = latest.find((row) =>
      row.patternId === input.patternId
      && String(row.effectiveFrom) === input.effectiveFrom
      && row.createdBy === sourceKey
    );
    if (retryExisting) return { assignment: retryExisting, idempotent: true };

    const competing = effectiveAssignment(latest, input.effectiveFrom);
    if (competing) {
      throw new GovernedScheduleAssignmentError(
        `Schedule assignment #${competing.id} began applying before the automated assignment could commit.`,
      );
    }

    const [created] = await tx.insert(employeeScheduleAssignments).values({
      organizationId: input.organizationId,
      employeeId: input.employeeId,
      patternId: input.patternId,
      effectiveFrom: input.effectiveFrom,
      effectiveUntil: null,
      anchorDate: input.effectiveFrom,
      workLocationOrgUnitId: employee.orgUnitId,
      worksiteId: null,
      reason,
      createdBy: sourceKey,
    }).returning();
    return { assignment: created, idempotent: false };
  });

  if (mutation.idempotent) {
    return {
      assignment: mutation.assignment,
      idempotent: true,
      guardrailIssues,
      staleTimesheetIds: [] as number[],
      auditWarning: null as string | null,
    };
  }

  const staleTimesheets = await markTimesheetsStaleForEmployeeRange({
    organizationId: input.organizationId,
    employeeId: input.employeeId,
    startDate: input.effectiveFrom,
    endDate: null,
  });

  let auditWarning: string | null = null;
  try {
    await recordAuditEvent({
      organizationId: input.organizationId,
      actor: input.actor ?? "Automation Studio",
      action: "Employee workforce schedule assigned by governed automation",
      resource: `${employee.employeeNo} · ${pattern.code}`,
      metadata: {
        assignmentId: mutation.assignment.id,
        employeeId: input.employeeId,
        patternId: input.patternId,
        patternCode: pattern.code,
        effectiveFrom: input.effectiveFrom,
        sourceKey,
        staleTimesheetIds: staleTimesheets.map((row) => row.id),
        guardrailIssues,
      },
    });
  } catch (error) {
    auditWarning = error instanceof Error ? error.message.slice(0, 1000) : "Audit recording failed.";
  }

  return {
    assignment: mutation.assignment,
    idempotent: false,
    guardrailIssues,
    staleTimesheetIds: staleTimesheets.map((row) => row.id),
    auditWarning,
  };
}
