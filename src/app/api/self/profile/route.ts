import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, employees, userOrganizations } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import { enforceSameOriginMutation } from "@/lib/security-request";
import { assertMembership } from "@/lib/access";

export const dynamic = "force-dynamic";

function clean(value: unknown, max: number) {
  if (value === undefined) return undefined;
  const text = String(value ?? "").trim();
  return text ? text.slice(0, max) : null;
}

export async function PATCH(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const session = await getSessionUser();
  if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
  if (session.role !== "employee" || !session.employeeId) {
    return Response.json({ error: "Employee self-service account required." }, { status: 403 });
  }
  const demoDenied = publicDemoMutationDenied(session.email, "Updating employee self-service profile");
  if (demoDenied) return demoDenied;

  const [employee] = await db.select().from(employees)
    .where(eq(employees.id, session.employeeId))
    .limit(1);
  if (!employee) return Response.json({ error: "Employee record not found." }, { status: 404 });
  const membershipDenied = await assertMembership(session.id, employee.organizationId);
  if (membershipDenied) return membershipDenied;

  const body = await request.json().catch(() => ({}));
  const updates = {
    mobile: clean(body.mobile, 24),
    emergencyContact: clean(body.emergencyContact, 120),
    emergencyPhone: clean(body.emergencyPhone, 32),
  };
  const patch = Object.fromEntries(Object.entries(updates).filter(([, value]) => value !== undefined));
  if (!Object.keys(patch).length) {
    return Response.json({ error: "No editable self-service profile fields were provided." }, { status: 400 });
  }

  // The preliminary membership check enforces the ordinary workspace and
  // session policies. Repeat the employee and active membership binding under
  // row locks, so a concurrent revocation or reassignment cannot authorize a
  // late contact write. The audit receipt and contact edit commit together.
  const updated = await db.transaction(async (tx) => {
    const [boundEmployee] = await tx.select({
      id: employees.id,
      employeeNo: employees.employeeNo,
      organizationId: employees.organizationId,
    }).from(employees).where(and(
      eq(employees.id, session.employeeId),
      eq(employees.organizationId, employee.organizationId),
    )).for("update").limit(1);
    if (!boundEmployee) return null;

    // FOR SHARE serializes this write with the membership row's revocation.
    // A secondary employer grant never authorizes the original employee row.
    const [membership] = await tx.select({
      id: userOrganizations.id,
      role: userOrganizations.role,
      workerEmployeeId: userOrganizations.workerEmployeeId,
    }).from(userOrganizations).where(and(
      eq(userOrganizations.userId, session.id),
      eq(userOrganizations.organizationId, boundEmployee.organizationId),
      eq(userOrganizations.active, true),
    )).for("share").limit(1);
    if (!membership || membership.role === "group_hr" ||
        (membership.workerEmployeeId != null &&
         membership.workerEmployeeId !== boundEmployee.id)) return null;

    const [changed] = await tx.update(employees)
      .set(patch)
      .where(and(
        eq(employees.id, boundEmployee.id),
        eq(employees.organizationId, boundEmployee.organizationId),
      ))
      .returning({
        mobile: employees.mobile,
        emergencyContact: employees.emergencyContact,
        emergencyPhone: employees.emergencyPhone,
      });
    if (!changed) return null;

    await tx.insert(auditEvents).values({
      organizationId: boundEmployee.organizationId,
      actor: session.name,
      action: "Employee self-service profile updated",
      resource: boundEmployee.employeeNo,
      metadata: {
        employeeId: boundEmployee.id,
        fields: Object.keys(patch),
        payrollSensitiveFieldsChanged: false,
      },
    });
    return changed;
  });
  if (!updated) {
    return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });
  }
  return Response.json({ profile: updated });
}
