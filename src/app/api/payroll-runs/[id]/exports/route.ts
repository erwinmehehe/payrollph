import { eq } from "drizzle-orm";
import { db } from "@/db";
import { payslips, payrollRuns } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { generateBankFile, generateGovernmentDraft, generateJournalCsv } from "@/lib/exporters";
import { assertMembership, canOperatePayroll, getAccess } from "@/lib/access";
import { createPaymongoPayrollDisbursement } from "@/lib/paymongo-disbursements";

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
  const deniedExports = await assertMembership(user.id, run.organizationId);
  if (deniedExports) return deniedExports;
  const access = await getAccess(user.id, run.organizationId);
  if (!canOperatePayroll(access)) {
    return Response.json({ error: "Payroll exports require an owner, admin, bookkeeper, or payroll role." }, { status: 403 });
  }

  const actor = user.name;

  if (kind === "payslip") {
    if (!payslipId) {
      const rows = await db.select().from(payslips).where(eq(payslips.organizationId, run.organizationId));
      return Response.json({ payslips: rows.filter((row) => row.periodLabel === run.periodLabel) });
    }
    const [slip] = await db.select().from(payslips).where(eq(payslips.id, payslipId));
    if (!slip) return Response.json({ error: "Payslip not found" }, { status: 404 });
    await recordAuditEvent({
      organizationId: run.organizationId,
      actor,
      action: "Payslip downloaded",
      resource: `${run.periodLabel} #${slip.id}`,
      metadata: { ruleVersion: slip.ruleVersion },
    });
    return new Response(slip.content, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename=payslip-${slip.id}.pdf`,
      },
    });
  }

  let file;
  if (kind === "journal") {
    file = await generateJournalCsv(runId);
  } else if (kind === "government") {
    file = await generateGovernmentDraft(runId, template);
  } else {
    file = await generateBankFile(runId, template, dryRun);
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
  const denied = await assertMembership(user.id, run.organizationId);
  if (denied) return denied;

  const access = await getAccess(user.id, run.organizationId);
  if (!canOperatePayroll(access)) {
    return Response.json({ error: "Only an owner, admin, bookkeeper, or payroll role can trigger a payroll disbursement." }, { status: 403 });
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
