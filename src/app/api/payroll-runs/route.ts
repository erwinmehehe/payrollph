import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees, orgUnits, payrollEntries, payrollRuns } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { drainPayrollQueue, enqueuePayrollRun, getPayrollJobStatus } from "@/lib/payroll-engine";
import { assertOrganizationRole, PAYROLL_OPERATOR_ROLES } from "@/lib/access";

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
    const [target] = await db.select({ organizationId: payrollRuns.organizationId })
      .from(payrollRuns).where(eq(payrollRuns.id, runId)).limit(1);
    if (!target) return Response.json({ error: "Payroll run not found" }, { status: 404 });
    const deniedJob = await assertOrganizationRole(
      sessionUser.id,
      target.organizationId,
      PAYROLL_OPERATOR_ROLES,
      "Only payroll operators can view payroll runs.",
    );
    if (deniedJob) return deniedJob;

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

  const runs = await db.select().from(payrollRuns)
    .where(eq(payrollRuns.organizationId, organizationId))
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
  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const periodStart = typeof body.periodStart === "string" ? body.periodStart.trim() : "";
  const periodEnd = typeof body.periodEnd === "string" ? body.periodEnd.trim() : "";
  const payDate = typeof body.payDate === "string" ? body.payDate.trim() : "";
  const rawScopeOrgUnitId = body.scopeOrgUnitId == null || body.scopeOrgUnitId === "" ? null : Number(body.scopeOrgUnitId);
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

  let scopeOrgUnitId: number | null = null;
  let scopeLabel = "All locations";
  if (rawScopeOrgUnitId !== null) {
    const [scope] = await db.select().from(orgUnits).where(and(
      eq(orgUnits.id, rawScopeOrgUnitId),
      eq(orgUnits.organizationId, organizationId),
    )).limit(1);
    if (!scope) {
      return Response.json({ error: "The selected payroll scope does not belong to this organization." }, { status: 400 });
    }
    scopeOrgUnitId = scope.id;
    scopeLabel = scope.name;
  }

  const employeeScope = scopeOrgUnitId
    ? and(
        eq(employees.organizationId, organizationId),
        eq(employees.orgUnitId, scopeOrgUnitId),
      )
    : eq(employees.organizationId, organizationId);
  const [employeeInScope] = await db
    .select({ id: employees.id })
    .from(employees)
    .where(employeeScope)
    .limit(1);
  if (!employeeInScope) {
    return Response.json({ error: "The selected payroll scope has no employees." }, { status: 400 });
  }

  const periodLabel = periodLabelFromDates(periodStart, periodEnd);
  const [run] = await db.insert(payrollRuns).values({
    organizationId,
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
    ruleVersion: "PH-2026.01",
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
      ruleVersion: "PH-2026.01",
    },
  });

  let queueMeta = null;
  let processResult = null;
  if (processNow) {
    queueMeta = await enqueuePayrollRun(run.id);
    processResult = await drainPayrollQueue(20, run.id);
  }

  const [fresh] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, run.id));
  return Response.json({ run: fresh, queue: queueMeta, processResult }, { status: 201 });
}

