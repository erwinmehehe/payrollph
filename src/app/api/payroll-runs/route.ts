import { enforceSameOriginMutation } from "@/lib/security-request";
import { loadApprovedPayrollExits, payrollEmploymentStatus } from "@/lib/approved-exit-payroll";
import { formatPayrollPeriodLabel } from "@/lib/payroll-period-ui";
import { MAX_PAYROLL_PERIOD_DAYS, inclusivePeriodDays, validIsoDate } from "@/lib/payroll-period-validation";
import { and, asc, desc, eq, lte } from "drizzle-orm";
import { db } from "@/db";
import { employees, legalEntities, organizations, orgUnits, payrollEntries, payrollRuns } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { drainPayrollQueue, enqueuePayrollRun, getPayrollJobStatus, PAYROLL_RULE_VERSION } from "@/lib/payroll-engine";
import { assertOrganizationRole, assertOrganizationUnitAccess, getAccess, PAYROLL_OPERATOR_ROLES } from "@/lib/access";
import { isCanonicalPhSemiMonthlyPeriod } from "@/lib/payroll-calendar";
import { loadTimesheetPayrollGate } from "@/lib/workforce-timesheet-server";
import { loadAttendanceCutoffGate } from "@/lib/workforce-attendance-lock";
import { ensurePrimaryLegalEntity } from "@/lib/legal-entity";
import { assertEntityResource, resolveMultiEntityContext } from "@/lib/multi-entity-server";
import { entityConfirmationMatches } from "@/lib/multi-entity-policy";
import { runAutomationEventSafely } from "@/lib/automation";
import { statutoryRuleVersionsForDate } from "@/lib/ph-statutory-rule-packs";
import { nationalHolidayCalendarForDate } from "@/lib/wage-orders";
import { findPayrollPeriodConflict } from "@/lib/payroll-period-integrity";
import { createTimesheetExpectationsForPayrollRun } from "@/lib/workforce-timesheet-expectations";
import { requireSaasPaidWrites } from "@/lib/saas-workspace-access";
import { loadPayrollPreRunReadiness } from "@/lib/payroll-pre-run-readiness-server";
import { payrollDraftPayoutReadiness } from "@/lib/payroll-draft-payout-readiness";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) return Response.json({ error: "Authentication required." }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const organizationId = Number(searchParams.get("organizationId") ?? "0");
  const runId = Number(searchParams.get("runId") ?? "0");

  // Job-status and register lookups are resource-addressed, so they are checked
  // against the run's own organization rather than trusting the query string.
  if (runId > 0) {
    const [target] = await db.select({ organizationId: payrollRuns.organizationId, scopeOrgUnitId: payrollRuns.scopeOrgUnitId, legalEntityId: payrollRuns.legalEntityId })
      .from(payrollRuns).where(eq(payrollRuns.id, runId)).limit(1);
    if (!target) return Response.json({ error: "Payroll run not found" }, { status: 404 });
    const deniedJob = await assertOrganizationRole(
      sessionUser.id,
      target.organizationId,
      PAYROLL_OPERATOR_ROLES,
      "Only payroll operators can view payroll runs.",
    );
    if (deniedJob) return deniedJob;
    const scopeDenied = await assertOrganizationUnitAccess(
      sessionUser.id,
      target.organizationId,
      target.scopeOrgUnitId,
      "This payroll run is outside your assigned organization unit.",
    );
    if (scopeDenied) return scopeDenied;
    const entityAccess = await resolveMultiEntityContext({ userId: sessionUser.id, organizationId: target.organizationId, request });
    if (!entityAccess.ok) return entityAccess.response;
    const entityDenied = assertEntityResource(entityAccess.context, target.legalEntityId);
    if (entityDenied) return entityDenied;

    // The workspace loads one run's register at a time, so it asks for the run
    // it is actually showing instead of relying on the dashboard's single set.
    if (searchParams.get("include") === "entries") {
      const entries = await db.select().from(payrollEntries)
        .where(eq(payrollEntries.payrollRunId, runId))
        .orderBy(asc(payrollEntries.id));
      return Response.json({ organizationId: target.organizationId, legalEntityId: target.legalEntityId, runId, entries });
    }

    const status = await getPayrollJobStatus(runId);
    return Response.json(status);
  }

  if (!Number.isInteger(organizationId) || organizationId <= 0) {
    return Response.json({ error: "organizationId is required" }, { status: 400 });
  }

  const deniedRuns = await assertOrganizationRole(
    sessionUser.id,
    organizationId,
    PAYROLL_OPERATOR_ROLES,
    "Only payroll operators can view payroll runs.",
  );
  if (deniedRuns) return deniedRuns;
  const access = await getAccess(sessionUser.id, organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });
  const entityAccess = await resolveMultiEntityContext({ userId: sessionUser.id, organizationId, request });
  if (!entityAccess.ok) return entityAccess.response;

  const runs = await db.select().from(payrollRuns)
    .where(and(
      eq(payrollRuns.organizationId, organizationId),
      entityAccess.context.enabled && entityAccess.context.legalEntityId !== null
        ? eq(payrollRuns.legalEntityId, entityAccess.context.legalEntityId) : undefined,
      !access.companyWide ? eq(payrollRuns.scopeOrgUnitId, access.orgUnitId!) : undefined,
    ))
    .orderBy(desc(payrollRuns.id));
  return Response.json({ runs });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const periodStart = typeof body.periodStart === "string" ? body.periodStart.trim() : "";
  const periodEnd = typeof body.periodEnd === "string" ? body.periodEnd.trim() : "";
  const payDate = typeof body.payDate === "string" ? body.payDate.trim() : "";
  const rawScopeOrgUnitId = body.scopeOrgUnitId == null || body.scopeOrgUnitId === "" ? null : Number(body.scopeOrgUnitId);
  const requestedLegalEntityId = body.legalEntityId == null || body.legalEntityId === "" ? null : Number(body.legalEntityId);
  const processNow = body.processNow !== false;

  if (
    !Number.isInteger(organizationId) ||
    !validIsoDate(periodStart) ||
    !validIsoDate(periodEnd) ||
    !validIsoDate(payDate)
  ) {
    return Response.json({
      error: "Organization, period start, period end, and pay date are required.",
    }, { status: 400 });
  }

  if (periodStart > periodEnd) {
    return Response.json({ error: "Payroll period start cannot be after period end." }, { status: 400 });
  }
  const periodDays = inclusivePeriodDays(periodStart, periodEnd);
  if (periodDays > MAX_PAYROLL_PERIOD_DAYS) {
    return Response.json({
      error: `Payroll periods are limited to ${MAX_PAYROLL_PERIOD_DAYS} calendar days. Split this into separate cutoffs.`,
    }, { status: 400 });
  }
  if (payDate < periodEnd) {
    return Response.json({ error: "Pay date cannot be before the payroll period ends." }, { status: 400 });
  }
  if (rawScopeOrgUnitId !== null && (!Number.isInteger(rawScopeOrgUnitId) || rawScopeOrgUnitId <= 0)) {
    return Response.json({ error: "Invalid payroll scope." }, { status: 400 });
  }
  if (requestedLegalEntityId !== null && (!Number.isInteger(requestedLegalEntityId) || requestedLegalEntityId <= 0)) {
    return Response.json({ error: "Invalid legal employer." }, { status: 400 });
  }

  try {
    statutoryRuleVersionsForDate(payDate);
    nationalHolidayCalendarForDate(periodEnd);
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "Payroll statutory rules are not certified for this period.",
      code: "PAYROLL_RULE_PACK_MISSING",
    }, { status: 422 });
  }

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const actor = user.name;

  const denied = await assertOrganizationRole(
    user.id,
    organizationId,
    PAYROLL_OPERATOR_ROLES,
    "Only payroll operators can create payroll runs.",
  );
  if (denied) return denied;
  const subscriptionDenied = await requireSaasPaidWrites(organizationId);
  if (subscriptionDenied) return subscriptionDenied;
  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });

  const [organization] = await db.select().from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (!organization) return Response.json({ error: "Organization not found." }, { status: 404 });

  await ensurePrimaryLegalEntity(organizationId);
  const legalEntityRows = await db.select().from(legalEntities).where(and(
    eq(legalEntities.organizationId, organizationId),
    eq(legalEntities.active, true),
  ));
  const entityAccess = await resolveMultiEntityContext({ userId: user.id, organizationId, request });
  if (!entityAccess.ok) return entityAccess.response;
  const legalEntity = requestedLegalEntityId
    ? legalEntityRows.find((entity) => entity.id === requestedLegalEntityId)
    : entityAccess.context.enabled && entityAccess.context.legalEntityId !== null
      ? legalEntityRows.find((entity) => entity.id === entityAccess.context.legalEntityId)
      : legalEntityRows.find((entity) => entity.primaryEntity) ?? legalEntityRows[0];
  if (!legalEntity) {
    return Response.json({ error: "Create an active legal employer before starting payroll." }, { status: 422 });
  }
  const entityDenied = assertEntityResource(entityAccess.context, legalEntity.id);
  if (entityDenied) return entityDenied;
  if (entityAccess.context.enabled && !entityConfirmationMatches(legalEntity.legalName, String(body.confirmLegalEntityName ?? ""))) {
    return Response.json({ error: "Type the exact legal employer name before starting payroll.", code: "ENTITY_CONFIRMATION_REQUIRED" }, { status: 422 });
  }

  if (
    legalEntity.payrollCalendarMode === "ph_semi_monthly"
    && !isCanonicalPhSemiMonthlyPeriod(periodStart, periodEnd)
  ) {
    return Response.json({
      error: `${legalEntity.displayName} uses the Philippine semi-monthly calendar. Payroll periods must be exactly the 1st–15th or the 16th–end of month.`,
      code: "INVALID_PH_SEMI_MONTHLY_PERIOD",
    }, { status: 422 });
  }
  if (!access.companyWide && rawScopeOrgUnitId !== null && rawScopeOrgUnitId !== access.orgUnitId) {
    return Response.json({ error: "You can create payroll only for your assigned organization unit." }, { status: 403 });
  }
  const effectiveScopeOrgUnitId = access.companyWide ? rawScopeOrgUnitId : access.orgUnitId;

  let scopeOrgUnitId: number | null = null;
  let scopeLabel = "All locations";
  if (effectiveScopeOrgUnitId !== null) {
    const [scope] = await db.select().from(orgUnits).where(and(
      eq(orgUnits.id, effectiveScopeOrgUnitId),
      eq(orgUnits.organizationId, organizationId),
    )).limit(1);
    if (!scope) {
      return Response.json({ error: "The selected payroll scope does not belong to this organization." }, { status: 400 });
    }
    scopeOrgUnitId = scope.id;
    scopeLabel = scope.name;
  }

  const periodConflict = await findPayrollPeriodConflict({
    organizationId,
    legalEntityId: legalEntity.id,
    scopeOrgUnitId,
    periodStart,
    periodEnd,
  });
  if (periodConflict) {
    return Response.json({
      error: `Payroll overlaps existing run #${periodConflict.id} (${periodConflict.periodLabel}). Resolve or void the existing run before creating another payroll for the same population.`,
      code: "PAYROLL_PERIOD_CONFLICT",
      conflictingRun: periodConflict,
    }, { status: 409 });
  }

  // Keep payroll creation aligned with the calculation engine: an employee
  // whose employment starts after this cutoff is not part of the payroll
  // cohort and must not block the run because payout details are incomplete.
  const employeeScope = scopeOrgUnitId
    ? and(
        eq(employees.organizationId, organizationId),
        eq(employees.legalEntityId, legalEntity.id),
        eq(employees.orgUnitId, scopeOrgUnitId),
        payrollEmploymentStatus(periodStart),
        lte(employees.startDate, periodEnd),
      )
    : and(
        eq(employees.organizationId, organizationId),
        eq(employees.legalEntityId, legalEntity.id),
        payrollEmploymentStatus(periodStart),
        lte(employees.startDate, periodEnd),
      );
  const employeesInScope = await db
    .select({
      id: employees.id,
      status: employees.status,
      orgUnitId: employees.orgUnitId,
      firstName: employees.firstName,
      lastName: employees.lastName,
      bankAccount: employees.bankAccount,
      bankCode: employees.bankCode,
      mobile: employees.mobile,
    })
    .from(employees)
    .where(employeeScope);
  if (employeesInScope.length === 0) {
    return Response.json({ error: `The selected payroll scope has no active employees assigned to ${legalEntity.displayName}.` }, { status: 400 });
  }

  // Draft-only creation may save incomplete payout details without calculation.
  // Opt-in payout deferral also requires independent statutory/attendance readiness.
  const payoutReadiness = payrollDraftPayoutReadiness(employeesInScope);
  if (processNow && !payoutReadiness.allowed) {
    return Response.json({
      error: payoutReadiness.message,
      code: "PAYOUT_DETAILS_REQUIRED",
      missingEmployeeIds: payoutReadiness.missingEmployeeIds,
    }, { status: 422 });
  }

  if (processNow) {
    // ID zero denotes a not-yet-persisted draft, never a resource to authorize.
    // Employer/unit/role/subscription and selected cohort were resolved above.
    // Check BEFORE inserting the draft, audit or job so Create & process cannot
    // bypass the same source gate enforced by the separate /process endpoint.
    const readiness = await loadPayrollPreRunReadiness({
      id: 0, organizationId, legalEntityId: legalEntity.id, scopeOrgUnitId,
      periodStart, periodEnd, payDate,
    });
    if (!readiness.ready) return Response.json({
      error: "Pre-calculation readiness has blocking issues. Resolve them before calculating payroll.",
      code: "PAYROLL_PRE_RUN_READINESS_BLOCKED",
      readiness,
    }, { status: 422, headers: { "Cache-Control": "private, no-store" } });
  }

  if (processNow) {
    try { await loadApprovedPayrollExits(db, organizationId, employeesInScope); }
    catch (error) {
      const message = error instanceof Error ? error.message : "";
      const code = message.split(":")[0];
      if (["PAYROLL_EXIT_APPROVAL_REQUIRED", "PAYROLL_EXIT_APPROVAL_IDENTITY", "PAYROLL_SEPARATION_CONFLICT", "PAYROLL_FINAL_PAY_WAGE_OVERLAP"].includes(code)) {
        return Response.json({ error: message, code }, { status: 409 });
      }
      return Response.json({ error: "Approved exit evidence could not be verified. Retry before processing payroll.", code: "PAYROLL_EXIT_VERIFICATION_UNAVAILABLE" }, { status: 503 });
    }
  }
  const attendanceCutoffGate = await loadAttendanceCutoffGate({
    organizationId,
    periodStart,
    periodEnd,
  });
  if (processNow && !attendanceCutoffGate.gate.allowed) {
    return Response.json({
      error: "An active payroll-cutoff attendance lock is required before payroll processing for this organization.",
      code: "ATTENDANCE_CUTOFF_LOCK_REQUIRED",
      attendanceCutoffGate: attendanceCutoffGate.gate,
    }, { status: 422 });
  }

  const timesheetGate = await loadTimesheetPayrollGate({
    organizationId,
    employeeIds: employeesInScope.map((employee) => employee.id),
    periodStart,
    periodEnd,
  });
  if (processNow && !timesheetGate.gate.allowed) {
    return Response.json({
      error: "Approved workforce timesheets are required before payroll processing for this organization.",
      code: "TIMESHEET_APPROVAL_REQUIRED",
      timesheetGate: timesheetGate.gate,
    }, { status: 422 });
  }

  const periodLabel = formatPayrollPeriodLabel(periodStart, periodEnd);
  const [run] = await db.transaction(async (tx) => {
    const [created] = await tx.insert(payrollRuns).values({
      organizationId,
      legalEntityId: legalEntity.id,
      periodLabel,
      periodStart,
      periodEnd,
      scopeLabel,
      scopeOrgUnitId,
      status: "Draft",
      payDate,
      employeeCount: 0,
      grossPay: "0",
      netPay: "0",
      exceptions: 0,
      ruleVersion: PAYROLL_RULE_VERSION,
    }).returning();

    if (timesheetGate.policy.active) {
      await createTimesheetExpectationsForPayrollRun({
        organizationId,
        payrollRunId: created.id,
        periodStart,
        periodEnd,
        enforcementMode: timesheetGate.policy.enforcementMode,
        employees: employeesInScope.map((employee) => ({
          id: employee.id,
          orgUnitId: employee.orgUnitId,
        })),
      }, tx);
    }
    return [created];
  });

  await recordAuditEvent({
    organizationId,
    actor,
    action: "Payroll draft created",
    resource: periodLabel,
    metadata: {
      periodStart,
      periodEnd,
      payDate,
      scope: scopeLabel,
      scopeOrgUnitId,
      legalEntityId: legalEntity.id,
      legalEntityCode: legalEntity.code,
      legalEntityName: legalEntity.displayName,
      ruleVersion: PAYROLL_RULE_VERSION,
      attendanceCutoffPolicy: attendanceCutoffGate.policy,
      ...(payoutReadiness.deferred ? {
        payoutSetupDeferred: true,
        payoutSetupMissingEmployeeCount: payoutReadiness.missingEmployeeIds.length,
      } : {}),
      attendanceCutoffGate: attendanceCutoffGate.gate,
      timesheetPolicy: timesheetGate.policy,
      timesheetGate: timesheetGate.gate,
      timesheetExpectationCohort: timesheetGate.policy.active
        ? { source: "payroll_run_creation", employeeCount: employeesInScope.length, historicalBackfill: false }
        : null,
    },
  });

  const automation = await runAutomationEventSafely({
    organizationId,
    trigger: "payroll.created",
    eventKey: `payroll-created:${run.id}`,
    context: {
      payrollRunId: run.id,
      periodLabel,
      periodStart,
      periodEnd,
      payDate,
      orgUnitId: scopeOrgUnitId,
      legalEntityId: legalEntity.id,
      payrollAmount: 0,
      employeeCount: employeesInScope.length,
    },
  });

  let queueMeta = null;
  let processResult = null;
  if (processNow) {
    queueMeta = await enqueuePayrollRun(run.id);
    processResult = await drainPayrollQueue(20, run.id);
  }

  const [fresh] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, run.id));
  return Response.json({ run: fresh, queue: queueMeta, processResult, attendanceCutoffGate, timesheetGate, automation,
    ...(payoutReadiness.deferred ? { payoutReadiness } : {}),
  }, { status: 201 });
}

