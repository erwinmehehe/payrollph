import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { approvalTasks, employees, leaveRequests } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { assertPermission } from "@/lib/access";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const organizationId = Number(searchParams.get("organizationId") ?? "1");
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const deniedOrg = await assertPermission(user.id, organizationId, "hr:read");
  if (deniedOrg) return deniedOrg;
  const rows = await db.select({
    leave: leaveRequests,
    employee: employees,
  })
    .from(leaveRequests)
    .innerJoin(employees, eq(leaveRequests.employeeId, employees.id))
    .where(eq(leaveRequests.organizationId, organizationId))
    .orderBy(desc(leaveRequests.id));

  return Response.json({
    requests: rows.map(({ leave, employee }) => ({
      ...leave,
      employeeName: `${employee.firstName} ${employee.lastName}`,
      avatarInitials: employee.avatarInitials,
    })),
  });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const employeeId = Number(body.employeeId);
  const leaveType = String(body.leaveType ?? "").trim();
  const startDate = String(body.startDate ?? "").trim();
  const endDate = String(body.endDate ?? "").trim();
  const days = Number(body.days);
  const reason = String(body.reason ?? "").trim();

  if (!Number.isInteger(organizationId) || !Number.isInteger(employeeId) || !leaveType || !startDate || !endDate || !Number.isFinite(days) || days <= 0) {
    return Response.json({ error: "organizationId, employeeId, leaveType, startDate, endDate and positive days are required." }, { status: 400 });
  }

  const denied = await assertPermission(user.id, organizationId, "hr:manage");
  if (denied) return denied;

  const [employee] = await db.select().from(employees).where(eq(employees.id, employeeId));
  if (!employee || employee.organizationId !== organizationId) {
    return Response.json({ error: "Employee not found in this organization." }, { status: 404 });
  }

  const [task] = await db.insert(approvalTasks).values({
    organizationId,
    title: `Approve leave request`,
    detail: `${employee.firstName} ${employee.lastName} · ${leaveType} · ${startDate}–${endDate}`,
    approver: "Mariel Santos",
    dueLabel: "Due in 2 days",
    priority: "Normal",
  }).returning();

  const [row] = await db.insert(leaveRequests).values({
    organizationId,
    employeeId,
    leaveType,
    startDate,
    endDate,
    days: days.toFixed(1),
    reason,
    status: "Pending",
    approvalTaskId: task.id,
  }).returning();

  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: "Leave request submitted",
    resource: `${employee.firstName} ${employee.lastName} · ${leaveType}`,
    metadata: { leaveId: row.id, taskId: task.id },
  });

  return Response.json(row, { status: 201 });
}
