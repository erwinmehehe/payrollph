import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { payslips, payrollEntries, payrollRuns } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { generateBankFile, generateGovernmentDraft, generateJournalCsv } from "@/lib/exporters";
import {
  assertOrganizationRole,
  PAYROLL_DISBURSEMENT_ROLES,
  PAYROLL_OPERATOR_ROLES,
} from "@/lib/access";
import { denyPublicDemoSideEffect } from "@/lib/public-demo-guard";
import {
  createPaymongoPayrollDisbursement,
  preflightPaymongoPayrollDisbursement,
} from "@/lib/paymongo-disbursements";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const runId = Number(id);
  if (!Number.isInteger(runId)) return Response.json({ error: "Invalid run id" }, { status: 400 });

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const kind = searchParams.get("kind") ?? "bank";
  const template = searchParams.get("template") ?? "BDO DAT";
  const dryRun = searchParams.get("dryRun") !== "false";
  const payslipId = Number(searchParams.get("payslipId") ?? "0");

  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId));
  if (!run) return Response.json({ error: "Payroll run not found" }, { status: 404 });
  const deniedExports = await assertOrganizationRole(
    user.id,
    run.organizationId,
    PAYROLL_OPERATOR_ROLES,
    "Only payroll operators can export payroll data.",
  );
  if (deniedExports) return deniedExports;

  const actor = user.name;

  if (kind === "bank" && !dryRun && run.status !== "Released") {
    return Response.json({
      error: `Final bank files are available only after payroll release (currently ${run.status}). Use dryRun=true before release.`,
    }, { status: 409 });
  }

  if (kind === "payslip" && run.status !== "Released") {
    return Response.json({
      error: `Payslips are available only after payroll release (currently ${run.status}).`,
    }, { status: 409 });
  }

  if (kind === "journal" && run.status !== "Released") {
    return Response.json({
      error: `Final accounting journals are available only after payroll release (currently ${run.status}).`,
    }, { status: 409 });
  }

  if (kind === "payslip") {
    if (!payslipId) {
      const rows = await db
        .select({ slip: payslips })
        .from(payslips)
        .innerJoin(payrollEntries, eq(payslips.payrollEntryId, payrollEntries.id))
        .where(and(
          eq(payslips.organizationId, run.organizationId),
          eq(payrollEntries.payrollRunId, run.id),
        ));
      return Response.json({ payslips: rows.map((row) => row.slip) });
    }

    const [row] = await db
      .select({ slip: payslips })
      .from(payslips)
      .innerJoin(payrollEntries, eq(payslips.payrollEntryId, payrollEntries.id))
      .where(and(
        eq(payslips.id, payslipId),
        eq(payslips.organizationId, run.organizationId),
        eq(payrollEntries.payrollRunId, run.id),
      ))
      .limit(1);
    const slip = row?.slip;
    if (!slip) return Response.json({ error: "Payslip not found for this payroll run" }, { status: 404 });
    await recordAuditEvent({
      organizationId: run.organizationId,
      actor,
      action: "Payslip downloaded",
      resource: `${run.periodLabel} #${slip.id}`,
      metadata: { runId: run.id, ruleVersion: slip.ruleVersion },
    });
    return new Response(slip.content, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename=payslip-${slip.id}.pdf`,
      },
    });
  }

  let file;
  try {
    if (kind === "journal") {
      file = await generateJournalCsv(runId);
    } else if (kind === "government") {
      file = await generateGovernmentDraft(runId, template);
    } else {
      file = await generateBankFile(runId, template, dryRun);
    }
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "The requested export could not be generated.",
    }, { status: 422 });
  }

  await recordAuditEvent({
    organizationId: run.organizationId,
    actor,
    action: dryRun && kind === "bank" ? "Bank file dry-run generated" : `${kind} export generated`,
    resource: run.periodLabel,
    metadata: { template, kind, filename: file.filename, ruleVersion: "PH-2026.01" },
  });

  return new Response(file.body, {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `attachment; filename=${file.filename}`,
      "X-Linaw-Dry-Run": kind === "bank" && dryRun ? "true" : "false",
    },
  });
}

/**
 * Submits a live PayMongo batch disbursement for this payroll run, this
 * moves real money and is deliberately separate from the read-only GET
 * export above. Requires PAYMONGO_SECRET_KEY and an explicit operator
 * confirmation (PAYMONGO_DISBURSEMENTS_ENABLED) that the wallet has been
 * verified as a Registered Business with an Enabled wallet, see
 * src/lib/paymongo-disbursements.ts for why this can't be auto-detected.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const runId = Number(id);
  if (!Number.isInteger(runId)) return Response.json({ error: "Invalid run id" }, { status: 400 });

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId));
  if (!run) return Response.json({ error: "Payroll run not found" }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const mode = body.mode === "preflight" ? "preflight" : "disburse";

  const denied = await assertOrganizationRole(
    user.id,
    run.organizationId,
    mode === "preflight" ? PAYROLL_OPERATOR_ROLES : PAYROLL_DISBURSEMENT_ROLES,
    mode === "preflight"
      ? "Only payroll operators can run a payout preflight."
      : "Only the workspace owner can trigger a live payroll disbursement.",
  );
  if (denied) return denied;

  const demoDenied = await denyPublicDemoSideEffect(run.organizationId, mode === "preflight" ? "External payout preflight" : "Live payroll disbursement");
  if (demoDenied) return demoDenied;

  if (run.status !== "Released") {
    return Response.json({
      error: mode === "preflight"
        ? "PayMongo preflight is allowed only for a released payroll run so it checks the exact final payout rows."
        : "Live payroll disbursement is allowed only after the payroll run has been approved and released.",
      status: run.status,
    }, { status: 409 });
  }

  if (mode === "preflight") {
    if (!process.env.PAYMONGO_SECRET_KEY) {
      return Response.json({
        error: "PayMongo credentials are not configured, so receiving-institution access cannot be verified.",
        readiness: "/api/readiness",
      }, { status: 501 });
    }

    try {
      const result = await preflightPaymongoPayrollDisbursement(runId);
      await recordAuditEvent({
        organizationId: run.organizationId,
        actor: user.name,
        action: "PayMongo payroll preflight passed",
        resource: run.periodLabel,
        metadata: {
          provider: result.provider,
          employeeCount: result.employeeCount,
          totalAmountCents: result.totalAmountCents,
          banks: result.banks,
          moneyMoved: false,
        },
      });
      return Response.json({
        ...result,
        moneyMoved: false,
        message: "PayMongo credentials and bank mappings were verified without creating a transfer.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "PayMongo preflight failed.";
      await recordAuditEvent({
        organizationId: run.organizationId,
        actor: user.name,
        action: "PayMongo payroll preflight failed",
        resource: run.periodLabel,
        metadata: { error: message, moneyMoved: false },
      });
      return Response.json({ error: message, moneyMoved: false }, { status: 502 });
    }
  }

  if (!process.env.PAYMONGO_SECRET_KEY || process.env.PAYMONGO_DISBURSEMENTS_ENABLED !== "true") {
    return Response.json({
      error: "Live disbursement is not configured.",
      manualWorkaround: "Download the bank file (GET this same URL with kind=bank) and upload it by hand to online banking / GCash for Business, or finish PayMongo Wallet verification and set PAYMONGO_DISBURSEMENTS_ENABLED=true.",
      readiness: "/api/readiness",
    }, { status: 501 });
  }

  try {
    const result = await createPaymongoPayrollDisbursement(runId);
    await recordAuditEvent({
      organizationId: run.organizationId,
      actor: user.name,
      action: "Payroll disbursed via PayMongo",
      resource: run.periodLabel,
      metadata: { batchId: result.batchId, provider: result.provider, transferCount: result.transfers.length },
    });
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Disbursement failed.";
    await recordAuditEvent({
      organizationId: run.organizationId,
      actor: user.name,
      action: "Payroll disbursement failed",
      resource: run.periodLabel,
      metadata: { error: message },
    });
    return Response.json({ error: message }, { status: 502 });
  }
}
