import { and, asc, eq, gte, inArray, isNull, lt, lte, or } from "drizzle-orm";
import { db, pool } from "@/db";
import {
  calamityAdvisories,
  compensationComponents,
  deMinimisGrants,
  earnedWageRequests,
  employeeCompensationComponents,
  employeeLoans,
  employeeMweClassifications,
  employeePayProfiles,
  employeePayRevisions,
  employeeRestDayRevisions,
  employeePayRetroAdjustments,
  employeeScheduleAssignments,
  employeeWorksiteAssignments,
  employees,
  expenseClaims,
  leaveConversions,
  leavePolicies,
  leaveRequests,
  holidays,
  legalEntities,
  orgUnits,
  organizations,
  overtimeRequests,
  payPolicies,
  payPolicyRules,
  payrollEntries,
  historicalPayrollEntries,
  payrollJobs,
  payrollRuns,
  payslips,
  scheduleOverrides,
  schedulePatternDays,
  schedulePatternSegments,
  schedulePatterns,
  shiftDefinitions,
  supplementaryEarnings,
  timePunches,
  yearEndAdjustments,
} from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { encryptBankAccount } from "@/lib/bank-account-crypto";
import { validPayrollLoanSchedule } from "@/lib/payroll-loan-approval";
import {
  computeCutoffStatutoryDeduction,
  computePagIbig,
  computePhilHealth,
  computeSemiMonthlyWithholdingTax,
  computeSss,
  deriveClockHours,
  holidayMultiplier,
  isRestDayOfWeek,
  restDayForDate,
  type EffectiveRestDayRevisionInput,
} from "@/lib/payroll-rules";
import {
  holidayPayContextOn,
  isBelowMinimum,
  NATIONAL_HOLIDAYS_2026,
  nationalHolidayCalendarForDate,
  type HolidayCalendarEntry,
} from "@/lib/wage-orders";
import {
  aggregateDeMinimisForSemiMonthly,
  deMinimisStatutoryPeriodStart,
  DE_MINIMIS_2026,
  type DeMinimisType,
} from "@/lib/ph-compliance";
import { holidayCalendarFingerprint } from "@/lib/payroll-calendar";
import { statutoryRuleVersionsForDate } from "@/lib/ph-statutory-rule-packs";
import { resolveMweClassification, type MweClassificationRecord } from "@/lib/mwe-classification";
import { isSharedBenefitPoolEarningType, sharedBenefitPoolCutoffTreatment } from "@/lib/annualization";
import { calculateBenefits, type EnrollmentInput } from "@/lib/benefits";
import { benefitDependents, benefitEnrollments, benefitPlans } from "@/db/schema";
import { ensureLeavePayrollSchema } from "@/lib/leave-payroll-schema";
import {
  leaveRangeContainsDate,
  resolveApprovedLeaveForPayroll,
  type ResolvedPayrollLeave,
} from "@/lib/leave-payroll";
import { ensureEmployeePayProfiles } from "@/lib/pay-basis-schema";
import { recurringComponentAmountForCutoff } from "@/lib/compensation";
import {
  attendanceDeductionsForCutoff,
  fixedMonthlyBasicForTimeline,
  leaveAdjustmentForCutoff,
  payTimelineTrace,
  profileForDate,
  resolvePayProfile,
  resolvePayTimeline,
  type EffectivePayRevisionInput,
  type EmployeePayProfileInput,
} from "@/lib/pay-basis";
import {
  resolveDailySchedule,
  type ResolvedDailySchedule,
} from "@/lib/workforce-scheduling";
import {
  matchPunchesToWorkforceSegments,
  payableTimeEvidenceFlagsForPayroll,
  payrollRestDayFromSchedule,
  segmentPayableTime,
  workforceScheduleTrace,
} from "@/lib/workforce-payroll";
import { workforceHolidayApplies } from "@/lib/workforce-holiday";
import { selectEffectiveWorksiteAssignment } from "@/lib/workforce-worksite";
import {
  resolveOvertimeAuthorizationDay,
  type OvertimeRequestEvidence,
  type OvertimeRequestKind,
  type OvertimeRequestStatus,
} from "@/lib/workforce-overtime";
import {
  HOLIDAY_REST_DAY_PREMIUM_EVENT,
  NIGHT_DIFFERENTIAL_PREMIUM_EVENT,
  OVERTIME_PREMIUM_EVENT,
  WORKED_TIME_PREMIUM_EVENT,
  payPolicyTrace,
  resolveHolidayRestDayPremium,
  resolveNightDifferentialPremium,
  resolveOvertimePremium,
  resolveWorkedTimePremium,
  type AppliedHolidayRestDayPremiumRule,
  type AppliedNightDifferentialPremiumRule,
  type AppliedOvertimePremiumRule,
  type AppliedWorkedTimePremiumRule,
  type PayPolicyHolidayType,
  type PayPolicyRecord,
  type PayPolicyRuleRecord,
  type PayPolicyScope,
} from "@/lib/pay-policy-engine";

export const PAYROLL_RULE_VERSION = "PH-2026.09";
const DEFAULT_CHUNK = 25;

function money(value: number) {
  return (Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2);
}

function roundToCents(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function payPolicyScope(value: string): PayPolicyScope {
  if (value === "organization" || value === "org_unit" || value === "employee") {
    return value;
  }
  throw new Error(`Unsupported pay policy scope "${value}".`);
}

function traceInputNumber(trace: unknown, key: string) {
  if (!trace || typeof trace !== "object") return 0;
  const inputs = (trace as { inputs?: unknown }).inputs;
  if (!Array.isArray(inputs)) return 0;
  const prefix = `${key}=`;
  const raw = inputs.find((item) => typeof item === "string" && item.startsWith(prefix));
  if (typeof raw !== "string") return 0;
  const value = Number(raw.slice(prefix.length));
  return Number.isFinite(value) ? value : 0;
}

function addDays(dateText: string, days: number) {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function orgUnitAncestors(
  orgUnitId: number | null,
  unitMap: Map<number, typeof orgUnits.$inferSelect>,
) {
  const ids = new Set<number>();
  let cursor = orgUnitId;
  let guard = 0;
  while (cursor != null && guard < 50) {
    if (ids.has(cursor)) break;
    ids.add(cursor);
    cursor = unitMap.get(cursor)?.parentId ?? null;
    guard += 1;
  }
  return ids;
}

function precedingScheduledWorkDate(input: {
  holidayDate: string;
  currentRestDay: string | null | undefined;
  restDayRevisions: EffectiveRestDayRevisionInput[];
  holidayCalendar: HolidayCalendarEntry[];
  employeeStartDate: string;
  scheduleForDate?: (date: string) => ResolvedDailySchedule | undefined;
}) {
  for (let offset = 1; offset <= 14; offset += 1) {
    const date = addDays(input.holidayDate, -offset);
    if (date < input.employeeStartDate) return null;

    const advanced = input.scheduleForDate?.(date);
    if (advanced && advanced.source !== "unassigned") {
      if (advanced.isRestDay) continue;
    } else {
      const restDay = restDayForDate(input.currentRestDay, input.restDayRevisions, date);
      if (isRestDayOfWeek(date, restDay)) continue;
    }

    if (holidayPayContextOn(date, input.holidayCalendar).holiday !== "ordinary") continue;
    return date;
  }
  return null;
}

const PHILIPPINE_TIME = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Manila",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function toLocalIso(date: Date) {
  const parts = new Map(
    PHILIPPINE_TIME.formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.get("year")}-${parts.get("month")}-${parts.get("day")}T${parts.get("hour")}:${parts.get("minute")}`;
}

export async function enqueuePayrollRun(runId: number, chunkSize = DEFAULT_CHUNK) {
  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId));
  if (!run) throw new Error("Payroll run not found");

  const employeeWhere = run.legalEntityId
    ? run.scopeOrgUnitId
      ? and(
          eq(employees.organizationId, run.organizationId),
          eq(employees.legalEntityId, run.legalEntityId),
          eq(employees.orgUnitId, run.scopeOrgUnitId),
          eq(employees.status, "Active"),
          lte(employees.startDate, run.periodEnd),
        )
      : and(
          eq(employees.organizationId, run.organizationId),
          eq(employees.legalEntityId, run.legalEntityId),
          eq(employees.status, "Active"),
          lte(employees.startDate, run.periodEnd),
        )
    : run.scopeOrgUnitId
      ? and(
          eq(employees.organizationId, run.organizationId),
          eq(employees.orgUnitId, run.scopeOrgUnitId),
          eq(employees.status, "Active"),
          lte(employees.startDate, run.periodEnd),
        )
      : and(
          eq(employees.organizationId, run.organizationId),
          eq(employees.status, "Active"),
          lte(employees.startDate, run.periodEnd),
        );
  const employeeRows = await db.select().from(employees).where(employeeWhere).orderBy(asc(employees.id));
  if (employeeRows.length === 0) {
    throw new Error("Payroll scope has no active employees. Add or reactivate an employee before calculating.");
  }
  const totalChunks = Math.max(1, Math.ceil(employeeRows.length / chunkSize));

  await db.delete(payrollJobs).where(eq(payrollJobs.payrollRunId, runId));
  await db.delete(payrollEntries).where(eq(payrollEntries.payrollRunId, runId));

  await db.update(payrollRuns).set({
    status: "Queued",
    employeeCount: employeeRows.length,
    grossPay: "0",
    netPay: "0",
    exceptions: 0,
    processedChunks: 0,
    totalChunks,
    ruleVersion: PAYROLL_RULE_VERSION,
  }).where(eq(payrollRuns.id, runId));

  await db.insert(payrollJobs).values({
    payrollRunId: runId,
    organizationId: run.organizationId,
    status: "queued",
    chunkIndex: 0,
    chunkSize,
    attempts: 0,
  });

  await recordAuditEvent({
    organizationId: run.organizationId,
    actor: "System",
    action: "Payroll job queued",
    resource: run.periodLabel,
    metadata: {
      runId,
      totalChunks,
      chunkSize,
      ruleVersion: PAYROLL_RULE_VERSION,
      periodStart: run.periodStart,
      periodEnd: run.periodEnd,
      scopeOrgUnitId: run.scopeOrgUnitId,
      legalEntityId: run.legalEntityId,
    },
  });

  return { runId, totalChunks, employeeCount: employeeRows.length };
}

export async function processNextPayrollJob(
  workerId = `worker-${process.pid}`,
  targetRunId?: number,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const claim = targetRunId
      ? await client.query<{
          id: number;
          payroll_run_id: number;
          organization_id: number;
          chunk_index: number;
          chunk_size: number;
          attempts: number;
        }>(
          `SELECT id, payroll_run_id, organization_id, chunk_index, chunk_size, attempts
           FROM payroll_jobs
           WHERE status IN ('queued', 'failed')
             AND payroll_run_id = $1
           ORDER BY id
           FOR UPDATE SKIP LOCKED
           LIMIT 1`,
          [targetRunId],
        )
      : await client.query<{
          id: number;
          payroll_run_id: number;
          organization_id: number;
          chunk_index: number;
          chunk_size: number;
          attempts: number;
        }>(
          `SELECT id, payroll_run_id, organization_id, chunk_index, chunk_size, attempts
           FROM payroll_jobs
           WHERE status IN ('queued', 'failed')
           ORDER BY id
           FOR UPDATE SKIP LOCKED
           LIMIT 1`,
        );

    if (claim.rowCount === 0) {
      await client.query("COMMIT");
      return { processed: false as const };
    }

    const job = claim.rows[0];
    await client.query(
      `UPDATE payroll_jobs
       SET status = 'processing', locked_at = NOW(), locked_by = $2, attempts = attempts + 1, updated_at = NOW()
       WHERE id = $1`,
      [job.id, workerId],
    );
    await client.query("COMMIT");

    try {
      const result = await processPayrollChunk({
        runId: job.payroll_run_id,
        organizationId: job.organization_id,
        chunkIndex: job.chunk_index,
        chunkSize: job.chunk_size,
      });

      if (result.done) {
        await db.update(payrollJobs).set({
          status: "completed",
          completedAt: new Date(),
          updatedAt: new Date(),
          lastError: null,
        }).where(eq(payrollJobs.id, job.id));
      } else {
        await db.update(payrollJobs).set({
          status: "queued",
          chunkIndex: job.chunk_index + 1,
          lockedAt: null,
          lockedBy: null,
          updatedAt: new Date(),
          lastError: null,
        }).where(eq(payrollJobs.id, job.id));
      }

      return { processed: true as const, ...result };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown payroll error";
      await db.update(payrollJobs).set({
        status: "failed",
        lastError: message,
        lockedAt: null,
        lockedBy: null,
        updatedAt: new Date(),
      }).where(eq(payrollJobs.id, job.id));
      await db.update(payrollRuns).set({ status: "Failed" }).where(eq(payrollRuns.id, job.payroll_run_id));
      throw error;
    }
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* ignore */ }
    throw error;
  } finally {
    client.release();
  }
}

export async function drainPayrollQueue(maxJobs = 50, targetRunId?: number) {
  const results = [];
  for (let i = 0; i < maxJobs; i += 1) {
    const result = await processNextPayrollJob(undefined, targetRunId);
    if (!result.processed) break;
    results.push(result);

    // Synchronous API callers drain one requested run to completion. A global
    // background worker should keep moving through other queued runs instead
    // of stopping merely because one run finished.
    if (targetRunId && result.done) break;
  }
  return results;
}

async function processPayrollChunk(input: {
  runId: number;
  organizationId: number;
  chunkIndex: number;
  chunkSize: number;
}) {
  await ensureLeavePayrollSchema();
  await ensureEmployeePayProfiles(input.organizationId);
  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, input.runId));
  if (!run) throw new Error("Payroll run missing");
  const [organization] = await db.select().from(organizations)
    .where(eq(organizations.id, input.organizationId))
    .limit(1);
  if (!organization) throw new Error("Payroll organization missing");
  const [legalEntity] = run.legalEntityId
    ? await db.select().from(legalEntities).where(and(
        eq(legalEntities.id, run.legalEntityId),
        eq(legalEntities.organizationId, input.organizationId),
      )).limit(1)
    : [];
  if (run.legalEntityId && !legalEntity) throw new Error("Payroll legal employer missing");
  const payrollEmployer = legalEntity ?? organization;
  const applicableStatutoryDate = String(run.payDate);
  const statutoryRuleVersions = statutoryRuleVersionsForDate(applicableStatutoryDate);
  const nationalHolidayCalendar = nationalHolidayCalendarForDate(String(run.periodEnd));

  const employeeWhere = run.legalEntityId
    ? run.scopeOrgUnitId
      ? and(
          eq(employees.organizationId, input.organizationId),
          eq(employees.legalEntityId, run.legalEntityId),
          eq(employees.orgUnitId, run.scopeOrgUnitId),
          eq(employees.status, "Active"),
          lte(employees.startDate, run.periodEnd),
        )
      : and(
          eq(employees.organizationId, input.organizationId),
          eq(employees.legalEntityId, run.legalEntityId),
          eq(employees.status, "Active"),
          lte(employees.startDate, run.periodEnd),
        )
    : run.scopeOrgUnitId
      ? and(
          eq(employees.organizationId, input.organizationId),
          eq(employees.orgUnitId, run.scopeOrgUnitId),
          eq(employees.status, "Active"),
          lte(employees.startDate, run.periodEnd),
        )
      : and(
          eq(employees.organizationId, input.organizationId),
          eq(employees.status, "Active"),
          lte(employees.startDate, run.periodEnd),
        );
  const allEmployees = await db.select().from(employees)
    .where(employeeWhere)
    .orderBy(asc(employees.id));

  if (allEmployees.length !== run.employeeCount) {
    throw new Error(
      "Payroll employee scope changed after calculation was queued. Recalculate so the run uses one consistent active-employee cohort.",
    );
  }
  const chunk = allEmployees.slice(input.chunkIndex * input.chunkSize, (input.chunkIndex + 1) * input.chunkSize);
  const chunkIds = chunk.map((employee) => employee.id);
  const payProfileRows = chunkIds.length
    ? await db.select().from(employeePayProfiles).where(inArray(employeePayProfiles.employeeId, chunkIds))
    : [];
  const payRevisionRows = chunkIds.length
    ? await db.select().from(employeePayRevisions).where(and(
        eq(employeePayRevisions.organizationId, input.organizationId),
        inArray(employeePayRevisions.employeeId, chunkIds),
        lte(employeePayRevisions.effectiveDate, run.periodEnd),
      )).orderBy(asc(employeePayRevisions.effectiveDate), asc(employeePayRevisions.id))
    : [];
  const restDayRevisionRows = chunkIds.length
    ? await db.select().from(employeeRestDayRevisions).where(and(
        eq(employeeRestDayRevisions.organizationId, input.organizationId),
        inArray(employeeRestDayRevisions.employeeId, chunkIds),
      )).orderBy(asc(employeeRestDayRevisions.effectiveDate), asc(employeeRestDayRevisions.id))
    : [];
  const mweClassificationRows = chunkIds.length
    ? await db.select().from(employeeMweClassifications).where(and(
        eq(employeeMweClassifications.organizationId, input.organizationId),
        inArray(employeeMweClassifications.employeeId, chunkIds),
        eq(employeeMweClassifications.status, "approved"),
        lte(employeeMweClassifications.effectiveFrom, String(run.payDate)),
        or(
          isNull(employeeMweClassifications.effectiveUntil),
          gte(employeeMweClassifications.effectiveUntil, String(run.payDate)),
        ),
      )).orderBy(asc(employeeMweClassifications.employeeId), asc(employeeMweClassifications.effectiveFrom))
    : [];
  const mweClassificationsByEmployee = new Map<number, MweClassificationRecord[]>();
  for (const row of mweClassificationRows) {
    const record: MweClassificationRecord = {
      id: row.id,
      employeeId: row.employeeId,
      isMwe: row.isMwe,
      region: row.region,
      employeeDailyWage: row.employeeDailyWage,
      statutoryMinimumWage: row.statutoryMinimumWage,
      wageOrderReference: row.wageOrderReference,
      evidenceReference: row.evidenceReference,
      effectiveFrom: String(row.effectiveFrom),
      effectiveUntil: row.effectiveUntil ? String(row.effectiveUntil) : null,
      status: row.status,
    };
    mweClassificationsByEmployee.set(row.employeeId, [
      ...(mweClassificationsByEmployee.get(row.employeeId) ?? []),
      record,
    ]);
  }
  const payProfileByEmployee = new Map(payProfileRows.map((profile) => [profile.employeeId, profile]));
  const payRevisionsByEmployee = new Map<number, typeof payRevisionRows>();
  for (const revision of payRevisionRows) {
    payRevisionsByEmployee.set(revision.employeeId, [...(payRevisionsByEmployee.get(revision.employeeId) ?? []), revision]);
  }
  const restDayRevisionsByEmployee = new Map<number, typeof restDayRevisionRows>();
  for (const revision of restDayRevisionRows) {
    restDayRevisionsByEmployee.set(revision.employeeId, [...(restDayRevisionsByEmployee.get(revision.employeeId) ?? []), revision]);
  }
  if (chunk.length === 0) {
    await finalizeRun(input.runId);
    return { done: true, chunkIndex: input.chunkIndex, processedEmployees: 0 };
  }

  const advisories = await db.select().from(calamityAdvisories).where(and(
    eq(calamityAdvisories.organizationId, input.organizationId),
    eq(calamityAdvisories.active, true),
    lte(calamityAdvisories.startDate, run.periodEnd),
    gte(calamityAdvisories.endDate, run.periodStart),
  ));
  const holidayRows = await db.select().from(holidays).where(
    or(isNull(holidays.organizationId), eq(holidays.organizationId, input.organizationId)),
  );
  const holidayWindowStart = addDays(String(run.periodStart), -14);
  const workforcePricingWindowEnd = addDays(String(run.periodEnd), 1);
  const localHolidayRows = holidayRows.flatMap((row) => {
    const date = String(row.holidayDate);
    if (date < holidayWindowStart || date > workforcePricingWindowEnd) return [];
    const kind = row.kind === "regular" || row.kind === "special" ? row.kind : null;
    return kind ? [{
      date,
      name: row.name,
      kind: kind as "regular" | "special",
      orgUnitId: row.orgUnitId,
      worksiteId: row.worksiteId,
    }] : [];
  });

  const units = await db.select().from(orgUnits).where(eq(orgUnits.organizationId, input.organizationId));
  const unitMap = new Map(units.map((unit) => [unit.id, unit]));

  // Pay-rule execution is loaded once per payroll chunk, then resolved
  // independently for each employee and work date. Only approved/effective
  // policies can execute, and v1 supports additive worked-time premiums only.
  const payPolicyRows = await db.select().from(payPolicies).where(and(
    eq(payPolicies.organizationId, input.organizationId),
    eq(payPolicies.active, true),
    lte(payPolicies.effectiveFrom, workforcePricingWindowEnd),
    or(
      isNull(payPolicies.effectiveUntil),
      gte(payPolicies.effectiveUntil, run.periodStart),
    ),
  )).orderBy(asc(payPolicies.id));
  const payPolicyIds = payPolicyRows.map((policy) => policy.id);
  const payPolicyRuleRows = payPolicyIds.length
    ? await db.select().from(payPolicyRules)
        .where(inArray(payPolicyRules.policyId, payPolicyIds))
        .orderBy(asc(payPolicyRules.policyId), asc(payPolicyRules.id))
    : [];
  const payrollPayPolicies: PayPolicyRecord[] = payPolicyRows.map((policy) => ({
    id: policy.id,
    organizationId: policy.organizationId,
    code: policy.code,
    name: policy.name,
    policyKind: policy.policyKind,
    version: policy.version,
    scopeType: payPolicyScope(policy.scopeType),
    scopeOrgUnitId: policy.scopeOrgUnitId,
    scopeEmployeeId: policy.scopeEmployeeId,
    priority: policy.priority,
    effectiveFrom: String(policy.effectiveFrom),
    effectiveUntil: policy.effectiveUntil ? String(policy.effectiveUntil) : null,
    active: policy.active,
    approvedAt: policy.approvedAt,
  }));
  const payrollPayPolicyRules: PayPolicyRuleRecord[] = payPolicyRuleRows.map((rule) => ({
    id: rule.id,
    policyId: rule.policyId,
    ruleKey: rule.ruleKey,
    eventType: rule.eventType,
    conditions: rule.conditions,
    outcome: rule.outcome,
    priority: rule.priority,
    statutoryFloorProtected: rule.statutoryFloorProtected,
    enabled: rule.enabled,
  }));

  // Workforce schedules are organization-level reusable definitions plus
  // employee-specific effective assignments/overrides. Load the reusable
  // definitions once per chunk and only the employee rows needed for this run.
  const scheduleWindowStart = holidayWindowStart;
  const scheduleWindowEnd = workforcePricingWindowEnd;
  const [workforceShiftRows, workforcePatternRows] = await Promise.all([
    db.select().from(shiftDefinitions).where(eq(shiftDefinitions.organizationId, input.organizationId)),
    db.select().from(schedulePatterns).where(eq(schedulePatterns.organizationId, input.organizationId)),
  ]);
  const workforcePatternIds = workforcePatternRows.map((pattern) => pattern.id);
  const workforcePatternDayRows = workforcePatternIds.length
    ? await db.select().from(schedulePatternDays)
        .where(inArray(schedulePatternDays.patternId, workforcePatternIds))
        .orderBy(asc(schedulePatternDays.patternId), asc(schedulePatternDays.dayIndex))
    : [];
  const workforcePatternDayIds = workforcePatternDayRows.map((day) => day.id);
  const workforcePatternSegmentRows = workforcePatternDayIds.length
    ? await db.select().from(schedulePatternSegments)
        .where(inArray(schedulePatternSegments.patternDayId, workforcePatternDayIds))
        .orderBy(asc(schedulePatternSegments.patternDayId), asc(schedulePatternSegments.segmentOrder))
    : [];
  const workforceAssignmentRows = chunkIds.length
    ? await db.select().from(employeeScheduleAssignments).where(and(
        eq(employeeScheduleAssignments.organizationId, input.organizationId),
        inArray(employeeScheduleAssignments.employeeId, chunkIds),
        lte(employeeScheduleAssignments.effectiveFrom, scheduleWindowEnd),
        or(
          isNull(employeeScheduleAssignments.effectiveUntil),
          gte(employeeScheduleAssignments.effectiveUntil, scheduleWindowStart),
        ),
      )).orderBy(
        asc(employeeScheduleAssignments.employeeId),
        asc(employeeScheduleAssignments.effectiveFrom),
        asc(employeeScheduleAssignments.id),
      )
    : [];
  const workforceOverrideRows = chunkIds.length
    ? await db.select().from(scheduleOverrides).where(and(
        eq(scheduleOverrides.organizationId, input.organizationId),
        inArray(scheduleOverrides.employeeId, chunkIds),
        gte(scheduleOverrides.workDate, scheduleWindowStart),
        lte(scheduleOverrides.workDate, scheduleWindowEnd),
      )).orderBy(
        asc(scheduleOverrides.employeeId),
        asc(scheduleOverrides.workDate),
        asc(scheduleOverrides.id),
      )
    : [];
  const workforceWorksiteAssignmentRows = chunkIds.length
    ? await db.select().from(employeeWorksiteAssignments).where(and(
        eq(employeeWorksiteAssignments.organizationId, input.organizationId),
        inArray(employeeWorksiteAssignments.employeeId, chunkIds),
        lte(employeeWorksiteAssignments.effectiveFrom, run.periodEnd),
        or(
          isNull(employeeWorksiteAssignments.effectiveUntil),
          gte(employeeWorksiteAssignments.effectiveUntil, scheduleWindowStart),
        ),
      )).orderBy(
        asc(employeeWorksiteAssignments.employeeId),
        asc(employeeWorksiteAssignments.effectiveFrom),
        asc(employeeWorksiteAssignments.id),
      )
    : [];
  const overtimeRequestRows = chunkIds.length
    ? await db.select().from(overtimeRequests).where(and(
        eq(overtimeRequests.organizationId, input.organizationId),
        inArray(overtimeRequests.employeeId, chunkIds),
        gte(overtimeRequests.workDate, run.periodStart),
        lte(overtimeRequests.workDate, run.periodEnd),
      )).orderBy(
        asc(overtimeRequests.employeeId),
        asc(overtimeRequests.workDate),
        asc(overtimeRequests.id),
      )
    : [];
  const workforceAssignmentsByEmployee = new Map<number, typeof workforceAssignmentRows>();
  for (const assignment of workforceAssignmentRows) {
    workforceAssignmentsByEmployee.set(
      assignment.employeeId,
      [...(workforceAssignmentsByEmployee.get(assignment.employeeId) ?? []), assignment],
    );
  }
  const workforceOverridesByEmployee = new Map<number, typeof workforceOverrideRows>();
  for (const override of workforceOverrideRows) {
    workforceOverridesByEmployee.set(
      override.employeeId,
      [...(workforceOverridesByEmployee.get(override.employeeId) ?? []), override],
    );
  }
  const workforceWorksitesByEmployee = new Map<number, typeof workforceWorksiteAssignmentRows>();
  for (const assignment of workforceWorksiteAssignmentRows) {
    workforceWorksitesByEmployee.set(
      assignment.employeeId,
      [...(workforceWorksitesByEmployee.get(assignment.employeeId) ?? []), assignment],
    );
  }
  const overtimeRequestsByEmployee = new Map<number, typeof overtimeRequestRows>();
  for (const request of overtimeRequestRows) {
    overtimeRequestsByEmployee.set(
      request.employeeId,
      [...(overtimeRequestsByEmployee.get(request.employeeId) ?? []), request],
    );
  }

  // Load the benefit catalogue and this chunk's active enrolments. Without this
  // the calculation function accepts benefits but nothing ever supplies them,
  // which would make the deduction silently inert.
  const plans = await db.select().from(benefitPlans).where(eq(benefitPlans.active, true));
  const planById = new Map(plans.map((plan) => [plan.id, plan]));
  const enrolments = plans.length === 0
    ? []
    : await db.select().from(benefitEnrollments).where(and(
        eq(benefitEnrollments.organizationId, input.organizationId),
        eq(benefitEnrollments.status, "active"),
      ));
  const activeEnrollmentIds = enrolments.map((row) => row.id);
  const dependentRows = activeEnrollmentIds.length
    ? await db.select().from(benefitDependents).where(and(
        eq(benefitDependents.organizationId, input.organizationId),
        eq(benefitDependents.status, "active"),
        inArray(benefitDependents.enrollmentId, activeEnrollmentIds),
      ))
    : [];
  const dependentContributionByEnrollment = new Map<number, number>();
  for (const dependent of dependentRows) {
    dependentContributionByEnrollment.set(
      dependent.enrollmentId,
      (dependentContributionByEnrollment.get(dependent.enrollmentId) ?? 0) + Number(dependent.monthlyContribution),
    );
  }

  const enrolmentsByEmployee = new Map<number, EnrollmentInput[]>();
  for (const enrolment of enrolments) {
    const plan = planById.get(enrolment.planId);
    if (!plan) continue;
    const list = enrolmentsByEmployee.get(enrolment.employeeId) ?? [];
    const dependentContribution = dependentContributionByEnrollment.get(enrolment.id) ?? 0;
    list.push({
      plan: {
        id: plan.id,
        name: plan.name,
        category: plan.category as "hmo" | "insurance" | "voluntary" | "allowance",
        employeeShare: Number(plan.employeeShare),
        employerShare: Number(plan.employerShare),
        cap: plan.cap == null ? null : Number(plan.cap),
      },
      monthlyContribution: Number(enrolment.monthlyContribution) + dependentContribution,
      active: true,
    });
    enrolmentsByEmployee.set(enrolment.employeeId, list);
  }

  // Approved-but-unpaid expense claims and approved-but-unrecovered advances
  // are pulled per chunk only, so a large run never loads the whole ledger.
  const [leavePolicyRows, approvedLeaveRows] = await Promise.all([
    db.select().from(leavePolicies).where(and(
      eq(leavePolicies.organizationId, input.organizationId),
      eq(leavePolicies.active, true),
    )),
    chunkIds.length
      ? db.select().from(leaveRequests).where(and(
          eq(leaveRequests.organizationId, input.organizationId),
          eq(leaveRequests.status, "Approved"),
          inArray(leaveRequests.employeeId, chunkIds),
        ))
      : Promise.resolve([]),
  ]);
  const approvedLeaveByEmployee = new Map<number, ResolvedPayrollLeave[]>();
  for (const employeeId of chunkIds) {
    const requests = approvedLeaveRows
      .filter((row) => row.employeeId === employeeId)
      .map((row) => ({
        id: row.id,
        leaveType: row.leaveType,
        startDate: String(row.startDate),
        endDate: String(row.endDate),
        days: Number(row.days),
      }));
    if (requests.length === 0) continue;

    const resolved = resolveApprovedLeaveForPayroll({
      requests,
      policies: leavePolicyRows.map((policy) => ({
        leaveType: policy.leaveType,
        payTreatment: policy.payTreatment,
        paidPercentage: Number(policy.paidPercentage),
      })),
      periodStart: String(run.periodStart),
      periodEnd: String(run.periodEnd),
    });
    approvedLeaveByEmployee.set(employeeId, resolved);
  }

  const openClaims = chunkIds.length
    ? await db.select().from(expenseClaims).where(and(
        eq(expenseClaims.organizationId, input.organizationId),
        eq(expenseClaims.status, "approved"),
        inArray(expenseClaims.employeeId, chunkIds),
      ))
    : [];
  const openAdvances = chunkIds.length
    ? await db.select().from(earnedWageRequests).where(and(
        eq(earnedWageRequests.organizationId, input.organizationId),
        eq(earnedWageRequests.status, "approved"),
        inArray(earnedWageRequests.employeeId, chunkIds),
      ))
    : [];
  const openSupplementaryEarnings = chunkIds.length
    ? await db.select().from(supplementaryEarnings).where(and(
        eq(supplementaryEarnings.organizationId, input.organizationId),
        eq(supplementaryEarnings.status, "approved"),
        inArray(supplementaryEarnings.employeeId, chunkIds),
        gte(supplementaryEarnings.effectiveDate, run.periodStart),
        lte(supplementaryEarnings.effectiveDate, run.periodEnd),
      ))
    : [];
  const recurringCompensationRows = chunkIds.length
    ? await db.select({
        assignmentId: employeeCompensationComponents.id,
        employeeId: employeeCompensationComponents.employeeId,
        amount: employeeCompensationComponents.amount,
        effectiveFrom: employeeCompensationComponents.effectiveFrom,
        effectiveUntil: employeeCompensationComponents.effectiveUntil,
        status: employeeCompensationComponents.status,
        componentId: compensationComponents.id,
        componentCode: compensationComponents.code,
        componentName: compensationComponents.name,
        kind: compensationComponents.kind,
        amountFrequency: compensationComponents.amountFrequency,
        taxable: compensationComponents.taxable,
        includeInSssBase: compensationComponents.includeInSssBase,
        includeInPagIbigBase: compensationComponents.includeInPagIbigBase,
      })
        .from(employeeCompensationComponents)
        .innerJoin(compensationComponents, eq(employeeCompensationComponents.componentId, compensationComponents.id))
        .where(and(
          eq(employeeCompensationComponents.organizationId, input.organizationId),
          inArray(employeeCompensationComponents.employeeId, chunkIds),
          // Ended assignments must still price past cutoffs inside their approved
          // effective interval; excluding them silently drops historical pay.
          inArray(employeeCompensationComponents.status, ["scheduled", "active", "ended"]),
          lte(employeeCompensationComponents.effectiveFrom, run.periodEnd),
          or(
            isNull(employeeCompensationComponents.effectiveUntil),
            gte(employeeCompensationComponents.effectiveUntil, run.periodStart),
          ),
          eq(compensationComponents.active, true),
        ))
    : [];
  const approvedYearEndAdjustments = chunkIds.length
    ? await db.select().from(yearEndAdjustments).where(and(
        eq(yearEndAdjustments.organizationId, input.organizationId),
        eq(yearEndAdjustments.payrollRunId, run.id),
        eq(yearEndAdjustments.status, "approved"),
        inArray(yearEndAdjustments.employeeId, chunkIds),
      ))
    : [];
  const yearEndByEmployee = new Map<number, typeof approvedYearEndAdjustments[number]>();
  for (const adjustment of approvedYearEndAdjustments) {
    if (yearEndByEmployee.has(adjustment.employeeId)) {
      throw new Error(
        `Employee #${adjustment.employeeId} has more than one approved year-end tax adjustment bound to payroll run #${run.id}.`,
      );
    }
    yearEndByEmployee.set(adjustment.employeeId, adjustment);
  }

  const deMinimis = chunkIds.length
    ? await db.select().from(deMinimisGrants).where(and(
        eq(deMinimisGrants.organizationId, input.organizationId),
        eq(deMinimisGrants.active, true),
        inArray(deMinimisGrants.employeeId, chunkIds),
      ))
    : [];
  const claimsByEmployee = new Map<number, typeof openClaims>();
  for (const claim of openClaims) {
    if (claim.payrollRunId != null) continue;
    claimsByEmployee.set(claim.employeeId, [...(claimsByEmployee.get(claim.employeeId) ?? []), claim]);
  }
  const advancesByEmployee = new Map<number, typeof openAdvances>();
  for (const advance of openAdvances) {
    if (advance.payrollRunId != null) continue;
    advancesByEmployee.set(advance.employeeId, [...(advancesByEmployee.get(advance.employeeId) ?? []), advance]);
  }
  const supplementaryByEmployee = new Map<number, typeof openSupplementaryEarnings>();
  for (const earning of openSupplementaryEarnings) {
    if (earning.payrollRunId != null) continue;
    supplementaryByEmployee.set(
      earning.employeeId,
      [...(supplementaryByEmployee.get(earning.employeeId) ?? []), earning],
    );
  }
  const recurringCompByEmployee = new Map<number, typeof recurringCompensationRows>();
  for (const component of recurringCompensationRows) {
    recurringCompByEmployee.set(
      component.employeeId,
      [...(recurringCompByEmployee.get(component.employeeId) ?? []), component],
    );
  }
  const deMinimisByEmployee = new Map<number, typeof deMinimis>();
  for (const grant of deMinimis) {
    deMinimisByEmployee.set(grant.employeeId, [...(deMinimisByEmployee.get(grant.employeeId) ?? []), grant]);
  }

  const activeLoans = chunkIds.length
    ? await db.select().from(employeeLoans).where(and(
        eq(employeeLoans.organizationId, input.organizationId),
        eq(employeeLoans.status, "active"),
        inArray(employeeLoans.employeeId, chunkIds),
      ))
    : [];
  const pendingRetroAdjustments = chunkIds.length
    ? await db.select().from(employeePayRetroAdjustments).where(and(
        eq(employeePayRetroAdjustments.organizationId, input.organizationId),
        eq(employeePayRetroAdjustments.status, "pending"),
        inArray(employeePayRetroAdjustments.employeeId, chunkIds),
      ))
    : [];
  const retroByEmployee = new Map<number, typeof pendingRetroAdjustments>();
  for (const retro of pendingRetroAdjustments) {
    retroByEmployee.set(retro.employeeId, [...(retroByEmployee.get(retro.employeeId) ?? []), retro]);
  }

    const loansByEmployee = new Map<number, typeof activeLoans>();
  for (const loan of activeLoans) {
    if (Number(loan.remainingBalance) <= 0) continue;
    loansByEmployee.set(loan.employeeId, [...(loansByEmployee.get(loan.employeeId) ?? []), loan]);
  }

  const openConversions = chunkIds.length
    ? await db.select().from(leaveConversions).where(and(
        eq(leaveConversions.organizationId, input.organizationId),
        eq(leaveConversions.status, "approved"),
        inArray(leaveConversions.employeeId, chunkIds),
      ))
    : [];
  const conversionsByEmployee = new Map<number, typeof openConversions>();
  for (const conv of openConversions) {
    if (conv.payrollRunId != null) continue;
    conversionsByEmployee.set(conv.employeeId, [...(conversionsByEmployee.get(conv.employeeId) ?? []), conv]);
  }

  // Monthly statutory contributions are ultimately reconciled against actual
  // remuneration. For the final cutoff of a month, use the released earlier
  // cutoff as the immutable ledger baseline instead of guessing current × 2.
  const periodEndText = String(run.periodEnd);
  const periodEndDate = new Date(`${periodEndText}T00:00:00Z`);
  const nextDay = new Date(periodEndDate);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const isFinalCutoffOfMonth = nextDay.getUTCMonth() !== periodEndDate.getUTCMonth();
  const monthStart = `${periodEndText.slice(0, 7)}-01`;

  const priorMonthEntries = chunkIds.length
    ? await db.select({
        employeeId: payrollEntries.employeeId,
        grossPay: payrollEntries.grossPay,
        lineItems: payrollEntries.lineItems,
        trace: payrollEntries.trace,
        periodStart: payrollRuns.periodStart,
        payDate: payrollRuns.payDate,
      })
        .from(payrollEntries)
        .innerJoin(payrollRuns, eq(payrollEntries.payrollRunId, payrollRuns.id))
        .where(and(
          eq(payrollRuns.organizationId, input.organizationId),
          eq(payrollRuns.status, "Released"),
          inArray(payrollEntries.employeeId, chunkIds),
          gte(payrollRuns.periodEnd, monthStart),
          lt(payrollRuns.periodEnd, run.periodStart),
        ))
    : [];

  const taxYearStart = `${String(run.payDate).slice(0, 4)}-01-01`;
  const priorImportedPayrollEmployees = new Set<number>(
    chunkIds.length
      ? (await db.select({ employeeId: historicalPayrollEntries.employeeId })
          .from(historicalPayrollEntries)
          .where(and(
            eq(historicalPayrollEntries.organizationId, input.organizationId),
            inArray(historicalPayrollEntries.employeeId, chunkIds),
            gte(historicalPayrollEntries.payDate, taxYearStart),
            lt(historicalPayrollEntries.payDate, run.payDate),
          )))
          .map((row) => row.employeeId)
      : [],
  );

  const priorDeMinimisEntries = chunkIds.length
    ? await db.select({
        employeeId: payrollEntries.employeeId,
        lineItems: payrollEntries.lineItems,
        payDate: payrollRuns.payDate,
      })
        .from(payrollEntries)
        .innerJoin(payrollRuns, eq(payrollEntries.payrollRunId, payrollRuns.id))
        .where(and(
          eq(payrollRuns.organizationId, input.organizationId),
          eq(payrollRuns.status, "Released"),
          inArray(payrollEntries.employeeId, chunkIds),
          gte(payrollRuns.payDate, taxYearStart),
          lt(payrollRuns.payDate, run.payDate),
        ))
    : [];

  const priorDeMinimisByEmployee = new Map<
    number,
    Partial<Record<DeMinimisType, number>>
  >();
  const priorBenefitPool90kByEmployee = new Map<number, number>();
  for (const prior of priorDeMinimisEntries) {
    const lines = Array.isArray(prior.lineItems)
      ? prior.lineItems as Array<{
          code?: string;
          label?: string;
          amount?: string | number;
          notes?: string[];
          periodOtherBenefitsPool?: number;
          benefitPool90k?: boolean;
          benefitPoolKind?: string;
        }>
      : [];
    for (const line of lines) {
      const rawCode = String(line.code ?? "");
      const amount = Math.max(0, Number(line.amount ?? 0) || 0);

      if (rawCode.startsWith("DM-")) {
        const benefitType = rawCode.slice(3) as DeMinimisType;
        if (benefitType in DE_MINIMIS_2026) {
          const periodStart = deMinimisStatutoryPeriodStart(
            benefitType,
            String(run.payDate),
          );
          if (String(prior.payDate) >= periodStart) {
            const bucket = priorDeMinimisByEmployee.get(prior.employeeId) ?? {};
            bucket[benefitType] = roundToCents(
              Number(bucket[benefitType] ?? 0) + amount,
            );
            priorDeMinimisByEmployee.set(prior.employeeId, bucket);
          }
        }

        const poolAmount = Math.max(0, Number(line.periodOtherBenefitsPool ?? 0) || 0);
        if (poolAmount > 0) {
          priorBenefitPool90kByEmployee.set(
            prior.employeeId,
            roundToCents((priorBenefitPool90kByEmployee.get(prior.employeeId) ?? 0) + poolAmount),
          );
        }
        continue;
      }

      const noteType = (line.notes ?? [])
        .find((note) => String(note).startsWith("Type: "))
        ?.slice("Type: ".length);
      const poolKind = String(line.benefitPoolKind ?? noteType ?? "");
      const label = String(line.label ?? "").toLowerCase();
      const isThirteenthMonth =
        poolKind === "13th_month"
        || poolKind === "thirteenth_month"
        || label.includes("13th month")
        || label.includes("thirteenth month");
      const joinsSharedPool =
        line.benefitPool90k === true
        || isSharedBenefitPoolEarningType(poolKind)
        || isThirteenthMonth;

      if (joinsSharedPool && amount > 0) {
        priorBenefitPool90kByEmployee.set(
          prior.employeeId,
          roundToCents((priorBenefitPool90kByEmployee.get(prior.employeeId) ?? 0) + amount),
        );
      }
    }
  }

  const priorStatutoryByEmployee = new Map<number, {
    sssRemuneration: number;
    pagIbigCompensation: number;
    sssEmployee: number;
    philHealthEmployee: number;
    pagIbigEmployee: number;
    pagIbigVoluntaryEmployee: number;
    sssEmployer: number;
    sssEmployerEc: number;
    philHealthEmployer: number;
    pagIbigEmployer: number;
  }>();

  for (const prior of priorMonthEntries) {
    const lines = Array.isArray(prior.lineItems)
      ? prior.lineItems as Array<{ code?: string; amount?: string | number }>
      : [];
    const expenseReimbursements = lines
      .filter((line) => String(line.code ?? "").startsWith("EXP-"))
      .reduce((sum, line) => sum + Math.max(0, Number(line.amount ?? 0) || 0), 0);
    const deduction = (code: string) =>
      -(Number(lines.find((line) => String(line.code ?? "").toUpperCase() === code)?.amount ?? 0) || 0);
    const previous = priorStatutoryByEmployee.get(prior.employeeId) ?? {
      sssRemuneration: 0,
      pagIbigCompensation: 0,
      sssEmployee: 0,
      philHealthEmployee: 0,
      pagIbigEmployee: 0,
      pagIbigVoluntaryEmployee: 0,
      sssEmployer: 0,
      sssEmployerEc: 0,
      philHealthEmployer: 0,
      pagIbigEmployer: 0,
    };
    const priorExcludedFromSss = roundToCents(
      traceInputNumber(prior.trace, "supplementaryExcludedFromSssBase")
        + traceInputNumber(prior.trace, "companyPremiumExcludedFromSssBase")
        + traceInputNumber(prior.trace, "holidayRestDayPremiumExcludedFromSssBase")
        + traceInputNumber(prior.trace, "overtimePremiumExcludedFromSssBase")
        + traceInputNumber(prior.trace, "nightDifferentialPremiumExcludedFromSssBase"),
    );
    const priorExcludedFromPagIbig = roundToCents(
      traceInputNumber(prior.trace, "supplementaryExcludedFromPagIbigBase")
        + traceInputNumber(prior.trace, "companyPremiumExcludedFromPagIbigBase")
        + traceInputNumber(prior.trace, "holidayRestDayPremiumExcludedFromPagIbigBase")
        + traceInputNumber(prior.trace, "overtimePremiumExcludedFromPagIbigBase")
        + traceInputNumber(prior.trace, "nightDifferentialPremiumExcludedFromPagIbigBase"),
    );
    previous.sssRemuneration = roundToCents(
      previous.sssRemuneration + Math.max(
        0,
        Number(prior.grossPay) - expenseReimbursements - priorExcludedFromSss,
      ),
    );
    previous.pagIbigCompensation = roundToCents(
      previous.pagIbigCompensation + Math.max(
        0,
        Number(prior.grossPay) - expenseReimbursements - priorExcludedFromPagIbig,
      ),
    );
    previous.sssEmployee = roundToCents(previous.sssEmployee + deduction("SSS"));
    previous.philHealthEmployee = roundToCents(previous.philHealthEmployee + deduction("PHIC"));
    previous.pagIbigEmployee = roundToCents(previous.pagIbigEmployee + deduction("HDMF"));
    previous.pagIbigVoluntaryEmployee = roundToCents(
      previous.pagIbigVoluntaryEmployee + deduction("HDMF_VOL"),
    );

    // Employer shares use the same cutoff policy and month-end true-up as
    // employee deductions. Exact cutoff amounts are persisted in the trace so
    // journals never silently revert to a hard-coded 50/50 allocation.
    const traceString = (key: string) => {
      const inputs = prior.trace && typeof prior.trace === "object"
        ? (prior.trace as { inputs?: unknown }).inputs
        : null;
      if (!Array.isArray(inputs)) return "";
      const prefix = `${key}=`;
      const raw = inputs.find((item) => typeof item === "string" && item.startsWith(prefix));
      return typeof raw === "string" ? raw.slice(prefix.length) : "";
    };
    const priorTimingValue = traceString("statutoryDeductionTiming");
    const priorTiming =
      priorTimingValue === "first_cutoff" || priorTimingValue === "second_cutoff"
        ? priorTimingValue
        : "split";
    const priorIsSecondCutoff = Number(String(prior.periodStart).slice(8, 10)) >= 16;
    const legacyEmployerCutoff = (monthlyTarget: number) =>
      computeCutoffStatutoryDeduction({
        monthlyTarget,
        priorCollected: 0,
        timing: priorTiming,
        isSecondCutoff: priorIsSecondCutoff,
      });

    const priorSssBase =
      traceInputNumber(prior.trace, "statutoryMonthlySssCompensation")
      || traceInputNumber(prior.trace, "statutoryMonthlyCompensation");
    const priorPagIbigBase =
      traceInputNumber(prior.trace, "statutoryMonthlyPagIbigCompensation")
      || traceInputNumber(prior.trace, "statutoryMonthlyCompensation");
    const priorPhilHealthBase = traceInputNumber(prior.trace, "philHealthContributionBase");
    const priorSssRule = computeSss(priorSssBase, String(prior.payDate));
    const priorPhilHealthRule = computePhilHealth(priorPhilHealthBase, String(prior.payDate));
    const priorPagIbigRule = computePagIbig(priorPagIbigBase, String(prior.payDate));

    const tracedSssEmployer = traceInputNumber(prior.trace, "sssEmployerCutoff");
    const tracedSssEc = traceInputNumber(prior.trace, "sssEmployerEcCutoff");
    const tracedPhilHealthEmployer = traceInputNumber(prior.trace, "philHealthEmployerCutoff");
    const tracedPagIbigEmployer = traceInputNumber(prior.trace, "pagIbigEmployerCutoff");

    previous.sssEmployer = roundToCents(
      previous.sssEmployer
      + (tracedSssEmployer > 0 ? tracedSssEmployer : legacyEmployerCutoff(priorSssRule.employer)),
    );
    previous.sssEmployerEc = roundToCents(
      previous.sssEmployerEc
      + (tracedSssEc > 0 ? tracedSssEc : legacyEmployerCutoff(priorSssRule.employerEC)),
    );
    previous.philHealthEmployer = roundToCents(
      previous.philHealthEmployer
      + (
        tracedPhilHealthEmployer > 0
          ? tracedPhilHealthEmployer
          : legacyEmployerCutoff(priorPhilHealthRule.employer)
      ),
    );
    previous.pagIbigEmployer = roundToCents(
      previous.pagIbigEmployer
      + (
        tracedPagIbigEmployer > 0
          ? tracedPagIbigEmployer
          : legacyEmployerCutoff(priorPagIbigRule.employer)
      ),
    );
    priorStatutoryByEmployee.set(prior.employeeId, previous);
  }

  let chunkGross = 0;
  let chunkNet = 0;
  let chunkExceptions = 0;

  for (const employee of chunk) {
    const employeeHolidayScopeIds = orgUnitAncestors(employee.orgUnitId, unitMap);

    const workforceAssignments = (workforceAssignmentsByEmployee.get(employee.id) ?? []).map((assignment) => ({
      id: assignment.id,
      patternId: assignment.patternId,
      effectiveFrom: String(assignment.effectiveFrom),
      effectiveUntil: assignment.effectiveUntil ? String(assignment.effectiveUntil) : null,
      anchorDate: String(assignment.anchorDate),
      workLocationOrgUnitId: assignment.workLocationOrgUnitId,
      worksiteId: assignment.worksiteId,
    }));
    const workforceOverrides = (workforceOverridesByEmployee.get(employee.id) ?? []).map((override) => ({
      id: override.id,
      workDate: String(override.workDate),
      kind: override.kind as "shift" | "split_shift" | "rest_day" | "off" | "location",
      isRestDay: override.isRestDay,
      segments: Array.isArray(override.segments)
        ? override.segments as Array<{ shiftDefinitionId: number; segmentOrder: number }>
        : [],
      workLocationOrgUnitId: override.workLocationOrgUnitId,
      worksiteId: override.worksiteId,
      status: override.status as "pending" | "approved" | "rejected" | "cancelled",
      reason: override.reason,
    }));
    const workforceScheduleCache = new Map<string, ResolvedDailySchedule>();
    const resolveWorkforceScheduleForDate = (date: string) => {
      const cached = workforceScheduleCache.get(date);
      if (cached) return cached;

      const resolved = resolveDailySchedule({
        date,
        assignments: workforceAssignments,
        patterns: workforcePatternRows.map((pattern) => ({
          id: pattern.id,
          code: pattern.code,
          name: pattern.name,
          cycleDays: pattern.cycleDays,
        })),
        patternDays: workforcePatternDayRows.map((day) => ({
          id: day.id,
          patternId: day.patternId,
          dayIndex: day.dayIndex,
          isRestDay: day.isRestDay,
          label: day.label,
        })),
        patternSegments: workforcePatternSegmentRows.map((segment) => ({
          patternDayId: segment.patternDayId,
          shiftDefinitionId: segment.shiftDefinitionId,
          segmentOrder: segment.segmentOrder,
        })),
        shifts: workforceShiftRows.map((shift) => ({
          id: shift.id,
          code: shift.code,
          name: shift.name,
          startTime: shift.startTime,
          endTime: shift.endTime,
          breakMinutes: shift.breakMinutes,
          spansMidnight: shift.spansMidnight,
        })),
        overrides: workforceOverrides,
        defaultWorksiteId:
          selectEffectiveWorksiteAssignment(
            (workforceWorksitesByEmployee.get(employee.id) ?? []).map((assignment) => ({
              id: assignment.id,
              worksiteId: assignment.worksiteId,
              effectiveFrom: String(assignment.effectiveFrom),
              effectiveUntil: assignment.effectiveUntil ? String(assignment.effectiveUntil) : null,
            })),
            date,
          )?.worksiteId ?? null,
      });
      workforceScheduleCache.set(date, resolved);
      return resolved;
    };

    const applicableLocalHolidayRows = localHolidayRows.filter((holiday) =>
      workforceHolidayApplies({
        holiday,
        employeeOrgUnitScopeIds: employeeHolidayScopeIds,
        resolvedWorksiteId: resolveWorkforceScheduleForDate(holiday.date).worksiteId,
      }),
    );
    const employeeHolidayCalendar: HolidayCalendarEntry[] = [
      ...nationalHolidayCalendar,
      ...applicableLocalHolidayRows
        .map(({ orgUnitId: _orgUnitId, worksiteId: _worksiteId, ...holiday }) => holiday)
        .filter((local) => !nationalHolidayCalendar.some(
          (national) => national.date === local.date && national.name === local.name && national.kind === local.kind,
        )),
    ];

    const punches = await db.select().from(timePunches).where(and(
      eq(timePunches.organizationId, input.organizationId),
      eq(timePunches.employeeId, employee.id),
      gte(timePunches.workDate, run.periodStart),
      lte(timePunches.workDate, run.periodEnd),
    ));
    for (const punch of punches) {
      const workDate = String(punch.workDate);
      resolveWorkforceScheduleForDate(workDate);

      // An overnight attendance record can enter a different holiday/rest-day
      // classification after midnight. Resolve every touched calendar date so
      // payroll never falls back to a guessed weekday when an advanced roster
      // exists for the continuation of the shift.
      if (punch.timeOut) {
        const endingCalendarDate = toLocalIso(new Date(punch.timeOut)).slice(0, 10);
        for (
          let date = addDays(workDate, 1), guard = 0;
          date <= endingCalendarDate && guard < 3;
          date = addDays(date, 1), guard += 1
        ) {
          resolveWorkforceScheduleForDate(date);
        }
      }
    }

    const employeeRestDayRevisions = (restDayRevisionsByEmployee.get(employee.id) ?? []).map((revision) => ({
      effectiveDate: String(revision.effectiveDate),
      previousRestDay: revision.previousRestDay,
      newRestDay: revision.newRestDay,
    }));
    const holidayEligibilityDates = [...new Set(
      employeeHolidayCalendar
        .map((holiday) => holiday.date)
        .filter((date) => date >= String(run.periodStart) && date <= String(run.periodEnd))
        .filter((date) => {
          const context = holidayPayContextOn(date, employeeHolidayCalendar);
          return context.holiday === "regular" || context.holiday === "double";
        })
        .map((holidayDate) => precedingScheduledWorkDate({
          holidayDate,
          currentRestDay: employee.restDay,
          restDayRevisions: employeeRestDayRevisions,
          holidayCalendar: employeeHolidayCalendar,
          employeeStartDate: String(employee.startDate),
          scheduleForDate: resolveWorkforceScheduleForDate,
        }))
        .filter((date): date is string => Boolean(date)),
    )];

    const holidayEligibilityAttendance = holidayEligibilityDates.length
      ? await db.select().from(timePunches).where(and(
          eq(timePunches.organizationId, input.organizationId),
          eq(timePunches.employeeId, employee.id),
          inArray(timePunches.workDate, holidayEligibilityDates),
        ))
      : [];
    const holidayEligibilityAttendanceDates = [...new Set(
      holidayEligibilityAttendance
        .filter((punch) => Boolean(punch.timeIn && punch.timeOut))
        .map((punch) => String(punch.workDate)),
    )];

    const paidPolicyByType = new Map(
      leavePolicyRows.map((policy) => [
        policy.leaveType,
        policy.payTreatment !== "unpaid" && Number(policy.paidPercentage) > 0,
      ]),
    );
    const employeeApprovedLeaveRows = approvedLeaveRows.filter((row) => row.employeeId === employee.id);
    const holidayEligibilityPaidLeaveDates = holidayEligibilityDates.filter((date) =>
      employeeApprovedLeaveRows.some((row) =>
        paidPolicyByType.get(row.leaveType) === true
        && String(row.startDate) <= date
        && String(row.endDate) >= date
      ),
    );
    const unit = employee.orgUnitId ? unitMap.get(employee.orgUnitId) : null;
    const calc = calculateEmployeePay({
      employee,
      punches,
      advisories,
      unitName: unit?.name ?? "Unassigned",
      periodLabel: run.periodLabel,
      benefits: enrolmentsByEmployee.get(employee.id) ?? [],
      expenses: (claimsByEmployee.get(employee.id) ?? []).map((c) => ({
        id: c.id,
        category: c.category,
        description: c.description,
        amount: Number(c.amount),
        incurredOn: String(c.incurredOn),
      })),
      advances: (advancesByEmployee.get(employee.id) ?? []).map((a) => ({
        id: a.id,
        requestedAmount: Number(a.requestedAmount),
        fee: Number(a.fee),
      })),
      supplementaryEarnings: [
        ...(supplementaryByEmployee.get(employee.id) ?? []).map((earning) => ({
          id: earning.id,
          earningType: earning.earningType,
          label: earning.label,
          amount: Number(earning.amount),
          taxable: earning.taxable,
          includeInSssBase: earning.includeInSssBase,
          includeInPagIbigBase: earning.includeInPagIbigBase,
        })),
        ...(recurringCompByEmployee.get(employee.id) ?? []).map((component) => ({
          id: component.assignmentId,
          code: `COMP-${component.assignmentId}`,
          earningType: `recurring_${component.kind}`,
          label: component.componentName,
          amount: recurringComponentAmountForCutoff({
            amount: Number(component.amount),
            amountFrequency: component.amountFrequency,
            effectiveFrom: String(component.effectiveFrom),
            effectiveUntil: component.effectiveUntil ? String(component.effectiveUntil) : null,
            periodStart: String(run.periodStart),
            periodEnd: String(run.periodEnd),
          }),
          taxable: component.taxable,
          includeInSssBase: component.includeInSssBase,
          includeInPagIbigBase: component.includeInPagIbigBase,
          notes: [
            `Recurring component ${component.componentCode}`,
            `Frequency: ${component.amountFrequency}`,
            `Effective ${component.effectiveFrom}${component.effectiveUntil ? ` through ${component.effectiveUntil}` : ""}`,
          ],
        })),
      ].filter((earning) => earning.amount > 0),
      yearEndTaxAdjustment: (() => {
        const adjustment = yearEndByEmployee.get(employee.id);
        return adjustment
          ? {
              id: adjustment.id,
              taxYear: adjustment.taxYear,
              adjustment: Number(adjustment.adjustment),
              outcome: adjustment.outcome,
            }
          : undefined;
      })(),
      deMinimis: (deMinimisByEmployee.get(employee.id) ?? [])
        .filter((g) =>
          String(g.effectiveOn) <= String(run.payDate)
          && (!g.endedOn || String(g.endedOn) >= String(run.payDate))
        )
        .map((g) => ({
          id: g.id,
          benefitType: g.benefitType as DeMinimisType,
          amount: Number(g.amount),
          frequency: g.frequency as "month" | "semester" | "year" | "eligible_day",
          basisDailyMinimumWage: g.basisDailyMinimumWage == null ? null : Number(g.basisDailyMinimumWage),
          basisWageOrder: g.basisWageOrder,
        })),
      priorDeMinimisPaid: priorDeMinimisByEmployee.get(employee.id) ?? {},
      priorBenefitPool90k: priorBenefitPool90kByEmployee.get(employee.id) ?? 0,
      importedPayrollHistoryBeforeCutoff: priorImportedPayrollEmployees.has(employee.id),

      loans: (loansByEmployee.get(employee.id) ?? [])
        .filter((l) =>
          (!l.startDate || String(l.startDate) <= String(run.periodEnd))
          && (!l.endDate || String(l.endDate) >= String(run.periodStart))
        )
        .map((l) => ({
          id: l.id,
          loanType: l.loanType,
          referenceNo: l.referenceNo,
          cutoffDeduction: Number(l.cutoffDeduction),
          remainingBalance: Number(l.remainingBalance),
        })),
      leaveConversions: (conversionsByEmployee.get(employee.id) ?? []).map((c) => ({
        id: c.id,
        leaveType: c.leaveType,
        daysConverted: Number(c.daysConverted),
        dailyRate: Number(c.dailyRate),
        cashAmount: Number(c.cashAmount),
        taxExempt: c.taxExempt,
      })),
      approvedLeave: approvedLeaveByEmployee.get(employee.id) ?? [],
      retroAdjustments: (retroByEmployee.get(employee.id) ?? []).map((retro) => ({
        id: retro.id,
        amount: Number(retro.amount),
        sourcePeriodLabel: retro.sourcePeriodLabel,
      })),
      payProfile: (() => {
        const profile = payProfileByEmployee.get(employee.id);
        if (!profile) throw new Error(`Employee #${employee.id} has no pay profile.`);
        return {
          payBasis: profile.payBasis,
          rateAmount: profile.rateAmount,
          standardWorkDaysPerMonth: profile.standardWorkDaysPerMonth,
          standardHoursPerDay: profile.standardHoursPerDay,
        };
      })(),
      payRevisions: (payRevisionsByEmployee.get(employee.id) ?? []).map((revision) => ({
        effectiveDate: String(revision.effectiveDate),
        previousPayBasis: revision.previousPayBasis,
        previousRateAmount: revision.previousRateAmount,
        previousStandardWorkDaysPerMonth: revision.previousStandardWorkDaysPerMonth,
        previousStandardHoursPerDay: revision.previousStandardHoursPerDay,
        newPayBasis: revision.newPayBasis,
        newRateAmount: revision.newRateAmount,
        newStandardWorkDaysPerMonth: revision.newStandardWorkDaysPerMonth,
        newStandardHoursPerDay: revision.newStandardHoursPerDay,
        reason: revision.reason,
      })),
      holidayCalendar: employeeHolidayCalendar,
      holidayCalendarFingerprint: holidayCalendarFingerprint(employeeHolidayCalendar),
      holidayEligibilityAttendanceDates,
      holidayEligibilityPaidLeaveDates,
      statutoryDeductionTiming: payrollEmployer.statutoryDeductionTiming,
      restDayRevisions: employeeRestDayRevisions,
      resolvedSchedules: Object.fromEntries(workforceScheduleCache),
      overtimeRequests: (overtimeRequestsByEmployee.get(employee.id) ?? []).map((request) => ({
        id: request.id,
        workDate: String(request.workDate),
        status: request.status as OvertimeRequestStatus,
        requestKind: request.requestKind as OvertimeRequestKind,
        requestedMinutes: request.requestedMinutes,
        requestedByUserId: request.requestedByUserId,
        decidedByUserId: request.decidedByUserId,
      })),
      payPolicies: payrollPayPolicies,
      payPolicyRules: payrollPayPolicyRules,
      payPolicyOrgUnitIds: [...employeeHolidayScopeIds],
      mweClassifications: mweClassificationsByEmployee.get(employee.id) ?? [],
      periodStart: String(run.periodStart),
      periodEnd: String(run.periodEnd),
      payDate: applicableStatutoryDate,
      statutoryRuleVersions,
      priorStatutory: priorStatutoryByEmployee.get(employee.id),
      isFinalCutoffOfMonth,
    });

    chunkGross += calc.gross;
    chunkNet += calc.net;
    if (calc.status === "Exception") chunkExceptions += 1;

    const [entry] = await db.insert(payrollEntries).values({
      payrollRunId: input.runId,
      employeeId: employee.id,
      grossPay: money(calc.gross),
      deductions: money(calc.deductions),
      netPay: money(calc.net),
      status: calc.status,
      lineItems: calc.lineItems,
      trace: {
        ...calc.trace,
        workforceHolidayScope: applicableLocalHolidayRows.map((holiday) => ({
          date: holiday.date,
          name: holiday.name,
          kind: holiday.kind,
          orgUnitId: holiday.orgUnitId,
          worksiteId: holiday.worksiteId,
          resolvedWorksiteId: resolveWorkforceScheduleForDate(holiday.date).worksiteId,
        })),
        payment: {
          employeeName: `${employee.firstName} ${employee.lastName}`,
          employeeNo: employee.employeeNo,
          firstName: employee.firstName,
          middleName: employee.middleName,
          lastName: employee.lastName,
          email: employee.email,
          // Never persist a legacy plaintext account into the payroll trace.
          bankAccount: encryptBankAccount(employee.bankAccount),
          bankCode: employee.bankCode,
          mobile: employee.mobile,
        },
        payProfile: {
          payBasis: payProfileByEmployee.get(employee.id)!.payBasis,
          rateAmount: Number(payProfileByEmployee.get(employee.id)!.rateAmount),
          standardWorkDaysPerMonth: Number(payProfileByEmployee.get(employee.id)!.standardWorkDaysPerMonth),
          standardHoursPerDay: Number(payProfileByEmployee.get(employee.id)!.standardHoursPerDay),
          monthlyEquivalent: Number(employee.basicRate),
        },
      },
    }).returning();

    await db.insert(payslips).values({
      payrollEntryId: entry.id,
      organizationId: input.organizationId,
      employeeId: employee.id,
      periodLabel: run.periodLabel,
      content: calc.payslipText,
      ruleVersion: PAYROLL_RULE_VERSION,
    });

  }

  const processedChunks = input.chunkIndex + 1;
  const totalChunks = Math.max(1, Math.ceil(allEmployees.length / input.chunkSize));
  const done = processedChunks >= totalChunks;

  const [fresh] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, input.runId));
  await db.update(payrollRuns).set({
    status: done ? "Needs review" : "Processing",
    grossPay: money(Number(fresh?.grossPay ?? 0) + chunkGross),
    netPay: money(Number(fresh?.netPay ?? 0) + chunkNet),
    exceptions: Number(fresh?.exceptions ?? 0) + chunkExceptions,
    processedChunks,
    totalChunks,
    employeeCount: allEmployees.length,
  }).where(eq(payrollRuns.id, input.runId));

  if (done) {
    await finalizeRun(input.runId);
  }

  return {
    done,
    chunkIndex: input.chunkIndex,
    processedEmployees: chunk.length,
    processedChunks,
    totalChunks,
  };
}

async function finalizeRun(runId: number) {
  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId));
  if (!run) return;
  await recordAuditEvent({
    organizationId: run.organizationId,
    actor: "System",
    action: "Payroll calculation completed",
    resource: run.periodLabel,
    metadata: {
      runId,
      employeeCount: run.employeeCount,
      exceptions: run.exceptions,
      ruleVersion: PAYROLL_RULE_VERSION,
    },
  });
}

function calculateEmployeePay(input: {
  employee: typeof employees.$inferSelect;
  punches: Array<typeof timePunches.$inferSelect>;
  advisories: Array<typeof calamityAdvisories.$inferSelect>;
  unitName: string;
  periodLabel: string;
  benefits?: EnrollmentInput[];
  expenses?: Array<{ id: number; category: string; description: string; amount: number; incurredOn: string }>;
  advances?: Array<{ id: number; requestedAmount: number; fee: number }>;
  supplementaryEarnings?: Array<{
    id: number;
    code?: string;
    earningType: string;
    label: string;
    amount: number;
    taxable: boolean;
    includeInSssBase: boolean;
    includeInPagIbigBase: boolean;
    notes?: string[];
  }>;
  yearEndTaxAdjustment?: {
    id: number;
    taxYear: number;
    adjustment: number;
    outcome: string;
  };
  deMinimis?: Array<{
    id: number;
    benefitType: DeMinimisType;
    amount: number;
    frequency: "month" | "semester" | "year" | "eligible_day";
    basisDailyMinimumWage?: number | null;
    basisWageOrder?: string | null;
  }>;
  priorDeMinimisPaid?: Partial<Record<DeMinimisType, number>>;
  priorBenefitPool90k?: number;
  importedPayrollHistoryBeforeCutoff?: boolean;
  loans?: Array<{ id: number; loanType: string; referenceNo: string; cutoffDeduction: number; remainingBalance: number }>;
  leaveConversions?: Array<{ id: number; leaveType: string; daysConverted: number; dailyRate: number; cashAmount: number; taxExempt: boolean }>;
  approvedLeave?: ResolvedPayrollLeave[];
  retroAdjustments?: Array<{ id: number; amount: number; sourcePeriodLabel: string }>;
  payProfile: EmployeePayProfileInput;
  payRevisions?: EffectivePayRevisionInput[];
  holidayCalendar?: HolidayCalendarEntry[];
  holidayCalendarFingerprint?: string;
  holidayEligibilityAttendanceDates?: string[];
  holidayEligibilityPaidLeaveDates?: string[];
  statutoryDeductionTiming?: string;
  restDayRevisions?: EffectiveRestDayRevisionInput[];
  resolvedSchedules?: Record<string, ResolvedDailySchedule>;
  overtimeRequests?: Array<OvertimeRequestEvidence & { workDate: string }>;
  payPolicies?: PayPolicyRecord[];
  payPolicyRules?: PayPolicyRuleRecord[];
  payPolicyOrgUnitIds?: number[];
  mweClassifications?: MweClassificationRecord[];
  periodStart: string;
  periodEnd: string;
  payDate: string;
  statutoryRuleVersions: {
    sss: string;
    philHealth: string;
    pagIbig: string;
    withholding: string;
  };
  priorStatutory?: {
    sssRemuneration: number;
    pagIbigCompensation: number;
    sssEmployee: number;
    philHealthEmployee: number;
    pagIbigEmployee: number;
    pagIbigVoluntaryEmployee: number;
    sssEmployer: number;
    sssEmployerEc: number;
    philHealthEmployer: number;
    pagIbigEmployer: number;
  };
  isFinalCutoffOfMonth?: boolean;
}) {
  const employeeStartDate = String(input.employee.startDate);
  const employmentStart = employeeStartDate > input.periodStart ? employeeStartDate : input.periodStart;
  if (employmentStart > input.periodEnd) {
    throw new Error(`Employee #${input.employee.id} starts after this payroll cutoff and must not be included.`);
  }

  const timeline = resolvePayTimeline({
    currentProfile: input.payProfile,
    revisions: input.payRevisions ?? [],
    periodStart: employmentStart,
    periodEnd: input.periodEnd,
  });
  const payProfile = profileForDate(timeline, input.periodEnd);
  const monthly = payProfile.monthlyEquivalent;
  // The denominator remains the full cutoff while timeline coverage begins on
  // the actual employment start date, so a mid-cutoff hire receives only the
  // earned fraction of the semi-monthly salary.
  const semiMonthlyBasic = fixedMonthlyBasicForTimeline(
    timeline,
    input.periodStart,
    input.periodEnd,
    employeeStartDate,
  );
  const dailyRate = payProfile.dailyRate;
  const hourlyRate = payProfile.hourlyRate;

  let regularMinutes = 0;
  let overtimeMinutes = 0;
  let nightMinutes = 0;
  let tardinessMinutes = 0;
  let undertimeMinutes = 0;
  let workedBasicPay = 0;
  let overtimePay = 0;
  let nightDiffPay = 0;
  let tardinessDeduction = 0;
  let undertimeDeduction = 0;
  let holidayPremium = 0;
  let companyPremiumPay = 0;
  let companyPremiumTaxable = 0;
  let companyPremiumExcludedFromSssBase = 0;
  let companyPremiumExcludedFromPagIbigBase = 0;
  const companyPremiumApplications: AppliedWorkedTimePremiumRule[] = [];
  const companyPremiumPolicyTrace = new Map<number, ReturnType<typeof payPolicyTrace>[number]>();

  let holidayRestDayPremiumPay = 0;
  let holidayRestDayPremiumTaxable = 0;
  let holidayRestDayPremiumExcludedFromSssBase = 0;
  let holidayRestDayPremiumExcludedFromPagIbigBase = 0;
  const holidayRestDayPremiumApplications: AppliedHolidayRestDayPremiumRule[] = [];
  const holidayRestDayPremiumPolicyTrace = new Map<number, ReturnType<typeof payPolicyTrace>[number]>();

  let overtimePremiumPay = 0;
  let overtimePremiumTaxable = 0;
  let overtimePremiumExcludedFromSssBase = 0;
  let overtimePremiumExcludedFromPagIbigBase = 0;
  const overtimePremiumApplications: AppliedOvertimePremiumRule[] = [];
  const overtimePremiumPolicyTrace = new Map<number, ReturnType<typeof payPolicyTrace>[number]>();

  let nightDifferentialPremiumPay = 0;
  let nightDifferentialPremiumTaxable = 0;
  let nightDifferentialPremiumExcludedFromSssBase = 0;
  let nightDifferentialPremiumExcludedFromPagIbigBase = 0;
  const nightDifferentialPremiumApplications: AppliedNightDifferentialPremiumRule[] = [];
  const nightDifferentialPremiumPolicyTrace = new Map<number, ReturnType<typeof payPolicyTrace>[number]>();

  const flags: string[] = [];
  const punchNotes: string[] = [];
  const holidayNotes: string[] = [];
  const overtimeMinutesByWorkDate = new Map<string, number>();
  const mealAllowanceEligibleWorkDates = new Set<string>();

  function applyWorkedTimePremium(inputSegment: {
    workDate: string;
    minutes: number;
    hourlyRate: number;
    shiftCode: string | null;
    worksiteId: number | null;
  }) {
    const resolution = resolveWorkedTimePremium({
      organizationId: input.employee.organizationId,
      employeeId: input.employee.id,
      orgUnitIds: input.payPolicyOrgUnitIds ?? [],
      workDate: inputSegment.workDate,
      minutes: inputSegment.minutes,
      hourlyRate: inputSegment.hourlyRate,
      shiftCode: inputSegment.shiftCode,
      worksiteId: inputSegment.worksiteId,
      policies: input.payPolicies ?? [],
      rules: input.payPolicyRules ?? [],
    });

    companyPremiumPay = roundToCents(companyPremiumPay + resolution.amount);
    companyPremiumTaxable = roundToCents(
      companyPremiumTaxable + resolution.taxableAmount,
    );
    companyPremiumExcludedFromSssBase = roundToCents(
      companyPremiumExcludedFromSssBase
        + Math.max(0, resolution.amount - resolution.sssIncludedAmount),
    );
    companyPremiumExcludedFromPagIbigBase = roundToCents(
      companyPremiumExcludedFromPagIbigBase
        + Math.max(0, resolution.amount - resolution.pagIbigIncludedAmount),
    );
    const appliedPolicyIds = new Set(resolution.applied.map((item) => item.policyId));
    for (const policy of resolution.policies) {
      if (appliedPolicyIds.has(policy.policyId)) {
        companyPremiumPolicyTrace.set(policy.policyId, policy);
      }
    }
    companyPremiumApplications.push(...resolution.applied);
    return resolution;
  }

  function applyHolidayRestDayPremium(inputSegment: {
    workDate: string;
    minutes: number;
    hourlyRate: number;
    holidayType: PayPolicyHolidayType;
    restDay: boolean;
    statutoryMultiplier: number;
    shiftCode: string | null;
    worksiteId: number | null;
  }) {
    const resolution = resolveHolidayRestDayPremium({
      organizationId: input.employee.organizationId,
      employeeId: input.employee.id,
      orgUnitIds: input.payPolicyOrgUnitIds ?? [],
      workDate: inputSegment.workDate,
      minutes: inputSegment.minutes,
      hourlyRate: inputSegment.hourlyRate,
      holidayType: inputSegment.holidayType,
      restDay: inputSegment.restDay,
      statutoryMultiplier: inputSegment.statutoryMultiplier,
      shiftCode: inputSegment.shiftCode,
      worksiteId: inputSegment.worksiteId,
      policies: input.payPolicies ?? [],
      rules: input.payPolicyRules ?? [],
    });

    holidayRestDayPremiumPay = roundToCents(
      holidayRestDayPremiumPay + resolution.amount,
    );
    holidayRestDayPremiumTaxable = roundToCents(
      holidayRestDayPremiumTaxable + resolution.taxableAmount,
    );
    holidayRestDayPremiumExcludedFromSssBase = roundToCents(
      holidayRestDayPremiumExcludedFromSssBase
        + Math.max(0, resolution.amount - resolution.sssIncludedAmount),
    );
    holidayRestDayPremiumExcludedFromPagIbigBase = roundToCents(
      holidayRestDayPremiumExcludedFromPagIbigBase
        + Math.max(0, resolution.amount - resolution.pagIbigIncludedAmount),
    );
    const appliedPolicyIds = new Set(resolution.applied.map((item) => item.policyId));
    for (const policy of resolution.policies) {
      if (appliedPolicyIds.has(policy.policyId)) {
        holidayRestDayPremiumPolicyTrace.set(policy.policyId, policy);
      }
    }
    holidayRestDayPremiumApplications.push(...resolution.applied);
    return resolution;
  }

  function applyOvertimePremium(inputSegment: {
    workDate: string;
    minutes: number;
    hourlyRate: number;
    holidayType: PayPolicyHolidayType;
    restDay: boolean;
    statutoryMultiplier: number;
    shiftCode: string | null;
    worksiteId: number | null;
  }) {
    const resolution = resolveOvertimePremium({
      organizationId: input.employee.organizationId,
      employeeId: input.employee.id,
      orgUnitIds: input.payPolicyOrgUnitIds ?? [],
      workDate: inputSegment.workDate,
      minutes: inputSegment.minutes,
      hourlyRate: inputSegment.hourlyRate,
      holidayType: inputSegment.holidayType,
      restDay: inputSegment.restDay,
      statutoryMultiplier: inputSegment.statutoryMultiplier,
      shiftCode: inputSegment.shiftCode,
      worksiteId: inputSegment.worksiteId,
      policies: input.payPolicies ?? [],
      rules: input.payPolicyRules ?? [],
    });

    overtimePremiumPay = roundToCents(overtimePremiumPay + resolution.amount);
    overtimePremiumTaxable = roundToCents(
      overtimePremiumTaxable + resolution.taxableAmount,
    );
    overtimePremiumExcludedFromSssBase = roundToCents(
      overtimePremiumExcludedFromSssBase
        + Math.max(0, resolution.amount - resolution.sssIncludedAmount),
    );
    overtimePremiumExcludedFromPagIbigBase = roundToCents(
      overtimePremiumExcludedFromPagIbigBase
        + Math.max(0, resolution.amount - resolution.pagIbigIncludedAmount),
    );
    const appliedPolicyIds = new Set(resolution.applied.map((item) => item.policyId));
    for (const policy of resolution.policies) {
      if (appliedPolicyIds.has(policy.policyId)) {
        overtimePremiumPolicyTrace.set(policy.policyId, policy);
      }
    }
    overtimePremiumApplications.push(...resolution.applied);
    return resolution;
  }

  function applyNightDifferentialPremium(inputSegment: {
    workDate: string;
    minutes: number;
    hourlyRate: number;
    holidayType: PayPolicyHolidayType;
    restDay: boolean;
    overtime: boolean;
    statutoryMultiplier: number;
    shiftCode: string | null;
    worksiteId: number | null;
  }) {
    const resolution = resolveNightDifferentialPremium({
      organizationId: input.employee.organizationId,
      employeeId: input.employee.id,
      orgUnitIds: input.payPolicyOrgUnitIds ?? [],
      workDate: inputSegment.workDate,
      minutes: inputSegment.minutes,
      hourlyRate: inputSegment.hourlyRate,
      holidayType: inputSegment.holidayType,
      restDay: inputSegment.restDay,
      overtime: inputSegment.overtime,
      statutoryMultiplier: inputSegment.statutoryMultiplier,
      shiftCode: inputSegment.shiftCode,
      worksiteId: inputSegment.worksiteId,
      policies: input.payPolicies ?? [],
      rules: input.payPolicyRules ?? [],
    });

    nightDifferentialPremiumPay = roundToCents(
      nightDifferentialPremiumPay + resolution.amount,
    );
    nightDifferentialPremiumTaxable = roundToCents(
      nightDifferentialPremiumTaxable + resolution.taxableAmount,
    );
    nightDifferentialPremiumExcludedFromSssBase = roundToCents(
      nightDifferentialPremiumExcludedFromSssBase
        + Math.max(0, resolution.amount - resolution.sssIncludedAmount),
    );
    nightDifferentialPremiumExcludedFromPagIbigBase = roundToCents(
      nightDifferentialPremiumExcludedFromPagIbigBase
        + Math.max(0, resolution.amount - resolution.pagIbigIncludedAmount),
    );
    const appliedPolicyIds = new Set(resolution.applied.map((item) => item.policyId));
    for (const policy of resolution.policies) {
      if (appliedPolicyIds.has(policy.policyId)) {
        nightDifferentialPremiumPolicyTrace.set(policy.policyId, policy);
      }
    }
    nightDifferentialPremiumApplications.push(...resolution.applied);
    return resolution;
  }

    const eligiblePunches = input.punches.filter((punch) => String(punch.workDate) >= employmentStart);
  const punchesByWorkDate = new Map<string, Array<typeof timePunches.$inferSelect>>();
  for (const punch of eligiblePunches) {
    const workDate = String(punch.workDate);
    punchesByWorkDate.set(workDate, [...(punchesByWorkDate.get(workDate) ?? []), punch]);
  }
  const workforceSegmentByPunchId = new Map<number, ResolvedDailySchedule["segments"][number]>();
  for (const [workDate, datePunches] of punchesByWorkDate) {
    const resolution = matchPunchesToWorkforceSegments({
      date: workDate,
      schedule: input.resolvedSchedules?.[workDate],
      punches: datePunches.map((punch) => ({
        id: punch.id,
        timeIn: punch.timeIn,
      })),
    });
    for (const [punchId, segment] of resolution.segmentByPunchId) {
      workforceSegmentByPunchId.set(punchId, segment);
    }
    if (resolution.exception) {
      flags.push(resolution.exception);
      punchNotes.push(resolution.exception);
    }
  }

  const attendanceCalendarDates = new Set<string>();
  const payableTimeTrace: Array<{
    punchId: number;
    sourceWorkDate: string;
    calendarDate: string;
    start: string;
    end: string;
    minutes: number;
    overtime: boolean;
    night: boolean;
    pricingMode: "calendar-segment" | "legacy-fallback";
    holiday: string | null;
    holidayLabel: string | null;
    restDay: boolean | null;
    multiplier: number | null;
  }> = [];
  const segmentedPremiumNotes = new Map<string, {
    date: string;
    label: string;
    multiplier: number;
    minutes: number;
    extra: number;
  }>();

  for (const punch of eligiblePunches) {
    const workDate = String(punch.workDate);
    const scheduledSegment = workforceSegmentByPunchId.get(punch.id);
    const shiftForPunch = {
      start: scheduledSegment?.startTime ?? punch.shiftStart,
      end: scheduledSegment?.endTime ?? punch.shiftEnd,
      breakMinutes: scheduledSegment?.breakMinutes ?? 60,
      spansMidnight: scheduledSegment?.spansMidnight,
    };
    const derived = deriveClockHours(
      {
        timeIn: punch.timeIn ? toLocalIso(new Date(punch.timeIn)) : null,
        timeOut: punch.timeOut ? toLocalIso(new Date(punch.timeOut)) : null,
        breakStart: punch.breakStart ? toLocalIso(new Date(punch.breakStart)) : null,
        breakEnd: punch.breakEnd ? toLocalIso(new Date(punch.breakEnd)) : null,
      },
      {
        start: shiftForPunch.start,
        end: shiftForPunch.end,
        breakMinutes: shiftForPunch.breakMinutes,
        graceMinutes: 5,
      },
    );
    const punchProfile = profileForDate(timeline, workDate);
    const segmentation = segmentPayableTime({
      punch: {
        id: punch.id,
        workDate,
        timeIn: punch.timeIn,
        timeOut: punch.timeOut,
        breakStart: punch.breakStart,
        breakEnd: punch.breakEnd,
      },
      shift: shiftForPunch,
    });
    for (const date of segmentation.attendanceCalendarDates) {
      attendanceCalendarDates.add(date);
    }

    const segmentedWorkedMinutes = segmentation.segments.reduce(
      (sum, segment) => sum + segment.minutes,
      0,
    );
    const useSegmentedPricing =
      segmentation.allocationComplete
      && segmentation.segments.length > 0
      && segmentedWorkedMinutes === derived.workedMinutes;

    if (
      segmentation.allocationComplete
      && segmentation.segments.length > 0
      && segmentedWorkedMinutes !== derived.workedMinutes
    ) {
      const message =
        `${workDate}: payable-time segmentation produced ${segmentedWorkedMinutes} worked minute(s), but attendance derivation produced ${derived.workedMinutes}; calendar-boundary pricing was not applied.`;
      flags.push(message);
      punchNotes.push(message);
    }
    const premiumEvidenceFlags = payableTimeEvidenceFlagsForPayroll(
      segmentation,
      derived.workedMinutes,
    );
    if (premiumEvidenceFlags.length > 0) {
      const message = `${workDate}: ${premiumEvidenceFlags.join("; ")}`;
      flags.push(message);
      punchNotes.push(message);
    }

    const segmentedRegularMinutes = useSegmentedPricing
      ? segmentation.segments
          .filter((segment) => !segment.overtime)
          .reduce((sum, segment) => sum + segment.minutes, 0)
      : Math.max(0, derived.workedMinutes - derived.overtimeMinutes);
    const segmentedOvertimeMinutes = useSegmentedPricing
      ? segmentation.segments
          .filter((segment) => segment.overtime)
          .reduce((sum, segment) => sum + segment.minutes, 0)
      : derived.overtimeMinutes;
    const segmentedNightMinutes = useSegmentedPricing
      ? segmentation.segments
          .filter((segment) => segment.night)
          .reduce((sum, segment) => sum + segment.minutes, 0)
      : derived.nightDifferentialMinutes;

    if (segmentedOvertimeMinutes > 0 || segmentedNightMinutes > 0) {
      mealAllowanceEligibleWorkDates.add(workDate);
    }

    regularMinutes += segmentedRegularMinutes;
    overtimeMinutes += segmentedOvertimeMinutes;
    overtimeMinutesByWorkDate.set(
      workDate,
      (overtimeMinutesByWorkDate.get(workDate) ?? 0) + segmentedOvertimeMinutes,
    );
    nightMinutes += segmentedNightMinutes;
    tardinessMinutes += derived.tardinessMinutes;
    undertimeMinutes += derived.undertimeMinutes;

    if (useSegmentedPricing) {
      for (const segment of segmentation.segments) {
        const holidayContext = holidayPayContextOn(
          segment.calendarDate,
          input.holidayCalendar ?? NATIONAL_HOLIDAYS_2026,
        );
        const restDay = restDayForDate(
          input.employee.restDay,
          input.restDayRevisions ?? [],
          segment.calendarDate,
        );
        const legacyIsRestDay = isRestDayOfWeek(segment.calendarDate, restDay);
        const isRestDay = payrollRestDayFromSchedule(
          input.resolvedSchedules?.[segment.calendarDate],
          legacyIsRestDay,
        );
        const multiplier = holidayMultiplier({
          holiday: holidayContext.holiday,
          worked: true,
          overtime: segment.overtime,
          restDay: isRestDay,
        });
        const hours = segment.minutes / 60;
        const segmentSchedule =
          input.resolvedSchedules?.[segment.calendarDate]
          ?? input.resolvedSchedules?.[workDate];
        applyWorkedTimePremium({
          workDate: segment.calendarDate,
          minutes: segment.minutes,
          hourlyRate: punchProfile.hourlyRate,
          shiftCode: scheduledSegment?.shiftCode ?? null,
          worksiteId: segmentSchedule?.worksiteId ?? null,
        });

        if (segment.overtime) {
          applyOvertimePremium({
            workDate: segment.calendarDate,
            minutes: segment.minutes,
            hourlyRate: punchProfile.hourlyRate,
            holidayType: holidayContext.holiday as PayPolicyHolidayType,
            restDay: isRestDay,
            statutoryMultiplier: multiplier,
            shiftCode: scheduledSegment?.shiftCode ?? null,
            worksiteId: segmentSchedule?.worksiteId ?? null,
          });
          overtimePay += hours * punchProfile.hourlyRate * multiplier;
        } else {
          applyHolidayRestDayPremium({
            workDate: segment.calendarDate,
            minutes: segment.minutes,
            hourlyRate: punchProfile.hourlyRate,
            holidayType: holidayContext.holiday as PayPolicyHolidayType,
            restDay: isRestDay,
            statutoryMultiplier: multiplier,
            shiftCode: scheduledSegment?.shiftCode ?? null,
            worksiteId: segmentSchedule?.worksiteId ?? null,
          });

          if (punchProfile.payBasis !== "monthly") {
            workedBasicPay += hours * punchProfile.hourlyRate;
          }
          const extra =
            hours * punchProfile.hourlyRate * Math.max(0, multiplier - 1);
          holidayPremium += extra;

          if ((holidayContext.holidays.length > 0 || isRestDay) && extra > 0) {
            const dayLabel = holidayContext.label
              ? `${holidayContext.label}${isRestDay ? ", rest day" : ""}`
              : "rest day";
            const key = `${segment.calendarDate}|${dayLabel}|${multiplier}`;
            const existing = segmentedPremiumNotes.get(key);
            segmentedPremiumNotes.set(key, {
              date: segment.calendarDate,
              label: dayLabel,
              multiplier,
              minutes: (existing?.minutes ?? 0) + segment.minutes,
              extra: (existing?.extra ?? 0) + extra,
            });
          }
        }

        if (segment.night) {
          applyNightDifferentialPremium({
            workDate: segment.calendarDate,
            minutes: segment.minutes,
            hourlyRate: punchProfile.hourlyRate,
            holidayType: holidayContext.holiday as PayPolicyHolidayType,
            restDay: isRestDay,
            overtime: segment.overtime,
            statutoryMultiplier: multiplier,
            shiftCode: scheduledSegment?.shiftCode ?? null,
            worksiteId: segmentSchedule?.worksiteId ?? null,
          });
          nightDiffPay += hours * punchProfile.hourlyRate * multiplier * 0.1;
        }

        payableTimeTrace.push({
          ...segment,
          pricingMode: "calendar-segment",
          holiday: holidayContext.holiday,
          holidayLabel: holidayContext.label ?? null,
          restDay: isRestDay,
          multiplier,
        });
      }
    } else {
      const touchedPremiumDates =
        segmentation.attendanceCalendarDates.length > 0
          ? segmentation.attendanceCalendarDates
          : [workDate];
      if (touchedPremiumDates.length <= 1) {
        applyWorkedTimePremium({
          workDate,
          minutes: derived.workedMinutes,
          hourlyRate: punchProfile.hourlyRate,
          shiftCode: scheduledSegment?.shiftCode ?? null,
          worksiteId: input.resolvedSchedules?.[workDate]?.worksiteId ?? null,
        });
      } else {
        const premiumRuleCouldApply = touchedPremiumDates.some((date) => {
          const probe = resolveWorkedTimePremium({
            organizationId: input.employee.organizationId,
            employeeId: input.employee.id,
            orgUnitIds: input.payPolicyOrgUnitIds ?? [],
            workDate: date,
            minutes: 60,
            hourlyRate: punchProfile.hourlyRate,
            shiftCode: scheduledSegment?.shiftCode ?? null,
            worksiteId:
              input.resolvedSchedules?.[date]?.worksiteId
              ?? input.resolvedSchedules?.[workDate]?.worksiteId
              ?? null,
            policies: input.payPolicies ?? [],
            rules: input.payPolicyRules ?? [],
          });
          return probe.applied.length > 0;
        });
        if (premiumRuleCouldApply) {
          const message =
            `${workDate}: configurable company premium was not executed because cross-midnight payable-time allocation is incomplete. Correct the attendance/break evidence before release so the effective-dated premium is not guessed.`;
          flags.push(message);
          punchNotes.push(message);
        }

        const holidayRestRuleCouldApply = touchedPremiumDates.some((date) => {
          const dateHolidayContext = holidayPayContextOn(
            date,
            input.holidayCalendar ?? NATIONAL_HOLIDAYS_2026,
          );
          const dateRestDay = restDayForDate(
            input.employee.restDay,
            input.restDayRevisions ?? [],
            date,
          );
          const dateLegacyRestDay = isRestDayOfWeek(date, dateRestDay);
          const dateIsRestDay = payrollRestDayFromSchedule(
            input.resolvedSchedules?.[date],
            dateLegacyRestDay,
          );
          const dateMultiplier = holidayMultiplier({
            holiday: dateHolidayContext.holiday,
            worked: true,
            overtime: false,
            restDay: dateIsRestDay,
          });
          const probe = resolveHolidayRestDayPremium({
            organizationId: input.employee.organizationId,
            employeeId: input.employee.id,
            orgUnitIds: input.payPolicyOrgUnitIds ?? [],
            workDate: date,
            minutes: 60,
            hourlyRate: punchProfile.hourlyRate,
            holidayType: dateHolidayContext.holiday as PayPolicyHolidayType,
            restDay: dateIsRestDay,
            statutoryMultiplier: dateMultiplier,
            shiftCode: scheduledSegment?.shiftCode ?? null,
            worksiteId:
              input.resolvedSchedules?.[date]?.worksiteId
              ?? input.resolvedSchedules?.[workDate]?.worksiteId
              ?? null,
            policies: input.payPolicies ?? [],
            rules: input.payPolicyRules ?? [],
          });
          return probe.applied.length > 0;
        });
        if (holidayRestRuleCouldApply) {
          const message =
            `${workDate}: configurable holiday/rest-day premium was not executed because cross-midnight payable-time allocation is incomplete. Correct the attendance/break evidence before release so the calendar-day premium is not guessed.`;
          flags.push(message);
          punchNotes.push(message);
        }

        if (segmentedOvertimeMinutes > 0) {
          const overtimeRuleCouldApply = touchedPremiumDates.some((date) => {
            const dateHolidayContext = holidayPayContextOn(
              date,
              input.holidayCalendar ?? NATIONAL_HOLIDAYS_2026,
            );
            const dateRestDay = restDayForDate(
              input.employee.restDay,
              input.restDayRevisions ?? [],
              date,
            );
            const dateLegacyRestDay = isRestDayOfWeek(date, dateRestDay);
            const dateIsRestDay = payrollRestDayFromSchedule(
              input.resolvedSchedules?.[date],
              dateLegacyRestDay,
            );
            const dateMultiplier = holidayMultiplier({
              holiday: dateHolidayContext.holiday,
              worked: true,
              overtime: true,
              restDay: dateIsRestDay,
            });
            const probe = resolveOvertimePremium({
              organizationId: input.employee.organizationId,
              employeeId: input.employee.id,
              orgUnitIds: input.payPolicyOrgUnitIds ?? [],
              workDate: date,
              minutes: 60,
              hourlyRate: punchProfile.hourlyRate,
              holidayType: dateHolidayContext.holiday as PayPolicyHolidayType,
              restDay: dateIsRestDay,
              statutoryMultiplier: dateMultiplier,
              shiftCode: scheduledSegment?.shiftCode ?? null,
              worksiteId:
                input.resolvedSchedules?.[date]?.worksiteId
                ?? input.resolvedSchedules?.[workDate]?.worksiteId
                ?? null,
              policies: input.payPolicies ?? [],
              rules: input.payPolicyRules ?? [],
            });
            return probe.applied.length > 0;
          });
          if (overtimeRuleCouldApply) {
            const message =
              `${workDate}: configurable overtime premium was not executed because cross-midnight payable-time allocation is incomplete. Correct the attendance/break evidence before release so the overtime policy date/classification is not guessed.`;
            flags.push(message);
            punchNotes.push(message);
          }
        }

        if (derived.nightDifferentialMinutes > 0) {
          const nightRuleCouldApply = touchedPremiumDates.some((date) => {
            const dateHolidayContext = holidayPayContextOn(
              date,
              input.holidayCalendar ?? NATIONAL_HOLIDAYS_2026,
            );
            const dateRestDay = restDayForDate(
              input.employee.restDay,
              input.restDayRevisions ?? [],
              date,
            );
            const dateLegacyRestDay = isRestDayOfWeek(date, dateRestDay);
            const dateIsRestDay = payrollRestDayFromSchedule(
              input.resolvedSchedules?.[date],
              dateLegacyRestDay,
            );
            const testContexts = [
              { overtime: false, minutes: derived.nightRegularMinutes },
              { overtime: true, minutes: derived.nightOvertimeMinutes },
            ].filter((item) => item.minutes > 0);
            return testContexts.some((item) => {
              const dateMultiplier = holidayMultiplier({
                holiday: dateHolidayContext.holiday,
                worked: true,
                overtime: item.overtime,
                restDay: dateIsRestDay,
              });
              const probe = resolveNightDifferentialPremium({
                organizationId: input.employee.organizationId,
                employeeId: input.employee.id,
                orgUnitIds: input.payPolicyOrgUnitIds ?? [],
                workDate: date,
                minutes: 60,
                hourlyRate: punchProfile.hourlyRate,
                holidayType: dateHolidayContext.holiday as PayPolicyHolidayType,
                restDay: dateIsRestDay,
                overtime: item.overtime,
                statutoryMultiplier: dateMultiplier,
                shiftCode: scheduledSegment?.shiftCode ?? null,
                worksiteId:
                  input.resolvedSchedules?.[date]?.worksiteId
                  ?? input.resolvedSchedules?.[workDate]?.worksiteId
                  ?? null,
                policies: input.payPolicies ?? [],
                rules: input.payPolicyRules ?? [],
              });
              return probe.applied.length > 0;
            });
          });
          if (nightRuleCouldApply) {
            const message =
              `${workDate}: configurable night-differential premium was not executed because cross-midnight payable-time allocation is incomplete. Correct the attendance/break evidence before release so the NSD policy date/classification is not guessed.`;
            flags.push(message);
            punchNotes.push(message);
          }
        }
      }

      if (punchProfile.payBasis !== "monthly") {
        workedBasicPay += (segmentedRegularMinutes / 60) * punchProfile.hourlyRate;
      }
      const holidayContext = holidayPayContextOn(
        workDate,
        input.holidayCalendar ?? NATIONAL_HOLIDAYS_2026,
      );
      const restDay = restDayForDate(
        input.employee.restDay,
        input.restDayRevisions ?? [],
        workDate,
      );
      const legacyIsRestDay = isRestDayOfWeek(workDate, restDay);
      const isRestDay = payrollRestDayFromSchedule(
        input.resolvedSchedules?.[workDate],
        legacyIsRestDay,
      );
      const otMultiplier = holidayMultiplier({
        holiday: holidayContext.holiday,
        worked: true,
        overtime: true,
        restDay: isRestDay,
      });
      const regularMultiplier = holidayMultiplier({
        holiday: holidayContext.holiday,
        worked: true,
        overtime: false,
        restDay: isRestDay,
      });
      if (touchedPremiumDates.length <= 1) {
        applyHolidayRestDayPremium({
          workDate,
          minutes: segmentedRegularMinutes,
          hourlyRate: punchProfile.hourlyRate,
          holidayType: holidayContext.holiday as PayPolicyHolidayType,
          restDay: isRestDay,
          statutoryMultiplier: regularMultiplier,
          shiftCode: scheduledSegment?.shiftCode ?? null,
          worksiteId: input.resolvedSchedules?.[workDate]?.worksiteId ?? null,
        });
        applyOvertimePremium({
          workDate,
          minutes: segmentedOvertimeMinutes,
          hourlyRate: punchProfile.hourlyRate,
          holidayType: holidayContext.holiday as PayPolicyHolidayType,
          restDay: isRestDay,
          statutoryMultiplier: otMultiplier,
          shiftCode: scheduledSegment?.shiftCode ?? null,
          worksiteId: input.resolvedSchedules?.[workDate]?.worksiteId ?? null,
        });
        if (derived.nightRegularMinutes > 0) {
          applyNightDifferentialPremium({
            workDate,
            minutes: derived.nightRegularMinutes,
            hourlyRate: punchProfile.hourlyRate,
            holidayType: holidayContext.holiday as PayPolicyHolidayType,
            restDay: isRestDay,
            overtime: false,
            statutoryMultiplier: regularMultiplier,
            shiftCode: scheduledSegment?.shiftCode ?? null,
            worksiteId: input.resolvedSchedules?.[workDate]?.worksiteId ?? null,
          });
        }
        if (derived.nightOvertimeMinutes > 0) {
          applyNightDifferentialPremium({
            workDate,
            minutes: derived.nightOvertimeMinutes,
            hourlyRate: punchProfile.hourlyRate,
            holidayType: holidayContext.holiday as PayPolicyHolidayType,
            restDay: isRestDay,
            overtime: true,
            statutoryMultiplier: otMultiplier,
            shiftCode: scheduledSegment?.shiftCode ?? null,
            worksiteId: input.resolvedSchedules?.[workDate]?.worksiteId ?? null,
          });
        }
      }
      overtimePay +=
        (segmentedOvertimeMinutes / 60) * punchProfile.hourlyRate * otMultiplier;
      nightDiffPay +=
        (derived.nightRegularMinutes / 60)
          * punchProfile.hourlyRate
          * regularMultiplier
          * 0.1
        + (derived.nightOvertimeMinutes / 60)
          * punchProfile.hourlyRate
          * otMultiplier
          * 0.1;

      if (
        (holidayContext.holidays.length > 0 || isRestDay)
        && derived.workedMinutes > 0
      ) {
        const extra =
          (segmentedRegularMinutes / 60)
          * punchProfile.hourlyRate
          * (regularMultiplier - 1);
        holidayPremium += extra;
        const otNote = segmentedOvertimeMinutes > 0
          ? ` (overtime that day priced separately at ×${otMultiplier})`
          : "";
        const dayLabel = holidayContext.label
          ? `${holidayContext.label}${isRestDay ? ", rest day" : ""}`
          : "rest day";
        holidayNotes.push(
          `${workDate} ${dayLabel} ×${regularMultiplier} → +${money(extra)}${otNote}`,
        );
      }

      for (const segment of segmentation.segments) {
        payableTimeTrace.push({
          ...segment,
          pricingMode: "legacy-fallback",
          holiday: null,
          holidayLabel: null,
          restDay: null,
          multiplier: null,
        });
      }
    }

    const attendanceDeduction = attendanceDeductionsForCutoff(
      punchProfile,
      derived.tardinessMinutes,
      derived.undertimeMinutes,
    );
    tardinessDeduction += attendanceDeduction.tardinessDeduction;
    undertimeDeduction += attendanceDeduction.undertimeDeduction;
    flags.push(...derived.flags);
    if (derived.flags.length) {
      punchNotes.push(`${workDate}: ${derived.flags.join("; ")}`);
    }
  }

  for (const note of segmentedPremiumNotes.values()) {
    holidayNotes.push(
      `${note.date} ${note.label} ×${note.multiplier} · ${note.minutes} min → +${money(note.extra)}`,
    );
  }

  const overtimeRequestsByWorkDate = new Map<string, Array<OvertimeRequestEvidence>>();
  for (const request of input.overtimeRequests ?? []) {
    overtimeRequestsByWorkDate.set(
      request.workDate,
      [...(overtimeRequestsByWorkDate.get(request.workDate) ?? []), request],
    );
  }
  const overtimeAuthorizationDates = [...new Set([
    ...overtimeMinutesByWorkDate.keys(),
    ...overtimeRequestsByWorkDate.keys(),
  ])].sort();
  const overtimeAuthorizationDays = overtimeAuthorizationDates.map((workDate) => {
    const evidence = resolveOvertimeAuthorizationDay({
      actualOvertimeMinutes: overtimeMinutesByWorkDate.get(workDate) ?? 0,
      requests: overtimeRequestsByWorkDate.get(workDate) ?? [],
    });

    if (evidence.reviewRequired) {
      if (evidence.reviewReason === "missing_request") {
        flags.push(
          `${workDate}: ${evidence.actualOvertimeMinutes} overtime minute(s) were worked with no OT authorization request. Statutory overtime pay remains based on validated attendance; manager review required.`,
        );
      } else if (evidence.reviewReason === "multiple_requests") {
        flags.push(
          `${workDate}: multiple OT authorization requests exist for ${evidence.actualOvertimeMinutes} worked overtime minute(s). Statutory overtime pay remains based on validated attendance; reconcile the duplicate requests before release.`,
        );
      } else if (evidence.reviewReason === "not_approved") {
        const status = evidence.requests[0]?.status ?? "none";
        flags.push(
          `${workDate}: ${evidence.actualOvertimeMinutes} overtime minute(s) were worked but the OT request is ${status}. Statutory overtime pay remains based on validated attendance; manager review required.`,
        );
      } else if (evidence.reviewReason === "exceeds_approved_minutes") {
        flags.push(
          `${workDate}: worked overtime of ${evidence.actualOvertimeMinutes} minute(s) exceeds the approved ${evidence.authorizedMinutes} minute(s). Statutory overtime pay remains based on validated attendance; review the excess before release.`,
        );
      }
    }

    return { workDate, ...evidence };
  });

  let unworkedHolidayPay = 0;
  if (payProfile.payBasis !== "monthly") {
    const punchedDates = new Set([
      ...eligiblePunches.map((punch) => String(punch.workDate)),
      ...attendanceCalendarDates,
    ]);
    const holidayDates = [...new Set(
      (input.holidayCalendar ?? NATIONAL_HOLIDAYS_2026)
        .map((holiday) => holiday.date)
        .filter((workDate) =>
          workDate >= employmentStart
          && workDate <= input.periodEnd
          && !punchedDates.has(workDate)
        ),
    )];
    for (const holidayDate of holidayDates) {
      const calendar = input.holidayCalendar ?? NATIONAL_HOLIDAYS_2026;
      const context = holidayPayContextOn(holidayDate, calendar);
      const multiplier = holidayMultiplier({ holiday: context.holiday, worked: false });
      if (multiplier <= 0) continue;

      const precedingWorkDate = precedingScheduledWorkDate({
        holidayDate,
        currentRestDay: input.employee.restDay,
        restDayRevisions: input.restDayRevisions ?? [],
        holidayCalendar: calendar,
        employeeStartDate,
        scheduleForDate: (date) => input.resolvedSchedules?.[date],
      });
      const attended = precedingWorkDate
        ? (input.holidayEligibilityAttendanceDates ?? []).includes(precedingWorkDate)
        : false;
      const onPaidLeave = precedingWorkDate
        ? (input.holidayEligibilityPaidLeaveDates ?? []).includes(precedingWorkDate)
        : false;

      if (!precedingWorkDate || (!attended && !onPaidLeave)) {
        flags.push(
          `Unworked regular-holiday pay for ${holidayDate} was not added because eligibility on the preceding scheduled workday${precedingWorkDate ? ` (${precedingWorkDate})` : ""} is not proven by attendance or paid leave.`,
        );
        holidayNotes.push(
          `${holidayDate} ${context.label ?? "regular holiday"} unworked entitlement pending eligibility review`,
        );
        continue;
      }

      const profile = profileForDate(timeline, holidayDate);
      const amount = roundToCents(profile.dailyRate * multiplier);
      unworkedHolidayPay += amount;
      holidayNotes.push(
        `${holidayDate} ${context.label ?? "regular holiday"} unworked entitlement ×${multiplier} → +${money(amount)}; eligible via ${onPaidLeave ? "paid leave" : "attendance"} on ${precedingWorkDate}`,
      );
    }
  }

  // Monthly portions are prorated across effective-dated rate segments by
  // calendar days inside the cutoff. Daily/hourly portions come from the
  // punch date's effective rate, so a mid-cutoff change never rewrites earlier
  // worked time.
  const baseBasicPay = semiMonthlyBasic + workedBasicPay + unworkedHolidayPay;

  const approvedLeave = input.approvedLeave ?? [];
  const invalidPreEmploymentLeave = approvedLeave.find((leave) => leave.startDate < employeeStartDate);
  if (invalidPreEmploymentLeave) {
    throw new Error(
      `Approved ${invalidPreEmploymentLeave.leaveType} leave #${invalidPreEmploymentLeave.id} begins before employee #${input.employee.id}'s employment start date. Correct the leave record before calculating payroll.`,
    );
  }
  if (timeline.length > 1 && approvedLeave.length > 0) {
    for (const leave of approvedLeave) {
      const touchedSegments = timeline.filter((segment) =>
        leave.startDate <= segment.endDate && leave.endDate >= segment.startDate
      );
      if (touchedSegments.length > 1) {
        throw new Error(
          `Approved ${leave.leaveType} leave #${leave.id} crosses an effective-dated pay change. Split the leave request at the pay-change date before calculating payroll so leave pay is not guessed.`,
        );
      }
    }
  }
  const leaveNotes: string[] = [];
  for (const leave of approvedLeave) {
    leaveNotes.push(
      `Leave #${leave.id} ${leave.leaveType}: ${leave.overlapDays}d in cutoff · ${leave.paidPercentage}% paid`,
    );
    const overlappingPunches = eligiblePunches.filter((punch) =>
      leaveRangeContainsDate(leave, String(punch.workDate)),
    );
    if (overlappingPunches.length > 0) {
      flags.push(
        `Attendance overlaps approved ${leave.leaveType} leave #${leave.id} on ${overlappingPunches.map((punch) => punch.workDate).join(", ")}`,
      );
    }
  }

  const desiredLeaveAmounts = approvedLeave.map((leave) => ({
    leave,
    desiredAmount: leaveAdjustmentForCutoff({
      profile: profileForDate(
        timeline,
        leave.startDate < employmentStart ? employmentStart : leave.startDate,
      ),
      paidDays: leave.paidDays,
      unpaidDays: leave.unpaidDays,
    }),
  }));
  const desiredLeaveAdjustment = desiredLeaveAmounts.reduce((sum, item) => sum + item.desiredAmount, 0);
  const cappedLeaveAdjustment =
    payProfile.payBasis === "monthly"
      ? Math.max(-semiMonthlyBasic, Math.min(0, desiredLeaveAdjustment))
      : Math.max(0, desiredLeaveAdjustment);
  const leaveScale =
    Math.abs(desiredLeaveAdjustment) > 0.000001
      ? cappedLeaveAdjustment / desiredLeaveAdjustment
      : 1;

  if (Math.abs(cappedLeaveAdjustment - desiredLeaveAdjustment) > 0.01) {
    flags.push("Leave pay adjustment was capped to the configured cutoff pay boundary.");
  }

  const leaveLines = desiredLeaveAmounts.map(({ leave, desiredAmount }) => ({
    code: `LEAVE-${leave.id}`,
    label:
      leave.payTreatment === "paid"
        ? `Paid leave, ${leave.leaveType}`
        : leave.payTreatment === "unpaid"
          ? `Unpaid leave, ${leave.leaveType}`
          : `Partially paid leave, ${leave.leaveType}`,
    amount: money(desiredAmount * leaveScale),
    notes: [
      `${leave.overlapDays} day(s) in this cutoff`,
      `${leave.paidPercentage}% paid · ${leave.paidDays} paid day(s) · ${leave.unpaidDays} unpaid day(s)`,
    ],
  }));
  const leaveAdjustmentTotal = leaveLines.reduce((sum, line) => sum + Number(line.amount), 0);

  const wageCheck = isBelowMinimum(monthly, input.employee.region ?? "NCR", payProfile.standardWorkDaysPerMonth);
  const mweResolution = resolveMweClassification(
    input.mweClassifications ?? [],
    input.payDate,
    input.employee.mwe,
  );
  const treatAsMwe = mweResolution.isMwe;
  if (mweResolution.governanceMissing) {
    flags.push(
      "MWE tax classification is using a legacy employee flag without approved effective-dated wage-order evidence; checker approval is blocked until classification governance is completed.",
    );
  }
  if (wageCheck.below) {
    flags.push(
      `Configured pay implies ₱${wageCheck.impliedDaily.toFixed(2)}/day versus the reference wage figure of ₱${wageCheck.order.dailyRate.toFixed(2)} for ${wageCheck.order.region}. Verify the applicable wage tier; payroll did not infer MWE tax status automatically.`,
    );
  }

  let calamityPay = 0;
  const calamityNotes: string[] = [];
  for (const advisory of input.advisories) {
    if (!advisory.policy.toLowerCase().includes("hazard")) continue;
    const unitMatch = advisory.affectedUnit === "All locations"
      || input.unitName.toLowerCase().includes(advisory.affectedUnit.toLowerCase())
      || advisory.affectedUnit.toLowerCase().includes(input.unitName.toLowerCase());
    // Apply to Cebu Hub employees or when unit is unknown but advisory is active for demo org.
    if (unitMatch || input.unitName === "Operations") {
      const premium = baseBasicPay * (advisory.premiumPercent / 100);
      calamityPay += premium;
      calamityNotes.push(`${advisory.advisoryNumber}: ${advisory.policy} applied (+${advisory.premiumPercent}%)`);
    }
  }

  const retroLines = (input.retroAdjustments ?? []).map((retro) => ({
    code: `RETRO-${retro.id}`,
    label: `Retro pay, ${retro.sourcePeriodLabel}`,
    amount: money(retro.amount),
    notes: ["Effective-dated monthly pay correction from a previously released cutoff"],
    amountNum: retro.amount,
  }));
  const retroTotal = retroLines.reduce((sum, line) => sum + line.amountNum, 0);

  // Approved expense reimbursements are a non-taxable addition to pay, and
  // approved earned-wage advances are recovered here so they cannot be
  // double-drawn. Both are excluded when not supplied, keeping the engine
  // usable for runs that predate these features.
  const expenseLines = (input.expenses ?? []).map((claim) => ({
    code: `EXP-${claim.id}`,
    label: `Expense, ${claim.category}`,
    amount: money(claim.amount),
    notes: [claim.description, `incurred ${claim.incurredOn}`],
  }));
  const expenseTotal = (input.expenses ?? []).reduce((sum, claim) => sum + Number(claim.amount), 0);

  const supplementaryLines = (input.supplementaryEarnings ?? []).map((earning) => {
    const benefitPool90k = isSharedBenefitPoolEarningType(earning.earningType);
    return {
      code: earning.code ?? `EARN-${earning.id}`,
      label: earning.label,
      amount: money(earning.amount),
      notes: [
        ...(earning.notes ?? []),
        `Type: ${earning.earningType}`,
        benefitPool90k
          ? "Tax treatment: shared PHP 90,000 annual benefit pool"
          : earning.taxable
            ? "Tax treatment: taxable"
            : "Tax treatment: non-taxable",
        earning.includeInSssBase ? "Included in SSS contribution base" : "Excluded from SSS contribution base",
        earning.includeInPagIbigBase ? "Included in Pag-IBIG contribution base" : "Excluded from Pag-IBIG contribution base",
      ],
      amountNum: Math.max(0, Number(earning.amount) || 0),
      taxable: Boolean(earning.taxable),
      benefitPool90k,
      benefitPoolKind: earning.earningType,
      includeInSssBase: Boolean(earning.includeInSssBase),
      includeInPagIbigBase: Boolean(earning.includeInPagIbigBase),
    };
  });
  const supplementaryTotal = supplementaryLines.reduce((sum, line) => sum + line.amountNum, 0);
  const supplementaryBenefitPool90k = supplementaryLines.reduce(
    (sum, line) => sum + (line.benefitPool90k ? line.amountNum : 0),
    0,
  );
  const supplementaryOrdinaryTaxableTotal = supplementaryLines.reduce(
    (sum, line) => sum + (line.taxable && !line.benefitPool90k ? line.amountNum : 0),
    0,
  );
  const supplementaryNonTaxableOutsidePool = supplementaryLines.reduce(
    (sum, line) => sum + (!line.taxable && !line.benefitPool90k ? line.amountNum : 0),
    0,
  );
  const supplementaryExcludedFromSssBase = supplementaryLines.reduce(
    (sum, line) => sum + (!line.includeInSssBase ? line.amountNum : 0),
    0,
  );
  const supplementaryExcludedFromPagIbigBase = supplementaryLines.reduce(
    (sum, line) => sum + (!line.includeInPagIbigBase ? line.amountNum : 0),
    0,
  );

  const requestedAdvanceLines = (input.advances ?? []).map((advance) => ({
    id: advance.id,
    code: `EWA-${advance.id}`,
    label: "Earned wage advance recovery",
    requestedDeduction: roundToCents(Number(advance.requestedAmount) + Number(advance.fee)),
    notes: [`advance ${advance.requestedAmount} + fee ${advance.fee}`],
  }));
  const advanceRequestedTotal = requestedAdvanceLines.reduce((sum, line) => sum + line.requestedDeduction, 0);

  // RR 29-2025 ceilings apply once per statutory benefit category. Imported
  // payroll history from older versions has no category-level de minimis
  // breakdown, so a current de minimis grant cannot be safely calculated
  // against that unknown prior-period consumption.
  if (input.importedPayrollHistoryBeforeCutoff && (input.deMinimis?.length ?? 0) > 0) {
    flags.push(
      "Imported payroll history exists earlier in this tax year but has no de minimis category breakdown. De minimis tax treatment cannot be proven safely; import the category totals or resolve this employee outside Linaw before release.",
    );
  }

  const deMinimisLines = aggregateDeMinimisForSemiMonthly(
    input.deMinimis ?? [],
    input.priorDeMinimisPaid ?? {},
    input.payDate,
    { mealEligibleDays: mealAllowanceEligibleWorkDates.size },
  ).map((group) => ({
    code: `DM-${group.benefitType}`,
    label: `De minimis, ${group.label}`,
    amount: money(group.semiMonthlyGranted),
    notes: [
      `Aggregated grant ids: ${group.grantIds.join(", ")}`,
      `${group.statutoryPeriod} ceiling ₱${group.statutoryPeriodCeiling.toFixed(2)}`,
      `paid earlier in this ${group.statutoryPeriod}: ₱${group.priorPaidInStatutoryPeriod.toFixed(2)}`,
      ...("eligibleDays" in group
        ? [
            `eligible OT/night days: ${group.eligibleDays}`,
            `verified daily minimum wage basis: ₱${Number(group.dailyMinimumWage ?? 0).toFixed(2)}`,
            `30% daily meal ceiling: ₱${Number(group.dailyCeiling ?? 0).toFixed(2)}`,
            `wage order/reference: ${group.basisWageOrder ?? "not supplied"}`,
          ]
        : []),
      `exempt this cutoff ₱${group.semiMonthlyExempt.toFixed(2)}`,
      `other-benefits pool excess this period ₱${group.semiMonthlyOtherBenefitsPool.toFixed(2)}`,
    ],
    periodAmount: group.semiMonthlyGranted,
    periodOtherBenefitsPool: group.semiMonthlyOtherBenefitsPool,
  }));
  const deMinimisTotal = deMinimisLines.reduce((sum, line) => sum + line.periodAmount, 0);
  const deMinimisOtherBenefitsPool = deMinimisLines.reduce((sum, line) => sum + line.periodOtherBenefitsPool, 0);
  const deMinimisExemptTotal = roundToCents(Math.max(0, deMinimisTotal - deMinimisOtherBenefitsPool));
  const currentBenefitPool90k = roundToCents(
    supplementaryBenefitPool90k + deMinimisOtherBenefitsPool,
  );
  const benefitPoolTreatment = sharedBenefitPoolCutoffTreatment({
    priorPool: input.priorBenefitPool90k ?? 0,
    currentPool: currentBenefitPool90k,
  });

  if (input.importedPayrollHistoryBeforeCutoff && currentBenefitPool90k > 0) {
    flags.push(
      "Imported payroll history exists earlier in this tax year but does not identify the shared PHP 90,000 13th-month/other-benefits pool consumed before Linaw. Current benefit-pool withholding cannot be proven safely; import verified YTD benefit-pool totals or resolve this employee outside Linaw before release.",
    );
  }

  // Leave Cash Conversions (monetization of vacation / service incentive leaves)
  const conversionLines = (input.leaveConversions ?? []).map((conv) => ({
    code: `LEAVE_CONV-${conv.id}`,
    label: `Leave Conversion (${conv.leaveType} ${conv.daysConverted}d)`,
    amount: money(conv.cashAmount),
    notes: [
      `${conv.daysConverted} days @ daily rate ₱${conv.dailyRate}`,
      conv.taxExempt ? "Tax treatment: exempt" : "Tax treatment: taxable",
    ],
    amountNum: conv.cashAmount,
    taxExempt: conv.taxExempt,
  }));
  const conversionTotal = conversionLines.reduce((sum, c) => sum + c.amountNum, 0);
  const conversionTaxExemptTotal = conversionLines.reduce(
    (sum, c) => sum + (c.taxExempt ? c.amountNum : 0),
    0,
  );

  const companyPremiumLineGroups = new Map<number, {
    application: AppliedWorkedTimePremiumRule;
    minutes: number;
    amount: number;
  }>();
  for (const application of companyPremiumApplications) {
    const existing = companyPremiumLineGroups.get(application.ruleId);
    companyPremiumLineGroups.set(application.ruleId, {
      application,
      minutes: (existing?.minutes ?? 0) + application.minutes,
      amount: roundToCents((existing?.amount ?? 0) + application.amount),
    });
  }
  const companyPremiumLines = [...companyPremiumLineGroups.values()]
    .sort((a, b) => a.application.policyId - b.application.policyId || a.application.ruleId - b.application.ruleId)
    .map(({ application, minutes, amount }) => ({
      code: `PREM-${application.ruleId}`,
      label: `Company premium, ${application.label}`,
      amount: money(amount),
      notes: [
        `Policy ${application.policyCode} v${application.policyVersion} · rule ${application.ruleKey}`,
        `${minutes} worked minute(s)`,
        `Taxable: ${application.taxable ? "yes" : "no"} · SSS base: ${application.includeInSssBase ? "included" : "excluded"} · Pag-IBIG base: ${application.includeInPagIbigBase ? "included" : "excluded"}`,
      ],
    }));
  const companyPremiumNonTaxable = roundToCents(
    Math.max(0, companyPremiumPay - companyPremiumTaxable),
  );

  const holidayRestDayPremiumLineGroups = new Map<number, {
    application: AppliedHolidayRestDayPremiumRule;
    minutes: number;
    amount: number;
  }>();
  for (const application of holidayRestDayPremiumApplications) {
    const existing = holidayRestDayPremiumLineGroups.get(application.ruleId);
    holidayRestDayPremiumLineGroups.set(application.ruleId, {
      application,
      minutes: (existing?.minutes ?? 0) + application.minutes,
      amount: roundToCents((existing?.amount ?? 0) + application.amount),
    });
  }
  const holidayRestDayPremiumLines = [...holidayRestDayPremiumLineGroups.values()]
    .sort((a, b) => a.application.policyId - b.application.policyId || a.application.ruleId - b.application.ruleId)
    .map(({ application, minutes, amount }) => ({
      code: `DAYPREM-${application.ruleId}`,
      label: `Holiday/rest-day policy premium, ${application.label}`,
      amount: money(amount),
      notes: [
        `Policy ${application.policyCode} v${application.policyVersion} · rule ${application.ruleKey}`,
        `${minutes} regular worked minute(s) · ${application.holidayType}${application.restDay ? " + rest day" : ""} · statutory ×${application.statutoryMultiplier}`,
        `Company top-up: +${application.additionalPremiumPercent}% of base hourly pay; OT and NSD remain statutory-only in this rule family`,
        `Taxable: ${application.taxable ? "yes" : "no"} · SSS base: ${application.includeInSssBase ? "included" : "excluded"} · Pag-IBIG base: ${application.includeInPagIbigBase ? "included" : "excluded"}`,
      ],
    }));
  const holidayRestDayPremiumNonTaxable = roundToCents(
    Math.max(0, holidayRestDayPremiumPay - holidayRestDayPremiumTaxable),
  );

  const overtimePremiumLineGroups = new Map<number, {
    application: AppliedOvertimePremiumRule;
    minutes: number;
    amount: number;
  }>();
  for (const application of overtimePremiumApplications) {
    const existing = overtimePremiumLineGroups.get(application.ruleId);
    overtimePremiumLineGroups.set(application.ruleId, {
      application,
      minutes: (existing?.minutes ?? 0) + application.minutes,
      amount: roundToCents((existing?.amount ?? 0) + application.amount),
    });
  }
  const overtimePremiumLines = [...overtimePremiumLineGroups.values()]
    .sort((a, b) => a.application.policyId - b.application.policyId || a.application.ruleId - b.application.ruleId)
    .map(({ application, minutes, amount }) => ({
      code: `OTPREM-${application.ruleId}`,
      label: `Overtime policy premium, ${application.label}`,
      amount: money(amount),
      notes: [
        `Policy ${application.policyCode} v${application.policyVersion} · rule ${application.ruleKey}`,
        `${minutes} overtime minute(s) · ${application.holidayType}${application.restDay ? " + rest day" : ""} · statutory OT ×${application.statutoryMultiplier}`,
        `Company top-up: +${application.additionalPremiumPercent}% of base hourly pay; statutory OT remains authoritative and authorization remains separate evidence`,
        `Taxable: ${application.taxable ? "yes" : "no"} · SSS base: ${application.includeInSssBase ? "included" : "excluded"} · Pag-IBIG base: ${application.includeInPagIbigBase ? "included" : "excluded"}`,
      ],
    }));
  const overtimePremiumNonTaxable = roundToCents(
    Math.max(0, overtimePremiumPay - overtimePremiumTaxable),
  );

  const nightDifferentialPremiumLineGroups = new Map<number, {
    application: AppliedNightDifferentialPremiumRule;
    minutes: number;
    amount: number;
  }>();
  for (const application of nightDifferentialPremiumApplications) {
    const existing = nightDifferentialPremiumLineGroups.get(application.ruleId);
    nightDifferentialPremiumLineGroups.set(application.ruleId, {
      application,
      minutes: (existing?.minutes ?? 0) + application.minutes,
      amount: roundToCents((existing?.amount ?? 0) + application.amount),
    });
  }
  const nightDifferentialPremiumLines = [...nightDifferentialPremiumLineGroups.values()]
    .sort((a, b) => a.application.policyId - b.application.policyId || a.application.ruleId - b.application.ruleId)
    .map(({ application, minutes, amount }) => ({
      code: `NDPREM-${application.ruleId}`,
      label: `Night differential policy premium, ${application.label}`,
      amount: money(amount),
      notes: [
        `Policy ${application.policyCode} v${application.policyVersion} · rule ${application.ruleKey}`,
        `${minutes} night minute(s) · ${application.holidayType}${application.restDay ? " + rest day" : ""}${application.overtime ? " + overtime" : ""} · statutory base ×${application.statutoryMultiplier}`,
        `Statutory NSD remains 10%; company top-up adds +${application.additionalDifferentialPercent}% of the same adjusted hourly base`,
        `Taxable: ${application.taxable ? "yes" : "no"} · SSS base: ${application.includeInSssBase ? "included" : "excluded"} · Pag-IBIG base: ${application.includeInPagIbigBase ? "included" : "excluded"}`,
      ],
    }));
  const nightDifferentialPremiumNonTaxable = roundToCents(
    Math.max(0, nightDifferentialPremiumPay - nightDifferentialPremiumTaxable),
  );

  // Employee loans are lower-priority than statutory/tax deductions. Government
  // loan amortizations are attempted before company/other loans; anything that
  // cannot fit in available net pay is carried forward instead of disappearing
  // behind a max(0, net) clamp.
  const requestedLoanLines = (input.loans ?? [])
    .flatMap((loan) => {
      // Existing databases may contain schedules created before the loan
      // API enforced positive centavos. Never let a negative cutoff become
      // an accidental credit to net wages or a malformed amount be settled.
      if (!validPayrollLoanSchedule(loan)) {
        flags.push(
          `PAYROLL_LOAN_SCHEDULE_INVALID: Loan #${loan.id} (${loan.loanType}) has an invalid deduction or balance. No loan deduction applied; pause and reconcile the schedule before payroll release.`,
        );
        return [] as Array<{
          id: number; loanType: string; referenceNo: string;
          cutoffDeduction: number; remainingBalance: number;
          requestedDeduction: number; governmentPriority: number;
        }>;
      }
      return [{
        ...loan,
        requestedDeduction: Math.min(loan.cutoffDeduction, loan.remainingBalance),
        governmentPriority: /sss|pag-?ibig|hdmf|calamity/i.test(loan.loanType) ? 0 : 1,
      }];
    })
    .sort((a, b) => a.governmentPriority - b.governmentPriority || a.id - b.id);

  const gross = Math.max(
    0,
    baseBasicPay
      + leaveAdjustmentTotal
      + overtimePay
      + nightDiffPay
      + nightDifferentialPremiumPay
      + calamityPay
      + holidayPremium
      + holidayRestDayPremiumPay
      + overtimePremiumPay
      + companyPremiumPay
      + retroTotal
      + expenseTotal
      + supplementaryTotal
      + deMinimisTotal
      + conversionTotal,
  );

  // SSS uses total actual remuneration; Pag-IBIG monthly compensation includes
  // basic salary and allowances. First cutoffs retain the product's 50/50
  // estimate. On a month-final cutoff, a released earlier cutoff becomes the
  // ledger baseline and the current deduction is a true-up to the actual
  // month-to-date obligation. A new hire who begins in the final cutoff has no
  // earlier obligation, so the current earned remuneration is used directly.
  const sssCutoffRemuneration = Math.max(
    0,
    gross
      - expenseTotal
      - supplementaryExcludedFromSssBase
      - companyPremiumExcludedFromSssBase
      - holidayRestDayPremiumExcludedFromSssBase
      - overtimePremiumExcludedFromSssBase
      - nightDifferentialPremiumExcludedFromSssBase,
  );
  const pagIbigCutoffCompensation = Math.max(
    0,
    gross
      - expenseTotal
      - supplementaryExcludedFromPagIbigBase
      - companyPremiumExcludedFromPagIbigBase
      - holidayRestDayPremiumExcludedFromPagIbigBase
      - overtimePremiumExcludedFromPagIbigBase
      - nightDifferentialPremiumExcludedFromPagIbigBase,
  );
  const priorStatutory = input.priorStatutory ?? {
    sssRemuneration: 0,
    pagIbigCompensation: 0,
    sssEmployee: 0,
    philHealthEmployee: 0,
    pagIbigEmployee: 0,
    pagIbigVoluntaryEmployee: 0,
    sssEmployer: 0,
    sssEmployerEc: 0,
    philHealthEmployer: 0,
    pagIbigEmployer: 0,
  };
  const newHireInCurrentCutoff = employeeStartDate >= input.periodStart;
  const hasPriorMonthStatutory =
    priorStatutory.sssRemuneration > 0 || priorStatutory.pagIbigCompensation > 0;
  const canTrueUpActualMonth =
    Boolean(input.isFinalCutoffOfMonth)
    && (hasPriorMonthStatutory || newHireInCurrentCutoff);

  const statutoryMonthlySssCompensation = roundToCents(
    canTrueUpActualMonth
      ? priorStatutory.sssRemuneration + sssCutoffRemuneration
      : sssCutoffRemuneration * 2,
  );
  const statutoryMonthlyPagIbigCompensation = roundToCents(
    canTrueUpActualMonth
      ? priorStatutory.pagIbigCompensation + pagIbigCutoffCompensation
      : pagIbigCutoffCompensation * 2,
  );
  const sssRule = computeSss(statutoryMonthlySssCompensation, input.payDate);
  const philHealthRule = computePhilHealth(monthly, input.payDate);
  const pagIbigRule = computePagIbig(statutoryMonthlyPagIbigCompensation, input.payDate);

  const isSecondCutoff = Number(input.periodStart.slice(8, 10)) >= 16;
  const timing =
    input.statutoryDeductionTiming === "first_cutoff"
      || input.statutoryDeductionTiming === "second_cutoff"
      ? input.statutoryDeductionTiming
      : "split";
  const schedule = (monthlyTarget: number, priorCollected: number) =>
    computeCutoffStatutoryDeduction({
      monthlyTarget,
      priorCollected,
      timing,
      isSecondCutoff,
    });

  const sss = schedule(sssRule.employee, priorStatutory.sssEmployee);
  const philhealth = schedule(philHealthRule.employee, priorStatutory.philHealthEmployee);
  const pagibigMandatory = schedule(pagIbigRule.employee, priorStatutory.pagIbigEmployee);
  const sssEmployer = schedule(sssRule.employer, priorStatutory.sssEmployer);
  const sssEmployerEc = schedule(sssRule.employerEC, priorStatutory.sssEmployerEc);
  const philHealthEmployer = schedule(philHealthRule.employer, priorStatutory.philHealthEmployer);
  const pagIbigEmployer = schedule(pagIbigRule.employer, priorStatutory.pagIbigEmployer);
  const voluntaryPagIbigMonthly = Math.max(0, Number(input.employee.pagIbigVoluntaryMonthly ?? 0));
  const requestedPagIbigVoluntary = schedule(
    voluntaryPagIbigMonthly,
    priorStatutory.pagIbigVoluntaryEmployee,
  );
  const statutoryReconciliationMode = canTrueUpActualMonth
    ? (hasPriorMonthStatutory ? "month-final-ledger-true-up" : "new-hire-final-cutoff-actual")
    : timing === "first_cutoff"
      ? "first-cutoff-full"
      : timing === "second_cutoff"
        ? "first-cutoff-deferred"
        : "50-50-estimate";

  // BIR: only mandatory SSS/PHIC/HDMF employee contributions reduce taxable
  // compensation. Voluntary Pag-IBIG savings must never reduce MWE taxable
  // supplementary compensation.
  const mweTaxableSupplementaryCompensation = Math.max(
    0,
    conversionTotal
      - conversionTaxExemptTotal
      + supplementaryOrdinaryTaxableTotal
      + benefitPoolTreatment.taxableCurrent
      + companyPremiumTaxable
      + holidayRestDayPremiumTaxable
      + overtimePremiumTaxable
      + nightDifferentialPremiumTaxable,
  );
  const taxableCompensation = treatAsMwe
    ? Math.max(0, mweTaxableSupplementaryCompensation - sss - philhealth - pagibigMandatory)
    : Math.max(
        0,
        gross
          - expenseTotal
          - supplementaryNonTaxableOutsidePool
          - deMinimisExemptTotal
          - benefitPoolTreatment.exemptCurrent
          - conversionTaxExemptTotal
          - companyPremiumNonTaxable
          - holidayRestDayPremiumNonTaxable
          - overtimePremiumNonTaxable
          - nightDifferentialPremiumNonTaxable
          - sss
          - philhealth
          - pagibigMandatory,
      );
  const withholding = computeSemiMonthlyWithholdingTax(taxableCompensation, false, input.payDate);
  // annualize().adjustment is taxDue - taxWithheld. A positive value is an
  // additional collection; a negative value is an employee refund. It settles
  // after the normal cutoff WHT and never changes taxable income or gross pay.
  const yearEndTaxAdjustment = roundToCents(input.yearEndTaxAdjustment?.adjustment ?? 0);

  // Money-integrity waterfall: statutory/tax/attendance deductions take
  // priority. Voluntary savings, benefit shares, wage-advance recovery, and
  // loans may use only the disposable pay left after those mandatory items.
  // An EWA is recovered all-or-nothing because its ledger has no partial
  // balance field; skipped recovery remains approved for a later payroll.
  const coreDeductions = roundToCents(
    sss
      + philhealth
      + pagibigMandatory
      + withholding
      + yearEndTaxAdjustment
      + tardinessDeduction
      + undertimeDeduction,
  );
  if (coreDeductions > gross + 0.005) {
    flags.push(
      `Mandatory/statutory and attendance deductions exceed gross pay by ₱${(coreDeductions - gross).toFixed(2)}; payroll requires reviewer correction before release.`,
    );
  }

  let disposablePay = roundToCents(Math.max(0, gross - coreDeductions));

  const pagibigVoluntary = roundToCents(Math.min(requestedPagIbigVoluntary, disposablePay));
  disposablePay = roundToCents(Math.max(0, disposablePay - pagibigVoluntary));
  if (pagibigVoluntary + 0.005 < requestedPagIbigVoluntary) {
    flags.push(
      `Voluntary Pag-IBIG deduction was limited to ₱${pagibigVoluntary.toFixed(2)}; ₱${(requestedPagIbigVoluntary - pagibigVoluntary).toFixed(2)} was not deducted because disposable pay was insufficient.`,
    );
  }

  const requestedBenefitLines = calculateBenefits(input.benefits ?? []);
  const benefitLines = requestedBenefitLines.map((line) => {
    const requested = Math.abs(line.amount);
    const deductAmount = requested <= disposablePay + 0.005 ? requested : 0;
    if (deductAmount > 0) disposablePay = roundToCents(Math.max(0, disposablePay - deductAmount));
    if (deductAmount + 0.005 < requested) {
      flags.push(
        `${line.label} employee-share deduction of ₱${requested.toFixed(2)} was deferred because disposable pay was insufficient.`,
      );
    }
    return {
      ...line,
      amount: -deductAmount,
      requestedDeduction: requested,
      deductAmount,
    };
  });
  const benefitTotal = benefitLines.reduce((sum, line) => sum + line.deductAmount, 0);

  const advanceLines = requestedAdvanceLines.map((line) => {
    const deductAmount = line.requestedDeduction <= disposablePay + 0.005
      ? line.requestedDeduction
      : 0;
    if (deductAmount > 0) disposablePay = roundToCents(Math.max(0, disposablePay - deductAmount));
    if (deductAmount + 0.005 < line.requestedDeduction) {
      flags.push(
        `Earned wage advance #${line.id} recovery of ₱${line.requestedDeduction.toFixed(2)} was deferred because disposable pay was insufficient; the advance remains outstanding.`,
      );
    }
    return {
      ...line,
      amount: money(-deductAmount),
      deductAmount,
    };
  });
  const advanceTotal = advanceLines.reduce((sum, line) => sum + line.deductAmount, 0);

  let availableForLoans = disposablePay;
  const loanLines = requestedLoanLines.map((loan) => {
    const deductAmount = Math.min(loan.requestedDeduction, availableForLoans);
    availableForLoans = roundToCents(Math.max(0, availableForLoans - deductAmount));
    if (deductAmount + 0.005 < loan.requestedDeduction) {
      flags.push(
        `${loan.loanType} deduction was limited to ₱${deductAmount.toFixed(2)} because available net pay was insufficient; ₱${(loan.requestedDeduction - deductAmount).toFixed(2)} remains for a later cutoff.`,
      );
    }
    return {
      code: `LOAN-${loan.id}`,
      label: `Loan, ${loan.loanType}`,
      amount: money(-deductAmount),
      notes: [
        `Ref: ${loan.referenceNo}`,
        `Bal: ₱${Number(loan.remainingBalance).toFixed(2)}`,
        `Requested this cutoff: ₱${loan.requestedDeduction.toFixed(2)}`,
      ],
      deductAmount,
      requestedDeduction: loan.requestedDeduction,
    };
  });
  const loanTotal = loanLines.reduce((sum, line) => sum + line.deductAmount, 0);
  const loanRequestedTotal = requestedLoanLines.reduce((sum, line) => sum + line.requestedDeduction, 0);
  const deductions = roundToCents(coreDeductions + pagibigVoluntary + benefitTotal + advanceTotal + loanTotal);
  const net = roundToCents(Math.max(0, gross - deductions));
  const status = flags.length > 0 ? "Exception" : "Ready";

  const lineItems = [
    { code: "BASIC", label: "Basic / worked pay", amount: money(baseBasicPay - unworkedHolidayPay) },
    { code: "HOLIDAY_UNWORKED", label: "Unworked regular-holiday pay", amount: money(unworkedHolidayPay), notes: holidayNotes.filter((note) => note.includes("unworked entitlement")) },
    ...leaveLines,
    { code: "OT", label: "Overtime", amount: money(overtimePay) },
    ...overtimePremiumLines,
    { code: "ND", label: "Night differential (10%)", amount: money(nightDiffPay) },
    ...nightDifferentialPremiumLines,
    { code: "HOLIDAY", label: "Holiday / rest-day premium", amount: money(holidayPremium), notes: holidayNotes },
    ...holidayRestDayPremiumLines,
    ...companyPremiumLines,
    { code: "CALAMITY", label: "Calamity / hazard premium", amount: money(calamityPay), notes: calamityNotes },
    ...retroLines.map(({ amountNum: _amountNum, ...line }) => line),
    ...conversionLines.map(({ amountNum: _amountNum, taxExempt: _taxExempt, ...c }) => c),
    { code: "SSS", label: "SSS contribution", amount: money(-sss) },
    { code: "PHIC", label: "PhilHealth contribution", amount: money(-philhealth) },
    { code: "HDMF", label: "Pag-IBIG mandatory contribution", amount: money(-pagibigMandatory) },
    { code: "HDMF_VOL", label: "Pag-IBIG voluntary contribution", amount: money(-pagibigVoluntary) },
    { code: "WHT", label: "Withholding tax", amount: money(-withholding) },
    {
      code: input.yearEndTaxAdjustment ? `YE-TAX-${input.yearEndTaxAdjustment.id}` : "YE-TAX",
      label:
        yearEndTaxAdjustment < 0
          ? `BIR year-end tax refund (${input.yearEndTaxAdjustment?.taxYear ?? ""})`
          : `BIR year-end tax collection (${input.yearEndTaxAdjustment?.taxYear ?? ""})`,
      amount: money(-yearEndTaxAdjustment),
      notes: input.yearEndTaxAdjustment
        ? [
            `Annual tax due minus tax withheld: ₱${yearEndTaxAdjustment.toFixed(2)}`,
            `Outcome: ${input.yearEndTaxAdjustment.outcome}`,
          ]
        : [],
    },
    { code: "LATE", label: "Tardiness", amount: money(-tardinessDeduction) },
    { code: "UT", label: "Undertime", amount: money(-undertimeDeduction) },
    ...expenseLines,
    ...supplementaryLines.map(({
      amountNum: _amountNum,
      taxable: _taxable,
      includeInSssBase: _includeInSssBase,
      includeInPagIbigBase: _includeInPagIbigBase,
      ...line
    }) => line),
    ...deMinimisLines.map(({ periodAmount: _periodAmount, ...line }) => line),
    ...advanceLines,
    ...loanLines.map(({ deductAmount: _deductAmount, requestedDeduction: _requestedDeduction, ...l }) => l),
    ...benefitLines.map((line) => ({
      code: line.code,
      label: `Benefit, ${line.label}`,
      amount: money(line.amount),
      notes: [line.basis, `Requested this cutoff: ₱${line.requestedDeduction.toFixed(2)}`],
    })),
  ].filter((item) => Number(item.amount) !== 0);

  const resolvedWorkforceTrace = workforceScheduleTrace(input.resolvedSchedules);
  const appliedPayPolicyTrace = new Map<number, ReturnType<typeof payPolicyTrace>[number]>();
  for (const policy of companyPremiumPolicyTrace.values()) {
    appliedPayPolicyTrace.set(policy.policyId, policy);
  }
  for (const policy of holidayRestDayPremiumPolicyTrace.values()) {
    appliedPayPolicyTrace.set(policy.policyId, policy);
  }
  for (const policy of overtimePremiumPolicyTrace.values()) {
    appliedPayPolicyTrace.set(policy.policyId, policy);
  }
  for (const policy of nightDifferentialPremiumPolicyTrace.values()) {
    appliedPayPolicyTrace.set(policy.policyId, policy);
  }
  const trace = {
    ruleVersion: PAYROLL_RULE_VERSION,
    payPolicyExecution: {
      version: "pay-rules-execution-v4",
      statutoryFloorMode: "additive-only",
      migratedRuleFamilies: [
        WORKED_TIME_PREMIUM_EVENT,
        HOLIDAY_REST_DAY_PREMIUM_EVENT,
        OVERTIME_PREMIUM_EVENT,
        NIGHT_DIFFERENTIAL_PREMIUM_EVENT,
      ],
      familyModes: {
        holidayRestDayPremium: {
          regularWorkedMinutes: "configurable-additive",
          overtime: "separate-overtime-premium-family",
          nightDifferential: "statutory-only",
          unworkedHoliday: "statutory-only",
        },
        overtimePremium: {
          overtimeMinutes: "configurable-additive",
          statutoryEntitlement: "authoritative",
          authorization: "evidence-only",
          nightDifferential: "statutory-only",
        },
        nightDifferentialPremium: {
          nightWindow: "statutory-10pm-to-6am",
          statutoryDifferentialPercent: 10,
          statutoryEntitlement: "authoritative",
          companyOverlay: "configurable-additive",
        },
      },
      appliedPolicies: [...appliedPayPolicyTrace.values()].sort((a, b) => a.policyId - b.policyId),
      appliedRules: [
        ...companyPremiumApplications,
        ...holidayRestDayPremiumApplications,
        ...overtimePremiumApplications,
        ...nightDifferentialPremiumApplications,
      ],
    },
    workforceSchedule: {
      mode: resolvedWorkforceTrace.length > 0 ? "advanced-with-legacy-fallback" : "legacy",
      days: resolvedWorkforceTrace,
    },
    payableTime: {
      version: "workforce-time-v1",
      mode:
        payableTimeTrace.length === 0
          ? "legacy"
          : payableTimeTrace.some((segment) => segment.pricingMode === "legacy-fallback")
            ? "calendar-segmented-with-fallback"
            : "calendar-segmented",
      attendanceCalendarDates: [...attendanceCalendarDates].sort(),
      segments: payableTimeTrace,
    },
    overtimeAuthorization: {
      payrollEntitlementIndependent: true,
      days: overtimeAuthorizationDays,
    },
    inputs: [
      `workforceScheduleMode=${resolvedWorkforceTrace.length > 0 ? "advanced-with-legacy-fallback" : "legacy"}`,
      `workforceScheduleDays=${resolvedWorkforceTrace.length}`,
      `payTimeline=${payTimelineTrace(timeline).join("|")}`,
      `effectivePayChanges=${Math.max(0, timeline.length - 1)}`,
      `payBasis=${payProfile.payBasis}`,
      `rateAmount=${money(payProfile.rateAmount)}`,
      `standardWorkDaysPerMonth=${payProfile.standardWorkDaysPerMonth}`,
      `standardHoursPerDay=${payProfile.standardHoursPerDay}`,
      `monthlyEquivalent=${money(monthly)}`,
      `basicRate=${monthly}`,
      `dailyRate=${money(dailyRate)}`,
      `hourlyRate=${money(hourlyRate)}`,
      `taxableCompensation=${money(taxableCompensation)}`,
      `supplementaryEarnings=${money(supplementaryTotal)}`,
      `supplementaryTaxable=${money(supplementaryOrdinaryTaxableTotal)}`,
      `supplementaryBenefitPool90k=${money(supplementaryBenefitPool90k)}`,
      `supplementaryExcludedFromSssBase=${money(supplementaryExcludedFromSssBase)}`,
      `supplementaryExcludedFromPagIbigBase=${money(supplementaryExcludedFromPagIbigBase)}`,
      `deMinimisPaid=${money(deMinimisTotal)}`,
      `deMinimisExempt=${money(deMinimisExemptTotal)}`,
      `deMinimisOtherBenefitsPool=${money(deMinimisOtherBenefitsPool)}`,
      `otNightMealEligibleDays=${mealAllowanceEligibleWorkDates.size}`,
      `priorBenefitPool90k=${money(benefitPoolTreatment.priorPool)}`,
      `currentBenefitPool90k=${money(benefitPoolTreatment.currentPool)}`,
      `benefitPoolRemainingBeforeCutoff=${money(benefitPoolTreatment.remainingExemption)}`,
      `benefitPoolExemptCurrent=${money(benefitPoolTreatment.exemptCurrent)}`,
      `benefitPoolTaxableCurrent=${money(benefitPoolTreatment.taxableCurrent)}`,
      `mweTaxableSupplementaryCompensation=${money(mweTaxableSupplementaryCompensation)}`,
      // Backward-compatible trace alias. Historically SSS/Pag-IBIG shared one
      // remuneration basis; keep the legacy key mapped to SSS remuneration so
      // older audit/report tooling remains readable while the explicit split
      // keys carry the authoritative bases.
      `statutoryMonthlyCompensation=${money(statutoryMonthlySssCompensation)}`,
      `statutoryMonthlySssCompensation=${money(statutoryMonthlySssCompensation)}`,
      `statutoryMonthlyPagIbigCompensation=${money(statutoryMonthlyPagIbigCompensation)}`,
      `statutoryReconciliation=${statutoryReconciliationMode}`,
      `priorMonthSssRemuneration=${money(priorStatutory.sssRemuneration)}`,
      `priorMonthPagIbigCompensation=${money(priorStatutory.pagIbigCompensation)}`,
      `priorSssEmployee=${money(priorStatutory.sssEmployee)}`,
      `priorPhilHealthEmployee=${money(priorStatutory.philHealthEmployee)}`,
      `priorPagIbigEmployee=${money(priorStatutory.pagIbigEmployee)}`,
      `priorPagIbigVoluntaryEmployee=${money(priorStatutory.pagIbigVoluntaryEmployee)}`,
      `priorSssEmployer=${money(priorStatutory.sssEmployer)}`,
      `priorSssEmployerEc=${money(priorStatutory.sssEmployerEc)}`,
      `priorPhilHealthEmployer=${money(priorStatutory.philHealthEmployer)}`,
      `priorPagIbigEmployer=${money(priorStatutory.pagIbigEmployer)}`,
      `sssEmployerCutoff=${money(sssEmployer)}`,
      `sssEmployerEcCutoff=${money(sssEmployerEc)}`,
      `philHealthEmployerCutoff=${money(philHealthEmployer)}`,
      `pagIbigEmployerCutoff=${money(pagIbigEmployer)}`,
      `pagIbigVoluntaryMonthly=${money(voluntaryPagIbigMonthly)}`,
      `pagIbigVoluntaryRequested=${money(requestedPagIbigVoluntary)}`,
      `pagIbigVoluntaryDeducted=${money(pagibigVoluntary)}`,
      `advanceRequested=${money(advanceRequestedTotal)}`,
      `advanceDeducted=${money(advanceTotal)}`,
      `benefitRequested=${money(requestedBenefitLines.reduce((sum, line) => sum + Math.abs(line.amount), 0))}`,
      `benefitDeducted=${money(benefitTotal)}`,
      `statutoryDeductionTiming=${timing}`,
      `loanRequested=${money(loanRequestedTotal)}`,
      `loanDeducted=${money(loanTotal)}`,
      `leaveConversionTaxExempt=${money(conversionTaxExemptTotal)}`,
      `approvedLeaveDays=${money(approvedLeave.reduce((sum, leave) => sum + leave.overlapDays, 0))}`,
      `paidLeaveDays=${money(approvedLeave.reduce((sum, leave) => sum + leave.paidDays, 0))}`,
      `unpaidLeaveDays=${money(approvedLeave.reduce((sum, leave) => sum + leave.unpaidDays, 0))}`,
      `leavePayAdjustment=${money(leaveAdjustmentTotal)}`,
      `retroPay=${money(retroTotal)}`,
      `retroAdjustments=${retroLines.length}`,
      `punches=${eligiblePunches.length}`,
      `holidayCalendarFingerprint=${input.holidayCalendarFingerprint ?? ""}`,
      `holidayEligibilityAttendanceDates=${(input.holidayEligibilityAttendanceDates ?? []).join("|")}`,
      `holidayEligibilityPaidLeaveDates=${(input.holidayEligibilityPaidLeaveDates ?? []).join("|")}`,
      `employmentStart=${employmentStart}`,
      `regularMinutes=${regularMinutes}`,
      `overtimeMinutes=${overtimeMinutes}`,
      `overtimeAuthorizationDays=${overtimeAuthorizationDays.length}`,
      `overtimeAuthorizationReviewDays=${overtimeAuthorizationDays.filter((day) => day.reviewRequired).length}`,
      `overtimeAuthorizedMinutes=${overtimeAuthorizationDays.reduce((sum, day) => sum + day.authorizedMinutes, 0)}`,
      `overtimeAuthorizationRequests=${overtimeAuthorizationDays.reduce((sum, day) => sum + day.requests.length, 0)}`,
      `nightMinutes=${nightMinutes}`,
      `companyPremium=${money(companyPremiumPay)}`,
      `companyPremiumTaxable=${money(companyPremiumTaxable)}`,
      `companyPremiumExcludedFromSssBase=${money(companyPremiumExcludedFromSssBase)}`,
      `companyPremiumExcludedFromPagIbigBase=${money(companyPremiumExcludedFromPagIbigBase)}`,
      `companyPremiumAppliedRules=${companyPremiumApplications.length}`,
      `companyPremiumAppliedPolicies=${companyPremiumPolicyTrace.size}`,
      `holidayRestDayPremium=${money(holidayRestDayPremiumPay)}`,
      `holidayRestDayPremiumTaxable=${money(holidayRestDayPremiumTaxable)}`,
      `holidayRestDayPremiumExcludedFromSssBase=${money(holidayRestDayPremiumExcludedFromSssBase)}`,
      `holidayRestDayPremiumExcludedFromPagIbigBase=${money(holidayRestDayPremiumExcludedFromPagIbigBase)}`,
      `holidayRestDayPremiumAppliedRules=${holidayRestDayPremiumApplications.length}`,
      `holidayRestDayPremiumAppliedPolicies=${holidayRestDayPremiumPolicyTrace.size}`,
      `overtimePremium=${money(overtimePremiumPay)}`,
      `overtimePremiumTaxable=${money(overtimePremiumTaxable)}`,
      `overtimePremiumExcludedFromSssBase=${money(overtimePremiumExcludedFromSssBase)}`,
      `overtimePremiumExcludedFromPagIbigBase=${money(overtimePremiumExcludedFromPagIbigBase)}`,
      `overtimePremiumAppliedRules=${overtimePremiumApplications.length}`,
      `overtimePremiumAppliedPolicies=${overtimePremiumPolicyTrace.size}`,
      `nightDifferentialPremium=${money(nightDifferentialPremiumPay)}`,
      `nightDifferentialPremiumTaxable=${money(nightDifferentialPremiumTaxable)}`,
      `nightDifferentialPremiumExcludedFromSssBase=${money(nightDifferentialPremiumExcludedFromSssBase)}`,
      `nightDifferentialPremiumExcludedFromPagIbigBase=${money(nightDifferentialPremiumExcludedFromPagIbigBase)}`,
      `nightDifferentialPremiumAppliedRules=${nightDifferentialPremiumApplications.length}`,
      `nightDifferentialPremiumAppliedPolicies=${nightDifferentialPremiumPolicyTrace.size}`,
      `tardinessMinutes=${tardinessMinutes}`,
      `undertimeMinutes=${undertimeMinutes}`,
      `sssMonthlySalaryCredit=${money(sssRule.monthlySalaryCredit)}`,
      `sssRegularMsc=${money(sssRule.regularMsc)}`,
      `sssMpfMsc=${money(sssRule.mpfMsc)}`,
      `philHealthContributionBase=${money(philHealthRule.base)}`,
      `philHealthMonthlyPremium=${money(philHealthRule.total)}`,
      `pagIbigFundSalary=${money(pagIbigRule.fundSalary)}`,
      `pagIbigEmployeeRate=${pagIbigRule.employeeRate}`,
      `withholdingTable=${input.statutoryRuleVersions.withholding}`,
      `sssRuleVersion=${input.statutoryRuleVersions.sss}`,
      `philHealthRuleVersion=${input.statutoryRuleVersions.philHealth}`,
      `pagIbigRuleVersion=${input.statutoryRuleVersions.pagIbig}`,
      `yearEndTaxAdjustmentId=${input.yearEndTaxAdjustment?.id ?? ""}`,
      `yearEndTaxAdjustment=${money(yearEndTaxAdjustment)}`,
      `yearEndTaxYear=${input.yearEndTaxAdjustment?.taxYear ?? ""}`,
      `region=${input.employee.region ?? "NCR"}`,
      `mwe=${treatAsMwe}`,
      `mweClassificationSource=${mweResolution.source}`,
      `mweClassificationId=${mweResolution.classificationId ?? ""}`,
      `mweClassificationEffectiveFrom=${mweResolution.effectiveFrom ?? ""}`,
      `mweClassificationEffectiveUntil=${mweResolution.effectiveUntil ?? ""}`,
      `mweClassificationRegion=${mweResolution.region ?? ""}`,
      `mweStatutoryMinimumWage=${mweResolution.statutoryMinimumWage ?? ""}`,
      `mweEmployeeDailyWage=${mweResolution.employeeDailyWage ?? ""}`,
      `mweWageOrderReference=${mweResolution.wageOrderReference ?? ""}`,
      `employerStatutoryCost=${money(sssEmployer + sssEmployerEc + philHealthEmployer + pagIbigEmployer)}`,
      ...holidayNotes,
      ...calamityNotes,
      ...leaveNotes,
      ...punchNotes,
    ],
    flags,
  };

  const payslipText = buildPayslipText({
    employeeName: `${input.employee.firstName} ${input.employee.lastName}`,
    employeeNo: input.employee.employeeNo,
    periodLabel: input.periodLabel,
    unitName: input.unitName,
    gross,
    deductions,
    net,
    lineItems,
    ruleVersion: PAYROLL_RULE_VERSION,
    notes: [...holidayNotes, ...calamityNotes, ...leaveNotes, ...punchNotes],
  });

  return { gross, deductions, net, status, lineItems, trace, payslipText };
}

function buildPayslipText(input: {
  employeeName: string;
  employeeNo: string;
  periodLabel: string;
  unitName: string;
  gross: number;
  deductions: number;
  net: number;
  lineItems: Array<{ code: string; label: string; amount: string; notes?: string[] }>;
  ruleVersion: string;
  notes: string[];
}) {
  const lines = [
    "%PDF-1.4",
    "1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj",
    "2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj",
    "3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj",
  ];

  const contentLines = [
    "Linaw Payslip",
    `Employee: ${input.employeeName} (${input.employeeNo})`,
    `Period: ${input.periodLabel}`,
    `Unit: ${input.unitName}`,
    `Rule version: ${input.ruleVersion}`,
    "",
    ...input.lineItems.map((item) => `${item.label}: PHP ${item.amount}`),
    "",
    `Gross: PHP ${money(input.gross)}`,
    `Deductions: PHP ${money(input.deductions)}`,
    `Net pay: PHP ${money(input.net)}`,
    "",
    ...(input.notes.length ? ["Notes:", ...input.notes] : ["Notes: none"]),
    "",
    `Traceable line items generated from approved punches and ${input.ruleVersion} rules.`,
  ];

  // Build a simple text-based PDF content stream.
  let y = 760;
  const streamParts = ["BT /F1 11 Tf 40 760 Td"];
  for (const line of contentLines) {
    const safe = line.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
    streamParts.push(`(${safe}) Tj`);
    y -= 14;
    streamParts.push("0 -14 Td");
  }
  streamParts.push("ET");
  const stream = streamParts.join("\n");
  lines.push(`4 0 obj<< /Length ${stream.length} >>stream\n${stream}\nendstream endobj`);
  lines.push("5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj");
  lines.push("xref");
  lines.push("0 6");
  lines.push("0000000000 65535 f ");
  lines.push("trailer<< /Size 6 /Root 1 0 R >>");
  lines.push("startxref");
  lines.push("0");
  lines.push("%%EOF");
  // Also include a plain-text fallback body after EOF marker for non-PDF readers in tests/exports.
  return `${lines.join("\n")}\n\n---PLAINTEXT---\n${contentLines.join("\n")}\n`;
}

export async function getPayrollJobStatus(runId: number) {
  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId));
  const [job] = await db.select().from(payrollJobs).where(eq(payrollJobs.payrollRunId, runId)).orderBy(asc(payrollJobs.id));
  return { run, job };
}
