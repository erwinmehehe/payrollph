import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  auditEvents,
  bankFileValidations,
  bankTemplates,
  payslips,
  payrollEntries,
  payrollRuns,
} from "@/db/schema";
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
  PAYROLL_OPERATOR_ROLES,
} from "@/lib/access";
import {
  createPaymongoPayrollDisbursement,
  preflightPaymongoPayrollDisbursement,
} from "@/lib/paymongo-disbursements";
import { withPayrollPayoutSubmissionLock } from "@/lib/payout-submission-lock";
import { authorizeTreasuryOperation, type TreasuryEvidence } from "@/lib/treasury-controls";
import { latestApprovedPayoutDestinationChangeForRun } from "@/lib/payout-destination-controls";

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
  let finalBankTreasuryEvidence: TreasuryEvidence | null = null;

  if (kind === "bank" && !dryRun && run.status !== "Released") {
    return Response.json({
      error: `Final bank files are available only after payroll release (currently ${run.status}). Use dryRun=true before release.`,
    }, { status: 409 });
  }

  if (kind === "bank" && !dryRun) {
    const treasury = await authorizeTreasuryOperation({
      organizationId: run.organizationId,
      runId: run.id,
      userId: user.id,
      userName: user.name,
      requireReleaseSeparation: true,
      legacyAllowedRoles: PAYROLL_OPERATOR_ROLES,
    });
    if (treasury.response) return treasury.response;
    finalBankTreasuryEvidence = treasury.evidence;
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

  const bankExportValidation =
    kind === "bank" && "validation" in file
      ? file.validation
      : null;

  const bankUsesMobile = /gcash|maya|paymaya/i.test(template);
  const bankPreviewDigest = kind === "bank" && dryRun
    ? createHash("sha256").update(file.body).digest("hex")
    : null;
  const missingBankPreviewDestinations = bankExportValidation == null
    ? null
    : bankUsesMobile
      ? bankExportValidation.missingMobiles
      : bankExportValidation.missingAccounts;

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
      bankFileCount: bankExportValidation?.fileCount ?? null,
      bankFileSplitApplied: bankExportValidation?.splitApplied ?? null,
      bankFileParts: bankExportValidation?.files ?? null,
      bankExportRowCount: bankExportValidation?.rowCount ?? null,
      bankExportTotalNet: bankExportValidation?.totalNet ?? null,
      bankExportMissingDestinations: missingBankPreviewDestinations,
      bankExportMissingPaymentSnapshots: bankExportValidation?.missingPaymentSnapshots ?? null,
      bankExportMissingIdentitySnapshots: bankExportValidation?.missingIdentitySnapshots ?? null,
      bankExportSyntheticDemoDestinations: bankExportValidation?.syntheticDemoDestinations ?? null,
      bankExportSha256: bankPreviewDigest,
      payoutProfileId: bankExportValidation?.payoutProfileId ?? null,
      ruleVersion: "PH-2026.01",
      treasury: kind === "bank" && !dryRun ? finalBankTreasuryEvidence : null,
    },
  });

  return new Response(file.body, {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `attachment; filename=${file.filename}`,
      "X-Linaw-Dry-Run": kind === "bank" && dryRun ? "true" : "false",
      "X-Linaw-Government-File-Status": kind === "government" ? "DRAFT-NOT-CERTIFIED" : "not-applicable",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
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

  let treasuryEvidence: TreasuryEvidence | null = null;
  if (mode === "preflight") {
    const denied = await assertOrganizationRole(
      user.id,
      run.organizationId,
      PAYROLL_OPERATOR_ROLES,
      "Only payroll operators can run a payout preflight.",
    );
    if (denied) return denied;
  } else {
    const treasury = await authorizeTreasuryOperation({
      organizationId: run.organizationId,
      runId: run.id,
      userId: user.id,
      userName: user.name,
      requireReleaseSeparation: true,
    });
    if (treasury.response) return treasury.response;
    treasuryEvidence = treasury.evidence;
  }
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

    const bankExportMetadata = bankExport.metadata && typeof bankExport.metadata === "object"
      ? bankExport.metadata as Record<string, unknown>
      : {};
    const bankTemplateName = typeof bankExportMetadata.template === "string"
      ? bankExportMetadata.template.trim()
      : "";
    if (!bankTemplateName) {
      return Response.json({
        error: "The final bank export audit record has no template identity. Regenerate the final bank file before recording payout completion.",
      }, { status: 409 });
    }

    const [bankTemplate] = await db.select().from(bankTemplates)
      .where(and(
        eq(bankTemplates.name, bankTemplateName),
        eq(bankTemplates.active, true),
      ))
      .limit(1);
    if (!bankTemplate) {
      return Response.json({
        error: `Bank template "${bankTemplateName}" is missing or inactive. Restore a reviewed template before recording payout completion.`,
      }, { status: 409 });
    }

    const [acceptedTemplateValidation] = await db.select({ id: bankFileValidations.id })
      .from(bankFileValidations)
      .where(and(
        eq(bankFileValidations.organizationId, run.organizationId),
        eq(bankFileValidations.templateName, bankTemplate.name),
        eq(bankFileValidations.templateVersion, bankTemplate.version),
        eq(bankFileValidations.status, "accepted"),
      ))
      .limit(1);
    if (!acceptedTemplateValidation) {
      return Response.json({
        error: `Bank template "${bankTemplate.name}" version ${bankTemplate.version} has not passed recorded bank-portal UAT. Submit a validation file under Compliance → Bank validations and record the bank's accepted reference before using this template for a completed live payout.`,
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
        bankTemplateName: bankTemplate.name,
        bankTemplateVersion: bankTemplate.version,
        bankValidationId: acceptedTemplateValidation.id,
        moneyMovedByLinaw: false,
        completionRecordedBy: user.name,
        completionRecordedByUserId: user.id,
        treasury: treasuryEvidence,
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
      await recordAuditEvent({
        organizationId: run.organizationId,
        actor: user.name,
        action: "PayMongo payroll preflight failed",
        resource: run.periodLabel,
        metadata: {
          runId: run.id,
          reason: "provider-not-configured",
          moneyMoved: false,
        },
      });
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

  if (
    !process.env.PAYMONGO_SECRET_KEY
    || !process.env.PAYMONGO_WALLET_ID
    || !process.env.PAYMONGO_WEBHOOK_SECRET
    || process.env.PAYMONGO_DISBURSEMENTS_ENABLED !== "true"
  ) {
    return Response.json({
      error: "Live PayMongo payroll disbursement is not fully configured.",
      required: [
        "PAYMONGO_SECRET_KEY",
        "PAYMONGO_WALLET_ID",
        "PAYMONGO_WEBHOOK_SECRET",
        "PAYMONGO_DISBURSEMENTS_ENABLED=true",
      ],
      manualWorkaround: "Connect the PayMongo Wallet and signed transfer webhook first. A validated corporate-bank file remains an optional fallback when the employer cannot use PayMongo.",
      readiness: "/api/readiness",
    }, { status: 501 });
  }

  if (body.confirm !== true) {
    return Response.json({
      error: "Explicit confirmation is required before submitting a money-moving PayMongo payroll batch.",
    }, { status: 400 });
  }

  const payoutEvents = await db.select().from(auditEvents)
    .where(eq(auditEvents.organizationId, run.organizationId));
  const latestPreflight = payoutEvents
    .filter((event) => {
      if (event.action !== "PayMongo payroll preflight passed") return false;
      if (!event.metadata || typeof event.metadata !== "object") return false;
      return Number((event.metadata as Record<string, unknown>).runId) === run.id;
    })
    .sort((a, b) => b.id - a.id)[0];

  if (!latestPreflight) {
    return Response.json({
      error: "Run the no-money PayMongo preflight successfully for this released payroll before submitting funds.",
    }, { status: 409 });
  }

  const changedAfterPreflight = await latestApprovedPayoutDestinationChangeForRun({
    organizationId: run.organizationId,
    runId: run.id,
    after: latestPreflight.createdAt,
  });
  if (changedAfterPreflight) {
    return Response.json({
      error: "An employee payout destination changed after the last PayMongo preflight. Run preflight again before submitting funds.",
      payoutDestinationChangeRequestId: changedAfterPreflight.id,
      employeeId: changedAfterPreflight.employeeId,
    }, { status: 409 });
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
        treasury: treasuryEvidence,
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
      metadata: { runId: run.id, error: message, treasury: treasuryEvidence },
    });
    return Response.json({ error: message }, { status: 502 });
  }
}
