import { enforceSameOriginMutation } from "@/lib/security-request";
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
import { runAutomationEventSafely } from "@/lib/automation";

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
    const [target] = await db.select({ organizationId: payrollRuns.organizationId, scopeOrgUnitId: payrollRuns.scopeOrgUnitId })
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

    // The workspace loads one run's register at a time, so it asks for the run
    // it is actually showing instead of relying on the dashboard's single set.
    if (searchParams.get("include") === "entries") {
      const entries = await db.select().from(payrollEntries)
        .where(eq(payrollEntries.payrollRunId, runId))
        .orderBy(asc(payrollEntries.id));
      return Response.json({ runId, entries });
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

  const runs = await db.select().from(payrollRuns)
    .where(access.companyWide
      ? eq(payrollRuns.organizationId, organizationId)
      : and(
          eq(payrollRuns.organizationId, organizationId),
          eq(payrollRuns.scopeOrgUnitId, access.orgUnitId!),
        ))
    .orderBy(desc(payrollRuns.id));
  return Response.json({ runs });
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
const MAX_PAYROLL_PERIOD_DAYS = 16;

function validIsoDate(value: string) {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function inclusivePeriodDays(periodStart: string, periodEnd: string) {
  const start = Date.parse(`${periodStart}T00:00:00Z`);
  const end = Date.parse(`${periodEnd}T00:00:00Z`);
  return Math.floor((end - start) / DAY_MS) + 1;
}

function periodLabelFromDates(periodStart: string, periodEnd: string) {
  const start = new Date(`${periodStart}T12:00:00Z`);
  const end = new Date(`${periodEnd}T12:00:00Z`);
  const sameMonth = start.getUTCFullYear() === end.getUTCFullYear() && start.getUTCMonth() === end.getUTCMonth();
  const startLabel = start.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameMonth ? {} : { year: "numeric" as const }),
    timeZone: "UTC",
  });
  const endLabel = end.toLocaleDateString("en-US", {
    month: sameMonth ? undefined : "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  return `${startLabel}–${endLabel}`;
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
  const legalEntity = requestedLegalEntityId
    ? legalEntityRows.find((entity) => entity.id === requestedLegalEntityId)
    : legalEntityRows.find((entity) => entity.primaryEntity) ?? legalEntityRows[0];
  if (!legalEntity) {
    return Response.json({ error: "Create an active legal employer before starting payroll." }, { status: 422 });
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

  // Keep payroll creation aligned with the calculation engine: an employee
  // whose employment starts after this cutoff is not part of the payroll
  // cohort and must not block the run because payout details are incomplete.
  const employeeScope = scopeOrgUnitId
    ? and(
        eq(employees.organizationId, organizationId),
        eq(employees.legalEntityId, legalEntity.id),
        eq(employees.orgUnitId, scopeOrgUnitId),
        eq(employees.status, "Active"),
        lte(employees.startDate, periodEnd),
      )
    : and(
        eq(employees.organizationId, organizationId),
        eq(employees.legalEntityId, legalEntity.id),
        eq(employees.status, "Active"),
        lte(employees.startDate, periodEnd),
      );
  const employeesInScope = await db
    .select({
      id: employees.id,
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

  const missingPayout = employeesInScope.filter((employee) => {
    const hasBank = Boolean(employee.bankAccount?.trim() && employee.bankCode?.trim());
    const hasMobileWallet = Boolean(employee.mobile?.trim());
    return !hasBank && !hasMobileWallet;
  });
  if (missingPayout.length > 0) {
    return Response.json({
      error: `${missingPayout.length} active employee${missingPayout.length === 1 ? " is" : "s are"} missing a usable bank account or mobile-wallet destination. Complete payout details before starting payroll.`,
      code: "PAYOUT_DETAILS_REQUIRED",
      missingEmployeeIds: missingPayout.map((employee) => employee.id),
    }, { status: 422 });
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

  const periodLabel = periodLabelFromDates(periodStart, periodEnd);
  const [run] = await db.insert(payrollRuns).values({
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
      attendanceCutoffGate: attendanceCutoffGate.gate,
      timesheetPolicy: timesheetGate.policy,
      timesheetGate: timesheetGate.gate,
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
  return Response.json({ run: fresh, queue: queueMeta, processResult, attendanceCutoffGate, timesheetGate, automation }, { status: 201 });
}

