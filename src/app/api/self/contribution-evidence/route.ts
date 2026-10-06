import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  employees,
  governmentFilingValidations,
  legalEntities,
  organizations,
  payrollEntries,
  payrollRuns,
  payslips,
  statutoryContributionIssueCases,
  statutoryContributionIssueEvents,
  statutoryRemittanceBatches,
  statutoryRemittanceMembers,
  statutoryRemittanceMonthClosures,
  statutoryRemittancePaymentEvidence,
  statutoryPostingEvidenceArtifacts,
} from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { compareFilingToRemittance } from "@/lib/filing-remittance-snapshot";
import { enforceSensitiveActionRateLimit } from "@/lib/security-request";
import { buildContributionEvidencePack } from "@/lib/statutory-contribution-evidence-pack";
import { postingEvidenceSourceLabel } from "@/lib/statutory-posting-evidence";
import {
  statutorySharesForEntry,
  type StatutoryAgency,
} from "@/lib/statutory-remittance";

export const dynamic = "force-dynamic";

const AGENCIES = new Set<StatutoryAgency>(["SSS", "PhilHealth", "Pag-IBIG"]);

function monthStart(month: string) {
  return `${month}-01`;
}

function monthEnd(month: string) {
  const [year, rawMonth] = month.split("-").map(Number);
  return new Date(Date.UTC(year, rawMonth, 0)).toISOString().slice(0, 10);
}

function safeFilePart(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  if (user.role !== "employee" || !user.employeeId) {
    return Response.json({
      error: "This evidence export is available only to linked employee self-service accounts.",
    }, { status: 403 });
  }

  const url = new URL(request.url);
  const agency = String(url.searchParams.get("agency") ?? "").trim() as StatutoryAgency;
  const applicableMonth = String(url.searchParams.get("month") ?? "").trim();

  if (!AGENCIES.has(agency) || !/^\d{4}-\d{2}$/.test(applicableMonth)) {
    return Response.json({
      error: "agency and month (YYYY-MM) are required.",
    }, { status: 400 });
  }

  const [employee] = await db.select().from(employees)
    .where(eq(employees.id, user.employeeId))
    .limit(1);
  if (!employee) return Response.json({ error: "Employee record not found." }, { status: 404 });
  if (!employee.legalEntityId) {
    return Response.json({ error: "Your employee record has no legal employer. Contact payroll before exporting contribution evidence." }, { status: 409 });
  }

  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: "employee-contribution-evidence-export",
    resourceId: employee.organizationId,
    limit: 20,
    windowMs: 60 * 60_000,
  });
  if (rateDenied) return rateDenied;

  const [[organization], [legalEntity]] = await Promise.all([
    db.select({
      id: organizations.id,
      name: organizations.name,
      legalName: organizations.legalName,
    }).from(organizations)
      .where(eq(organizations.id, employee.organizationId))
      .limit(1),
    db.select({
      id: legalEntities.id,
      code: legalEntities.code,
      legalName: legalEntities.legalName,
      displayName: legalEntities.displayName,
    }).from(legalEntities)
      .where(and(
        eq(legalEntities.id, employee.legalEntityId),
        eq(legalEntities.organizationId, employee.organizationId),
      ))
      .limit(1),
  ]);
  if (!organization || !legalEntity) return Response.json({ error: "Employer record not found." }, { status: 404 });

  const start = monthStart(applicableMonth);
  const end = monthEnd(applicableMonth);

  const runs = await db.select().from(payrollRuns)
    .where(and(
      eq(payrollRuns.organizationId, employee.organizationId),
      eq(payrollRuns.legalEntityId, employee.legalEntityId),
      eq(payrollRuns.status, "Released"),
      gte(payrollRuns.periodEnd, start),
      lte(payrollRuns.periodEnd, end),
    ))
    .orderBy(asc(payrollRuns.periodEnd), asc(payrollRuns.id));

  const runIds = runs.map((run) => run.id);
  const entries = runIds.length
    ? await db.select().from(payrollEntries)
        .where(and(
          eq(payrollEntries.employeeId, employee.id),
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
          eq(payslips.organizationId, employee.organizationId),
          eq(payslips.employeeId, employee.id),
          inArray(payslips.payrollEntryId, entryIds),
        ))
        .orderBy(asc(payslips.createdAt), asc(payslips.id))
    : [];

  const [batch] = await db.select().from(statutoryRemittanceBatches)
    .where(and(
      eq(statutoryRemittanceBatches.organizationId, employee.organizationId),
      eq(statutoryRemittanceBatches.legalEntityId, employee.legalEntityId),
      eq(statutoryRemittanceBatches.agency, agency),
      eq(statutoryRemittanceBatches.applicableMonth, applicableMonth),
    ))
    .limit(1);

  const [member] = batch
    ? await db.select().from(statutoryRemittanceMembers)
        .where(and(
          eq(statutoryRemittanceMembers.organizationId, employee.organizationId),
          eq(statutoryRemittanceMembers.legalEntityId, employee.legalEntityId),
          eq(statutoryRemittanceMembers.batchId, batch.id),
          eq(statutoryRemittanceMembers.employeeId, employee.id),
        ))
        .limit(1)
    : [];

  const [postingEvidenceArtifact] = member?.postingEvidenceArtifactId
    ? await db.select({
        id: statutoryPostingEvidenceArtifacts.id,
        sourceType: statutoryPostingEvidenceArtifacts.sourceType,
        contentSha256: statutoryPostingEvidenceArtifacts.contentSha256,
        createdAt: statutoryPostingEvidenceArtifacts.createdAt,
      }).from(statutoryPostingEvidenceArtifacts)
        .where(and(
          eq(statutoryPostingEvidenceArtifacts.id, member.postingEvidenceArtifactId),
          eq(statutoryPostingEvidenceArtifacts.organizationId, employee.organizationId),
          eq(statutoryPostingEvidenceArtifacts.batchId, batch!.id),
        ))
        .limit(1)
    : [];

  const [paymentProof] = batch
    ? await db.select({
        id: statutoryRemittancePaymentEvidence.id,
        fileName: statutoryRemittancePaymentEvidence.fileName,
        mimeType: statutoryRemittancePaymentEvidence.mimeType,
        byteSize: statutoryRemittancePaymentEvidence.byteSize,
        fileSha256: statutoryRemittancePaymentEvidence.fileSha256,
        uploadedByName: statutoryRemittancePaymentEvidence.uploadedByName,
        uploadedAt: statutoryRemittancePaymentEvidence.uploadedAt,
      }).from(statutoryRemittancePaymentEvidence)
        .where(and(
          eq(statutoryRemittancePaymentEvidence.organizationId, employee.organizationId),
          eq(statutoryRemittancePaymentEvidence.batchId, batch.id),
          eq(statutoryRemittancePaymentEvidence.status, "active"),
        ))
        .limit(1)
    : [];

  const filings = await db.select().from(governmentFilingValidations)
    .where(and(
      eq(governmentFilingValidations.organizationId, employee.organizationId),
      eq(governmentFilingValidations.legalEntityId, employee.legalEntityId),
      eq(governmentFilingValidations.agency, agency),
      eq(governmentFilingValidations.applicableMonth, applicableMonth),
    ))
    .orderBy(asc(governmentFilingValidations.createdAt), asc(governmentFilingValidations.id));

  const cases = await db.select().from(statutoryContributionIssueCases)
    .where(and(
      eq(statutoryContributionIssueCases.organizationId, employee.organizationId),
      eq(statutoryContributionIssueCases.legalEntityId, employee.legalEntityId),
      eq(statutoryContributionIssueCases.employeeId, employee.id),
      eq(statutoryContributionIssueCases.agency, agency),
      eq(statutoryContributionIssueCases.applicableMonth, applicableMonth),
    ))
    .orderBy(asc(statutoryContributionIssueCases.createdAt), asc(statutoryContributionIssueCases.id));

  const caseIds = cases.map((issue) => issue.id);
  const caseEvents = caseIds.length
    ? await db.select().from(statutoryContributionIssueEvents)
        .where(and(
          eq(statutoryContributionIssueEvents.organizationId, employee.organizationId),
          eq(statutoryContributionIssueEvents.employeeId, employee.id),
          eq(statutoryContributionIssueEvents.visibility, "employee"),
          inArray(statutoryContributionIssueEvents.caseId, caseIds),
        ))
        .orderBy(
          asc(statutoryContributionIssueEvents.createdAt),
          asc(statutoryContributionIssueEvents.id),
        )
    : [];
  const eventsByCase = new Map<number, typeof caseEvents>();
  for (const event of caseEvents) {
    eventsByCase.set(event.caseId, [...(eventsByCase.get(event.caseId) ?? []), event]);
  }

  const closures = await db.select().from(statutoryRemittanceMonthClosures)
    .where(and(
      eq(statutoryRemittanceMonthClosures.organizationId, employee.organizationId),
      eq(statutoryRemittanceMonthClosures.legalEntityId, employee.legalEntityId),
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

  const employeeShareDeducted = payrollEvidence.reduce(
    (sum, row) => sum + Number(row.employeeShareDeducted || 0),
    0,
  );
  const employerShareCalculated = payrollEvidence.reduce(
    (sum, row) => sum + Number(row.employerShareCalculated || 0),
    0,
  );
  const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
  const remittanceEmployeeShare = member ? Number(member.employeeShare) : null;
  const remittanceEmployerShare = member ? Number(member.employerShare) : null;

  const filingEvidence = filings.map((filing) => {
    let matchedToRemittance: boolean | null = null;
    if (
      batch
      && filing.employeeCount != null
      && filing.reportedTotal != null
    ) {
      matchedToRemittance = compareFilingToRemittance({
        filingEmployeeCount: filing.employeeCount,
        filingTotal: Number(filing.reportedTotal),
        remittanceEmployeeCount: batch.employeeCount,
        remittanceTotal: Number(batch.expectedTotal),
      }).matched;
    }

    return {
      form: filing.form,
      fileName: filing.fileName,
      fileSha256: filing.fileSha256,
      generatorVersion: filing.generatorVersion,
      status: filing.status,
      submissionMethod: filing.submissionMethod,
      agencyReference: filing.agencyReference,
      submittedAt: filing.submittedAt?.toISOString() ?? null,
      recordedAt: filing.recordedAt?.toISOString() ?? null,
      matchedToRemittance,
    };
  });

  const caseHistory = cases.map((issue) => ({
    caseId: issue.id,
    issueType: issue.issueType,
    description: issue.description,
    status: issue.status,
    reportedAt: issue.createdAt.toISOString(),
    reviewStartedAt: issue.reviewStartedAt?.toISOString() ?? null,
    assignedToName: issue.assignedToName,
    resolutionOutcome: issue.resolutionOutcome,
    resolutionNote: issue.resolutionNote,
    resolvedByName: issue.resolvedByName,
    resolvedAt: issue.resolvedAt?.toISOString() ?? null,
    timeline: (eventsByCase.get(issue.id) ?? []).map((event) => ({
      eventId: event.id,
      eventType: event.eventType,
      message: event.message,
      actorName: event.actorName,
      createdAt: event.createdAt.toISOString(),
    })),
  }));

  const certificationHistory = closures.map((closure) => ({
    closureId: closure.id,
    status: closure.status,
    snapshotHash: closure.snapshotHash,
    certifiedByName: closure.certifiedByName,
    certifiedAt: closure.certifiedAt.toISOString(),
    invalidatedAt: closure.invalidatedAt?.toISOString() ?? null,
    invalidationReason: closure.invalidationReason,
  }));

  const generatedAt = new Date().toISOString();
  const payload = {
    schemaVersion: "linaw-statutory-contribution-evidence-v1",
    generatedAt,
    employee: {
      employeeNo: employee.employeeNo,
      name: `${employee.firstName} ${employee.lastName}`,
    },
    employer: {
      organizationName: organization.name,
      legalEntityId: legalEntity.id,
      legalEntityCode: legalEntity.code,
      name: legalEntity.displayName,
      legalName: legalEntity.legalName,
    },
    agency,
    applicableMonth,
    payrollEvidence,
    reconciliation: {
      employeeShareDeducted: round2(employeeShareDeducted),
      employerShareCalculated: round2(employerShareCalculated),
      remittanceEmployeeShare,
      remittanceEmployerShare,
      employeeShareMatchesRemittance:
        remittanceEmployeeShare == null
          ? null
          : Math.abs(round2(employeeShareDeducted) - round2(remittanceEmployeeShare)) <= 0.01,
      employerShareMatchesRemittance:
        remittanceEmployerShare == null
          ? null
          : Math.abs(round2(employerShareCalculated) - round2(remittanceEmployerShare)) <= 0.01,
    },
    remittanceEvidence: batch ? {
      batchId: batch.id,
      status: batch.status,
      dueDate: String(batch.dueDate),
      paymentReference: batch.paymentReference,
      agencyReceiptReference: batch.agencyReceiptReference,
      paymentChannel: batch.paymentChannel,
      paidAt: batch.paidAt?.toISOString() ?? null,
      paymentProof: paymentProof ? {
        evidenceId: paymentProof.id,
        fileName: paymentProof.fileName,
        mimeType: paymentProof.mimeType,
        byteSize: paymentProof.byteSize,
        fileSha256: paymentProof.fileSha256,
        uploadedByName: paymentProof.uploadedByName,
        uploadedAt: paymentProof.uploadedAt.toISOString(),
      } : null,
      employeeShare: member?.employeeShare ?? null,
      employerShare: member?.employerShare ?? null,
      totalContribution: member?.totalContribution ?? null,
      postingStatus: member?.postingStatus ?? "missing_employee_record",
      postingReference: member?.postingReference ?? null,
      postedAmount: member?.postedAmount ?? null,
      postedAt: member?.postedAt?.toISOString() ?? null,
      postingEvidence: postingEvidenceArtifact ? {
        source: postingEvidenceSourceLabel(postingEvidenceArtifact.sourceType),
        sha256: postingEvidenceArtifact.contentSha256,
        recordedAt: postingEvidenceArtifact.createdAt.toISOString(),
      } : null,
      exceptionNote: member?.exceptionNote ?? null,
    } : null,
    filingEvidence,
    caseHistory,
    certificationHistory,
    notices: [
      "This export is generated from PayrollPH records and is not an agency-issued certificate.",
      "The evidence hash verifies the contents of this export; filing, payment-proof and posting-evidence hashes identify the exact stored artifacts referenced here.",
      "No other employee's payroll or contribution amounts are included.",
      "Imported multi-employee posting source files are retained for employer audit but are not downloadable from employee self-service.",
      "Contribution-case timeline entries are limited to events explicitly marked employee-visible.",
    ],
  };

  const pack = buildContributionEvidencePack(payload);

  await recordAuditEvent({
    organizationId: employee.organizationId,
    actor: user.name,
    action: "Employee statutory contribution evidence exported",
    resource: `${agency} · ${applicableMonth} · ${employee.employeeNo}`,
    metadata: {
      employeeId: employee.id,
      legalEntityId: employee.legalEntityId,
      legalEntityCode: legalEntity.code,
      agency,
      applicableMonth,
      evidenceHashSha256: pack.evidenceHashSha256,
      payrollEntries: payrollEvidence.length,
      filingArtifacts: filingEvidence.length,
      paymentProofEvidenceId: paymentProof?.id ?? null,
      paymentProofSha256: paymentProof?.fileSha256 ?? null,
      postingEvidenceArtifactId: postingEvidenceArtifact?.id ?? null,
      postingEvidenceSha256: postingEvidenceArtifact?.contentSha256 ?? null,
      postingEvidenceSource: postingEvidenceArtifact
        ? postingEvidenceSourceLabel(postingEvidenceArtifact.sourceType)
        : null,
      contributionCases: caseHistory.length,
      contributionCaseTimelineEvents: caseEvents.length,
    },
  });

  const filename = safeFilePart(
    `${employee.employeeNo}-${agency}-${applicableMonth}-contribution-evidence.json`,
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
