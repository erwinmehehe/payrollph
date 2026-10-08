import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { employeeMweClassifications, employees } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import {
  assertOrganizationRole,
  assertOrganizationUnitAccess,
  PAYROLL_TAX_APPROVER_ROLES,
} from "@/lib/access";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import { decideMweClassificationRequest } from "@/lib/mwe-classification";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; classificationId: string }> },
) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const demoDenied = publicDemoMutationDenied(user.email, "MWE tax classification governance");
  if (demoDenied) return demoDenied;

  const values = await params;
  const employeeId = Number(values.id);
  const classificationId = Number(values.classificationId);
  if (!Number.isInteger(employeeId) || !Number.isInteger(classificationId)) {
    return Response.json({ error: "Invalid employee or classification id." }, { status: 400 });
  }

  const [classification] = await db.select().from(employeeMweClassifications).where(and(
    eq(employeeMweClassifications.id, classificationId),
    eq(employeeMweClassifications.employeeId, employeeId),
  )).limit(1);
  if (!classification) return Response.json({ error: "MWE classification request not found." }, { status: 404 });
  const [employee] = await db.select().from(employees).where(and(
    eq(employees.id, employeeId),
    eq(employees.organizationId, classification.organizationId),
  )).limit(1);
  if (!employee) return Response.json({ error: "Employee not found." }, { status: 404 });

  const denied = await assertOrganizationRole(
    user.id,
    classification.organizationId,
    PAYROLL_TAX_APPROVER_ROLES,
    "Only an authorized payroll tax checker can decide MWE classifications.",
  );
  if (denied) return denied;
  const scopeDenied = await assertOrganizationUnitAccess(
    user.id,
    classification.organizationId,
    employee.orgUnitId,
    "This employee is outside your assigned organization unit.",
  );
  if (scopeDenied) return scopeDenied;

  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: "mwe-classification-decision",
    resourceId: classificationId,
    limit: 12,
    windowMs: 15 * 60_000,
  });
  if (rateDenied) return rateDenied;

  const body = await request.json().catch(() => ({}));
  const decision = body.decision === "approve" || body.decision === "reject"
    ? body.decision
    : null;
  if (!decision) {
    return Response.json({ error: "decision must be approve or reject." }, { status: 422 });
  }

  const result = await decideMweClassificationRequest({
    organizationId: classification.organizationId,
    classificationId,
    decidedByUserId: user.id,
    decidedByName: user.name,
    decision,
    decisionNote: String(body.decisionNote ?? "").trim() || null,
  });

  if (result.kind === "not_found") return Response.json({ error: "Classification request not found." }, { status: 404 });
  if (result.kind === "forbidden") return Response.json({ error: result.message }, { status: 403 });
  if (result.kind === "conflict" || result.kind === "busy") {
    return Response.json({ error: result.message }, { status: 409 });
  }
  return Response.json(result);
}
