import { enforceSameOriginMutation } from "@/lib/security-request";
import { and, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { earnedWageRequests, employees, timePunches } from "@/db/schema";
import { assertMembership, assertOrganizationRole, assertScope, getAccess, PEOPLE_PAYROLL_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { computeEwa } from "@/lib/ewa";

export const dynamic = "force-dynamic";

function periodStart() {
  const now = new Date();
  const day = now.getDate();
  const start = new Date(now.getFullYear(), now.getMonth(), day <= 15 ? 1 : 16);
  return start.toISOString().slice(0, 10);
}

async function earnedDays(employeeId: number) {
  const rows = await db.select().from(timePunches)
    .where(and(eq(timePunches.employeeId, employeeId), gte(timePunches.workDate, periodStart())));
  return rows.filter((punch) => punch.timeIn && punch.timeOut).length;
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  let employeeId = Number(url.searchParams.get("employeeId") ?? 0);
  let adminAccess: Awaited<ReturnType<typeof getAccess>> = null;
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

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
      "Only People or payroll administrators can view earned-wage requests.",
    );
    if (denied) return denied;
    adminAccess = await getAccess(user.id, organizationId);
    if (!adminAccess) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });
  }

  const allRequests = await db.select().from(earnedWageRequests)
    .where(eq(earnedWageRequests.organizationId, organizationId))
    .orderBy(earnedWageRequests.id);

  let requests = user.role === "employee"
    ? allRequests.filter((requestRow) => requestRow.employeeId === employeeId)
    : allRequests;
  if (user.role !== "employee" && adminAccess && !adminAccess.companyWide) {
    const staff = await db.select({ id: employees.id, orgUnitId: employees.orgUnitId }).from(employees)
      .where(eq(employees.organizationId, organizationId));
    const visibleIds = new Set(staff.filter((employee) => employee.orgUnitId === adminAccess!.orgUnitId).map((employee) => employee.id));
    requests = requests.filter((requestRow) => visibleIds.has(requestRow.employeeId));
  }

  let eligibility = null;
  if (employeeId > 0) {
    const [employee] = await db.select().from(employees)
      .where(and(eq(employees.id, employeeId), eq(employees.organizationId, organizationId)))
      .limit(1);

    if (employee) {
      if (user.role !== "employee") {
        const scope = assertScope(adminAccess, employee.orgUnitId);
        if (!scope.ok) return Response.json({ error: scope.error }, { status: scope.status });
      }
      const daysWorked = await earnedDays(employeeId);
      const advances = allRequests
        .filter((row) => row.employeeId === employeeId && row.status === "approved" && row.payrollRunId == null)
        .reduce((sum, row) => sum + Number(row.requestedAmount) + Number(row.fee), 0);

      const check = computeEwa({
        monthlyBasic: Number(employee.basicRate),
        daysWorked,
        existingAdvances: advances,
        status: employee.status,
        hasPendingRequest: allRequests.some((row) => row.employeeId === employeeId && row.status === "pending"),
      });
      eligibility = { ...check, employeeId, daysWorked };
    }
  }

  return Response.json({ requests, eligibility });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  let employeeId = Number(body.employeeId);
  let adminAccess: Awaited<ReturnType<typeof getAccess>> = null;
  const requested = Number(body.requestedAmount);

  if (!Number.isInteger(organizationId) || !Number.isFinite(requested) || requested <= 0) {
    return Response.json({ error: "organizationId and a positive requestedAmount are required." }, { status: 400 });
  }

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
      "Only People or payroll administrators can submit advances for another employee.",
    );
    if (denied) return denied;
    adminAccess = await getAccess(user.id, organizationId);
    if (!adminAccess) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });
  }

  if (!Number.isInteger(employeeId)) return Response.json({ error: "employeeId is required." }, { status: 400 });

  const [employee] = await db.select().from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.organizationId, organizationId)))
    .limit(1);
  if (!employee) return Response.json({ error: "Employee not found in this workspace." }, { status: 404 });
  if (user.role !== "employee") {
    const scope = assertScope(adminAccess, employee.orgUnitId);
    if (!scope.ok) return Response.json({ error: scope.error }, { status: scope.status });
  }

  const daysWorked = await earnedDays(employeeId);
  const existing = await db.select().from(earnedWageRequests)
    .where(eq(earnedWageRequests.organizationId, organizationId));
  const advances = existing
    .filter((row) => row.employeeId === employeeId && row.status === "approved" && row.payrollRunId == null)
    .reduce((sum, row) => sum + Number(row.requestedAmount) + Number(row.fee), 0);

  const check = computeEwa({
    monthlyBasic: Number(employee.basicRate),
    daysWorked,
    existingAdvances: advances,
    requested,
    status: employee.status,
    hasPendingRequest: existing.some((row) => row.employeeId === employeeId && row.status === "pending"),
  });

  if (!check.eligible) {
    return Response.json({ error: "Advance not permitted.", reasons: check.reasons, maxAdvance: check.maxAdvance }, { status: 422 });
  }

  const [row] = await db.insert(earnedWageRequests).values({
    organizationId,
    employeeId,
    requestedAmount: requested.toFixed(2),
    fee: check.fee.toFixed(2),
    status: "pending",
  }).returning();

  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: "Earned wage advance requested",
    resource: `${employee.firstName} ${employee.lastName} ${requested.toFixed(2)}`,
    metadata: { requestId: row.id, employeeId, daysWorked, maxAdvance: check.maxAdvance },
  });

  return Response.json({ request: row, eligibility: { ...check, employeeId, daysWorked } }, { status: 201 });
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

  const [existing] = await db.select().from(earnedWageRequests).where(eq(earnedWageRequests.id, id)).limit(1);
  if (!existing) return Response.json({ error: "Request not found." }, { status: 404 });

  const denied = await assertOrganizationRole(
    user.id,
    existing.organizationId,
    PEOPLE_PAYROLL_ROLES,
    "Only People or payroll administrators can decide earned-wage requests.",
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
    return Response.json({ error: `This request is already ${existing.status} and cannot be decided again.` }, { status: 409 });
  }

  const [row] = await db.update(earnedWageRequests)
    .set({ status, decidedBy: user.name })
    .where(and(eq(earnedWageRequests.id, id), eq(earnedWageRequests.status, "pending")))
    .returning();
  if (!row) return Response.json({ error: "Request changed before the decision was saved. Refresh and retry." }, { status: 409 });

  await recordAuditEvent({
    organizationId: existing.organizationId,
    actor: user.name,
    action: `Earned wage advance ${status}`,
    resource: `request ${id}`,
    metadata: { requestId: id, employeeId: existing.employeeId, amount: existing.requestedAmount },
  });

  return Response.json(row);
}
