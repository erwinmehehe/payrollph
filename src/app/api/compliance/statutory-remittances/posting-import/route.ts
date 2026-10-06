import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  complianceActionTasks,
  statutoryContributionIssueCases,
  statutoryContributionIssueEvents,
  statutoryRemittanceBatches,
  statutoryRemittanceMembers,
  statutoryPostingEvidenceArtifacts,
} from "@/db/schema";
import { getAccess, PAYROLL_OPERATOR_ROLES, roleAllowed } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import { contributionCaseServiceTargets } from "@/lib/statutory-contribution-case-aging";
import { canConfirmMemberPosting } from "@/lib/statutory-remittance";
import { postingCsvEvidence } from "@/lib/statutory-posting-evidence";
import { invalidateStatutoryRemittanceMonthCertification } from "@/lib/statutory-remittance-certification";
import {
  parseStatutoryPostingCsv,
  STATUTORY_POSTING_TEMPLATE,
} from "@/lib/statutory-posting-import";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";

async function requirePayrollOperator(userId: number, organizationId: number) {
  const access = await getAccess(userId, organizationId);
  if (!access?.companyWide || !roleAllowed(access.role, PAYROLL_OPERATOR_ROLES)) {
    return Response.json({
      error: "Only company-wide payroll operators can import statutory posting evidence.",
    }, { status: 403 });
  }
  return null;
}

export async function GET() {
  return new Response(STATUTORY_POSTING_TEMPLATE + "\n", {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="statutory-posting-template.csv"',
      "cache-control": "no-store",
    },
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const batchId = Number(body.batchId);
  const csv = typeof body.csv === "string" ? body.csv : "";
  const fileName = String(body.fileName ?? "posting-evidence.csv").slice(0, 200);
  const dryRun = Boolean(body.dryRun);
  const openMismatchCases = Boolean(body.openMismatchCases);

  if (!Number.isInteger(organizationId) || !Number.isInteger(batchId) || !csv.trim()) {
    return Response.json({
      error: "organizationId, batchId and csv content are required.",
    }, { status: 400 });
  }
  if (Buffer.byteLength(csv, "utf8") > 2 * 1024 * 1024) {
    return Response.json({ error: "Posting evidence CSV exceeds the 2 MB limit." }, { status: 413 });
  }

  const denied = await requirePayrollOperator(user.id, organizationId);
  if (denied) return denied;
  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: "statutory-posting-import",
    resourceId: organizationId,
    limit: 15,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  const [batch] = await db.select().from(statutoryRemittanceBatches).where(and(
    eq(statutoryRemittanceBatches.id, batchId),
    eq(statutoryRemittanceBatches.organizationId, organizationId),
  )).limit(1);
  if (!batch) return Response.json({ error: "Remittance batch not found." }, { status: 404 });
  if (batch.status === "open") {
    return Response.json({
      error: "Record the agency payment before importing member posting evidence.",
    }, { status: 409 });
  }
  if (batch.status === "reconciled") {
    return Response.json({
      error: "A reconciled remittance batch is immutable.",
    }, { status: 409 });
  }

  const parsed = parseStatutoryPostingCsv(csv);
  const csvEvidence = postingCsvEvidence({ csv, fileName });
  if (csvEvidence.contentSha256 !== parsed.hash) {
    return Response.json({ error: "Posting evidence hash verification failed." }, { status: 500 });
  }
  const members = await db.select().from(statutoryRemittanceMembers).where(and(
    eq(statutoryRemittanceMembers.batchId, batchId),
    eq(statutoryRemittanceMembers.organizationId, organizationId),
  ));
  const byEmployeeNo = new Map(members.map((member) => [member.employeeNo, member]));

  const errors = [...parsed.errors];
  const matched: Array<{
    member: typeof members[number];
    postedAmount: number;
    postingReference: string;
    postedAt: Date;
  }> = [];

  const amountMismatchCandidates: Array<{
    member: typeof members[number];
    postedAmount: number;
    postingReference: string;
    sourceLine: number;
  }> = [];

  parsed.valid.forEach((row) => {
    const line = row.sourceLine;
    const member = byEmployeeNo.get(row.employeeNo);
    if (!member) {
      errors.push({ line, problems: [`Employee "${row.employeeNo}" is not part of this remittance batch.`] });
      return;
    }
    if (member.postingStatus === "confirmed") {
      errors.push({ line, problems: [`Employee "${row.employeeNo}" already has immutable confirmed posting evidence.`] });
      return;
    }

    const expectedTotal = Number(member.totalContribution);
    const amountMismatch = Math.abs(expectedTotal - row.postedAmount) > 0.01;
    const gate = canConfirmMemberPosting({
      expectedTotal,
      postedAmount: row.postedAmount,
      postingReference: row.postingReference,
    });
    if (!gate.ok) {
      if (amountMismatch && Number.isFinite(row.postedAmount) && row.postedAmount >= 0) {
        amountMismatchCandidates.push({
          member,
          postedAmount: row.postedAmount,
          postingReference: row.postingReference,
          sourceLine: line,
        });
      }
      errors.push({ line, problems: [gate.error] });
      return;
    }

    matched.push({
      member,
      postedAmount: row.postedAmount,
      postingReference: row.postingReference,
      postedAt: new Date(row.postedAt),
    });
  });

  if (errors.length > 0) {
    let autoCaseIds: number[] = [];

    if (openMismatchCases && amountMismatchCandidates.length > 0) {
      const candidateEmployeeIds = [...new Set(
        amountMismatchCandidates.map((candidate) => candidate.member.employeeId),
      )];
      const existingCases = candidateEmployeeIds.length
        ? await db.select({
            id: statutoryContributionIssueCases.id,
            employeeId: statutoryContributionIssueCases.employeeId,
          }).from(statutoryContributionIssueCases).where(and(
            eq(statutoryContributionIssueCases.organizationId, organizationId),
            eq(statutoryContributionIssueCases.agency, batch.agency),
            eq(statutoryContributionIssueCases.applicableMonth, batch.applicableMonth),
            eq(statutoryContributionIssueCases.issueType, "wrong_posted_amount"),
            inArray(statutoryContributionIssueCases.employeeId, candidateEmployeeIds),
            inArray(statutoryContributionIssueCases.status, ["open", "in_review"]),
          ))
        : [];
      const existingEmployeeIds = new Set(existingCases.map((row) => row.employeeId));

      const mismatchResult = await db.transaction(async (tx) => {
        const [insertedArtifact] = await tx.insert(statutoryPostingEvidenceArtifacts).values({
          organizationId,
          batchId,
          sourceType: csvEvidence.sourceType,
          outcome: "mismatch_cases",
          fileName: csvEvidence.fileName,
          mimeType: csvEvidence.mimeType,
          byteSize: csvEvidence.byteSize,
          contentSha256: csvEvidence.contentSha256,
          fileDataBase64: csvEvidence.fileDataBase64,
          evidenceReference: `${batch.agency} posting mismatch import`,
          rowCount: amountMismatchCandidates.length,
          recordedByUserId: user.id,
          recordedByName: user.name,
        }).onConflictDoNothing().returning();
        const artifact = insertedArtifact ?? (await tx.select().from(statutoryPostingEvidenceArtifacts).where(and(
          eq(statutoryPostingEvidenceArtifacts.organizationId, organizationId),
          eq(statutoryPostingEvidenceArtifacts.batchId, batchId),
          eq(statutoryPostingEvidenceArtifacts.contentSha256, csvEvidence.contentSha256),
          eq(statutoryPostingEvidenceArtifacts.outcome, "mismatch_cases"),
        )).limit(1))[0];
        if (!artifact) throw new Error("Could not persist posting evidence artifact.");

        const createdIds: number[] = [];
        for (const candidate of amountMismatchCandidates) {
          if (existingEmployeeIds.has(candidate.member.employeeId)) continue;

          const expectedTotal = Number(candidate.member.totalContribution);
          const description =
            `Agency posting import shows ${candidate.postedAmount.toFixed(2)} but payroll expects ${expectedTotal.toFixed(2)} for ${candidate.member.employeeNo}.`;

          const [issue] = await tx.insert(statutoryContributionIssueCases).values({
            organizationId,
            employeeId: candidate.member.employeeId,
            batchId: batch.id,
            remittanceMemberId: candidate.member.id,
            agency: batch.agency,
            applicableMonth: batch.applicableMonth,
            issueType: "wrong_posted_amount",
            description,
            employeeSnapshot: {
              source: "statutory_posting_import",
              fileName,
              fileHash: csvEvidence.contentSha256,
              evidenceArtifactId: artifact.id,
              sourceLine: candidate.sourceLine,
              employeeNo: candidate.member.employeeNo,
              expectedTotal,
              postedAmount: candidate.postedAmount,
              postingReference: candidate.postingReference,
              postingStatus: candidate.member.postingStatus,
            },
            status: "open",
            reportedByUserId: user.id,
            reportedByName: `Posting import · ${user.name}`.slice(0, 120),
          }).returning();

          const serviceTargets = contributionCaseServiceTargets(issue);

          await tx.insert(complianceActionTasks).values({
            organizationId,
            sourceType: "employee_contribution_issue",
            sourceKey: `employee-contribution-issue:${issue.id}`,
            agency: batch.agency,
            applicableMonth: batch.applicableMonth,
            severity: "danger",
            title: `${batch.agency} posting amount mismatch · ${candidate.member.employeeNo}`.slice(0, 180),
            detail: description.slice(0, 360),
            status: "open",
            dueDate: serviceTargets.firstReviewDue.toISOString().slice(0, 10),
            firstDetectedAt: new Date(),
            lastDetectedAt: new Date(),
          });

          await tx.insert(statutoryContributionIssueEvents).values({
            organizationId,
            caseId: issue.id,
            employeeId: candidate.member.employeeId,
            eventType: "reported",
            visibility: "employee",
            message: `Payroll detected a ${batch.agency} contribution amount mismatch from agency posting evidence for ${batch.applicableMonth}. Expected ${expectedTotal.toFixed(2)}, agency evidence shows ${candidate.postedAmount.toFixed(2)}. The invalid posting file was not applied.`,
            actorUserId: user.id,
            actorName: `Posting import · ${user.name}`.slice(0, 120),
          });

          createdIds.push(issue.id);
          existingEmployeeIds.add(candidate.member.employeeId);
        }
        return { createdIds, artifact };
      });
      autoCaseIds = mismatchResult.createdIds;

      if (autoCaseIds.length > 0) {
        await recordAuditEvent({
          organizationId,
          actor: user.name,
          action: "Agency posting import mismatches opened contribution cases",
          resource: `${batch.agency} · ${batch.applicableMonth}`,
          metadata: {
            batchId,
            fileName,
            fileHash: csvEvidence.contentSha256,
            evidenceArtifactId: mismatchResult.artifact.id,
            evidenceByteSize: mismatchResult.artifact.byteSize,
            caseIds: autoCaseIds,
            mismatchCount: autoCaseIds.length,
          },
        });

        const invalidatedClosures = await invalidateStatutoryRemittanceMonthCertification({
          organizationId,
          applicableMonth: batch.applicableMonth,
          reason: `Agency posting import opened ${autoCaseIds.length} contribution mismatch case(s).`,
        });
        if (invalidatedClosures.length > 0) {
          await recordAuditEvent({
            organizationId,
            actor: user.name,
            action: "Statutory remittance month certification invalidated",
            resource: batch.applicableMonth,
            metadata: {
              reason: "agency_posting_amount_mismatch_cases_opened",
              caseIds: autoCaseIds,
              batchId,
              invalidatedClosureIds: invalidatedClosures.map((row) => row.id),
            },
          });
        }
      }
    }

    return Response.json({
      dryRun,
      fileName,
      batchId,
      fileHash: parsed.hash,
      validRows: matched.length,
      errorCount: errors.length,
      errors: errors.slice(0, 50),
      unmappedColumns: parsed.unmapped,
      applied: false,
      validationFailed: true,
      amountMismatchCount: amountMismatchCandidates.length,
      autoCaseIds,
      evidenceArtifactId:
        openMismatchCases && autoCaseIds.length > 0
          ? (await db.select({ id: statutoryPostingEvidenceArtifacts.id }).from(statutoryPostingEvidenceArtifacts).where(and(
              eq(statutoryPostingEvidenceArtifacts.organizationId, organizationId),
              eq(statutoryPostingEvidenceArtifacts.batchId, batchId),
              eq(statutoryPostingEvidenceArtifacts.contentSha256, csvEvidence.contentSha256),
              eq(statutoryPostingEvidenceArtifacts.outcome, "mismatch_cases"),
            )).limit(1))[0]?.id ?? null
          : null,
      casesOpened: openMismatchCases && autoCaseIds.length > 0,
      message: openMismatchCases && autoCaseIds.length > 0
        ? `${autoCaseIds.length} employee contribution compliance case${autoCaseIds.length === 1 ? "" : "s"} opened from agency amount mismatches. No posting rows were applied.`
        : "No posting rows were applied because the file did not pass full validation.",
    }, { status: openMismatchCases && autoCaseIds.length > 0 ? 200 : 422 });
  }

  if (matched.length === 0) {
    return Response.json({
      error: "No valid posting rows were found.",
      dryRun,
      batchId,
      fileHash: parsed.hash,
    }, { status: 422 });
  }

  if (dryRun) {
    return Response.json({
      dryRun: true,
      fileName,
      batchId,
      fileHash: parsed.hash,
      validRows: matched.length,
      errorCount: 0,
      errors: [],
      unmappedColumns: parsed.unmapped,
      applied: false,
      message: `${matched.length} posting row${matched.length === 1 ? "" : "s"} validated. Nothing was changed.`,
    });
  }

  const result = await db.transaction(async (tx) => {
    const [currentBatch] = await tx.select({
      status: statutoryRemittanceBatches.status,
    }).from(statutoryRemittanceBatches).where(and(
      eq(statutoryRemittanceBatches.id, batchId),
      eq(statutoryRemittanceBatches.organizationId, organizationId),
    )).limit(1);
    if (!currentBatch || currentBatch.status === "open" || currentBatch.status === "reconciled") {
      throw new Error("Remittance batch changed while the import was being applied. Refresh and validate the file again.");
    }

    const [insertedArtifact] = await tx.insert(statutoryPostingEvidenceArtifacts).values({
      organizationId,
      batchId,
      sourceType: csvEvidence.sourceType,
      outcome: "applied",
      fileName: csvEvidence.fileName,
      mimeType: csvEvidence.mimeType,
      byteSize: csvEvidence.byteSize,
      contentSha256: csvEvidence.contentSha256,
      fileDataBase64: csvEvidence.fileDataBase64,
      evidenceReference: `${batch.agency} member posting import`,
      rowCount: matched.length,
      recordedByUserId: user.id,
      recordedByName: user.name,
    }).onConflictDoNothing().returning();
    const artifact = insertedArtifact ?? (await tx.select().from(statutoryPostingEvidenceArtifacts).where(and(
      eq(statutoryPostingEvidenceArtifacts.organizationId, organizationId),
      eq(statutoryPostingEvidenceArtifacts.batchId, batchId),
      eq(statutoryPostingEvidenceArtifacts.contentSha256, csvEvidence.contentSha256),
      eq(statutoryPostingEvidenceArtifacts.outcome, "applied"),
    )).limit(1))[0];
    if (!artifact) throw new Error("Could not persist posting evidence artifact.");

    for (const row of matched) {
      const updated = await tx.update(statutoryRemittanceMembers).set({
        postingStatus: "confirmed",
        postingReference: row.postingReference,
        postedAmount: row.postedAmount.toFixed(2),
        postedAt: row.postedAt,
        confirmedByUserId: user.id,
        confirmedBy: user.name,
        postingEvidenceArtifactId: artifact.id,
        exceptionNote: null,
        updatedAt: new Date(),
      }).where(and(
        eq(statutoryRemittanceMembers.id, row.member.id),
        eq(statutoryRemittanceMembers.organizationId, organizationId),
        ne(statutoryRemittanceMembers.postingStatus, "confirmed"),
      )).returning({ id: statutoryRemittanceMembers.id });
      if (updated.length !== 1) {
        throw new Error(`Employee "${row.member.employeeNo}" posting evidence changed concurrently. No rows were applied.`);
      }
    }

    const refreshed = await tx.select({
      postingStatus: statutoryRemittanceMembers.postingStatus,
    }).from(statutoryRemittanceMembers).where(and(
      eq(statutoryRemittanceMembers.batchId, batchId),
      eq(statutoryRemittanceMembers.organizationId, organizationId),
    ));
    const pending = refreshed.filter((row) => row.postingStatus === "pending").length;
    const exceptions = refreshed.filter((row) => row.postingStatus === "exception").length;
    const reconciled = pending === 0 && exceptions === 0;

    await tx.update(statutoryRemittanceBatches).set({
      status: reconciled ? "reconciled" : exceptions > 0 ? "exception" : "paid",
      reconciledAt: reconciled ? new Date() : null,
      reconciledByUserId: reconciled ? user.id : null,
      reconciledBy: reconciled ? user.name : null,
      updatedAt: new Date(),
    }).where(and(
      eq(statutoryRemittanceBatches.id, batchId),
      eq(statutoryRemittanceBatches.organizationId, organizationId),
    ));

    return { pending, exceptions, reconciled, artifact };
  });

  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: "Statutory member posting evidence imported",
    resource: `${batch.agency} · ${batch.applicableMonth}`,
    metadata: {
      batchId,
      fileName,
      fileHash: result.artifact.contentSha256,
      evidenceArtifactId: result.artifact.id,
      evidenceByteSize: result.artifact.byteSize,
      importedRows: matched.length,
      pendingPostingCount: result.pending,
      exceptionCount: result.exceptions,
      reconciled: result.reconciled,
      employeeIds: matched.map((row) => row.member.employeeId),
    },
  });

  return Response.json({
    dryRun: false,
    fileName,
    batchId,
    fileHash: result.artifact.contentSha256,
    evidenceArtifactId: result.artifact.id,
    validRows: matched.length,
    errorCount: 0,
    errors: [],
    unmappedColumns: parsed.unmapped,
    applied: true,
    reconciled: result.reconciled,
    pendingPostingCount: result.pending,
    exceptionCount: result.exceptions,
    message: `${matched.length} posting row${matched.length === 1 ? "" : "s"} applied.`,
  });
}
