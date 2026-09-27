import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees, expenseClaims } from "@/db/schema";
import { assertAnyPermission } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId") ?? 1);
  const status = url.searchParams.get("status");

  const denied = await assertAnyPermission(user.id, organizationId, ["finance:read", "hr:read"]);
  if (denied) return denied;

  const rows = await db.select().from(expenseClaims)
    .where(
      status
        ? and(eq(expenseClaims.organizationId, organizationId), eq(expenseClaims.status, status))
        : eq(expenseClaims.organizationId, organizationId),
    )
    .orderBy(desc(expenseClaims.createdAt));

  const approved = rows.filter((r) => r.status === "approved" && r.payrollRunId == null);
  return Response.json({
    claims: rows,
    pendingReimbursement: Number(approved.reduce((s, r) => s + Number(r.amount), 0).toFixed(2)),
  });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const employeeId = Number(body.employeeId);
  const amount = Number(body.amount);
  const description = String(body.description ?? "").trim();
  const category = String(body.category ?? "Other").trim();
  const incurredOn = String(body.incurredOn ?? "").trim();

  const denied = await assertAnyPermission(user.id, organizationId, ["finance:manage", "hr:manage"]);
  if (denied) return denied;

  if (!employeeId || !Number.isFinite(amount) || amount <= 0 || !description || !/^\d{4}-\d{2}-\d{2}$/.test(incurredOn)) {
    return Response.json({ error: "employeeId, positive amount, description and YYYY-MM-DD incurredOn are required." }, { status: 400 });
  }
  const [employee] = await db.select({ organizationId: employees.organizationId }).from(employees).where(eq(employees.id, employeeId)).limit(1);
  if (!employee || employee.organizationId !== organizationId) return Response.json({ error: "Employee not found in this workspace." }, { status: 404 });

  const [row] = await db.insert(expenseClaims).values({
    organizationId,
    employeeId,
    category,
    description,
    amount: amount.toFixed(2),
    incurredOn,
    status: "pending",
  }).returning();

  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: "Expense claim submitted",
    resource: `${category} ${amount.toFixed(2)}`,
    metadata: { claimId: row.id, employeeId },
  });

  return Response.json(row, { status: 201 });
}

export async function PATCH(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const id = Number(body.id);
  const status = String(body.status ?? "");
  if (!id || !["approved", "rejected"].includes(status)) {
    return Response.json({ error: "id and status of approved/rejected are required." }, { status: 400 });
  }

  const [existing] = await db.select().from(expenseClaims).where(eq(expenseClaims.id, id));
  if (!existing) return Response.json({ error: "Claim not found." }, { status: 404 });
  const denied = await assertAnyPermission(user.id, existing.organizationId, ["finance:manage", "hr:manage"]);
  if (denied) return denied;

  const [row] = await db.update(expenseClaims).set({ status, decidedBy: user.name })
    .where(eq(expenseClaims.id, id)).returning();

  await recordAuditEvent({
    organizationId: existing.organizationId,
    actor: user.name,
    action: `Expense claim ${status}`,
    resource: `${existing.category} ${existing.amount}`,
    metadata: { claimId: id, employeeId: existing.employeeId },
  });

  return Response.json(row);
}
