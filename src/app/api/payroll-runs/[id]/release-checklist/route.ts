import { eq } from "drizzle-orm";
import { db } from "@/db";
import { payrollRuns } from "@/db/schema";
import { assertOrganizationRole, assertOrganizationUnitAccess, PAYROLL_VIEW_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import { buildPayrollReleaseChecklist } from "@/lib/payroll-release-checklist";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const runId = Number(id);
  if (!Number.isInteger(runId)) return Response.json({ error: "Invalid run id." }, { status: 400 });
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId)).limit(1);
  if (!run) return Response.json({ error: "Payroll run not found." }, { status: 404 });
  const denied = await assertOrganizationRole(user.id, run.organizationId, PAYROLL_VIEW_ROLES, "Your role cannot inspect payroll release readiness.");
  if (denied) return denied;
  const scopeDenied = await assertOrganizationUnitAccess(
    user.id,
    run.organizationId,
    run.scopeOrgUnitId,
    "This payroll run is outside your assigned organization unit.",
  );
  if (scopeDenied) return scopeDenied;
  const checklist = await buildPayrollReleaseChecklist(runId);
  if (!checklist) return Response.json({ error: "Payroll run not found." }, { status: 404 });
  return Response.json({
    runId,
    ready: checklist.ready,
    items: checklist.items,
    approvalStatus: checklist.approval?.status ?? "Not submitted",
    assuranceSummary: checklist.assurance?.summary ?? null,
  });
}
