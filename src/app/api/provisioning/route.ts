import { enforceSameOriginMutation } from "@/lib/security-request";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { employees, provisioningTasks } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { ensureLifecycleProvisioning } from "@/lib/provisioning";
import { assertOrganizationRole, assertScope, getAccess, PEOPLE_ADMIN_ROLES } from "@/lib/access";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const organizationId = Number(searchParams.get("organizationId") ?? "1");
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const deniedOrg = await assertOrganizationRole(
    user.id,
    organizationId,
    PEOPLE_ADMIN_ROLES,
    "Your role is not allowed to view this HR workflow.",
  );
  if (deniedOrg) return deniedOrg;
  const access = await getAccess(user.id, organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });
  await ensureLifecycleProvisioning(organizationId);

  const [tasks, staff] = await Promise.all([
    db.select().from(provisioningTasks).where(eq(provisioningTasks.organizationId, organizationId)),
    db.select().from(employees).where(eq(employees.organizationId, organizationId)),
  ]);

  const visibleStaff = access.companyWide ? staff : staff.filter((employee) => employee.orgUnitId === access.orgUnitId);
  const byEmployee = visibleStaff.map((employee) => {
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
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const id = Number(body.id);
  const done = Boolean(body.done);
  if (!Number.isInteger(id)) return Response.json({ error: "id is required." }, { status: 400 });

  const [target] = await db.select({ organizationId: provisioningTasks.organizationId, employeeId: provisioningTasks.employeeId }).from(provisioningTasks).where(eq(provisioningTasks.id, id)).limit(1);
  if (!target) return Response.json({ error: "Task not found." }, { status: 404 });
  const deniedTask = await assertOrganizationRole(
    user.id,
    target.organizationId,
    PEOPLE_ADMIN_ROLES,
    "Your role is not allowed to update provisioning tasks.",
  );
  if (deniedTask) return deniedTask;
  const access = await getAccess(user.id, target.organizationId);
  if (!access) return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });
  if (target.employeeId != null) {
    const [employee] = await db.select({ orgUnitId: employees.orgUnitId }).from(employees)
      .where(eq(employees.id, target.employeeId))
      .limit(1);
    if (!employee) return Response.json({ error: "Employee not found for this provisioning task." }, { status: 404 });
    const scope = assertScope(access, employee.orgUnitId);
    if (!scope.ok) return Response.json({ error: scope.error }, { status: scope.status });
  } else if (!access.companyWide) {
    return Response.json({ error: "Unit-scoped roles cannot update company-wide provisioning tasks." }, { status: 403 });
  }

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
