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

  // Keep every existing caller and flag-OFF response exactly as before. A
  // caller must also opt into the separate explanatory read; it never runs
  // during payroll creation, calculation, approval or release.
  // The default OFF path returns before URL parsing or any new module load.
  if (process.env.PAYROLL_EXPLANATION_AI_ENABLED !== "true") {
    return Response.json(readiness, {
      headers: { "Cache-Control": "private, no-store" },
    });
  }
  if (new URL(request.url).searchParams.get("explain") !== "true") {
    return Response.json(readiness, {
      headers: { "Cache-Control": "private, no-store" },
    });
  }
  const { criticalReleaseFlagEnabled } = await import("@/lib/critical-release-flags");
  if (!criticalReleaseFlagEnabled("payrollExplanationAi")) {
    return Response.json(readiness, {
      headers: { "Cache-Control": "private, no-store" },
    });
  }

  const { payrollExplanationAccess, generatePayrollFindingExplanation } =
    await import("@/lib/payroll-finding-explanations");
  if (payrollExplanationAccess(run.organizationId) !== "allowed") {
    return Response.json({ error: "PAYROLL_EXPLANATION_CONSENT_REQUIRED" }, {
      status: 403,
      headers: { "Cache-Control": "private, no-store" },
    });
  }

  // Consume only the existing phase-1 and post-calculation findings. Never
  // recompute an assurance decision or fetch PII for an external model.
  const { buildPayrollAssurance } = await import("@/lib/payroll-assurance-server");
  const assurance = await buildPayrollAssurance(run.id);
  if (!assurance || assurance.run.organizationId !== run.organizationId) {
    return Response.json({ error: "Payroll run not found." }, { status: 404 });
  }
  return Response.json({
    ...readiness,
    explanation: generatePayrollFindingExplanation([
      ...readiness.findings,
      ...assurance.assurance.findings,
    ]),
  }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
