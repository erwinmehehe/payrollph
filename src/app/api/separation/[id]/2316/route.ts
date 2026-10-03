import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { employees, organizations, separationRecords } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import {
  assertOrganizationRole,
  assertScope,
  getAccess,
  PEOPLE_PAYROLL_ROLES,
} from "@/lib/access";
import { decryptGovernmentId } from "@/lib/government-id-crypto";
import { renderForm2316, type AnnualizationResult } from "@/lib/annualization";
import { requireSensitiveActionMfa } from "@/lib/security-request";
import { recordAuditEvent } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * Generates the offboarding Form 2316 draft directly from the immutable
 * annualization snapshot approved with final pay.
 *
 * The rendered certificate contains full TIN data, so it is generated
 * on-demand after recent MFA and is never persisted as plaintext in Documents.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionUser();
  if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });

  const id = Number((await params).id);
  if (!Number.isInteger(id)) {
    return Response.json({ error: "Invalid separation id." }, { status: 400 });
  }

  const [separation] = await db.select().from(separationRecords)
    .where(eq(separationRecords.id, id))
    .limit(1);
  if (!separation) {
    return Response.json({ error: "Separation record not found." }, { status: 404 });
  }

  const denied = await assertOrganizationRole(
    session.id,
    separation.organizationId,
    PEOPLE_PAYROLL_ROLES,
    "Only authorized People/payroll administrators can generate an offboarding BIR 2316 draft.",
  );
  if (denied) return denied;

  const access = await getAccess(session.id, separation.organizationId);
  if (!access) {
    return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });
  }

  const [employee] = await db.select().from(employees).where(and(
    eq(employees.id, separation.employeeId),
    eq(employees.organizationId, separation.organizationId),
  )).limit(1);
  if (!employee) {
    return Response.json({ error: "Employee not found in this workspace." }, { status: 404 });
  }

  const scope = assertScope(access, employee.orgUnitId);
  if (!scope.ok) return Response.json({ error: scope.error }, { status: scope.status });

  const mfaDenied = requireSensitiveActionMfa(session);
  if (mfaDenied) return mfaDenied;

  if (separation.status !== "released") {
    return Response.json({
      error: "Offboarding BIR 2316 is available only after final pay is approved and released.",
    }, { status: 409 });
  }

  const snapshot = (separation.computationSnapshot ?? {}) as Record<string, unknown>;
  const annualization = snapshot.annualization as AnnualizationResult | undefined;
  if (!annualization) {
    return Response.json({
      error: "This separation package does not contain an approved annualization snapshot. Recompute final pay before generating BIR 2316.",
    }, { status: 409 });
  }

  const [organization] = await db.select().from(organizations)
    .where(eq(organizations.id, separation.organizationId))
    .limit(1);
  if (!organization) {
    return Response.json({ error: "Organization not found." }, { status: 404 });
  }

  const digits = (value: string | null | undefined) => (value ?? "").replace(/\D/g, "");
  const employerTin = digits(organization.birTin);
  const employerBranch = digits(organization.birBranchCode).padStart(4, "0").slice(-4);
  const employeeTin = digits(decryptGovernmentId(employee.tin));
  const employeeBranch = digits(decryptGovernmentId(employee.tinBranchCode)).padStart(4, "0").slice(-4);

  if (employerTin.length !== 9 || employerBranch.length !== 4) {
    return Response.json({
      error: "Employer BIR TIN and 4-digit branch code are required before generating BIR 2316.",
    }, { status: 422 });
  }
  if (employeeTin.length !== 9 || employeeBranch.length !== 4) {
    return Response.json({
      error: "Employee BIR TIN and 4-digit branch code are required before generating BIR 2316.",
    }, { status: 422 });
  }

  const taxYear = Number(String(separation.lastDay).slice(0, 4));
  const body = renderForm2316({
    taxYear,
    employerName: organization.legalName ?? organization.name,
    employerTin: `${employerTin}-${employerBranch}`,
    employeeName: [employee.firstName, employee.middleName, employee.lastName]
      .filter(Boolean)
      .join(" "),
    employeeNo: employee.employeeNo,
    employeeTin: `${employeeTin}-${employeeBranch}`,
    result: annualization,
  });

  await recordAuditEvent({
    organizationId: separation.organizationId,
    actor: session.name,
    action: "Offboarding BIR 2316 draft generated",
    resource: `Separation #${separation.id}`,
    metadata: {
      separationId: separation.id,
      employeeId: employee.id,
      taxYear,
      annualizationRuleVersion: annualization.ruleVersion,
      plaintextCertificatePersisted: false,
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="bir-2316-draft-${employee.employeeNo}-${taxYear}.txt"`,
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
