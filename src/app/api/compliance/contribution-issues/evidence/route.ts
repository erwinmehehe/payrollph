import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  employees,
  governmentFilingValidations,
  payrollEntries,
  payrollRuns,
  payslips,
  statutoryContributionIssueCases,
  statutoryContributionIssueEvents,
  statutoryRemittanceBatches,
  statutoryRemittanceMembers,
  statutoryRemittanceCorrectionRequests,
  statutoryRemittanceMonthClosures,
} from "@/db/schema";
import { getAccess, PAYROLL_OPERATOR_ROLES, roleAllowed } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { enforceSensitiveActionRateLimit } from "@/lib/security-request";
import { buildContributionEvidencePack } from "@/lib/statutory-contribution-evidence-pack";
import {
  statutorySharesForEntry,
  type StatutoryAgency,
} from "@/lib/statutory-remittance";

export const dynamic = "force-dynamic";

function monthStart(month: string) {
  return `${month}-01`;
}

function monthEnd(month: string) {
  const [year, rawMonth] = month.split("-").map(Number);
  return new Date(Date.UTC(year, rawMonth, 0)).toISOString().slice(0, 10);
}

function safeFilePart(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100);
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  const caseId = Number(url.searchParams.get("caseId"));
  if (!Number.isInteger(organizationId) || !Number.isInteger(caseId)) {
    return Response.json({ error: "organizationId and caseId are required." }, { status: 400 });
  }

  const access = await getAccess(user.id, organizationId);
  if (!access || !access.companyWide || !roleAllowed(access.role, PAYROLL_OPERATOR_ROLES)) {
    return Response.json({
      error: "Only company-wide authorized payroll operators can export contribution-case evidence.",
    }, { status: 403 });
  }

  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: "payroll-contribution-case-evidence-export",
    resourceId: organizationId,
    limit: 30,
    windowMs: 60 * 60_000,
  });
  if (rateDenied) return rateDenied;

  const [row] = await db.select({
    issue: statutoryContributionIssueCases,
    employeeNo: employees.employeeNo,
    firstName: employees.firstName,
    lastName: employees.lastName,
  })
    .from(statutoryContributionIssueCases)
    .innerJoin(employees, eq(statutoryContributionIssueCases.employeeId, employees.id))
    .where(and(
      eq(statutoryContributionIssueCases.id, caseId),
      eq(statutoryContributionIssueCases.organizationId, organizationId),
      eq(employees.organizationId, organizationId),
    ))
    .limit(1);

  if (!row) return Response.json({ error: "Contribution issue case not found." }, { status: 404 });

  const issue = row.issue;
  const agency = issue.agency as StatutoryAgency;
  const applicableMonth = issue.applicableMonth;
  const start = monthStart(applicableMonth);
  const end = monthEnd(applicableMonth);

  const timeline = await db.select().from(statutoryContributionIssueEvents)
    .where(and(
      eq(statutoryContributionIssueEvents.organizationId, organizationId),
      eq(statutoryContributionIssueEvents.caseId, issue.id),
      eq(statutoryContributionIssueEvents.employeeId, issue.employeeId),
    ))
    .orderBy(
      asc(statutoryContributionIssueEvents.createdAt),
      asc(statutoryContributionIssueEvents.id),
    );

  const runs = await db.select().from(payrollRuns)
    .where(and(
      eq(payrollRuns.organizationId, organizationId),
      eq(payrollRuns.legalEntityId, issue.legalEntityId),
      eq(payrollRuns.status, "Released"),
      gte(payrollRuns.periodEnd, start),
      lte(payrollRuns.periodEnd, end),
    ))
    .orderBy(asc(payrollRuns.periodEnd), asc(payrollRuns.id));

  const runIds = runs.map((run) => run.id);
  const entries = runIds.length
    ? await db.select().from(payrollEntries)
        .where(and(
          eq(payrollEntries.employeeId, issue.employeeId),
          inArray(payrollEntries.payrollRunId, runIds),
        ))
        .orderBy(asc(payrollEntries.payrollRunId), asc(payrollEntries.id))
    : [];

  const entryIds = entries.map((entry) => entry.id);
  const slips = entryIds.length
    ? await db.select({
        id: payslips.id,
        payrollEntryId: payslips.payrollEntryId,
        periodLabel: payslips.periodLabel,
        ruleVersion: payslips.ruleVersion,
        createdAt: payslips.createdAt,
      }).from(payslips)
        .where(and(
          eq(payslips.organizationId, organizationId),
          eq(payslips.employeeId, issue.employeeId),
          inArray(payslips.payrollEntryId, entryIds),
        ))
        .orderBy(asc(payslips.createdAt), asc(payslips.id))
    : [];

  const [batch] = await db.select().from(statutoryRemittanceBatches)
    .where(and(
      eq(statutoryRemittanceBatches.organizationId, organizationId),
      eq(statutoryRemittanceBatches.legalEntityId, issue.legalEntityId),
      eq(statutoryRemittanceBatches.agency, agency),
      eq(statutoryRemittanceBatches.applicableMonth, applicableMonth),
    ))
    .limit(1);

  const [member] = batch
    ? await db.select().from(statutoryRemittanceMembers)
        .where(and(
          eq(statutoryRemittanceMembers.organizationId, organizationId),
          eq(statutoryRemittanceMembers.legalEntityId, issue.legalEntityId),
          eq(statutoryRemittanceMembers.batchId, batch.id),
          eq(statutoryRemittanceMembers.employeeId, issue.employeeId),
        ))
        .limit(1)
    : [];

  const corrections = batch
    ? await db.select().from(statutoryRemittanceCorrectionRequests)
        .where(and(
          eq(statutoryRemittanceCorrectionRequests.organizationId, organizationId),
          eq(statutoryRemittanceCorrectionRequests.batchId, batch.id),
        ))
        .orderBy(
          asc(statutoryRemittanceCorrectionRequests.createdAt),
          asc(statutoryRemittanceCorrectionRequests.id),
        )
    : [];

  const filings = await db.select().from(governmentFilingValidations)
    .where(and(
      eq(governmentFilingValidations.organizationId, organizationId),
      eq(governmentFilingValidations.legalEntityId, issue.legalEntityId),
      eq(governmentFilingValidations.agency, agency),
      eq(governmentFilingValidations.applicableMonth, applicableMonth),
    ))
    .orderBy(asc(governmentFilingValidations.createdAt), asc(governmentFilingValidations.id));

  const closures = await db.select().from(statutoryRemittanceMonthClosures)
    .where(and(
      eq(statutoryRemittanceMonthClosures.organizationId, organizationId),
      eq(statutoryRemittanceMonthClosures.legalEntityId, issue.legalEntityId),
      eq(statutoryRemittanceMonthClosures.applicableMonth, applicableMonth),
    ))
    .orderBy(asc(statutoryRemittanceMonthClosures.createdAt), asc(statutoryRemittanceMonthClosures.id));

  const runById = new Map(runs.map((run) => [run.id, run]));
  const slipByEntryId = new Map(slips.map((slip) => [slip.payrollEntryId, slip]));

  const payrollEvidence = entries.map((entry) => {
    const run = runById.get(entry.payrollRunId)!;
    const slip = slipByEntryId.get(entry.id) ?? null;
    const shares = statutorySharesForEntry({
      employeeId: entry.employeeId,
      lineItems: entry.lineItems,
      trace: entry.trace,
    }, agency);

    return {
      payrollRunId: run.id,
      payrollEntryId: entry.id,
      periodLabel: run.periodLabel,
      periodStart: String(run.periodStart),
      periodEnd: String(run.periodEnd),
      payDate: String(run.payDate),
      ruleVersion: run.ruleVersion,
      employeeShareDeducted: shares.employeeShare,
      employerShareCalculated: shares.employerShare,
      payslip: slip ? {
        payslipId: slip.id,
        periodLabel: slip.periodLabel,
        ruleVersion: slip.ruleVersion,
        createdAt: slip.createdAt.toISOString(),
      } : null,
    };
  });

  const payload = {
    schemaVersion: "linaw-contribution-case-evidence-v2",
    generatedAt: new Date().toISOString(),
    case: {
      caseId: issue.id,
      legalEntityId: issue.legalEntityId,
      employeeId: issue.employeeId,
      employeeNo: row.employeeNo,
      employeeName: `${row.firstName} ${row.lastName}`,
      agency,
      applicableMonth,
      issueType: issue.issueType,
      description: issue.description,
      status: issue.status,
      reportedByName: issue.reportedByName,
      reportedAt: issue.createdAt.toISOString(),
      assignedToName: issue.assignedToName,
      reviewStartedAt: issue.reviewStartedAt?.toISOString() ?? null,
      resolutionOutcome: issue.resolutionOutcome,
      resolutionNote: issue.resolutionNote,
      resolvedByName: issue.resolvedByName,
      resolvedAt: issue.resolvedAt?.toISOString() ?? null,
    },
    timeline: timeline.map((event) => ({
      eventId: event.id,
      eventType: event.eventType,
      visibility: event.visibility,
      message: event.message,
      actorName: event.actorName,
      createdAt: event.createdAt.toISOString(),
    })),
    reportedSnapshot: issue.employeeSnapshot,
    payrollEvidence,
    currentRemittanceEvidence: batch ? {
      batchId: batch.id,
      status: batch.status,
      dueDate: String(batch.dueDate),
      amountPaid: batch.amountPaid,
      paymentReference: batch.paymentReference,
      agencyReceiptReference: batch.agencyReceiptReference,
      paymentChannel: batch.paymentChannel,
      paidAt: batch.paidAt?.toISOString() ?? null,
      memberId: member?.id ?? null,
      employeeShare: member?.employeeShare ?? null,
      employerShare: member?.employerShare ?? null,
      totalContribution: member?.totalContribution ?? null,
      postingStatus: member?.postingStatus ?? "missing_employee_record",
      postingReference: member?.postingReference ?? null,
      postedAmount: member?.postedAmount ?? null,
      postedAt: member?.postedAt?.toISOString() ?? null,
      exceptionNote: member?.exceptionNote ?? null,
    } : null,
    correctionHistory: corrections.map((correction) => ({
      correctionId: correction.id,
      targetType: correction.targetType,
      batchId: correction.batchId,
      memberId: correction.memberId,
      status: correction.status,
      reason: correction.reason,
      requestedByName: correction.requestedByName,
      createdAt: correction.createdAt.toISOString(),
      decidedByName: correction.decidedByName,
      decisionNote: correction.decisionNote,
      decidedAt: correction.decidedAt?.toISOString() ?? null,
      appliedAt: correction.appliedAt?.toISOString() ?? null,
      originalSnapshot: correction.originalSnapshot,
      proposedSnapshot: correction.proposedSnapshot,
    })),
    filingEvidence: filings.map((filing) => ({
      form: filing.form,
      fileName: filing.fileName,
      fileSha256: filing.fileSha256,
      generatorVersion: filing.generatorVersion,
      status: filing.status,
      submissionMethod: filing.submissionMethod,
      agencyReference: filing.agencyReference,
      submittedAt: filing.submittedAt?.toISOString() ?? null,
      recordedAt: filing.recordedAt?.toISOString() ?? null,
    })),
    certificationHistory: closures.map((closure) => ({
      closureId: closure.id,
      status: closure.status,
      snapshotHash: closure.snapshotHash,
      certifiedByName: closure.certifiedByName,
      certifiedAt: closure.certifiedAt.toISOString(),
      invalidatedAt: closure.invalidatedAt?.toISOString() ?? null,
      invalidationReason: closure.invalidationReason,
    })),
    notices: [
      "This export is a PayrollPH compliance-case evidence artifact, not an agency-issued certificate.",
      "The reported snapshot preserves what the employee-facing remittance record showed when the case was created.",
      "Current evidence is included separately so later corrections do not rewrite the original report context.",
      "The case timeline is append-only evidence of review, employee-visible updates, referrals and resolution events.",
      "Correction history shows audited proposed changes separately from the original employee report and current agency posting.",
    ],
  };

  const pack = buildContributionEvidencePack(payload);

  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: "Employee contribution case evidence exported",
    resource: `${agency} · ${applicableMonth} · case #${issue.id}`,
    metadata: {
      caseId: issue.id,
      legalEntityId: issue.legalEntityId,
      employeeId: issue.employeeId,
      evidenceHashSha256: pack.evidenceHashSha256,
      payrollEntries: payrollEvidence.length,
      timelineEvents: timeline.length,
      correctionRecords: corrections.length,
      filingArtifacts: filings.length,
    },
  });

  const filename = safeFilePart(
    `case-${issue.id}-${row.employeeNo}-${agency}-${applicableMonth}-evidence.json`,
  );

  return new Response(JSON.stringify(pack, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
