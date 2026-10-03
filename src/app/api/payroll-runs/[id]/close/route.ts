import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, governmentFilingValidations, payrollRuns } from "@/db/schema";
import { ORG_ADMIN_ROLES, assertOrganizationRole, assertOrganizationUnitAccess } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { buildBookkeeperPayrollClose } from "@/lib/bookkeeper-payroll-close";
import { publicDemoMutationDenied } from "@/lib/demo-security";
import { FILING_FORMS, provesFileFormat } from "@/lib/filing-evidence";
import { generateJournalCsv } from "@/lib/exporters";
import { derivePayrollPayoutState } from "@/lib/payroll-payout-state";
import { enforceSameOriginMutation, requireSensitiveActionMfa } from "@/lib/security-request";

export const dynamic = "force-dynamic";

async function loadCloseState(runId: number, userId: number) {
  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId)).limit(1);
  if (!run) return { error: Response.json({ error: "Payroll run not found." }, { status: 404 }) };

  const denied = await assertOrganizationRole(
    userId,
    run.organizationId,
    ORG_ADMIN_ROLES,
    "Only an owner, administrator, or bookkeeper can inspect payroll close.",
  );
  if (denied) return { error: denied };

  const scopeDenied = await assertOrganizationUnitAccess(
    userId,
    run.organizationId,
    run.scopeOrgUnitId,
    "This payroll run is outside your assigned organization unit.",
  );
  if (scopeDenied) return { error: scopeDenied };

  const [events, filingRows] = await Promise.all([
    db.select().from(auditEvents)
      .where(eq(auditEvents.organizationId, run.organizationId))
      .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id)),
    db.select().from(governmentFilingValidations)
      .where(and(
        eq(governmentFilingValidations.organizationId, run.organizationId),
        eq(governmentFilingValidations.payrollRunId, run.id),
      ))
      .orderBy(desc(governmentFilingValidations.createdAt), desc(governmentFilingValidations.id)),
  ]);

  const runEvents = events.filter((event) => {
    if (!event.metadata || typeof event.metadata !== "object") return false;
    return Number((event.metadata as Record<string, unknown>).runId) === run.id;
  });
  const payout = derivePayrollPayoutState(events, run.id);
  const journalEvent = runEvents.find((event) => event.action === "journal export generated") ?? null;
  const closeEvent = runEvents.find((event) => event.action === "Payroll close completed") ?? null;
  const governmentExports = runEvents.filter((event) => event.action === "government export generated");

  let liabilities = null;
  let liabilityError: string | null = null;
  if (run.status === "Released") {
    try {
      liabilities = (await generateJournalCsv(run.id)).summary;
    } catch (error) {
      liabilityError = error instanceof Error ? error.message : "Statutory liabilities could not be prepared.";
    }
  }

  const filingEvidence = FILING_FORMS.map((definition) => {
    const rows = filingRows.filter((row) => row.agency === definition.agency && row.form === definition.form);
    const proving = rows.find((row) => provesFileFormat(row, definition)) ?? null;
    const latest = rows[0] ?? null;
    return {
      agency: definition.agency,
      form: definition.form,
      kind: definition.kind,
      periodType: definition.form === "1604-C" ? "annual/source-layout evidence" : "agency remittance evidence",
      status: proving ? "accepted" : latest?.status ?? "not recorded",
      proven: Boolean(proving),
      reference: proving?.agencyReference ?? latest?.agencyReference ?? null,
      submittedAt: proving?.submittedAt ?? latest?.submittedAt ?? null,
      note: definition.copy.scopeNote,
    };
  });

  const closeMetadata = closeEvent?.metadata && typeof closeEvent.metadata === "object"
    ? closeEvent.metadata as Record<string, unknown>
    : {};
  const closedAt = closeEvent
    ? typeof closeMetadata.closedAt === "string"
      ? closeMetadata.closedAt
      : new Date(closeEvent.createdAt).toISOString()
    : null;

  const state = buildBookkeeperPayrollClose({
    runStatus: run.status,
    payoutCompleted: payout.payout.status === "completed",
    journalExported: Boolean(journalEvent),
    liabilities,
    filingEvidence,
    closedAt,
  });

  return {
    run,
    state,
    payout,
    liabilities,
    liabilityError,
    filingEvidence,
    journal: {
      exported: Boolean(journalEvent),
      exportedAt: journalEvent ? new Date(journalEvent.createdAt).toISOString() : null,
      filename: journalEvent && journalEvent.metadata && typeof journalEvent.metadata === "object"
        ? String((journalEvent.metadata as Record<string, unknown>).filename ?? "")
        : null,
    },
    governmentExports: governmentExports.map((event) => ({
      id: event.id,
      createdAt: new Date(event.createdAt).toISOString(),
      template: event.metadata && typeof event.metadata === "object"
        ? String((event.metadata as Record<string, unknown>).template ?? "")
        : "",
      filename: event.metadata && typeof event.metadata === "object"
        ? String((event.metadata as Record<string, unknown>).filename ?? "")
        : "",
    })),
    closeEvent: closeEvent ? {
      id: closeEvent.id,
      actor: closeEvent.actor,
      createdAt: new Date(closeEvent.createdAt).toISOString(),
      metadata: closeMetadata,
    } : null,
  };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const runId = Number(id);
  if (!Number.isInteger(runId)) return Response.json({ error: "Invalid run id." }, { status: 400 });

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const result = await loadCloseState(runId, user.id);
  if ("error" in result) return result.error;
  return Response.json(result);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const { id } = await params;
  const runId = Number(id);
  if (!Number.isInteger(runId)) return Response.json({ error: "Invalid run id." }, { status: 400 });

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const demoDenied = publicDemoMutationDenied(user.email, "Closing payroll");
  if (demoDenied) return demoDenied;
  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;

  const result = await loadCloseState(runId, user.id);
  if ("error" in result) return result.error;
  if (result.state.closed) {
    return Response.json({
      closed: true,
      alreadyClosed: true,
      closedAt: result.state.closedAt,
      closeEvent: result.closeEvent,
    });
  }

  const body = await request.json().catch(() => ({}));
  if (body.confirmed !== true) {
    return Response.json({
      error: "Confirm the payroll close after reviewing payout, journal, liabilities, and filing evidence.",
    }, { status: 400 });
  }
  if (!result.state.canClose) {
    return Response.json({
      error: "Payroll close still has blocking accounting controls.",
      blockers: result.state.hardBlockers,
    }, { status: 409 });
  }
  if (result.state.requiresFilingEvidenceAcknowledgement && body.acknowledgeFilingEvidenceGaps !== true) {
    return Response.json({
      error: "Review and acknowledge the outstanding filing-evidence gaps before closing this semi-monthly payroll cycle.",
      filingEvidenceGaps: result.state.filingEvidenceGaps,
    }, { status: 409 });
  }

  const closedAt = new Date().toISOString();
  await recordAuditEvent({
    organizationId: result.run.organizationId,
    actor: user.name,
    action: "Payroll close completed",
    resource: result.run.periodLabel,
    metadata: {
      runId: result.run.id,
      closedAt,
      payout: {
        status: result.payout.payout.status,
        reference: result.payout.payout.reference,
        method: result.payout.payout.method,
        completedAt: result.payout.payout.completedAt,
      },
      journal: result.journal,
      liabilities: result.liabilities,
      filingEvidence: result.filingEvidence.map((item) => ({
        agency: item.agency,
        form: item.form,
        status: item.status,
        proven: item.proven,
        reference: item.reference,
      })),
      filingEvidenceGapsAcknowledged: result.state.requiresFilingEvidenceAcknowledgement,
      accountingCloseOnly: true,
      note: "Payroll close records accounting completion for this cutoff. It does not claim government filing or remittance beyond the attached agency evidence.",
    },
  });

  return Response.json({
    closed: true,
    closedAt,
    filingEvidenceGapsAcknowledged: result.state.requiresFilingEvidenceAcknowledgement,
  });
}
