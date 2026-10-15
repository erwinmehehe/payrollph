import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  attendanceCorrectionRequests, employeeCompensationComponents, employeeLoans,
  expenseClaims, leaveRequests, legalEntities, overtimeRequests, payrollRuns,
  supplementaryEarnings, timePunches, workforceAttendanceLockPolicies,
  workforceAttendancePeriodLocks, workforceTimesheetPolicies, workforceTimesheets,
} from "@/db/schema";
import { projectCanonicalPayrollReadOnly } from "@/lib/payroll-engine";
import { loadReadOnlyFirstPayrollPreview } from "@/lib/first-payroll-preview";
import { payrollCutoffLockForPeriod } from "@/lib/workforce-attendance-lock";
import { evaluateTimesheetPayrollGate } from "@/lib/workforce-timesheet";

/**
 * The existing preview gate validates organization identity, roles, onboarding
 * and whether the payroll engine needs complex input. This second stage removes
 * only those source blockers the *same canonical worker assembler* can now
 * reconcile. No data or response from the tentative simple estimate is used.
 */
type Input = { organizationId: number; periodStart: string; periodEnd: string; payDate: string };
type ReadOnlyReader = Pick<typeof db, "select">;

const CANONICAL_WORKER_SOURCES = new Set([
  "time punches", "employee pay revisions", "supplementary earnings",
  "leave requests", "de minimis grants", "wage advances", "employee loans",
  "historical payroll entries", "MWE classification history",
  "benefit enrollment", "recurring compensation", "retroactive adjustments",
  "leave conversions", "overtime approvals", "rest-day revisions",
  "workforce schedule assignments", "workforce schedule overrides",
  "worksite assignment history",
]);
const GLOBAL_CANONICAL_SOURCES = new Set([
  "custom pay policies", "employer-specific holidays", "previous payroll runs",
  "calamity advisories",
]);
const WORKER_PREFIX = "Full payroll-context reconciliation required: ";
const GLOBAL_SUFFIX = " is recorded.";

function supportedWorkerBlocker(blocker: string) {
  if (!blocker.startsWith(WORKER_PREFIX) || !blocker.endsWith(" is recorded for this employee.")) return false;
  const source = blocker.slice(WORKER_PREFIX.length, -" is recorded for this employee.".length);
  return CANONICAL_WORKER_SOURCES.has(source);
}
function supportedGlobalBlocker(blocker: string) {
  if (!blocker.startsWith(WORKER_PREFIX) || !blocker.endsWith(GLOBAL_SUFFIX)) return false;
  const source = blocker.slice(WORKER_PREFIX.length, -GLOBAL_SUFFIX.length);
  return GLOBAL_CANONICAL_SOURCES.has(source);
}

export async function loadCanonicalFirstPayrollPreview(input: Input, reader: ReadOnlyReader) {
  const baseline = await loadReadOnlyFirstPayrollPreview(input, reader);
  // Baseline already fails closed on multi-entity configurations. Do not
  // infer a primary employer from an unrelated or unscoped legal entity.
  const legalRows = await reader.select().from(legalEntities)
    .where(and(eq(legalEntities.organizationId, input.organizationId), eq(legalEntities.active, true)));
  const legal = legalRows.length === 1 && legalRows[0].primaryEntity ? legalRows[0] : null;

  const blockers = baseline.blockers.filter(message =>
    message !== "Resolve employee-level blockers before treating preview as ready."
    && !supportedGlobalBlocker(message),
  );
  const problems = new Map(baseline.rows.map(row => [row.employeeId,
    row.blockers.filter(message => !supportedWorkerBlocker(message)
      && message !== "Daily/hourly payroll requires approved worked-time inputs."),
  ]));

  // The preview must never resurrect amounts for a worker assigned to a
  // different legal employer. The canonical assembler filters exact employer.
  if (!legal) blockers.push("Read-only projection requires one active primary legal employer.");

  // A prior *released* cutoff is valid immutable statutory input, but a busy
  // overlapping run is not. Never ignore an in-progress or draft payroll.
  if (legal) {
    const runs = await reader.select({
      periodStart: payrollRuns.periodStart, periodEnd: payrollRuns.periodEnd,
      status: payrollRuns.status,
    }).from(payrollRuns).where(and(
      eq(payrollRuns.organizationId, input.organizationId),
      eq(payrollRuns.legalEntityId, legal.id),
      lte(payrollRuns.periodStart, input.periodEnd),
      gte(payrollRuns.periodEnd, input.periodStart),
    ));
    if (runs.some(run => !["Released", "Voided"].includes(run.status))) {
      blockers.push("An overlapping payroll run exists. Resolve or void it before previewing another run.");
    }
  }

  // Attendance approval and cutoff locking are queried through the exact same
  // read-only snapshot as the canonical calculation. No schema ensure() calls.
  const employeeIds = baseline.rows.map(row => row.employeeId);
  if (employeeIds.length > 0) {
    const [policyRows, timesheetRows, lockPolicies, lockRows, punchWorkerRows] = await Promise.all([
      reader.select().from(workforceTimesheetPolicies)
        .where(eq(workforceTimesheetPolicies.organizationId, input.organizationId)),
      reader.select().from(workforceTimesheets).where(and(
        eq(workforceTimesheets.organizationId, input.organizationId),
        inArray(workforceTimesheets.employeeId, employeeIds),
        eq(workforceTimesheets.periodStart, input.periodStart),
        eq(workforceTimesheets.periodEnd, input.periodEnd),
      )),
      reader.select().from(workforceAttendanceLockPolicies)
        .where(eq(workforceAttendanceLockPolicies.organizationId, input.organizationId)),
      reader.select().from(workforceAttendancePeriodLocks)
        .where(eq(workforceAttendancePeriodLocks.organizationId, input.organizationId)),
      reader.select({ employeeId: timePunches.employeeId }).from(timePunches).where(and(
        eq(timePunches.organizationId, input.organizationId),
        inArray(timePunches.employeeId, employeeIds),
        gte(timePunches.workDate, input.periodStart),
        lte(timePunches.workDate, input.periodEnd),
      )).groupBy(timePunches.employeeId),
    ]);
    const policy = {
      active: policyRows[0]?.active ?? true,
      enforcementMode: policyRows[0]?.enforcementMode === "block" ? "block" as const : "advisory" as const,
    };
    const latest = new Map<number, (typeof timesheetRows)[number]>();
    for (const timesheet of timesheetRows) {
      const previous = latest.get(timesheet.employeeId);
      if (!previous || timesheet.version > previous.version) {
        latest.set(timesheet.employeeId, timesheet);
      }
    }
    const gate = evaluateTimesheetPayrollGate({
      policy, employeeIds,
      latestTimesheets: [...latest.values()].map(row => ({
        employeeId: row.employeeId, status: row.status, version: row.version,
      })),
    });
    if (gate.blocking) {
      for (const employeeId of [...gate.missingEmployeeIds, ...gate.nonApprovedEmployeeIds]) {
        problems.get(employeeId)?.push("Approved timesheet required for this pay period.");
      }
    }
    // Even when policy is advisory, do not present punch-based monetary output
    // from a stale or missing timesheet as an approved payroll projection.
    if (policy.active) {
      for (const row of punchWorkerRows) {
        if (latest.get(row.employeeId)?.status !== "approved") {
          const worker = problems.get(row.employeeId);
          if (worker && !worker.includes("Approved timesheet required for this pay period.")) {
            worker.push("Approved timesheet required for this pay period.");
          }
        }
      }
    }
    if (lockPolicies[0]?.requirePayrollCutoffLock &&
      !payrollCutoffLockForPeriod(lockRows, input.periodStart, input.periodEnd)) {
      blockers.push("Attendance payroll-cutoff lock is required for this exact period.");
    }

    // Unapproved changes must not silently disappear simply because the normal
    // payroll worker consumes only approved ledger and WFM records.
    const pendingSources = [
      ["pending leave", await reader.select({employeeId: leaveRequests.employeeId, status: leaveRequests.status})
        .from(leaveRequests).where(and(eq(leaveRequests.organizationId, input.organizationId),
          inArray(leaveRequests.employeeId, employeeIds),
          lte(leaveRequests.startDate, input.periodEnd), gte(leaveRequests.endDate, input.periodStart)))],
      ["unapproved overtime", await reader.select({employeeId: overtimeRequests.employeeId, status: overtimeRequests.status})
        .from(overtimeRequests).where(and(eq(overtimeRequests.organizationId, input.organizationId),
          inArray(overtimeRequests.employeeId, employeeIds),
          gte(overtimeRequests.workDate, input.periodStart), lte(overtimeRequests.workDate, input.periodEnd)))],
      ["pending recurring compensation", await reader.select({employeeId: employeeCompensationComponents.employeeId, status: employeeCompensationComponents.status})
        .from(employeeCompensationComponents).where(and(eq(employeeCompensationComponents.organizationId, input.organizationId),
          inArray(employeeCompensationComponents.employeeId, employeeIds),
          lte(employeeCompensationComponents.effectiveFrom, input.periodEnd)))],
      ["pending supplementary earnings", await reader.select({employeeId: supplementaryEarnings.employeeId, status: supplementaryEarnings.status})
        .from(supplementaryEarnings).where(and(eq(supplementaryEarnings.organizationId, input.organizationId),
          inArray(supplementaryEarnings.employeeId, employeeIds),
          gte(supplementaryEarnings.effectiveDate, input.periodStart),
          lte(supplementaryEarnings.effectiveDate, input.periodEnd)))],
      ["unapproved loan", await reader.select({employeeId: employeeLoans.employeeId, status: employeeLoans.status})
        .from(employeeLoans).where(and(eq(employeeLoans.organizationId, input.organizationId),
          inArray(employeeLoans.employeeId, employeeIds)))],
      ["incomplete punch", await reader.select({employeeId: timePunches.employeeId, status: timePunches.status})
        .from(timePunches).where(and(eq(timePunches.organizationId, input.organizationId),
          inArray(timePunches.employeeId, employeeIds),
          gte(timePunches.workDate, input.periodStart),
          lte(timePunches.workDate, input.periodEnd)))],
    ] as const;
    for (const [source, rows] of pendingSources) {
      for (const row of rows) {
        const status = row.status.toLowerCase();
        if (status === "pending" || status === "pending_approval" || status === "submitted"
          || status === "under_review" || (source === "incomplete punch" && status !== "complete")) {
          const reason = "Resolve " + source + " before projecting payroll.";
          const worker = problems.get(row.employeeId);
          if (worker && !worker.includes(reason)) worker.push(reason);
        }
      }
    }
    // Existing corrections and approved expense claims are not yet guaranteed
    // to have the same immutable authorization snapshot as a canonical run.
    const [corrections, claims] = await Promise.all([
      reader.select({employeeId: attendanceCorrectionRequests.employeeId})
        .from(attendanceCorrectionRequests).where(and(
          eq(attendanceCorrectionRequests.organizationId, input.organizationId),
          inArray(attendanceCorrectionRequests.employeeId, employeeIds),
          gte(attendanceCorrectionRequests.workDate, input.periodStart),
          lte(attendanceCorrectionRequests.workDate, input.periodEnd),
        )),
      reader.select({employeeId: expenseClaims.employeeId}).from(expenseClaims).where(and(
        eq(expenseClaims.organizationId, input.organizationId),
        inArray(expenseClaims.employeeId, employeeIds),
      )),
    ]);
    for (const row of corrections) problems.get(row.employeeId)?.push(
      "Attendance corrections require a reconciled cutoff snapshot.");
    for (const row of claims) problems.get(row.employeeId)?.push(
      "Expense claims require reviewed payroll evidence.");
  }

  const eligibleIds = blockers.length > 0 ? [] : baseline.rows
    .filter(row => (problems.get(row.employeeId)?.length ?? 0) === 0)
    .map(row => row.employeeId);
  let projected = new Map<number, Awaited<ReturnType<typeof projectCanonicalPayrollReadOnly>>[number]>();
  if (legal && eligibleIds.length > 0) {
    try {
      const rows = await projectCanonicalPayrollReadOnly({
        organizationId: input.organizationId,
        legalEntityId: legal.id,
        periodStart: input.periodStart, periodEnd: input.periodEnd, payDate: input.payDate,
        employeeIds: eligibleIds, employeeCount: baseline.rows.length,
      }, reader);
      if (rows.length !== eligibleIds.length ||
        rows.some(row => !eligibleIds.includes(row.employeeId))) {
        throw Error("Canonical preview returned a mismatched worker cohort.");
      }
      projected = new Map(rows.map(row => [row.employeeId, row]));
    } catch {
      // No partial amounts are returned if source history, migration lineage
      // or a canonical calculation cannot be read from this snapshot.
      blockers.push("Canonical payroll sources could not be reconciled. Check source history and deployed schema.");
    }
  }

  const rows = baseline.rows.map(row => {
    const issues = [...(problems.get(row.employeeId) ?? [])];
    const projectedRow = blockers.length === 0 ? projected.get(row.employeeId) : null;
    if (projectedRow) issues.push(...projectedRow.blockers);
    return {
      ...row,
      gross: issues.length === 0 && projectedRow ? projectedRow.gross : null,
      sss: issues.length === 0 && projectedRow ? projectedRow.sss : null,
      philHealth: issues.length === 0 && projectedRow ? projectedRow.philHealth : null,
      pagIbig: issues.length === 0 && projectedRow ? projectedRow.pagIbig : null,
      withholding: issues.length === 0 && projectedRow ? projectedRow.withholding : null,
      net: issues.length === 0 && projectedRow ? projectedRow.net : null,
      blockers: issues,
    };
  });
  if (rows.some(row => row.blockers.length > 0)) {
    blockers.push("Resolve employee-level blockers before treating preview as ready.");
  }

  return {
    ...baseline,
    previewReady: blockers.length === 0 && rows.every(row => row.gross !== null && row.net !== null),
    rows, blockers,
    warnings: [
      ...baseline.warnings,
      "Complex previews reuse the authoritative payroll worker's input assembly inside a read-only transaction.",
      "Preview calculations do not create, approve, release, export or submit payroll.",
    ],
  };
}
