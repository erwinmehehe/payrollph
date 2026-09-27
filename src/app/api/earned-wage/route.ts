import { and, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { earnedWageRequests, employees, timePunches } from "@/db/schema";
import { assertMembership } from "@/lib/access";
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

/** Days with a complete punch pair in the current semi-monthly period. */
async function earnedDays(employeeId: number) {
  const rows = await db.select().from(timePunches)
    .where(and(eq(timePunches.employeeId, employeeId), gte(timePunches.workDate, periodStart())));
  return rows.filter((p) => p.timeIn && p.timeOut).length;
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId") ?? 1);
  const employeeId = Number(url.searchParams.get("employeeId") ?? 0);

  const denied = await assertMembership(user.id, organizationId);
  if (denied) return denied;

  const requests = await db.select().from(earnedWageRequests)
    .where(eq(earnedWageRequests.organizationId, organizationId))
    .orderBy(earnedWageRequests.id);

  let eligibility = null;
  if (employeeId) {
    const [employee] = await db.select().from(employees).where(eq(employees.id, employeeId));
    if (employee && employee.organizationId === organizationId) {
      const daysWorked = await earnedDays(employeeId);
      const advances = requests
        .filter((r) => r.employeeId === employeeId && r.status === "approved" && r.payrollRunId == null)
        .reduce((s, r) => s + Number(r.requestedAmount) + Number(r.fee), 0);
      eligibility = computeEwa({
        monthlyBasic: Number(employee.basicRate),
        daysWorked,
        existingAdvances: advances,
        status: employee.status,
        hasPendingRequest: requests.some((r) => r.employeeId === employeeId && r.status === "pending"),
      });
      eligibility = { ...eligibility, employeeId, daysWorked };
    }
  }

  return Response.json({ requests, eligibility });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const employeeId = Number(body.employeeId);
  const requested = Number(body.requestedAmount);

  const denied = await assertMembership(user.id, organizationId);
  if (denied) return denied;

  const [employee] = await db.select().from(employees).where(eq(employees.id, employeeId));
  if (!employee || employee.organizationId !== organizationId) {
    return Response.json({ error: "Employee not found in this workspace." }, { status: 404 });
  }

  const daysWorked = await earnedDays(employeeId);
  const existing = await db.select().from(earnedWageRequests)
    .where(eq(earnedWageRequests.organizationId, organizationId));
  const advances = existing
    .filter((r) => r.employeeId === employeeId && r.status === "approved" && r.payrollRunId == null)
    .reduce((s, r) => s + Number(r.requestedAmount) + Number(r.fee), 0);

  const check = computeEwa({
    monthlyBasic: Number(employee.basicRate),
    daysWorked,
    existingAdvances: advances,
    requested,
    status: employee.status,
    hasPendingRequest: existing.some((r) => r.employeeId === employeeId && r.status === "pending"),
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
    metadata: { requestId: row.id, daysWorked, maxAdvance: check.maxAdvance },
  });

  return Response.json({ request: row, eligibility: { ...check, employeeId, daysWorked } }, { status: 201 });
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

  const [existing] = await db.select().from(earnedWageRequests).where(eq(earnedWageRequests.id, id));
  if (!existing) return Response.json({ error: "Request not found." }, { status: 404 });
  const denied = await assertMembership(user.id, existing.organizationId);
  if (denied) return denied;

  const [row] = await db.update(earnedWageRequests).set({ status, decidedBy: user.name })
    .where(eq(earnedWageRequests.id, id)).returning();

  await recordAuditEvent({
    organizationId: existing.organizationId,
    actor: user.name,
    action: `Earned wage advance ${status}`,
    resource: `request ${id}`,
    metadata: { requestId: id, employeeId: existing.employeeId, amount: existing.requestedAmount },
  });

  return Response.json(row);
}
