import { eq } from "drizzle-orm";
import { db } from "@/db";
import { employees } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
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

  const [updated] = await db.update(employees)
    .set(patch)
    .where(eq(employees.id, session.employeeId))
    .returning({
      mobile: employees.mobile,
      emergencyContact: employees.emergencyContact,
      emergencyPhone: employees.emergencyPhone,
    });

  await recordAuditEvent({
    organizationId: employee.organizationId,
    actor: session.name,
    action: "Employee self-service profile updated",
    resource: employee.employeeNo,
    metadata: {
      employeeId: employee.id,
      fields: Object.keys(patch),
      payrollSensitiveFieldsChanged: false,
    },
  });

  return Response.json({ profile: updated });
}
