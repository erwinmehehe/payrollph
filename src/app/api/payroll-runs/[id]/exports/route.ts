import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, payslips, payrollEntries, payrollRuns } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { isPublicDemoIdentity, publicDemoMutationDenied } from "@/lib/demo-security";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";
import { generateBankFile, generateGovernmentDraft, generateJournalCsv } from "@/lib/exporters";
import {
  assertOrganizationRole,
  assertOrganizationUnitAccess,
  PAYROLL_DISBURSEMENT_ROLES,
  PAYROLL_OPERATOR_ROLES,
} from "@/lib/access";
import {
  createPaymongoPayrollDisbursement,
  preflightPaymongoPayrollDisbursement,
} from "@/lib/paymongo-disbursements";
import { withPayrollPayoutSubmissionLock } from "@/lib/payout-submission-lock";

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
  if (kind === "bank" || kind === "government" || kind === "payslip") {
    const mfaDenied = requireSensitiveActionMfa(user);
    if (mfaDenied) return mfaDenied;
  }

  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId));
  if (!run) return Response.json({ error: "Payroll run not found" }, { status: 404 });
  const deniedExports = await assertOrganizationRole(
    user.id,
    run.organizationId,
    PAYROLL_OPERATOR_ROLES,
    "Only payroll operators can export payroll data.",
  );
  if (deniedExports) return deniedExports;
  const scopeDenied = await assertOrganizationUnitAccess(
    user.id,
    run.organizationId,
    run.scopeOrgUnitId,
    "This payroll run is outside your assigned organization unit.",
  );
  if (scopeDenied) return scopeDenied;

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
      file = await generateBankFile(runId, template, dryRun, {
        allowSyntheticDemoDestinations: isPublicDemoIdentity(user.email),
      });
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
    metadata: {
      runId: run.id,
      template,
      kind,
      filename: file.filename,
      dryRun: kind === "bank" ? dryRun : false,
      ruleVersion: "PH-2026.01",
    },
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
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const { id } = await params;
  const runId = Number(id);
  if (!Number.isInteger(runId)) return Response.json({ error: "Invalid run id" }, { status: 400 });

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const demoDenied = publicDemoMutationDenied(user.email, "Live payroll disbursement");
  if (demoDenied) return demoDenied;

  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId));
  if (!run) return Response.json({ error: "Payroll run not found" }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const mode =
    body.mode === "preflight"
      ? "preflight"
      : body.mode === "complete-manual"
        ? "complete-manual"
        : "disburse";

  const denied = await assertOrganizationRole(
    user.id,
    run.organizationId,
    mode === "preflight" ? PAYROLL_OPERATOR_ROLES : PAYROLL_DISBURSEMENT_ROLES,
    mode === "preflight"
      ? "Only payroll operators can run a payout preflight."
      : mode === "complete-manual"
        ? "Only the workspace owner can record payroll payout completion."
        : "Only the workspace owner can trigger a live payroll disbursement.",
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
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: mode === "preflight" ? "payout-preflight" : "payout-submit",
    resourceId: runId,
    limit: mode === "preflight" ? 20 : 5,
    windowMs: mode === "preflight" ? 10 * 60_000 : 10 * 60_000,
  });
  if (rateDenied) return rateDenied;

  if (run.status !== "Released") {
    return Response.json({
      error: mode === "preflight"
        ? "PayMongo preflight is allowed only for a released payroll run so it checks the exact final payout rows."
        : "Live payroll disbursement is allowed only after the payroll run has been approved and released.",
      status: run.status,
    }, { status: 409 });
  }

  if (mode === "complete-manual") {
    const reference = typeof body.reference === "string" ? body.reference.trim() : "";
    if (reference.length < 4 || reference.length > 120) {
      return Response.json({
        error: "Enter the bank confirmation, transaction reference, or upload batch reference (4–120 characters).",
      }, { status: 400 });
    }
    if (body.confirmed !== true) {
      return Response.json({
        error: "Confirm that the bank or payment provider shows this payroll payout as completed.",
      }, { status: 400 });
    }

    const events = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.organizationId, run.organizationId));

    const runEvents = events.filter((event) => {
      if (!event.metadata || typeof event.metadata !== "object") return false;
      return Number((event.metadata as Record<string, unknown>).runId) === run.id;
    });
    const providerPayout = runEvents.find((event) =>
      event.action === "Payroll payout submitted via PayMongo"
      || event.action === "Payroll payout completed via PayMongo"
      || event.action === "Payroll payout retry submitted via PayMongo"
    );
    if (providerPayout) {
      return Response.json({
        error: "This payroll run already has a PayMongo payout batch. Reconcile the provider status instead of recording a separate manual completion.",
      }, { status: 409 });
    }

    const bankExport = runEvents
      .filter((event) => event.action === "bank export generated")
      .find((event) => {
        const metadata = event.metadata as Record<string, unknown>;
        return metadata.kind === "bank" && metadata.dryRun !== true;
      });

    if (!bankExport) {
      return Response.json({
        error: "Generate the final released bank file before recording payout completion.",
      }, { status: 409 });
    }

    const existing = runEvents.find((event) =>
      event.action === "Payroll payout completed manually" ||
      event.action === "Payroll payout completed via PayMongo"
    );
    if (existing) {
      const existingMetadata = existing.metadata && typeof existing.metadata === "object"
        ? existing.metadata as Record<string, unknown>
        : {};
      return Response.json({
        completed: true,
        alreadyRecorded: true,
        reference:
          typeof existingMetadata.reference === "string"
            ? existingMetadata.reference
            : typeof existingMetadata.batchId === "string"
              ? existingMetadata.batchId
              : null,
        completedAt:
          typeof existingMetadata.completedAt === "string"
            ? existingMetadata.completedAt
            : existing.createdAt,
      });
    }

    const completedAt = new Date().toISOString();
    await recordAuditEvent({
      organizationId: run.organizationId,
      actor: user.name,
      action: "Payroll payout completed manually",
      resource: run.periodLabel,
      metadata: {
        runId: run.id,
        method: "bank-file",
        reference,
        completedAt,
        bankExportEventId: bankExport.id,
        moneyMovedByLinaw: false,
        completionRecordedBy: user.name,
      },
    });

    return Response.json({
      completed: true,
      reference,
      completedAt,
      method: "bank-file",
      moneyMovedByLinaw: false,
    });
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
        action: result.ready ? "PayMongo payroll preflight passed" : "PayMongo payroll preflight blocked: wallet underfunded",
        resource: run.periodLabel,
        metadata: {
          provider: result.provider,
          employeeCount: result.employeeCount,
          totalAmountCents: result.totalAmountCents,
          banks: result.banks,
          wallet: result.wallet,
          ready: result.ready,
          runId: run.id,
          moneyMoved: false,
        },
      });
      return Response.json({
        ...result,
        moneyMoved: false,
        message: result.ready
          ? "PayMongo credentials, bank mappings and wallet funding were verified without creating a transfer."
          : `Bank mappings are valid but the PayMongo wallet is short by ${(result.wallet.shortfallCents / 100).toFixed(2)} PHP. Top it up before submitting.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "PayMongo preflight failed.";
      await recordAuditEvent({
        organizationId: run.organizationId,
        actor: user.name,
        action: "PayMongo payroll preflight failed",
        resource: run.periodLabel,
        metadata: { runId: run.id, error: message, moneyMoved: false },
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
    const result = await withPayrollPayoutSubmissionLock(
      () => createPaymongoPayrollDisbursement(runId),
    );
    const everyTransferCompleted =
      result.transfers.length > 0 &&
      result.transfers.every((transfer) => transfer.status.toLowerCase() === "succeeded");
    const completedAt = everyTransferCompleted ? new Date().toISOString() : null;
    await recordAuditEvent({
      organizationId: run.organizationId,
      actor: user.name,
      action: everyTransferCompleted
        ? "Payroll payout completed via PayMongo"
        : "Payroll payout submitted via PayMongo",
      resource: run.periodLabel,
      metadata: {
        runId: run.id,
        batchId: result.batchId,
        provider: result.provider,
        transferCount: result.transfers.length,
        transferStatuses: result.transfers.map((transfer) => transfer.status),
        transfers: result.transfers,
        completedAt,
        moneyMovedByLinaw: true,
      },
    });
    return Response.json({ ...result, completed: everyTransferCompleted, completedAt });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Disbursement failed.";
    await recordAuditEvent({
      organizationId: run.organizationId,
      actor: user.name,
      action: "Payroll disbursement failed",
      resource: run.periodLabel,
      metadata: { runId: run.id, error: message },
    });
    return Response.json({ error: message }, { status: 502 });
  }
}
