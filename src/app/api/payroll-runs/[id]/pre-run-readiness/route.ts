import { eq } from "drizzle-orm";
import { db } from "@/db";
import { payrollRuns } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { assertOrganizationRole, assertOrganizationUnitAccess, PAYROLL_OPERATOR_ROLES } from "@/lib/access";
import { requireRunEmployer } from "@/lib/multi-entity-run-guard";
import { loadPayrollPreRunReadiness } from "@/lib/payroll-pre-run-readiness-server";

export const dynamic = "force-dynamic";

/** Read-only, tenant/employer-scoped pre-calculation evidence, not release assurance. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const runId = Number(id);
  if (!Number.isSafeInteger(runId) || runId <= 0) {
    return Response.json({ error: "Invalid run id." }, { status: 400 });
  }
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId)).limit(1);
  if (!run) return Response.json({ error: "Payroll run not found." }, { status: 404 });

  const orgDenied = await assertOrganizationRole(
    user.id, run.organizationId, PAYROLL_OPERATOR_ROLES,
    "Only payroll operators can inspect pre-calculation readiness.",
  );
  if (orgDenied) return orgDenied;
  const scopeDenied = await assertOrganizationUnitAccess(
    user.id, run.organizationId, run.scopeOrgUnitId,
    "This payroll run is outside your assigned organization unit.",
  );
  if (scopeDenied) return scopeDenied;
  const employerDenied = await requireRunEmployer({
    request, userId: user.id, organizationId: run.organizationId,
    legalEntityId: run.legalEntityId,
  });
  if (employerDenied) return employerDenied;

  const readiness = await loadPayrollPreRunReadiness(run);
  return Response.json(readiness, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
