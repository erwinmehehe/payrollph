import { enforceSameOriginMutation } from "@/lib/security-request";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees, expenseClaims } from "@/db/schema";
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
  const approved = visibleRows.filter((row) => row.status === "approved" && row.payrollRunId == null);

  return Response.json({
    claims: visibleRows,
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
  if (existing.status !== "pending") {
    return Response.json({ error: `This claim is already ${existing.status} and cannot be decided again.` }, { status: 409 });
  }

  const [row] = await db.update(expenseClaims)
    .set({ status, decidedBy: user.name })
    .where(and(eq(expenseClaims.id, id), eq(expenseClaims.status, "pending")))
    .returning();
  if (!row) return Response.json({ error: "Claim changed before the decision was saved. Refresh and retry." }, { status: 409 });

  await recordAuditEvent({
    organizationId: existing.organizationId,
    actor: user.name,
    action: `Expense claim ${status}`,
    resource: `${existing.category} ${existing.amount}`,
    metadata: { claimId: id, employeeId: existing.employeeId },
  });

  return Response.json(row);
}
