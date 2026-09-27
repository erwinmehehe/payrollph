import { eq } from "drizzle-orm";
import { db } from "@/db";
import { employees, provisioningTasks } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { ensureLifecycleProvisioning } from "@/lib/provisioning";
import { assertMembership } from "@/lib/access";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const organizationId = Number(searchParams.get("organizationId") ?? "1");
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const deniedOrg = await assertMembership(user.id, organizationId);
  if (deniedOrg) return deniedOrg;
  await ensureLifecycleProvisioning(organizationId);

  const [tasks, staff] = await Promise.all([
    db.select().from(provisioningTasks).where(eq(provisioningTasks.organizationId, organizationId)),
    db.select().from(employees).where(eq(employees.organizationId, organizationId)),
  ]);

  const byEmployee = staff.map((employee) => {
    const items = tasks.filter((task) => task.employeeId === employee.id);
    return {
      employeeId: employee.id,
      name: `${employee.firstName} ${employee.lastName}`,
      status: employee.status,
      avatarInitials: employee.avatarInitials,
      onboarding: items.filter((item) => item.kind === "onboarding"),
      offboarding: items.filter((item) => item.kind === "offboarding"),
    };
  });

  return Response.json({ employees: byEmployee });
}

export async function PATCH(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const id = Number(body.id);
  const done = Boolean(body.done);
  if (!Number.isInteger(id)) return Response.json({ error: "id is required." }, { status: 400 });

  const [target] = await db.select({ organizationId: provisioningTasks.organizationId }).from(provisioningTasks).where(eq(provisioningTasks.id, id)).limit(1);
  if (!target) return Response.json({ error: "Task not found." }, { status: 404 });
  const deniedTask = await assertMembership(user.id, target.organizationId);
  if (deniedTask) return deniedTask;

  const [row] = await db.update(provisioningTasks).set({
    done,
    completedAt: done ? new Date() : null,
    completedBy: done ? user.name : null,
  }).where(eq(provisioningTasks.id, id)).returning();

  if (!row) return Response.json({ error: "Task not found." }, { status: 404 });

  await recordAuditEvent({
    organizationId: row.organizationId,
    actor: user.name,
    action: done ? "Provisioning item completed" : "Provisioning item reopened",
    resource: row.title,
    metadata: { taskId: row.id, employeeId: row.employeeId, kind: row.kind },
  });

  return Response.json(row);
}
