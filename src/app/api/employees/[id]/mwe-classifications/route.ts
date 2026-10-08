import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertOrganizationRole, assertOrganizationUnitAccess, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import {
  createMweClassificationRequest,
  listMweClassifications,
} from "@/lib/mwe-classification";

export const dynamic = "force-dynamic";

async function loadEmployee(employeeId: number) {
  return (await db.select().from(employees).where(eq(employees.id, employeeId)).limit(1))[0] ?? null;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const employeeId = Number((await params).id);
  if (!Number.isInteger(employeeId)) return Response.json({ error: "Invalid employee id." }, { status: 400 });
  const employee = await loadEmployee(employeeId);
  if (!employee) return Response.json({ error: "Employee not found." }, { status: 404 });

  const denied = await assertOrganizationRole(
    user.id,
    employee.organizationId,
    PEOPLE_ADMIN_ROLES,
    "Only People administrators can review MWE classification history.",
  );
  if (denied) return denied;
  const scopeDenied = await assertOrganizationUnitAccess(
    user.id,
    employee.organizationId,
    employee.orgUnitId,
    "This employee is outside your assigned organization unit.",
  );
  if (scopeDenied) return scopeDenied;

  return Response.json({
    employee: {
      id: employee.id,
      employeeNo: employee.employeeNo,
      name: `${employee.firstName} ${employee.lastName}`,
      legacyMwe: employee.mwe,
      region: employee.region,
    },
    classifications: await listMweClassifications(employee.organizationId, employee.id),
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const demoDenied = publicDemoMutationDenied(user.email, "MWE tax classification governance");
  if (demoDenied) return demoDenied;

  const employeeId = Number((await params).id);
  if (!Number.isInteger(employeeId)) return Response.json({ error: "Invalid employee id." }, { status: 400 });
  const employee = await loadEmployee(employeeId);
  if (!employee) return Response.json({ error: "Employee not found." }, { status: 404 });

  const denied = await assertOrganizationRole(
    user.id,
    employee.organizationId,
    PEOPLE_ADMIN_ROLES,
    "Only People administrators can submit MWE classification evidence.",
  );
  if (denied) return denied;
  const scopeDenied = await assertOrganizationUnitAccess(
    user.id,
    employee.organizationId,
    employee.orgUnitId,
    "This employee is outside your assigned organization unit.",
  );
  if (scopeDenied) return scopeDenied;

  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: "mwe-classification-submit",
    resourceId: employee.id,
    limit: 12,
    windowMs: 15 * 60_000,
  });
  if (rateDenied) return rateDenied;

  const body = await request.json().catch(() => ({}));
  if (typeof body.isMwe !== "boolean") {
    return Response.json({ error: "isMwe must be explicitly true or false." }, { status: 422 });
  }

  try {
    const classification = await createMweClassificationRequest({
      organizationId: employee.organizationId,
      employeeId: employee.id,
      isMwe: body.isMwe,
      region: String(body.region ?? employee.region ?? "NCR"),
      employeeDailyWage: Number(body.employeeDailyWage),
      statutoryMinimumWage: Number(body.statutoryMinimumWage),
      wageOrderReference: String(body.wageOrderReference ?? ""),
      evidenceReference: String(body.evidenceReference ?? ""),
      effectiveFrom: String(body.effectiveFrom ?? ""),
      effectiveUntil: body.effectiveUntil == null ? null : String(body.effectiveUntil),
      requestedByUserId: user.id,
      requestedByName: user.name,
    });
    return Response.json({ classification }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not submit MWE classification.";
    return Response.json({ error: message }, {
      status: /already has a pending|already starts/i.test(message) ? 409 : 422,
    });
  }
}
