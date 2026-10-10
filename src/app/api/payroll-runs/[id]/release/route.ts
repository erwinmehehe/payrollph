import { and, count, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { approvalTasks, employees, organizations, payrollEntries, payrollRuns } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { queueMessage } from "@/lib/mailer";
import { dispatchWebhook } from "@/lib/webhooks";
import { assertOrganizationRole, assertOrganizationUnitAccess, PAYROLL_RELEASE_ROLES } from "@/lib/access";
import { buildPayrollAssurance } from "@/lib/payroll-assurance-server";
import { settlePayrollRun } from "@/lib/payroll-settlement";
import { buildPayrollReleaseChecklist } from "@/lib/payroll-release-checklist";
import { isPublicDemoIdentity } from "@/lib/demo-security";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";
import { recordAuditEvent } from "@/lib/audit";
import { managedPayrollReleaseRequirement } from "@/lib/managed-payroll";
import { runAutomationEventSafely } from "@/lib/automation";
import { findPayrollPeriodConflict } from "@/lib/payroll-period-integrity";
import { verifyPayrollApprovalSnapshot } from "@/lib/payroll-approval-integrity";
import { checkIndependentPayrollReleaser } from "@/lib/payroll-approval-release-separation";
import { connectedPayrollReleaseGateEnabled, safePayrollConnectedReleaseReadiness } from "@/lib/payroll-connected-release-gate-server";

const RELEASABLE = ["Ready for release"];

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const { id } = await params;
  const runId = Number(id);
  if (!Number.isInteger(runId)) return Response.json({ error: "Invalid run id." }, { status: 400 });

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const sharedDemo = isPublicDemoIdentity(user.email);

  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId));
  if (!run) return Response.json({ error: "Payroll run not found." }, { status: 404 });
  const deniedOrg = await assertOrganizationRole(
    user.id,
    run.organizationId,
    PAYROLL_RELEASE_ROLES,
    "Only an owner or administrator can release payroll.",
  );
  if (deniedOrg) return deniedOrg;
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
    action: "payroll-release",
    resourceId: runId,
    limit: 5,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  if (run.status === "Released") {
    return Response.json({ error: "This run is already released." }, { status: 409 });
  }

  const [{ value: entryCount }] = await db
    .select({ value: count() })
    .from(payrollEntries)
    .where(eq(payrollEntries.payrollRunId, runId));

  if (entryCount === 0) {
    return Response.json({ error: "Run has no calculated entries, process the payroll first." }, { status: 409 });
  }
  if (!RELEASABLE.includes(run.status)) {
    return Response.json({ error: `Run must be processed before release (currently ${run.status}).` }, { status: 409 });
  }

  const periodConflict = await findPayrollPeriodConflict({
    organizationId: run.organizationId,
    legalEntityId: run.legalEntityId,
    scopeOrgUnitId: run.scopeOrgUnitId,
    periodStart: String(run.periodStart),
    periodEnd: String(run.periodEnd),
    excludeRunId: run.id,
    conflictStatuses: ["Releasing", "Released"],
  });
  if (periodConflict) {
    return Response.json({
      error: `Payroll overlaps ${periodConflict.status.toLowerCase()} run #${periodConflict.id} (${periodConflict.periodLabel}). A worker population cannot be released twice for overlapping payroll periods.`,
      code: "PAYROLL_RELEASE_PERIOD_CONFLICT",
      conflictingRun: periodConflict,
    }, { status: 409 });
  }

  const approvalRows = await db.select().from(approvalTasks).where(and(
    eq(approvalTasks.organizationId, run.organizationId),
    eq(approvalTasks.payrollRunId, run.id),
  ));
  const payrollApproval = approvalRows.sort((a, b) => b.id - a.id)[0];

  if (!payrollApproval || payrollApproval.status !== "Approved") {
    return Response.json({
      error: "Payroll must be approved by a checker before release.",
      approvalStatus: payrollApproval?.status ?? "Not submitted",
    }, { status: 409 });
  }

  const approvalSnapshot = await verifyPayrollApprovalSnapshot(run, payrollApproval);
  if (!approvalSnapshot.valid) {
    return Response.json({
      error: "Checker approval is stale because the payroll contents changed after review. Recalculate and submit the exact run for approval again.",
      code: "PAYROLL_APPROVAL_SNAPSHOT_STALE",
    }, { status: 409 });
  }

  const managedRequirement = await managedPayrollReleaseRequirement(run.organizationId, run.id);
  if (
    managedRequirement.required
    && (
      !managedRequirement.engagementActive
      || !managedRequirement.gatesComplete
      || !managedRequirement.approval
      || !managedRequirement.approvalValid
    )
  ) {
    return Response.json({
      error: !managedRequirement.engagementActive
        ? "Managed payroll is paused. Resume the engagement and re-confirm the release controls before releasing payroll."
        : !managedRequirement.gatesComplete
          ? `Managed payroll implementation evidence is incomplete. Re-verify: ${managedRequirement.missingGateKeys.join(", ")}.`
          : managedRequirement.approval
            ? "Managed payroll client approval is stale because the payroll contents or designated approver changed. The designated client approver must review and approve this exact run again."
            : "Managed payroll requires designated client approval of this exact run before release.",
      managedPayroll: {
        required: true,
        approverUserId: managedRequirement.engagement.clientApproverUserId,
        engagementActive: managedRequirement.engagementActive,
        gatesComplete: managedRequirement.gatesComplete,
        missingGateKeys: managedRequirement.missingGateKeys,
        approvalRecorded: Boolean(managedRequirement.approval),
        approvalValid: Boolean(managedRequirement.approvalValid),
      },
    }, { status: 409 });
  }

  const assuranceResult = await buildPayrollAssurance(runId);
  const blockingFindings = assuranceResult?.assurance.findings.filter(
    (finding) => finding.blocking && !(sharedDemo && finding.code === "MISSING_BANK_DETAILS"),
  ) ?? [];
  if (blockingFindings.length > 0) {
    return Response.json({
      error: `Payroll assurance found ${blockingFindings.length} blocking issue(s). Resolve them before release.`,
      blockingFindings,
    }, { status: 409 });
  }

  const body = await request.json().catch(() => ({}));
  if (run.exceptions > 0 && !body.acknowledgeExceptions) {
    return Response.json({
      error: `${run.exceptions} exception(s) need sign-off. Re-send with acknowledgeExceptions: true to release anyway.`,
      exceptions: run.exceptions,
    }, { status: 409 });
  }

  const releaseChecklist = await buildPayrollReleaseChecklist(runId, {
    acknowledgeExceptions: Boolean(body.acknowledgeExceptions),
    allowRedactedDemoPayout: sharedDemo,
  });
  if (!releaseChecklist?.ready) {
    const failedItems = releaseChecklist?.items.filter((item) => item.blocking && !item.passed) ?? [];
    return Response.json({
      error: failedItems.length
        ? `Payroll release checklist has ${failedItems.length} blocking item(s). Resolve them before release.`
        : "Payroll release checklist could not be completed.",
      checklist: releaseChecklist?.items ?? [],
    }, { status: 409 });
  }

  // Claim the release transition atomically so two concurrent requests cannot
  // settle the same ledgers twice.
  const [claimed] = await db.update(payrollRuns)
    .set({ status: "Releasing" })
    .where(and(eq(payrollRuns.id, runId), eq(payrollRuns.status, "Ready for release")))
    .returning();

  if (!claimed) {
    return Response.json({ error: "Payroll is no longer ready for release. Refresh and review its current status." }, { status: 409 });
  }

  // Authoritative approval audit contains the actual authenticated checker ID
  // (including delegated approvals), not just a mutable display name. Enforce
  // independent approve -> release regardless of opt-in treasury policies.
  const checkerGate = await checkIndependentPayrollReleaser({
    organizationId: run.organizationId,
    payrollRunId: run.id,
    approvalTaskId: payrollApproval.id,
    releasingUserId: user.id,
  });
  if (checkerGate) {
    // No settlement occurred; restore only our unchanged claim.
    await db.update(payrollRuns)
      .set({ status: "Ready for release" })
      .where(and(eq(payrollRuns.id, runId), eq(payrollRuns.status, "Releasing")));
    return checkerGate;
  }

  // Revalidate upstream evidence after the atomic Ready -> Releasing claim,
  // not only when the release screen rendered. A failing check restores the
  // claim without touching financial settlement. Source writers still need
  // coordinated locking before this can be treated as race-free certification.
  let connectedReleaseEvidence: { version: string; blockingCount: number; reviewCount: number } | null = null;
  if (connectedPayrollReleaseGateEnabled(run.organizationId)) {
    const connected = await safePayrollConnectedReleaseReadiness(runId);
    if (!connected.ready) {
      await db.update(payrollRuns)
        .set({ status: "Ready for release" })
        .where(and(eq(payrollRuns.id, runId), eq(payrollRuns.status, "Releasing")));
      return Response.json({
        code: "PAYROLL_CONNECTED_SOURCE_INTEGRITY_BLOCK",
        error: "HRIS, WFM or HCM input evidence is no longer safe to release. Review upstream changes and recalculate when needed.",
        blockingCount: connected.blockingCount,
        findings: connected.findings.filter((finding) => finding.severity === "blocker").slice(0, 15),
      }, { status: 409 });
    }
    connectedReleaseEvidence = {
      version: connected.version,
      blockingCount: connected.blockingCount,
      reviewCount: connected.reviewCount,
    };
  }

  let settlement;
  let updated;
  try {
    const released = await settlePayrollRun(runId, {
      actor: user.name,
      resource: run.periodLabel,
      metadata: {
        runId,
        releasedByUserId: user.id,
        ruleVersion: run.ruleVersion,
        netPay: run.netPay,
        employees: entryCount,
        exceptionsAcknowledged: run.exceptions > 0 ? run.exceptions : 0,
        assurance: assuranceResult?.assurance.summary ?? null,
        approvalTaskId: payrollApproval.id,
        approvedBy: payrollApproval.decidedBy ?? payrollApproval.approver,
        connectedSourceGate: connectedReleaseEvidence,
      },
    });
    settlement = released.settlement;
    updated = released.run;
  } catch (error) {
    // The settlement transaction rolled back every ledger mutation. Only the
    // earlier release claim lives outside that transaction, so restore it for a
    // safe recalculation/retry.
    await db.update(payrollRuns)
      .set({ status: "Ready for release" })
      .where(and(eq(payrollRuns.id, runId), eq(payrollRuns.status, "Releasing")));
    return Response.json({
      error: error instanceof Error ? error.message : "Payroll settlement failed; recalculate before release.",
    }, { status: 409 });
  }

  // Notify staff that payslips are ready. Queued in the outbox when no mail
  // provider is configured, never silently reported as sent.
  const [organization] = await db.select().from(organizations).where(eq(organizations.id, run.organizationId));
  const releasedEntries = await db
    .select({ employeeId: payrollEntries.employeeId })
    .from(payrollEntries)
    .where(eq(payrollEntries.payrollRunId, runId));
  const releasedEmployeeIds = [...new Set(releasedEntries.map((entry) => entry.employeeId))];
  const staff = releasedEmployeeIds.length
    ? await db.select().from(employees).where(and(
        eq(employees.organizationId, run.organizationId),
        inArray(employees.id, releasedEmployeeIds),
      ))
    : [];

  // Payroll is already atomically released at this point. Notification or
  // webhook failures must not turn a successful financial commit into a 500
  // response that invites the operator to retry the release.
  const postReleaseWarnings: string[] = [];
  const releasedAt = new Date().toISOString();
  const activeStaff = (sharedDemo ? [] : staff).filter((person) => person.status === "Active");
  const notifiableStaff = activeStaff.filter((person) => Boolean(person.email));
  const missingEmail = activeStaff.length - notifiableStaff.length;
  let noticesSent = 0;
  let noticesQueued = 0;
  let noticesFailed = 0;
  for (const person of notifiableStaff) {
    try {
      const delivery = await queueMessage({
        organizationId: run.organizationId,
        recipient: person.email!,
        subject: `Your payslip for ${run.periodLabel} is ready`,
        purpose: "payslip-ready",
        dedupeKey: `payslip-ready:${run.id}:${person.id}`,
        body: [
          `Hi ${person.firstName},`,
          "",
          `${organization?.name ?? "Your employer"} released payroll for ${run.periodLabel}.`,
          "",
          "Sign in to Linaw to view and download your payslip.",
        ].join("\n"),
        audit: {
          actor: user.name,
          metadata: {
            runId: run.id,
            employeeId: person.id,
            employeeNo: person.employeeNo,
            periodLabel: run.periodLabel,
          },
        },
      });
      if (delivery.status === "sent") noticesSent += 1;
      else if (delivery.status === "queued") noticesQueued += 1;
      else noticesFailed += 1;
    } catch {
      noticesFailed += 1;
      postReleaseWarnings.push(`Could not create a payslip notice for employee #${person.id}.`);
    }
  }

  if (noticesFailed > 0) {
    postReleaseWarnings.push(
      `${noticesFailed} payslip-ready notice(s) failed delivery and can be retried from the outbox.`,
    );
  }

  let webhookDeliveries = 0;
  try {
    const deliveries = sharedDemo ? [] : await dispatchWebhook({
      organizationId: run.organizationId,
      event: "payroll.released",
      data: {
        runId,
        period: run.periodLabel,
        payDate: run.payDate,
        employees: entryCount,
        grossPay: run.grossPay,
        netPay: run.netPay,
      },
    });
    webhookDeliveries = deliveries.length;
  } catch {
    postReleaseWarnings.push("Payroll was released, but webhook delivery could not be queued.");
  }

  const receipt = {
    runId,
    periodLabel: run.periodLabel,
    employeeCount: Number(entryCount),
    totalNetPay: run.netPay,
    releasedAt,
    bankExport: {
      status: "waiting" as const,
      label: "Optional fallback: no final bank file has been generated.",
    },
    payout: {
      status: "awaiting-preflight" as const,
      label:
        process.env.PAYMONGO_SECRET_KEY
        && process.env.PAYMONGO_WALLET_ID
        && process.env.PAYMONGO_WEBHOOK_SECRET
        && process.env.PAYMONGO_DISBURSEMENTS_ENABLED === "true"
          ? "Run the no-money PayMongo preflight, then submit the payout."
          : "PayMongo is the primary payout rail. Connect the wallet credentials and signed webhook, then run preflight. Bank files remain an optional fallback.",
      reference: null,
      method: "PayMongo",
      completedAt: null,
    },
    payslips: {
      status: postReleaseWarnings.length > 0 ? "attention" as const : "ready" as const,
      label:
        noticesFailed > 0
          ? `Payslips are available; ${noticesFailed} notice(s) failed and need retry`
          : noticesQueued > 0
            ? `Payslips are available; ${noticesSent} sent and ${noticesQueued} queued`
            : missingEmail > 0
              ? `Payslips are available; ${noticesSent} sent and ${missingEmail} employee(s) have no email on file`
              : `Payslips are available; ${noticesSent} notice(s) sent`,
      available: Number(entryCount),
      noticesQueued,
      noticesSent,
      noticesFailed,
      missingEmail,
      warningCount: postReleaseWarnings.length,
    },
  };

  try {
    await recordAuditEvent({
      organizationId: run.organizationId,
      actor: user.name,
      action: "Payroll release receipt",
      resource: run.periodLabel,
      metadata: receipt,
    });
  } catch {
    postReleaseWarnings.push("Payroll was released, but the delivery summary could not be added to the audit trail.");
    receipt.payslips.status = "attention";
    receipt.payslips.warningCount = postReleaseWarnings.length;
    receipt.payslips.label = "Payslips are available; delivery status needs attention";
  }

  const automation = await runAutomationEventSafely({
    organizationId: run.organizationId,
    trigger: "payroll.released",
    eventKey: `payroll-released:${run.id}`,
    context: {
      payrollRunId: run.id,
      periodLabel: run.periodLabel,
      orgUnitId: run.scopeOrgUnitId,
      legalEntityId: run.legalEntityId,
      payrollAmount: Number(run.grossPay),
      netPay: Number(run.netPay),
      employeeCount: Number(entryCount),
      payDate: run.payDate,
      releasedAt,
      releasedByUserId: user.id,
      approvalTaskId: payrollApproval.id,
    },
  });

  return Response.json({
    run: updated,
    settlement,
    webhookDeliveries,
    automation,
    employeesNotified: noticesSent + noticesQueued,
    emailDelivery: {
      sent: noticesSent,
      queued: noticesQueued,
      failed: noticesFailed,
      missingEmail,
    },
    postReleaseWarnings,
    receipt,
  });
}
