import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
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
  snapshotsMatch,
  validatePaymentCorrection,
  validatePostingCorrection,
} from "@/lib/statutory-remittance-correction";
import { syncStatutoryRemittanceActions } from "@/lib/statutory-remittance-actions";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";

const APPROVER_ROLES = ["owner", "admin", "checker"] as const;

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
        memberId: correction.memberId,
        requestedByUserId: correction.requestedByUserId,
        requestedByName: correction.requestedByName,
        before: correction.originalSnapshot,
        after: correction.proposedSnapshot,
        decisionNote,
      },
    });
    await syncStatutoryRemittanceActions(organizationId, user.name);

    return Response.json({ correction: updatedCorrection });
  }

  return Response.json({
    error: "Unsupported action. Use request_payment_correction, request_posting_correction, approve, or reject.",
  }, { status: 400 });
}
