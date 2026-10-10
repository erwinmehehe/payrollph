import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  approvalTasks,
  employees,
  payrollEntries,
  payrollRuns,
  payrollUnderpaymentRequests,
  supplementaryEarnings,
} from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { isSharedBenefitPoolEarningType } from "@/lib/annualization";
import {
  assertOrganizationRole,
  assertScope,
  getAccess,
  PAYROLL_OPERATOR_ROLES,
} from "@/lib/access";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";

const EARNING_TYPES = new Set([
  "commission",
  "bonus",
  "13th_month",
  "thirteenth_month",
  "christmas_bonus",
  "midyear_bonus",
  "performance_bonus",
  "other_benefit_90k",
  "honorarium",
  "taxable_allowance",
  "other_taxable",
]);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const BUSY_PAYROLL_STATUSES = new Set(["Queued", "Processing", "Recalculating", "Releasing"]);

async function payrollRunsCoveringDate(organizationId: number, effectiveDate: string) {
  const runs = await db.select().from(payrollRuns)
    .where(eq(payrollRuns.organizationId, organizationId));
  return runs.filter((run) =>
    String(run.periodStart) <= effectiveDate
    && String(run.periodEnd) >= effectiveDate
  );
}

async function prepareSupplementaryEarningMutation(
  organizationId: number,
  employeeOrgUnitId: number | null,
  effectiveDate: string,
) {
  const overlapping = await payrollRunsCoveringDate(organizationId, effectiveDate);
  const inEmployeeScope = overlapping.filter((run) =>
    run.scopeOrgUnitId == null || run.scopeOrgUnitId === employeeOrgUnitId
  );

  const busy = inEmployeeScope.find((run) => BUSY_PAYROLL_STATUSES.has(run.status));
  if (busy) {
    throw new Error(
      `Supplementary earnings cannot change while payroll run #${busy.id} is ${busy.status}. Retry after that payroll action finishes.`,
    );
  }

  const released = inEmployeeScope.find((run) => run.status === "Released");
  if (released) {
    throw new Error(
      `Payroll run #${released.id} covering ${effectiveDate} is already released. Post the earning as a separately audited adjustment in an open later cutoff instead of changing released history.`,
    );
  }

  return inEmployeeScope.filter((run) =>
    run.status !== "Draft"
    || Number(run.employeeCount ?? 0) > 0
    || Number(run.processedChunks ?? 0) > 0
  );
}

async function invalidatePayrollRunsForSupplementaryChange(
  organizationId: number,
  runs: Awaited<ReturnType<typeof prepareSupplementaryEarningMutation>>,
) {
  if (runs.length === 0) return [] as number[];

  const tasks = await db.select().from(approvalTasks)
    .where(eq(approvalTasks.organizationId, organizationId));
  const invalidated: number[] = [];

  await db.transaction(async (tx) => {
    for (const run of runs) {
      await tx.delete(payrollEntries).where(eq(payrollEntries.payrollRunId, run.id));
      const [updated] = await tx.update(payrollRuns).set({
        status: "Draft",
        employeeCount: 0,
        grossPay: "0",
        netPay: "0",
        exceptions: 0,
        processedChunks: 0,
        totalChunks: 0,
      }).where(and(
        eq(payrollRuns.id, run.id),
        eq(payrollRuns.status, run.status),
      )).returning({ id: payrollRuns.id });
      if (!updated) {
        throw new Error(
          `Payroll run #${run.id} changed state while supplementary earnings were being updated. No earning change was applied; retry after payroll activity finishes.`,
        );
      }
      invalidated.push(updated.id);

      for (const task of tasks) {
        if (!task.detail.includes(`Payroll run #${run.id}`)) continue;
        if (task.status !== "Pending" && task.status !== "Approved") continue;
        await tx.update(approvalTasks).set({
          status: "Superseded",
          decidedBy: "System",
          decidedAt: new Date(),
        }).where(eq(approvalTasks.id, task.id));
      }
    }
  });

  return invalidated;
}

export async function GET(request: Request) {
  const session = await getSessionUser();
  if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });

  const organizationId = Number(new URL(request.url).searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    session.id,
    organizationId,
    PAYROLL_OPERATOR_ROLES,
    "Only payroll operators can review supplementary earnings.",
  );
  if (denied) return denied;
  const access = await getAccess(session.id, organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });

  const employeeRows = await db.select({
    id: employees.id,
    orgUnitId: employees.orgUnitId,
    employeeNo: employees.employeeNo,
    firstName: employees.firstName,
    lastName: employees.lastName,
  }).from(employees).where(eq(employees.organizationId, organizationId));
  const visible = access.companyWide
    ? employeeRows
    : employeeRows.filter((employee) => employee.orgUnitId === access.orgUnitId);
  const visibleIds = visible.map((employee) => employee.id);
  if (visibleIds.length === 0) return Response.json({ earnings: [] });

  const rows = await db.select().from(supplementaryEarnings).where(and(
    eq(supplementaryEarnings.organizationId, organizationId),
    inArray(supplementaryEarnings.employeeId, visibleIds),
  )).orderBy(asc(supplementaryEarnings.effectiveDate), asc(supplementaryEarnings.id));

  const employeeById = new Map(visible.map((employee) => [employee.id, employee]));
  return Response.json({
    earnings: rows.map((row) => {
      const employee = employeeById.get(row.employeeId);
      return {
        ...row,
        employeeName: employee ? `${employee.firstName} ${employee.lastName}` : null,
        employeeNo: employee?.employeeNo ?? null,
      };
    }),
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const session = await getSessionUser();
  if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const employeeId = Number(body.employeeId);
  const earningType = String(body.earningType ?? "").trim().toLowerCase();
  const label = String(body.label ?? "").trim().slice(0, 120);
  const amount = Number(body.amount);
  const effectiveDate = String(body.effectiveDate ?? "").trim();
  const legacyStatutoryBase = body.includeInStatutoryBase;
  const includeInSssBase = body.includeInSssBase === undefined
    ? legacyStatutoryBase !== false
    : body.includeInSssBase !== false;
  const includeInPagIbigBase = body.includeInPagIbigBase === undefined
    ? legacyStatutoryBase !== false
    : body.includeInPagIbigBase !== false;

  if (
    !Number.isInteger(organizationId)
    || !Number.isInteger(employeeId)
    || !EARNING_TYPES.has(earningType)
    || !label
    || !Number.isFinite(amount)
    || amount <= 0
    || !ISO_DATE.test(effectiveDate)
  ) {
    return Response.json({
      error: "organizationId, employeeId, earningType, label, positive amount, and effectiveDate (YYYY-MM-DD) are required.",
    }, { status: 400 });
  }

  const denied = await assertOrganizationRole(
    session.id,
    organizationId,
    PAYROLL_OPERATOR_ROLES,
    "Only payroll operators can add supplementary earnings.",
  );
  if (denied) return denied;

  const [employee] = await db.select().from(employees).where(and(
    eq(employees.id, employeeId),
    eq(employees.organizationId, organizationId),
  )).limit(1);
  if (!employee) return Response.json({ error: "Employee not found in this workspace." }, { status: 404 });

  const access = await getAccess(session.id, organizationId);
  const scope = assertScope(access, employee.orgUnitId);
  if (!scope.ok) return Response.json({ error: scope.error }, { status: scope.status });
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: session.id,
    action: "supplementary-earning-create",
    resourceId: employeeId,
    limit: 20,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  let overlappingRuns: Awaited<ReturnType<typeof prepareSupplementaryEarningMutation>>;
  try {
    overlappingRuns = await prepareSupplementaryEarningMutation(
      organizationId,
      employee.orgUnitId,
      effectiveDate,
    );
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "Supplementary earning conflicts with payroll state.",
      code: "SUPPLEMENTARY_EARNING_PAYROLL_CONFLICT",
    }, { status: 409 });
  }

  let invalidatedPayrollRunIds: number[];
  try {
    invalidatedPayrollRunIds = await invalidatePayrollRunsForSupplementaryChange(
      organizationId,
      overlappingRuns!,
    );
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "Payroll state changed during earning update.",
      code: "SUPPLEMENTARY_EARNING_PAYROLL_CONFLICT",
    }, { status: 409 });
  }

  const benefitPool90k = isSharedBenefitPoolEarningType(earningType);

  const [row] = await db.insert(supplementaryEarnings).values({
    organizationId,
    employeeId,
    earningType,
    label,
    amount: amount.toFixed(2),
    taxable: true,
    includeInSssBase,
    includeInPagIbigBase,
    effectiveDate,
    status: "approved",
    createdBy: session.name,
  }).returning();

  await recordAuditEvent({
    organizationId,
    actor: session.name,
    action: "Supplementary earning approved",
    resource: `${employee.employeeNo} · ${label}`,
    metadata: {
      earningId: row.id,
      employeeId,
      earningType,
      amount,
      effectiveDate,
      taxable: true,
      benefitPool90k,
      includeInSssBase,
      includeInPagIbigBase,
      invalidatedPayrollRunIds,
    },
  });

  return Response.json({ ...row, invalidatedPayrollRunIds }, { status: 201 });
}

export async function PATCH(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const session = await getSessionUser();
  if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const id = Number(body.id);
  if (!Number.isInteger(id)) {
    return Response.json({ error: "id is required." }, { status: 400 });
  }

  const [existing] = await db.select().from(supplementaryEarnings)
    .where(eq(supplementaryEarnings.id, id))
    .limit(1);
  if (!existing) return Response.json({ error: "Supplementary earning not found." }, { status: 404 });

  const denied = await assertOrganizationRole(
    session.id,
    existing.organizationId,
    PAYROLL_OPERATOR_ROLES,
    "Only payroll operators can void supplementary earnings.",
  );
  if (denied) return denied;

  const [employee] = await db.select().from(employees)
    .where(eq(employees.id, existing.employeeId))
    .limit(1);
  const access = await getAccess(session.id, existing.organizationId);
  const scope = assertScope(access, employee?.orgUnitId ?? null);
  if (!scope.ok) return Response.json({ error: scope.error }, { status: scope.status });
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: session.id,
    action: "supplementary-earning-void",
    resourceId: id,
    limit: 12,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  // Correction earnings can only be posted after independent review. Their
  // approval chain must not be undone through generic supplementary-earnings
  // void, even before the next payroll calculates or settles.
  const [reviewedCorrection] = await db.select({ id: payrollUnderpaymentRequests.id })
    .from(payrollUnderpaymentRequests)
    .where(and(
      eq(payrollUnderpaymentRequests.organizationId, existing.organizationId),
      eq(payrollUnderpaymentRequests.postedEarningId, id),
    )).limit(1);
  if (reviewedCorrection) {
    return Response.json({
      code: "REVIEWED_UNDERPAYMENT_IMMUTABLE",
      error: "An independently approved historical underpayment cannot be voided through supplementary earnings. Use a separately reviewed reversing adjustment rather than erasing the audit trail.",
      correctionRequestId: reviewedCorrection.id,
    }, { status: 409 });
  }

  if (existing.payrollRunId != null || existing.status === "settled") {
    return Response.json({
      error: "A settled supplementary earning is immutable. Use a separately audited adjustment in a later payroll.",
    }, { status: 409 });
  }
  if (existing.status === "void") return Response.json(existing);

  let overlappingRuns: Awaited<ReturnType<typeof prepareSupplementaryEarningMutation>>;
  try {
    overlappingRuns = await prepareSupplementaryEarningMutation(
      existing.organizationId,
      employee?.orgUnitId ?? null,
      String(existing.effectiveDate),
    );
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "Supplementary earning conflicts with payroll state.",
      code: "SUPPLEMENTARY_EARNING_PAYROLL_CONFLICT",
    }, { status: 409 });
  }

  let invalidatedPayrollRunIds: number[];
  try {
    invalidatedPayrollRunIds = await invalidatePayrollRunsForSupplementaryChange(
      existing.organizationId,
      overlappingRuns!,
    );
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "Payroll state changed during earning update.",
      code: "SUPPLEMENTARY_EARNING_PAYROLL_CONFLICT",
    }, { status: 409 });
  }

  const [row] = await db.update(supplementaryEarnings)
    .set({ status: "void" })
    .where(and(
      eq(supplementaryEarnings.id, id),
      eq(supplementaryEarnings.organizationId, existing.organizationId),
      eq(supplementaryEarnings.status, "approved"),
    ))
    .returning();
  if (!row) {
    return Response.json({ error: "Supplementary earning changed before it could be voided." }, { status: 409 });
  }

  await recordAuditEvent({
    organizationId: existing.organizationId,
    actor: session.name,
    action: "Supplementary earning voided",
    resource: `Earning #${id}`,
    metadata: {
      earningId: id,
      employeeId: existing.employeeId,
      amount: Number(existing.amount),
      invalidatedPayrollRunIds,
    },
  });

  return Response.json({ ...row, invalidatedPayrollRunIds });
}
