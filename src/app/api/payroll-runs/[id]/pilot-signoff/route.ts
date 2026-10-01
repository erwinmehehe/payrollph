import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, payrollEntries, payrollRuns, payslips } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import {
  assertOrganizationRole,
  assertOrganizationUnitAccess,
  PAYROLL_DISBURSEMENT_ROLES,
} from "@/lib/access";
import { enforceSameOriginMutation, requireSensitiveActionMfa } from "@/lib/security-request";

export const dynamic = "force-dynamic";

const REQUIRED_CHECKS = [
  "grossPay",
  "deductions",
  "netPay",
  "withholdingTax",
  "statutoryContributions",
  "payoutTotal",
  "payslips",
  "accountingExport",
] as const;

type PilotCheck = (typeof REQUIRED_CHECKS)[number];

function eventBelongsToRun(event: typeof auditEvents.$inferSelect, runId: number) {
  if (!event.metadata || typeof event.metadata !== "object") return false;
  return Number((event.metadata as Record<string, unknown>).runId) === runId;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  if (process.env.NODE_ENV !== "production") {
    return Response.json(
      { error: "Production payroll pilot sign-off can only be recorded in the production environment." },
      { status: 409 },
    );
  }

  const { id } = await params;
  const runId = Number(id);
  if (!Number.isInteger(runId)) {
    return Response.json({ error: "Invalid payroll run id." }, { status: 400 });
  }

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const demoDenied = publicDemoMutationDenied(user.email, "Production payroll pilot sign-off");
  if (demoDenied) return demoDenied;

  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId)).limit(1);
  if (!run) return Response.json({ error: "Payroll run not found." }, { status: 404 });

  const denied = await assertOrganizationRole(
    user.id,
    run.organizationId,
    PAYROLL_DISBURSEMENT_ROLES,
    "Only the workspace owner can sign off the production payroll pilot.",
  );
  if (denied) return denied;

  const scopeDenied = await assertOrganizationUnitAccess(
    user.id,
    run.organizationId,
    run.scopeOrgUnitId,
    "This payroll run is outside your assigned organization unit.",
  );
  if (scopeDenied) return scopeDenied;

  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;

  if (run.status !== "Released") {
    return Response.json(
      { error: "Only a released payroll run can be used as production pilot evidence." },
      { status: 409 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const evidenceReference = typeof body.evidenceReference === "string" ? body.evidenceReference.trim() : "";
  const independentPreparedBy = typeof body.independentPreparedBy === "string" ? body.independentPreparedBy.trim() : "";
  const checks = body.checks && typeof body.checks === "object"
    ? body.checks as Record<string, unknown>
    : {};

  if (evidenceReference.length < 8 || evidenceReference.length > 200) {
    return Response.json(
      { error: "Provide an evidence reference between 8 and 200 characters." },
      { status: 400 },
    );
  }
  if (independentPreparedBy.length < 3 || independentPreparedBy.length > 120) {
    return Response.json(
      { error: "Identify who prepared the independent expected payroll figures." },
      { status: 400 },
    );
  }
  if (body.operatorCompletedWithoutDeveloper !== true) {
    return Response.json(
      { error: "Confirm that the payroll operator completed the cycle without developer intervention." },
      { status: 400 },
    );
  }

  const missingChecks = REQUIRED_CHECKS.filter((key) => checks[key] !== true);
  if (missingChecks.length > 0) {
    return Response.json(
      { error: `Independent reconciliation is incomplete: ${missingChecks.join(", ")}.` },
      { status: 400 },
    );
  }

  const [entries, slips, orgEvents] = await Promise.all([
    db.select({ id: payrollEntries.id }).from(payrollEntries).where(eq(payrollEntries.payrollRunId, run.id)),
    db.select({ id: payslips.id })
      .from(payslips)
      .innerJoin(payrollEntries, eq(payslips.payrollEntryId, payrollEntries.id))
      .where(and(
        eq(payslips.organizationId, run.organizationId),
        eq(payrollEntries.payrollRunId, run.id),
      )),
    db.select().from(auditEvents).where(eq(auditEvents.organizationId, run.organizationId)),
  ]);

  const runEvents = orgEvents.filter((event) => eventBelongsToRun(event, run.id));
  const releaseReceipt = runEvents.find((event) => event.action === "Payroll release receipt");
  const payoutCompleted = runEvents.find((event) =>
    event.action === "Payroll payout completed manually"
    || event.action === "Payroll payout completed via PayMongo"
  );
  const accountingExport = runEvents.find((event) => {
    if (event.action !== "journal export generated") return false;
    const meta = event.metadata && typeof event.metadata === "object"
      ? event.metadata as Record<string, unknown>
      : {};
    return meta.kind === "journal";
  });
  const alreadySigned = runEvents.find((event) => event.action === "Production payroll pilot signed off");

  if (alreadySigned) {
    return Response.json(
      {
        signedOff: true,
        alreadyRecorded: true,
        runId: run.id,
        auditEventId: alreadySigned.id,
      },
    );
  }

  const evidenceFailures: string[] = [];
  if (entries.length === 0) evidenceFailures.push("released payroll entries");
  if (!releaseReceipt) evidenceFailures.push("release receipt");
  if (!payoutCompleted) evidenceFailures.push("completed payout evidence");
  if (slips.length < entries.length) evidenceFailures.push("payslips for every released entry");
  if (!accountingExport) evidenceFailures.push("accounting journal export");

  if (evidenceFailures.length > 0) {
    return Response.json(
      {
        error: `The selected payroll run is missing required system evidence: ${evidenceFailures.join(", ")}.`,
      },
      { status: 409 },
    );
  }

  const signedAt = new Date().toISOString();
  const event = await recordAuditEvent({
    organizationId: run.organizationId,
    actor: user.name,
    action: "Production payroll pilot signed off",
    resource: run.periodLabel,
    metadata: {
      runId: run.id,
      evidenceReference,
      independentPreparedBy,
      operatorCompletedWithoutDeveloper: true,
      independentChecks: Object.fromEntries(REQUIRED_CHECKS.map((key: PilotCheck) => [key, true])),
      employeeCount: entries.length,
      payslipCount: slips.length,
      releasedGrossPay: run.grossPay,
      releasedNetPay: run.netPay,
      signedAt,
      environment: "production",
    },
  });

  return Response.json({
    signedOff: true,
    runId: run.id,
    auditEventId: event?.id ?? null,
    signedAt,
    evidenceReference,
  });
}
