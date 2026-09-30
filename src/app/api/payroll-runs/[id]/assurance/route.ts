import { eq } from "drizzle-orm";
import { db } from "@/db";
import { payrollRuns } from "@/db/schema";
import { assertOrganizationRole, assertOrganizationUnitAccess, PAYROLL_OPERATOR_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { buildPayrollAssurance } from "@/lib/payroll-assurance-server";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const runId = Number(id);
  if (!Number.isInteger(runId)) {
    return Response.json({ error: "Invalid run id." }, { status: 400 });
  }

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId)).limit(1);
  if (!run) return Response.json({ error: "Payroll run not found." }, { status: 404 });

  const denied = await assertOrganizationRole(
    user.id,
    run.organizationId,
    PAYROLL_OPERATOR_ROLES,
    "Only payroll operators can inspect payroll assurance.",
  );
  if (denied) return denied;
  const scopeDenied = await assertOrganizationUnitAccess(
    user.id,
    run.organizationId,
    run.scopeOrgUnitId,
    "This payroll run is outside your assigned organization unit.",
  );
  if (scopeDenied) return scopeDenied;

  const result = await buildPayrollAssurance(runId);
  if (!result) return Response.json({ error: "Payroll run not found." }, { status: 404 });

  return Response.json({
    runId,
    previousRun: result.previousRun
      ? {
          id: result.previousRun.id,
          periodLabel: result.previousRun.periodLabel,
          payDate: result.previousRun.payDate,
          netPay: result.previousRun.netPay,
          grossPay: result.previousRun.grossPay,
        }
      : null,
    ...result.assurance,
  });
}
