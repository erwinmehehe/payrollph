import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, payrollEntries, payrollRuns, payslips } from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { isValidPilotBankDryRunEvidence } from "@/lib/pilot-bank-dry-run-evidence";
import { getSessionUser } from "@/lib/auth";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import {
  assertOrganizationRole,
  assertOrganizationUnitAccess,
  PAYROLL_DISBURSEMENT_ROLES,
} from "@/lib/access";
import { enforceSameOriginMutation, requireSensitiveActionMfa } from "@/lib/security-request";

export const dynamic = "force-dynamic";

const MONEY_FIGURES = [
  "grossPay",
  "deductions",
  "netPay",
  "withholdingTax",
  "statutoryContributions",
  "payoutTotal",
] as const;

type MoneyFigure = (typeof MONEY_FIGURES)[number];
type IndependentFigures = Record<MoneyFigure, number> & { employeeCount: number };

function eventBelongsToRun(event: typeof auditEvents.$inferSelect, runId: number) {
  if (!event.metadata || typeof event.metadata !== "object") return false;
  return Number((event.metadata as Record<string, unknown>).runId) === runId;
}

function asMoney(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round((parsed + Number.EPSILON) * 100) / 100;
}

function asEmployeeCount(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function lineAmount(entry: typeof payrollEntries.$inferSelect, codes: Set<string>) {
  if (!Array.isArray(entry.lineItems)) return 0;
  return entry.lineItems.reduce((total, raw) => {
    if (!raw || typeof raw !== "object") return total;
    const item = raw as Record<string, unknown>;
    if (typeof item.code !== "string" || !codes.has(item.code)) return total;
    const amount = Number(item.amount);
    return Number.isFinite(amount) ? total + Math.abs(amount) : total;
  }, 0);
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function figuresFromEntries(entries: Array<typeof payrollEntries.$inferSelect>): IndependentFigures {
  const withholdingCodes = new Set(["WHT"]);
  const statutoryCodes = new Set(["SSS", "PHIC", "HDMF"]);
  return {
    grossPay: roundMoney(entries.reduce((sum, entry) => sum + Number(entry.grossPay), 0)),
    deductions: roundMoney(entries.reduce((sum, entry) => sum + Number(entry.deductions), 0)),
    netPay: roundMoney(entries.reduce((sum, entry) => sum + Number(entry.netPay), 0)),
    withholdingTax: roundMoney(entries.reduce((sum, entry) => sum + lineAmount(entry, withholdingCodes), 0)),
    statutoryContributions: roundMoney(entries.reduce((sum, entry) => sum + lineAmount(entry, statutoryCodes), 0)),
    payoutTotal: roundMoney(entries.reduce((sum, entry) => sum + Number(entry.netPay), 0)),
    employeeCount: entries.length,
  };
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
  const reconciliationReportSha256 = typeof body.reconciliationReportSha256 === "string"
    ? body.reconciliationReportSha256.trim().toLowerCase()
    : "";
  const supplied = body.independentFigures && typeof body.independentFigures === "object"
    ? body.independentFigures as Record<string, unknown>
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
  if (!/^[0-9a-f]{64}$/.test(reconciliationReportSha256)) {
    return Response.json(
      { error: "Provide the SHA-256 of the privately reviewed employee-level reconciliation report." },
      { status: 400 },
    );
  }
  if (body.independentSourceConfirmed !== true) {
    return Response.json(
      { error: "Confirm that the figures were prepared independently and were not copied from Linaw." },
      { status: 400 },
    );
  }
  if (body.employeeLevelReconciliationConfirmed !== true) {
    return Response.json(
      { error: "Confirm every employee was reconciled to independent source figures within one cent, with no unexplained variances." },
      { status: 400 },
    );
  }
  if (body.operatorCompletedWithoutDeveloper !== true) {
    return Response.json(
      { error: "Confirm that the payroll operator completed the cycle without developer intervention." },
      { status: 400 },
    );
  }

  const independentFigures = {} as IndependentFigures;
  for (const key of MONEY_FIGURES) {
    const value = asMoney(supplied[key]);
    if (value === null) {
      return Response.json(
        { error: `Independent figure ${key} must be a non-negative peso amount with at most cent precision.` },
        { status: 400 },
      );
    }
    independentFigures[key] = value;
  }
  const employeeCount = asEmployeeCount(supplied.employeeCount);
  const reconciledEmployeeCount = asEmployeeCount(body.reconciledEmployeeCount);
  if (reconciledEmployeeCount === null) {
    return Response.json(
      { error: "Record the number of employees covered by the independent private reconciliation." },
      { status: 400 },
    );
  }
  if (employeeCount === null) {
    return Response.json(
      { error: "Independent employee count must be a positive whole number." },
      { status: 400 },
    );
  }
  independentFigures.employeeCount = employeeCount;

  const [entries, slips, orgEvents] = await Promise.all([
    db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, run.id)),
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
  const dryRunBankExport = runEvents.find((event) => isValidPilotBankDryRunEvidence(
    event,
    releaseReceipt?.createdAt ?? null,
    { employeeCount: entries.length, netPay: Number(run.netPay) },
  ));
  // A no-money reconciliation can be upgraded after actual bank settlement,
  // but cannot be submitted twice in the same evidence mode.
  const alreadySigned = runEvents.find((event) => {
    if (event.action !== "Production payroll pilot signed off") return false;
    if (!payoutCompleted) return true;
    const metadata = event.metadata && typeof event.metadata === "object"
      ? event.metadata as Record<string, unknown>
      : {};
    return metadata.payoutEvidenceMode === "completed-payout";
  });

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
  if (reconciledEmployeeCount !== entries.length) {
    evidenceFailures.push("independent employee-level reconciliation population does not match the released payroll register");
  }
  if (!releaseReceipt) evidenceFailures.push("release receipt");
  if (!payoutCompleted && !dryRunBankExport) {
    evidenceFailures.push("completed payout or post-release bank-file dry-run with complete real destinations, immutable payment/identity snapshots, matching file-part counts and totals, and SHA-256 proof");
  }
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

  const verifiedFigures = figuresFromEntries(entries);
  const systemConsistencyFailures: string[] = [];
  if (Math.abs(verifiedFigures.grossPay - Number(run.grossPay)) > 0.01) systemConsistencyFailures.push("grossPay");
  if (Math.abs(verifiedFigures.netPay - Number(run.netPay)) > 0.01) systemConsistencyFailures.push("netPay");
  if (verifiedFigures.employeeCount !== run.employeeCount) systemConsistencyFailures.push("employeeCount");
  if (systemConsistencyFailures.length > 0) {
    return Response.json(
      {
        error: `The released payroll is internally inconsistent and cannot be used as launch evidence: ${systemConsistencyFailures.join(", ")}.`,
        systemConsistencyFailures,
      },
      { status: 409 },
    );
  }

  const mismatches: string[] = [];
  const variances: Record<string, number> = {};
  for (const key of MONEY_FIGURES) {
    const variance = roundMoney(independentFigures[key] - verifiedFigures[key]);
    variances[key] = variance;
    if (Math.abs(variance) > 0.01) mismatches.push(key);
  }
  variances.employeeCount = independentFigures.employeeCount - verifiedFigures.employeeCount;
  if (independentFigures.employeeCount !== verifiedFigures.employeeCount) mismatches.push("employeeCount");

  if (mismatches.length > 0) {
    return Response.json(
      {
        error: `Independent reconciliation does not match the released payroll: ${mismatches.join(", ")}.`,
        mismatches,
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
      reconciliationReportSha256,
      reconciledEmployeeCount,
      independentPreparedBy,
      independentSourceConfirmed: true,
      employeeLevelReconciliationConfirmed: true,
      operatorCompletedWithoutDeveloper: true,
      payoutEvidenceMode: payoutCompleted ? "completed-payout" : "no-money-bank-file-dry-run",
      bankPreviewSha256: dryRunBankExport && typeof (dryRunBankExport.metadata as Record<string, unknown>).bankExportSha256 === "string"
        ? (dryRunBankExport.metadata as Record<string, unknown>).bankExportSha256
        : null,
      independentFigures,
      verifiedFigures,
      reconciliationVariances: variances,
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
    verifiedFigures,
  });
}
