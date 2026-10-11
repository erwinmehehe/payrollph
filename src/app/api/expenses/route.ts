import { enforceSameOriginMutation } from "@/lib/security-request";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, employees, expenseClaims, expenseReportItems } from "@/db/schema";
import { assertMembership, assertOrganizationRole, assertScope, getAccess, PEOPLE_PAYROLL_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  const status = url.searchParams.get("status");
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  let employeeId: number | null = null;
  let visibleEmployeeIds: Set<number> | null = null;
  if (user.role === "employee") {
    if (!user.employeeId) return Response.json({ error: "Employee profile is not linked." }, { status: 403 });
    const denied = await assertMembership(user.id, organizationId);
    if (denied) return denied;
    employeeId = user.employeeId;
  } else {
    const denied = await assertOrganizationRole(
      user.id,
      organizationId,
      PEOPLE_PAYROLL_ROLES,
      "Only People or payroll administrators can view expense claims.",
    );
    if (denied) return denied;
    const access = await getAccess(user.id, organizationId);
    if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });
    if (!access.companyWide) {
      const staff = await db.select({ id: employees.id, orgUnitId: employees.orgUnitId }).from(employees)
        .where(eq(employees.organizationId, organizationId));
      visibleEmployeeIds = new Set(staff.filter((employee) => employee.orgUnitId === access.orgUnitId).map((employee) => employee.id));
    }
  }

  const rows = await db.select().from(expenseClaims)
    .where(
      employeeId != null
        ? and(eq(expenseClaims.organizationId, organizationId), eq(expenseClaims.employeeId, employeeId))
        : status
          ? and(eq(expenseClaims.organizationId, organizationId), eq(expenseClaims.status, status))
          : eq(expenseClaims.organizationId, organizationId),
    )
    .orderBy(desc(expenseClaims.createdAt));

  const scopedRows = visibleEmployeeIds ? rows.filter((row) => visibleEmployeeIds!.has(row.employeeId)) : rows;
  const visibleRows = employeeId != null && status ? scopedRows.filter((row) => row.status === status) : scopedRows;
  const reportedItems = visibleRows.length
    ? await db.select({ claimId: expenseReportItems.claimId }).from(expenseReportItems)
        .where(and(
          eq(expenseReportItems.organizationId, organizationId),
          inArray(expenseReportItems.claimId, visibleRows.map(row => row.id)),
        ))
    : [];
  const reportedIds = new Set(reportedItems.map(item => item.claimId));
  const approved = visibleRows.filter((row) => row.status === "approved" && row.payrollRunId == null);

  return Response.json({
    claims: visibleRows.map(row => ({ ...row, inExpenseReport: reportedIds.has(row.id) })),
    pendingReimbursement: Number(approved.reduce((sum, row) => sum + Number(row.amount), 0).toFixed(2)),
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  let employeeId = Number(body.employeeId);
  const amount = Number(body.amount);
  const description = String(body.description ?? "").trim();
  const category = String(body.category ?? "Other").trim();
  const incurredOn = String(body.incurredOn ?? "").trim();

  if (!Number.isInteger(organizationId)) return Response.json({ error: "organizationId is required." }, { status: 400 });

  if (user.role === "employee") {
    if (!user.employeeId) return Response.json({ error: "Employee profile is not linked." }, { status: 403 });
    const denied = await assertMembership(user.id, organizationId);
    if (denied) return denied;
    employeeId = user.employeeId;
  } else {
    const denied = await assertOrganizationRole(
      user.id,
      organizationId,
      PEOPLE_PAYROLL_ROLES,
      "Only People or payroll administrators can submit claims for another employee.",
    );
    if (denied) return denied;
  }

  if (
    !Number.isInteger(employeeId) ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    !description ||
    !/^\d{4}-\d{2}-\d{2}$/.test(incurredOn)
  ) {
    return Response.json({
      error: "employeeId, positive amount, description and YYYY-MM-DD incurredOn are required.",
    }, { status: 400 });
  }

  const [employee] = await db.select({ id: employees.id, orgUnitId: employees.orgUnitId }).from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.organizationId, organizationId)))
    .limit(1);
  if (!employee) return Response.json({ error: "Employee not found in this workspace." }, { status: 404 });
  if (user.role !== "employee") {
    const access = await getAccess(user.id, organizationId);
    const scope = assertScope(access, employee.orgUnitId);
    if (!scope.ok) return Response.json({ error: scope.error }, { status: scope.status });
  }

  const [row] = await db.insert(expenseClaims).values({
    organizationId,
    employeeId,
    submittedByUserId: user.id,
    category: category.slice(0, 60),
    description: description.slice(0, 240),
    amount: amount.toFixed(2),
    incurredOn,
    status: "pending",
  }).returning();

  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: "Expense claim submitted",
    resource: `${category.slice(0, 60)} ${amount.toFixed(2)}`,
    metadata: { claimId: row.id, employeeId },
  });

  return Response.json(row, { status: 201 });
}

export async function PATCH(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const id = Number(body.id);
  const status = String(body.status ?? "");
  if (!Number.isInteger(id) || !["approved", "rejected"].includes(status)) {
    return Response.json({ error: "id and status of approved/rejected are required." }, { status: 400 });
  }

  const [existing] = await db.select().from(expenseClaims).where(eq(expenseClaims.id, id)).limit(1);
  if (!existing) return Response.json({ error: "Claim not found." }, { status: 404 });

  const denied = await assertOrganizationRole(
    user.id,
    existing.organizationId,
    PEOPLE_PAYROLL_ROLES,
    "Only People or payroll administrators can decide expense claims.",
  );
  if (denied) return denied;
  const access = await getAccess(user.id, existing.organizationId);
  const [employee] = await db.select({ orgUnitId: employees.orgUnitId }).from(employees)
    .where(and(eq(employees.id, existing.employeeId), eq(employees.organizationId, existing.organizationId)))
    .limit(1);
  if (!employee) return Response.json({ error: "Employee not found in this workspace." }, { status: 404 });
  const scope = assertScope(access, employee.orgUnitId);
  if (!scope.ok) return Response.json({ error: scope.error }, { status: scope.status });
  const decided = await db.transaction(async tx => {
    // This lock pairs with expense report submission's claim-row locks.
    // Checking report membership outside this transaction would permit a
    // concurrent single-claim approval after the report was committed.
    await tx.execute(sql`select id from expense_claims where organization_id = ${existing.organizationId} and id = ${id} for update`);
    const [fresh] = await tx.select().from(expenseClaims).where(and(
      eq(expenseClaims.id, id), eq(expenseClaims.organizationId, existing.organizationId),
    )).limit(1);
    const [reported] = await tx.select({ id: expenseReportItems.id }).from(expenseReportItems)
      .where(and(eq(expenseReportItems.organizationId, existing.organizationId), eq(expenseReportItems.claimId, id))).limit(1);
    if (reported) throw new Error("CLAIM_IN_REPORT");
    if (!fresh || fresh.status !== "pending") throw new Error("CLAIM_STALE");
    // Legacy rows without a verified maker cannot satisfy independent
    // checker separation. Reconcile the origin before allowing a decision.
    if (fresh.submittedByUserId == null) throw new Error("CLAIM_MAKER_UNKNOWN");
    if (fresh.submittedByUserId === user.id) throw new Error("CLAIM_SELF_REVIEW");
    const [row] = await tx.update(expenseClaims).set({ status, decidedBy: user.name }).where(and(
      eq(expenseClaims.id, id), eq(expenseClaims.organizationId, existing.organizationId),
      eq(expenseClaims.status, "pending"),
    )).returning();
    if (!row) throw new Error("CLAIM_STALE");
    await tx.insert(auditEvents).values({
      organizationId: existing.organizationId, actor: user.name, action: `Expense claim ${status}`,
      resource: `${existing.category} ${existing.amount}`, metadata: { claimId: id, employeeId: existing.employeeId, actorUserId: user.id },
    });
    return row;
  }).catch(error => error instanceof Error ? error : new Error("CLAIM_STALE"));
  if (decided instanceof Error) {
    const message = decided.message === "CLAIM_IN_REPORT"
      ? "This claim belongs to an expense report. Decide the report in Spend management."
      : decided.message === "CLAIM_SELF_REVIEW"
        ? "You cannot approve or reject a claim you submitted."
        : decided.message === "CLAIM_MAKER_UNKNOWN"
          ? "The original submitter is unverified. Reconcile this legacy claim before approval."
          : "This claim already changed, or is no longer pending. Refresh before deciding.";
    return Response.json({ error: message }, { status: decided.message === "CLAIM_SELF_REVIEW" ? 403 : 409 });
  }

  return Response.json(decided);
}
