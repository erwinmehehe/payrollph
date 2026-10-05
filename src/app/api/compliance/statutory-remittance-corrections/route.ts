import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import {
  employees,
  payrollEntries,
  payrollRuns,
  statutoryContributionIssueCases,
  statutoryContributionIssueEvents,
  statutoryRemittanceBatches,
  statutoryRemittanceCorrectionRequests,
  statutoryRemittanceMembers,
} from "@/db/schema";
import {
  getAccess,
  PAYROLL_OPERATOR_ROLES,
  roleAllowed,
} from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { getSessionUser } from "@/lib/auth";
import {
  batchPaymentSnapshot,
  memberPostingSnapshot,
  type BatchPaymentEvidence,
  type MemberPostingEvidence,
  snapshotsMatch,
  validatePaymentCorrection,
  validatePostingCorrection,
} from "@/lib/statutory-remittance-correction";
import { syncStatutoryRemittanceActions } from "@/lib/statutory-remittance-actions";
import {
  buildStatutoryRemittanceSnapshot,
  statutoryRemittanceSnapshotHash,
  type StatutoryAgency,
} from "@/lib/statutory-remittance";
import { invalidateStatutoryRemittanceMonthCertification } from "@/lib/statutory-remittance-certification";
import { ensureStatutoryRemittanceCorrectionSchema } from "@/lib/statutory-remittance-correction-schema";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";

const APPROVER_ROLES = ["owner", "admin", "checker"] as const;

function monthStart(month: string) {
  return `${month}-01`;
}

function monthEnd(month: string) {
  const [year, rawMonth] = month.split("-").map(Number);
  return new Date(Date.UTC(year, rawMonth, 0)).toISOString().slice(0, 10);
}

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

async function deriveMissingMemberAddition(organizationId: number, caseId: number) {
  const [issue] = await db.select().from(statutoryContributionIssueCases).where(and(
    eq(statutoryContributionIssueCases.id, caseId),
    eq(statutoryContributionIssueCases.organizationId, organizationId),
  )).limit(1);
  if (!issue) throw new Error("Contribution issue case not found.");
  if (issue.status === "resolved") throw new Error("Resolved contribution cases cannot request a missing-member correction.");
  if (issue.issueType !== "missing_posting") {
    throw new Error("Missing-member corrections are only available for missing-posting cases.");
  }
  if (issue.remittanceMemberId != null) {
    throw new Error("This contribution case already has a linked remittance member.");
  }

  const [employee] = await db.select({
    id: employees.id,
    employeeNo: employees.employeeNo,
  }).from(employees).where(and(
    eq(employees.id, issue.employeeId),
    eq(employees.organizationId, organizationId),
  )).limit(1);
  if (!employee) throw new Error("Employee record not found.");

  const [batch] = await db.select().from(statutoryRemittanceBatches).where(and(
    eq(statutoryRemittanceBatches.organizationId, organizationId),
    eq(statutoryRemittanceBatches.agency, issue.agency),
    eq(statutoryRemittanceBatches.applicableMonth, issue.applicableMonth),
  )).limit(1);
  if (!batch) {
    throw new Error("No remittance batch exists for this agency and month. Create or reconcile the batch before adding a missing member.");
  }
  if (batch.status === "open") {
    throw new Error("Record the employer remittance payment before using a missing-member correction.");
  }

  const existingMembers = await db.select().from(statutoryRemittanceMembers).where(and(
    eq(statutoryRemittanceMembers.organizationId, organizationId),
    eq(statutoryRemittanceMembers.batchId, batch.id),
  )).orderBy(asc(statutoryRemittanceMembers.employeeId));

  if (existingMembers.some((member) => member.employeeId === employee.id)) {
    throw new Error("This employee already exists in the remittance batch.");
  }

  if (existingMembers.length !== batch.employeeCount) {
    throw new Error("Batch employee count does not match its member rows. Resolve the batch reconciliation mismatch first.");
  }

  const runs = await db.select().from(payrollRuns).where(and(
    eq(payrollRuns.organizationId, organizationId),
    gte(payrollRuns.periodEnd, monthStart(issue.applicableMonth)),
    lte(payrollRuns.periodEnd, monthEnd(issue.applicableMonth)),
  ));
  if (runs.length === 0 || runs.some((run) => run.status !== "Released")) {
    throw new Error("All payroll runs for the contribution month must be Released before a missing member can be derived.");
  }

  const runIds = runs.map((run) => run.id);
  const entries = await db.select({
    employeeId: payrollEntries.employeeId,
    lineItems: payrollEntries.lineItems,
    trace: payrollEntries.trace,
  }).from(payrollEntries).where(inArray(payrollEntries.payrollRunId, runIds));

  const employeeIds = [...new Set(entries.map((entry) => entry.employeeId))];
  const identities = employeeIds.length
    ? await db.select({
        id: employees.id,
        employeeNo: employees.employeeNo,
      }).from(employees).where(and(
        eq(employees.organizationId, organizationId),
        inArray(employees.id, employeeIds),
      ))
    : [];

  const payrollSnapshot = buildStatutoryRemittanceSnapshot({
    agency: issue.agency as StatutoryAgency,
    applicableMonth: issue.applicableMonth,
    entries,
    employees: identities,
  });
  const expectedByEmployee = new Map(payrollSnapshot.members.map((member) => [member.employeeId, member]));
  const target = expectedByEmployee.get(employee.id);
  if (!target) {
    throw new Error("Released payroll does not contain a positive statutory contribution for this employee and agency.");
  }

  for (const member of existingMembers) {
    const expected = expectedByEmployee.get(member.employeeId);
    if (
      !expected
      || Math.abs(Number(member.employeeShare) - expected.employeeShare) > 0.01
      || Math.abs(Number(member.employerShare) - expected.employerShare) > 0.01
      || Math.abs(Number(member.totalContribution) - expected.totalContribution) > 0.01
    ) {
      throw new Error("Existing remittance membership does not match released payroll. Resolve that broader variance before adding a member.");
    }
  }

  const currentEmployeeShare = round2(existingMembers.reduce((sum, row) => sum + Number(row.employeeShare), 0));
  const currentEmployerShare = round2(existingMembers.reduce((sum, row) => sum + Number(row.employerShare), 0));
  const currentTotal = round2(existingMembers.reduce((sum, row) => sum + Number(row.totalContribution), 0));
  if (
    Math.abs(currentEmployeeShare - Number(batch.expectedEmployeeShare)) > 0.01
    || Math.abs(currentEmployerShare - Number(batch.expectedEmployerShare)) > 0.01
    || Math.abs(currentTotal - Number(batch.expectedTotal)) > 0.01
  ) {
    throw new Error("Batch liability totals do not match existing member rows. Resolve the batch variance first.");
  }

  const membersAfter = [
    ...existingMembers.map((member) => ({
      employeeId: member.employeeId,
      employeeNo: member.employeeNo,
      employeeShare: Number(member.employeeShare),
      employerShare: Number(member.employerShare),
      totalContribution: Number(member.totalContribution),
    })),
    target,
  ];

  const proposedSnapshot = {
    caseId: issue.id,
    employeeId: target.employeeId,
    employeeNo: target.employeeNo,
    employeeShare: target.employeeShare.toFixed(2),
    employerShare: target.employerShare.toFixed(2),
    totalContribution: target.totalContribution.toFixed(2),
    postingStatus: "exception",
    exceptionNote: "Employee was omitted from the remittance member list; payment and agency posting must be reconciled.",
    batchId: batch.id,
    batchEmployeeCount: batch.employeeCount + 1,
    batchExpectedEmployeeShare: round2(Number(batch.expectedEmployeeShare) + target.employeeShare).toFixed(2),
    batchExpectedEmployerShare: round2(Number(batch.expectedEmployerShare) + target.employerShare).toFixed(2),
    batchExpectedTotal: round2(Number(batch.expectedTotal) + target.totalContribution).toFixed(2),
    batchSnapshotHash: statutoryRemittanceSnapshotHash({
      agency: issue.agency as StatutoryAgency,
      applicableMonth: issue.applicableMonth,
      members: membersAfter,
    }),
  };

  const originalSnapshot = {
    caseId: issue.id,
    employeeId: employee.id,
    memberFound: false,
    batchId: batch.id,
    batchEmployeeCount: batch.employeeCount,
    batchExpectedEmployeeShare: String(batch.expectedEmployeeShare),
    batchExpectedEmployerShare: String(batch.expectedEmployerShare),
    batchExpectedTotal: String(batch.expectedTotal),
    batchSnapshotHash: batch.snapshotHash,
  };

  return { issue, employee, batch, originalSnapshot, proposedSnapshot };
}

async function requireRequester(userId: number, organizationId: number) {
  const access = await getAccess(userId, organizationId);
  if (!access || !roleAllowed(access.role, PAYROLL_OPERATOR_ROLES)) {
    return {
      access,
      denied: Response.json({
        error: "Only authorized payroll operators can request remittance evidence corrections.",
      }, { status: 403 }),
    };
  }
  if (!access.companyWide) {
    return {
      access,
      denied: Response.json({
        error: "Remittance evidence corrections require company-wide payroll access.",
      }, { status: 403 }),
    };
  }
  return { access, denied: null };
}

async function requireApprover(userId: number, organizationId: number) {
  const access = await getAccess(userId, organizationId);
  if (!access || !roleAllowed(access.role, APPROVER_ROLES)) {
    return {
      access,
      denied: Response.json({
        error: "Only an Owner, Admin, or Checker can decide remittance evidence corrections.",
      }, { status: 403 }),
    };
  }
  if (!access.companyWide) {
    return {
      access,
      denied: Response.json({
        error: "Remittance evidence correction approval requires company-wide access.",
      }, { status: 403 }),
    };
  }
  return { access, denied: null };
}

export async function GET(request: Request) {
  await ensureStatutoryRemittanceCorrectionSchema();
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const requester = await requireRequester(user.id, organizationId);
  const approver = await requireApprover(user.id, organizationId);
  if (requester.denied && approver.denied) return requester.denied;

  const rows = await db.select().from(statutoryRemittanceCorrectionRequests)
    .where(eq(statutoryRemittanceCorrectionRequests.organizationId, organizationId))
    .orderBy(
      asc(statutoryRemittanceCorrectionRequests.status),
      asc(statutoryRemittanceCorrectionRequests.createdAt),
    );

  return Response.json({
    corrections: rows,
    canRequest: requester.denied == null,
    canApprove: approver.denied == null,
    currentUserId: user.id,
  });
}

export async function POST(request: Request) {
  await ensureStatutoryRemittanceCorrectionSchema();
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const organizationId = Number(body.organizationId);
  const action = String(body.action ?? "").trim();

  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: `statutory-remittance-correction-${action || "mutation"}`,
    resourceId: organizationId,
    limit: 30,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  if (action === "request_payment_correction") {
    const auth = await requireRequester(user.id, organizationId);
    if (auth.denied) return auth.denied;

    const batchId = Number(body.batchId);
    const reason = String(body.reason ?? "").trim().slice(0, 360);
    if (!Number.isInteger(batchId) || reason.length < 8) {
      return Response.json({
        error: "batchId and a correction reason of at least 8 characters are required.",
      }, { status: 400 });
    }

    const [batch] = await db.select().from(statutoryRemittanceBatches).where(and(
      eq(statutoryRemittanceBatches.id, batchId),
      eq(statutoryRemittanceBatches.organizationId, organizationId),
    )).limit(1);
    if (!batch) return Response.json({ error: "Remittance batch not found." }, { status: 404 });
    if (batch.status === "open" || batch.amountPaid == null || !batch.paidAt) {
      return Response.json({
        error: "There is no recorded payment evidence to correct.",
      }, { status: 409 });
    }

    const proposed = {
      amountPaid: Number(body.amountPaid),
      paymentReference: String(body.paymentReference ?? "").trim(),
      agencyReceiptReference: String(body.agencyReceiptReference ?? "").trim(),
      paymentChannel: String(body.paymentChannel ?? "").trim().slice(0, 80) || null,
      paymentVarianceNote: String(body.paymentVarianceNote ?? "").trim().slice(0, 240) || null,
      paidAt: String(body.paidAt ?? "").trim(),
    };
    const gate = validatePaymentCorrection({
      expectedTotal: Number(batch.expectedTotal),
      proposed,
    });
    if (!gate.ok) return Response.json({ error: gate.error }, { status: 409 });

    const [pending] = await db.select({ id: statutoryRemittanceCorrectionRequests.id })
      .from(statutoryRemittanceCorrectionRequests)
      .where(and(
        eq(statutoryRemittanceCorrectionRequests.organizationId, organizationId),
        eq(statutoryRemittanceCorrectionRequests.batchId, batchId),
        eq(statutoryRemittanceCorrectionRequests.targetType, "batch_payment"),
        eq(statutoryRemittanceCorrectionRequests.status, "pending"),
      )).limit(1);
    if (pending) {
      return Response.json({
        error: "A payment correction is already pending for this remittance batch.",
      }, { status: 409 });
    }

    const originalSnapshot = batchPaymentSnapshot(batch);
    const proposedSnapshot = {
      ...originalSnapshot,
      amountPaid: proposed.amountPaid.toFixed(2),
      paymentReference: proposed.paymentReference,
      agencyReceiptReference: proposed.agencyReceiptReference,
      paymentChannel: proposed.paymentChannel,
      paymentVarianceNote: proposed.paymentVarianceNote,
      paidAt: new Date(proposed.paidAt).toISOString(),
    };
    if (snapshotsMatch(originalSnapshot, proposedSnapshot)) {
      return Response.json({ error: "The proposed payment evidence is unchanged." }, { status: 409 });
    }

    const [created] = await db.insert(statutoryRemittanceCorrectionRequests).values({
      organizationId,
      targetType: "batch_payment",
      batchId,
      memberId: null,
      originalSnapshot,
      proposedSnapshot,
      reason,
      status: "pending",
      requestedByUserId: user.id,
      requestedByName: user.name,
    }).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Statutory remittance payment correction requested",
      resource: `${batch.agency} · ${batch.applicableMonth}`,
      metadata: {
        correctionId: created.id,
        batchId,
        reason,
        before: originalSnapshot,
        proposed: proposedSnapshot,
      },
    });
    return Response.json({ correction: created }, { status: 201 });
  }

  if (action === "request_missing_member_correction") {
    const auth = await requireRequester(user.id, organizationId);
    if (auth.denied) return auth.denied;

    const caseId = Number(body.caseId);
    if (!Number.isInteger(caseId)) {
      return Response.json({ error: "caseId is required." }, { status: 400 });
    }

    let derived: Awaited<ReturnType<typeof deriveMissingMemberAddition>>;
    try {
      derived = await deriveMissingMemberAddition(organizationId, caseId);
    } catch (error) {
      return Response.json({
        error: error instanceof Error ? error.message : "Could not derive the missing remittance member.",
      }, { status: 409 });
    }

    if (derived.issue.assignedToUserId != null && derived.issue.assignedToUserId !== user.id) {
      return Response.json({
        error: `This contribution case is assigned to ${derived.issue.assignedToName ?? "another payroll operator"}.`,
      }, { status: 409 });
    }

    const pendingAdditions = await db.select().from(statutoryRemittanceCorrectionRequests)
      .where(and(
        eq(statutoryRemittanceCorrectionRequests.organizationId, organizationId),
        eq(statutoryRemittanceCorrectionRequests.batchId, derived.batch.id),
        eq(statutoryRemittanceCorrectionRequests.targetType, "member_addition"),
        eq(statutoryRemittanceCorrectionRequests.status, "pending"),
      ));
    const duplicate = pendingAdditions.some((item) => {
      const proposed = item.proposedSnapshot as { employeeId?: unknown };
      return Number(proposed.employeeId) === derived.employee.id;
    });
    if (duplicate) {
      return Response.json({
        error: "A missing-member correction is already pending for this employee.",
      }, { status: 409 });
    }

    const reason = String(body.reason ?? "").trim().replace(/\s+/g, " ").slice(0, 360)
      || `Missing-posting case #${derived.issue.id}: ${derived.issue.description}`;

    const [created] = await db.insert(statutoryRemittanceCorrectionRequests).values({
      organizationId,
      targetType: "member_addition",
      batchId: derived.batch.id,
      memberId: null,
      originalSnapshot: derived.originalSnapshot,
      proposedSnapshot: derived.proposedSnapshot,
      reason,
      status: "pending",
      requestedByUserId: user.id,
      requestedByName: user.name,
    }).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Missing statutory remittance member correction requested",
      resource: `${derived.batch.agency} · ${derived.batch.applicableMonth} · ${derived.employee.employeeNo}`,
      metadata: {
        correctionId: created.id,
        caseId: derived.issue.id,
        batchId: derived.batch.id,
        employeeId: derived.employee.id,
        before: derived.originalSnapshot,
        proposed: derived.proposedSnapshot,
      },
    });

    return Response.json({ correction: created }, { status: 201 });
  }

  if (action === "request_posting_correction") {
    const auth = await requireRequester(user.id, organizationId);
    if (auth.denied) return auth.denied;

    const memberId = Number(body.memberId);
    const reason = String(body.reason ?? "").trim().slice(0, 360);
    if (!Number.isInteger(memberId) || reason.length < 8) {
      return Response.json({
        error: "memberId and a correction reason of at least 8 characters are required.",
      }, { status: 400 });
    }

    const [member] = await db.select().from(statutoryRemittanceMembers).where(and(
      eq(statutoryRemittanceMembers.id, memberId),
      eq(statutoryRemittanceMembers.organizationId, organizationId),
    )).limit(1);
    if (!member) return Response.json({ error: "Remittance member row not found." }, { status: 404 });
    if (member.postingStatus !== "confirmed" || member.postedAmount == null || !member.postedAt) {
      return Response.json({
        error: "Only confirmed employee posting evidence can use the correction workflow.",
      }, { status: 409 });
    }

    const [batch] = await db.select().from(statutoryRemittanceBatches).where(and(
      eq(statutoryRemittanceBatches.id, member.batchId),
      eq(statutoryRemittanceBatches.organizationId, organizationId),
    )).limit(1);
    if (!batch) return Response.json({ error: "Remittance batch not found." }, { status: 404 });

    const proposed = {
      postingReference: String(body.postingReference ?? "").trim(),
      postedAmount: Number(body.postedAmount),
      postedAt: String(body.postedAt ?? "").trim(),
    };
    const gate = validatePostingCorrection({
      expectedTotal: Number(member.totalContribution),
      proposed,
    });
    if (!gate.ok) return Response.json({ error: gate.error }, { status: 409 });

    const [pending] = await db.select({ id: statutoryRemittanceCorrectionRequests.id })
      .from(statutoryRemittanceCorrectionRequests)
      .where(and(
        eq(statutoryRemittanceCorrectionRequests.organizationId, organizationId),
        eq(statutoryRemittanceCorrectionRequests.memberId, memberId),
        eq(statutoryRemittanceCorrectionRequests.targetType, "member_posting"),
        eq(statutoryRemittanceCorrectionRequests.status, "pending"),
      )).limit(1);
    if (pending) {
      return Response.json({
        error: "A posting correction is already pending for this employee.",
      }, { status: 409 });
    }

    const originalSnapshot = memberPostingSnapshot(member);
    const proposedSnapshot = {
      ...originalSnapshot,
      postingReference: proposed.postingReference,
      postedAmount: proposed.postedAmount.toFixed(2),
      postedAt: new Date(proposed.postedAt).toISOString(),
    };
    if (snapshotsMatch(originalSnapshot, proposedSnapshot)) {
      return Response.json({ error: "The proposed employee posting evidence is unchanged." }, { status: 409 });
    }

    const [created] = await db.insert(statutoryRemittanceCorrectionRequests).values({
      organizationId,
      targetType: "member_posting",
      batchId: batch.id,
      memberId,
      originalSnapshot,
      proposedSnapshot,
      reason,
      status: "pending",
      requestedByUserId: user.id,
      requestedByName: user.name,
    }).returning();

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Employee statutory posting correction requested",
      resource: `${batch.agency} · ${batch.applicableMonth} · ${member.employeeNo}`,
      metadata: {
        correctionId: created.id,
        batchId: batch.id,
        memberId,
        employeeId: member.employeeId,
        reason,
        before: originalSnapshot,
        proposed: proposedSnapshot,
      },
    });
    return Response.json({ correction: created }, { status: 201 });
  }

  if (action === "approve" || action === "reject") {
    const auth = await requireApprover(user.id, organizationId);
    if (auth.denied) return auth.denied;

    const correctionId = Number(body.correctionId);
    const decisionNote = String(body.decisionNote ?? "").trim().slice(0, 360) || null;
    if (!Number.isInteger(correctionId)) {
      return Response.json({ error: "correctionId is required." }, { status: 400 });
    }

    const [correction] = await db.select().from(statutoryRemittanceCorrectionRequests)
      .where(and(
        eq(statutoryRemittanceCorrectionRequests.id, correctionId),
        eq(statutoryRemittanceCorrectionRequests.organizationId, organizationId),
      )).limit(1);
    if (!correction) return Response.json({ error: "Correction request not found." }, { status: 404 });
    if (correction.status !== "pending") {
      return Response.json({ error: "Only pending correction requests can be decided." }, { status: 409 });
    }
    if (correction.requestedByUserId === user.id) {
      return Response.json({
        error: "The requester cannot approve or reject their own remittance evidence correction.",
      }, { status: 409 });
    }

    if (action === "reject") {
      const now = new Date();
      const [updated] = await db.update(statutoryRemittanceCorrectionRequests).set({
        status: "rejected",
        decidedByUserId: user.id,
        decidedByName: user.name,
        decisionNote,
        decidedAt: now,
        updatedAt: now,
      }).where(and(
        eq(statutoryRemittanceCorrectionRequests.id, correction.id),
        eq(statutoryRemittanceCorrectionRequests.status, "pending"),
      )).returning();

      if (!updated) return Response.json({ error: "Correction request changed before rejection." }, { status: 409 });

      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Statutory remittance evidence correction rejected",
        resource: `Correction #${correction.id}`,
        metadata: { correctionId: correction.id, decisionNote },
      });
      return Response.json({ correction: updated });
    }

    const now = new Date();
    let resource = `Correction #${correction.id}`;
    let appliedMemberId: number | null = correction.memberId;
    let missingMemberAddition: Awaited<ReturnType<typeof deriveMissingMemberAddition>> | null = null;

    if (correction.targetType === "member_addition") {
      const proposed = correction.proposedSnapshot as { caseId?: unknown };
      const caseId = Number(proposed.caseId);
      if (!Number.isInteger(caseId)) {
        return Response.json({ error: "Missing-member correction has no valid contribution case." }, { status: 409 });
      }
      try {
        missingMemberAddition = await deriveMissingMemberAddition(organizationId, caseId);
      } catch (error) {
        return Response.json({
          error: error instanceof Error ? error.message : "Could not revalidate the missing-member correction.",
        }, { status: 409 });
      }
      if (
        !snapshotsMatch(missingMemberAddition.originalSnapshot, correction.originalSnapshot)
        || !snapshotsMatch(missingMemberAddition.proposedSnapshot, correction.proposedSnapshot)
      ) {
        return Response.json({
          error: "Payroll or remittance data changed after this missing-member correction was requested. Open a new correction request.",
        }, { status: 409 });
      }
    }

    const updatedCorrection = await db.transaction(async (tx) => {
      if (correction.targetType === "batch_payment") {
        const [batch] = await tx.select().from(statutoryRemittanceBatches).where(and(
          eq(statutoryRemittanceBatches.id, correction.batchId),
          eq(statutoryRemittanceBatches.organizationId, organizationId),
        )).limit(1);
        if (!batch) throw new Error("Remittance batch no longer exists.");

        const current = batchPaymentSnapshot(batch);
        if (!snapshotsMatch(current, correction.originalSnapshot)) {
          throw new Error("Payment evidence changed after this correction was requested. Open a new correction request.");
        }
        const proposed = correction.proposedSnapshot as unknown as BatchPaymentEvidence;
        const gate = validatePaymentCorrection({
          expectedTotal: Number(batch.expectedTotal),
          proposed: {
            amountPaid: Number(proposed.amountPaid),
            paymentReference: String(proposed.paymentReference ?? ""),
            agencyReceiptReference: String(proposed.agencyReceiptReference ?? ""),
            paymentChannel: proposed.paymentChannel,
            paymentVarianceNote: proposed.paymentVarianceNote,
            paidAt: String(proposed.paidAt ?? ""),
          },
        });
        if (!gate.ok) throw new Error(gate.error);

        await tx.update(statutoryRemittanceBatches).set({
          amountPaid: Number(proposed.amountPaid).toFixed(2),
          paymentReference: proposed.paymentReference,
          agencyReceiptReference: proposed.agencyReceiptReference,
          paymentChannel: proposed.paymentChannel,
          paymentVarianceNote: proposed.paymentVarianceNote,
          paidAt: new Date(String(proposed.paidAt)),
          updatedAt: now,
        }).where(and(
          eq(statutoryRemittanceBatches.id, batch.id),
          eq(statutoryRemittanceBatches.organizationId, organizationId),
        ));
        resource = `${batch.agency} · ${batch.applicableMonth}`;
      } else if (correction.targetType === "member_addition") {
        if (!missingMemberAddition) throw new Error("Missing-member correction was not revalidated.");
        const proposed = missingMemberAddition.proposedSnapshot;

        const [currentBatch] = await tx.select().from(statutoryRemittanceBatches).where(and(
          eq(statutoryRemittanceBatches.id, missingMemberAddition.batch.id),
          eq(statutoryRemittanceBatches.organizationId, organizationId),
        )).limit(1);
        if (!currentBatch) throw new Error("Remittance batch no longer exists.");
        if (
          currentBatch.employeeCount !== missingMemberAddition.batch.employeeCount
          || String(currentBatch.expectedTotal) !== String(missingMemberAddition.batch.expectedTotal)
          || currentBatch.snapshotHash !== missingMemberAddition.batch.snapshotHash
        ) {
          throw new Error("Remittance batch changed before the missing member could be added.");
        }

        const [alreadyExists] = await tx.select({ id: statutoryRemittanceMembers.id })
          .from(statutoryRemittanceMembers)
          .where(and(
            eq(statutoryRemittanceMembers.batchId, currentBatch.id),
            eq(statutoryRemittanceMembers.employeeId, missingMemberAddition.employee.id),
          ))
          .limit(1);
        if (alreadyExists) throw new Error("The employee was added to the remittance batch before approval.");

        const [newMember] = await tx.insert(statutoryRemittanceMembers).values({
          batchId: currentBatch.id,
          organizationId,
          employeeId: missingMemberAddition.employee.id,
          employeeNo: missingMemberAddition.employee.employeeNo,
          employeeShare: proposed.employeeShare,
          employerShare: proposed.employerShare,
          totalContribution: proposed.totalContribution,
          postingStatus: "exception",
          exceptionNote: proposed.exceptionNote,
        }).returning();

        await tx.update(statutoryRemittanceBatches).set({
          employeeCount: proposed.batchEmployeeCount,
          expectedEmployeeShare: proposed.batchExpectedEmployeeShare,
          expectedEmployerShare: proposed.batchExpectedEmployerShare,
          expectedTotal: proposed.batchExpectedTotal,
          snapshotHash: proposed.batchSnapshotHash,
          status: "exception",
          reconciledAt: null,
          reconciledBy: null,
          updatedAt: now,
        }).where(and(
          eq(statutoryRemittanceBatches.id, currentBatch.id),
          eq(statutoryRemittanceBatches.organizationId, organizationId),
        ));

        await tx.update(statutoryContributionIssueCases).set({
          batchId: currentBatch.id,
          remittanceMemberId: newMember.id,
          updatedAt: now,
        }).where(and(
          eq(statutoryContributionIssueCases.id, missingMemberAddition.issue.id),
          eq(statutoryContributionIssueCases.organizationId, organizationId),
        ));

        await tx.insert(statutoryContributionIssueEvents).values({
          organizationId,
          caseId: missingMemberAddition.issue.id,
          employeeId: missingMemberAddition.issue.employeeId,
          eventType: "missing_member_added",
          visibility: "employee",
          message: "Payroll added the omitted employee to the remittance liability. Employer payment and agency posting still require reconciliation.",
          actorUserId: user.id,
          actorName: user.name,
        });

        appliedMemberId = newMember.id;
        resource = `${currentBatch.agency} · ${currentBatch.applicableMonth} · ${newMember.employeeNo}`;
      } else if (correction.targetType === "member_posting") {
        if (correction.memberId == null) throw new Error("Posting correction has no member target.");
        const [member] = await tx.select().from(statutoryRemittanceMembers).where(and(
          eq(statutoryRemittanceMembers.id, correction.memberId),
          eq(statutoryRemittanceMembers.organizationId, organizationId),
        )).limit(1);
        if (!member) throw new Error("Remittance member row no longer exists.");

        const current = memberPostingSnapshot(member);
        if (!snapshotsMatch(current, correction.originalSnapshot)) {
          throw new Error("Employee posting evidence changed after this correction was requested. Open a new correction request.");
        }
        const proposed = correction.proposedSnapshot as unknown as MemberPostingEvidence;
        const gate = validatePostingCorrection({
          expectedTotal: Number(member.totalContribution),
          proposed: {
            postingReference: String(proposed.postingReference ?? ""),
            postedAmount: Number(proposed.postedAmount),
            postedAt: String(proposed.postedAt ?? ""),
          },
        });
        if (!gate.ok) throw new Error(gate.error);

        await tx.update(statutoryRemittanceMembers).set({
          postingReference: proposed.postingReference,
          postedAmount: Number(proposed.postedAmount).toFixed(2),
          postedAt: new Date(String(proposed.postedAt)),
          updatedAt: now,
        }).where(and(
          eq(statutoryRemittanceMembers.id, member.id),
          eq(statutoryRemittanceMembers.organizationId, organizationId),
        ));
        resource = `Employee ${member.employeeNo}`;
      } else {
        throw new Error("Unsupported correction target type.");
      }

      const [updated] = await tx.update(statutoryRemittanceCorrectionRequests).set({
        status: "approved",
        memberId: appliedMemberId,
        decidedByUserId: user.id,
        decidedByName: user.name,
        decisionNote,
        decidedAt: now,
        appliedAt: now,
        updatedAt: now,
      }).where(and(
        eq(statutoryRemittanceCorrectionRequests.id, correction.id),
        eq(statutoryRemittanceCorrectionRequests.status, "pending"),
      )).returning();

      if (!updated) throw new Error("Correction request changed before approval.");
      return updated;
    }).catch((error) => ({ error: error instanceof Error ? error.message : "Correction approval failed." }));

    if ("error" in updatedCorrection) {
      return Response.json({ error: updatedCorrection.error }, { status: 409 });
    }

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Statutory remittance evidence correction approved",
      resource,
      metadata: {
        correctionId: correction.id,
        targetType: correction.targetType,
        batchId: correction.batchId,
        memberId: updatedCorrection.memberId,
        requestedByUserId: correction.requestedByUserId,
        requestedByName: correction.requestedByName,
        before: correction.originalSnapshot,
        after: correction.proposedSnapshot,
        decisionNote,
      },
    });

    const [correctedBatch] = await db.select({
      applicableMonth: statutoryRemittanceBatches.applicableMonth,
    }).from(statutoryRemittanceBatches).where(and(
      eq(statutoryRemittanceBatches.id, correction.batchId),
      eq(statutoryRemittanceBatches.organizationId, organizationId),
    )).limit(1);
    if (correctedBatch) {
      const invalidatedClosures = await invalidateStatutoryRemittanceMonthCertification({
        organizationId,
        applicableMonth: correctedBatch.applicableMonth,
        reason: `Approved remittance correction #${correction.id} changed certified month evidence.`,
      });
      if (invalidatedClosures.length > 0) {
        await recordAuditEvent({
          organizationId,
          actor: user.name,
          action: "Statutory remittance month certification invalidated",
          resource: correctedBatch.applicableMonth,
          metadata: {
            reason: "approved_remittance_evidence_correction",
            correctionId: correction.id,
            invalidatedClosureIds: invalidatedClosures.map((row) => row.id),
          },
        });
      }
    }

    await syncStatutoryRemittanceActions(organizationId, user.name);

    return Response.json({ correction: updatedCorrection });
  }

  return Response.json({
    error: "Unsupported action. Use request_payment_correction, request_posting_correction, request_missing_member_correction, approve, or reject.",
  }, { status: 400 });
}
