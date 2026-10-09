import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, employees, hcmEmploymentDecisionEvents, hcmEmploymentTermDecisions, hcmEmploymentTerms } from "@/db/schema";
import { assertOrganizationRole, getAccess, PEOPLE_ADMIN_ROLES } from "@/lib/access";
import { getSessionUser } from "@/lib/auth";
import {
  applyEmploymentTermDecision,
  EMPLOYMENT_TERM_DECISION_KINDS,
} from "@/lib/hcm-employment-term-decisions";
import {
  approveEmploymentDecisionWithEvidence,
  DecisionEvidenceApprovalError,
} from "@/lib/hcm-employment-decision-evidence";
import { EMPLOYMENT_TERM_KINDS, philippineBusinessDate } from "@/lib/hcm-employment-terms";
import {
  cancellationBlocker, retryBlocker, validHcmCalendarDate,
  HCM_TERM_DECISION_CANCELLABLE_STATES,
} from "@/lib/hcm-employment-decision-integrity";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";


async function assertDecisionAdmin(userId: number, organizationId: number) {
  const denied = await assertOrganizationRole(
    userId,
    organizationId,
    PEOPLE_ADMIN_ROLES,
    "Only People administrators can manage employment-term decisions.",
  );
  if (denied) return { error: denied };
  const access = await getAccess(userId, organizationId);
  if (!access?.companyWide) {
    return { error: Response.json({
      error: "Employment-term decisions require company-wide People access.",
    }, { status: 403 }) };
  }
  return { access };
}

function optionalDate(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return validHcmCalendarDate(text) ? text : undefined;
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  const employeeId = url.searchParams.get("employeeId") ? Number(url.searchParams.get("employeeId")) : null;
  if (!Number.isInteger(organizationId) || (employeeId !== null && !Number.isInteger(employeeId))) {
    return Response.json({ error: "A valid organizationId and optional employeeId are required." }, { status: 400 });
  }

  const gate = await assertDecisionAdmin(user.id, organizationId);
  if ("error" in gate) return gate.error;

  const rows = await db.select().from(hcmEmploymentTermDecisions).where(
    employeeId === null
      ? eq(hcmEmploymentTermDecisions.organizationId, organizationId)
      : and(
          eq(hcmEmploymentTermDecisions.organizationId, organizationId),
          eq(hcmEmploymentTermDecisions.employeeId, employeeId),
        ),
  ).orderBy(desc(hcmEmploymentTermDecisions.createdAt), desc(hcmEmploymentTermDecisions.id));

  return Response.json({ decisions: rows, today: philippineBusinessDate() });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const organizationId = Number(body.organizationId);
  const employeeId = Number(body.employeeId);
  const employmentTermId = Number(body.employmentTermId);
  if (!Number.isInteger(organizationId) || !Number.isInteger(employeeId) || !Number.isInteger(employmentTermId)) {
    return Response.json({ error: "Valid organizationId, employeeId and employmentTermId are required." }, { status: 400 });
  }

  const gate = await assertDecisionAdmin(user.id, organizationId);
  if ("error" in gate) return gate.error;
  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: "hcm-employment-term-decision-create",
    resourceId: employmentTermId,
    limit: 20,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  const decisionKind = String(body.decisionKind ?? "").trim().toLowerCase();
  const effectiveDate = String(body.effectiveDate ?? "").trim();
  const reason = String(body.reason ?? "").trim().slice(0, 240);
  const nextEmploymentType = String(body.nextEmploymentType ?? "").trim().slice(0, 32) || null;
  const nextTermKind = String(body.nextTermKind ?? "").trim().toLowerCase() || null;
  const nextEffectiveUntil = optionalDate(body.nextEffectiveUntil);
  const nextProbationReviewDate = optionalDate(body.nextProbationReviewDate);
  const nextContractEndDate = optionalDate(body.nextContractEndDate);
  const nextProjectName = String(body.nextProjectName ?? "").trim().slice(0, 160) || null;
  const proposedSeparationLastDay = optionalDate(body.proposedSeparationLastDay);
  const separationReason = String(body.separationReason ?? "").trim().slice(0, 160) || null;

  if (!EMPLOYMENT_TERM_DECISION_KINDS.includes(decisionKind as (typeof EMPLOYMENT_TERM_DECISION_KINDS)[number])
      || !validHcmCalendarDate(effectiveDate) || reason.length < 3
      || nextEffectiveUntil === undefined || nextProbationReviewDate === undefined
      || nextContractEndDate === undefined || proposedSeparationLastDay === undefined) {
    return Response.json({ error: "A supported decision, effective date, and reason are required." }, { status: 400 });
  }
  if (nextTermKind && !EMPLOYMENT_TERM_KINDS.includes(nextTermKind as (typeof EMPLOYMENT_TERM_KINDS)[number])) {
    return Response.json({ error: "Unsupported successor employment-term kind." }, { status: 400 });
  }
  if (nextEffectiveUntil && nextEffectiveUntil < effectiveDate) {
    return Response.json({ error: "Successor effective-until cannot be before the decision effective date." }, { status: 400 });
  }
  if (nextProbationReviewDate && nextProbationReviewDate < effectiveDate) {
    return Response.json({ error: "Successor probation review date cannot be before its effective date." }, { status: 400 });
  }
  if (nextContractEndDate && nextContractEndDate < effectiveDate) {
    return Response.json({ error: "Successor contract end cannot be before its effective date." }, { status: 400 });
  }

  const [employee, term] = await Promise.all([
    db.select().from(employees).where(and(
      eq(employees.id, employeeId),
      eq(employees.organizationId, organizationId),
    )).limit(1).then((rows) => rows[0] ?? null),
    db.select().from(hcmEmploymentTerms).where(and(
      eq(hcmEmploymentTerms.id, employmentTermId),
      eq(hcmEmploymentTerms.organizationId, organizationId),
      eq(hcmEmploymentTerms.employeeId, employeeId),
    )).limit(1).then((rows) => rows[0] ?? null),
  ]);
  if (!employee) return Response.json({ error: "Employee not found in this workspace." }, { status: 404 });
  if (!term) return Response.json({ error: "Employment terms record not found for this worker." }, { status: 404 });
  if (term.status !== "active") {
    return Response.json({ error: "Decisions must be recorded against the worker's active employment terms." }, { status: 409 });
  }
  if (["Separating", "Separated"].includes(employee.status)) {
    return Response.json({ error: "Use the existing Separation workflow for a worker already in offboarding." }, { status: 409 });
  }
  if (effectiveDate < String(term.effectiveFrom)) {
    return Response.json({ error: "Decision effective date cannot be before the active employment terms." }, { status: 409 });
  }

  if (decisionKind === "confirm_regular" && term.termKind !== "probationary") {
    return Response.json({ error: "Confirm regular is available only for active probationary terms." }, { status: 409 });
  }
  if (decisionKind === "confirm_regular" && nextTermKind && nextTermKind !== "regular") {
    return Response.json({ error: "Confirm regular must create regular successor terms." }, { status: 400 });
  }
  if (decisionKind === "non_renew" && !proposedSeparationLastDay) {
    return Response.json({ error: "Non-renewal requires an explicit proposed last day for separation handoff." }, { status: 400 });
  }
  if (decisionKind === "non_renew" && proposedSeparationLastDay && proposedSeparationLastDay < effectiveDate) {
    return Response.json({
      error: "The proposed non-renewal last day cannot precede the effective decision date.",
    }, { status: 400 });
  }
  if (decisionKind === "convert_terms" && (!nextTermKind || !nextEmploymentType)) {
    return Response.json({ error: "Converting terms requires an explicit successor term kind and employment type." }, { status: 400 });
  }

  const resolvedNextTermKind = decisionKind === "confirm_regular" ? "regular" : nextTermKind;
  const resolvedNextEmploymentType = decisionKind === "confirm_regular"
    ? (nextEmploymentType || "Regular")
    : nextEmploymentType;
  if (resolvedNextTermKind === "probationary" && !nextProbationReviewDate) {
    return Response.json({
      error: "A successor probationary term requires an explicit review date. PayrollPH will not infer or extend probation automatically.",
    }, { status: 400 });
  }
  if (resolvedNextTermKind === "fixed_term" && !nextContractEndDate) {
    return Response.json({ error: "A successor fixed-term record requires an explicit contract end date." }, { status: 400 });
  }
  if (resolvedNextTermKind === "fixed_term" && nextEffectiveUntil && nextEffectiveUntil !== nextContractEndDate) {
    return Response.json({ error: "For fixed-term successor terms, effective-until must match the contract end date." }, { status: 400 });
  }

  try {
    const created = await db.transaction(async (tx) => {
      // Serialize decision creation with employment lifecycle changes using
      // the same employee -> employment terms row locking order as activation.
      await tx.execute(sql`select id from employees
        where id = ${employeeId} and organization_id = ${organizationId} for update`);
      await tx.execute(sql`select id from hcm_employment_terms
        where id = ${employmentTermId} and organization_id = ${organizationId}
          and employee_id = ${employeeId} for update`);
      const [freshEmployee] = await tx.select({
        id: employees.id, status: employees.status,
      }).from(employees).where(and(
        eq(employees.id, employeeId), eq(employees.organizationId, organizationId),
      )).limit(1);
      const [freshTerm] = await tx.select({
        id: hcmEmploymentTerms.id, status: hcmEmploymentTerms.status,
        termKind: hcmEmploymentTerms.termKind, effectiveFrom: hcmEmploymentTerms.effectiveFrom,
      }).from(hcmEmploymentTerms).where(and(
        eq(hcmEmploymentTerms.id, employmentTermId),
        eq(hcmEmploymentTerms.organizationId, organizationId),
        eq(hcmEmploymentTerms.employeeId, employeeId),
      )).limit(1);
      if (!freshEmployee || !["Active", "On leave"].includes(freshEmployee.status)
        || !freshTerm || freshTerm.status !== "active"
        || effectiveDate < String(freshTerm.effectiveFrom)
        || (decisionKind === "confirm_regular" && freshTerm.termKind !== "probationary")) {
        throw new Error("TERM_DECISION_SOURCE_STALE");
      }

      const [record] = await tx.insert(hcmEmploymentTermDecisions).values({
        organizationId, employeeId, employmentTermId, decisionKind, effectiveDate,
        nextEmploymentType: resolvedNextEmploymentType,
        nextTermKind: resolvedNextTermKind,
        nextEffectiveUntil, nextProbationReviewDate, nextContractEndDate,
        nextProjectName, proposedSeparationLastDay, separationReason,
        status: "pending_approval", separationHandoffStatus: "none",
        reason, requestedByUserId: user.id, requestedBy: user.name,
      }).returning();
      if (!record) throw new Error("Employment-term decision insert did not return a record.");
      await tx.insert(hcmEmploymentDecisionEvents).values({
        organizationId, decisionId: record.id, employeeId, eventType: "requested",
        actorName: user.name.slice(0, 120), actorUserId: user.id,
        metadata: { employmentTermId, decisionKind, effectiveDate, proposedSeparationLastDay },
        createdAt: record.createdAt,
      });
      await tx.insert(auditEvents).values({
        organizationId, actor: user.name,
        action: "HCM employment-term decision requested",
        resource: `Employee #${employeeId}`,
        metadata: {
          employmentTermDecisionId: record.id, employmentTermId,
          decisionKind, effectiveDate, proposedSeparationLastDay,
          actorUserId: user.id,
        },
      });
      return record;
    });
    return Response.json({ decision: created }, { status: 201 });
  } catch (error) {
    const driver = error as { code?: string; cause?: { code?: string } };
    if (driver.code === "23505" || driver.cause?.code === "23505") {
      return Response.json({
        code: "TERM_DECISION_ALREADY_OPEN",
        error: "This employment-term record already has a decision awaiting approval or application.",
      }, { status: 409 });
    }
    if (error instanceof Error && error.message === "TERM_DECISION_SOURCE_STALE") {
      return Response.json({
        code: "TERM_DECISION_SOURCE_STALE",
        error: "Employee or active employment terms changed while this decision was being recorded. Refresh before retrying.",
      }, { status: 409 });
    }
    throw error;
  }
}

export async function PATCH(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const id = Number(body.id);
  const organizationId = Number(body.organizationId);
  const action = String(body.action ?? "").trim().toLowerCase();
  if (!Number.isInteger(id) || !Number.isInteger(organizationId)
      || !["approve", "cancel", "retry"].includes(action)) {
    return Response.json({ error: "Valid id, organizationId, and supported action are required." }, { status: 400 });
  }

  const gate = await assertDecisionAdmin(user.id, organizationId);
  if ("error" in gate) return gate.error;
  const mfaDenied = requireSensitiveActionMfa(user);
  if (mfaDenied) return mfaDenied;
  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: `hcm-employment-term-decision-${action}`,
    resourceId: id,
    limit: 30,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  const [decision] = await db.select().from(hcmEmploymentTermDecisions).where(and(
    eq(hcmEmploymentTermDecisions.id, id),
    eq(hcmEmploymentTermDecisions.organizationId, organizationId),
  )).limit(1);
  if (!decision) return Response.json({ error: "Employment-term decision not found." }, { status: 404 });

  // Core 3.2: handoff state is authoritative evidence from the Separation workflow.
  // It can no longer be advanced manually from the term-decision endpoint.
  if (action === "cancel") {
    if (!["pending_approval", "scheduled", "failed"].includes(decision.status)) {
      return Response.json({ error: "Only pending, scheduled, or failed decisions can be cancelled." }, { status: 409 });
    }
    const [cancelled] = await db.update(hcmEmploymentTermDecisions).set({
      status: "cancelled",
      cancelledByUserId: user.id,
      cancelledBy: user.name,
      cancelledAt: new Date(),
      updatedAt: new Date(),
    }).where(and(
      eq(hcmEmploymentTermDecisions.id, id),
      eq(hcmEmploymentTermDecisions.organizationId, organizationId),
    )).returning();
    await recordEmploymentDecisionEvidenceEvent({
      organizationId,
      decisionId: cancelled.id,
      employeeId: cancelled.employeeId,
      eventType: "cancelled",
      actor: user.name,
      actorUserId: user.id,
      metadata: { previousStatus: decision.status },
      createdAt: cancelled.cancelledAt ?? new Date(),
    });
    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "HCM employment-term decision cancelled",
      resource: `Employee #${decision.employeeId}`,
      metadata: { employmentTermDecisionId: id, previousStatus: decision.status },
    });
    return Response.json({ decision: cancelled });
  }

  if (action === "retry") {
    if (decision.status !== "failed" || !decision.approvedByUserId) {
      return Response.json({ error: "Only previously approved failed decisions can be retried." }, { status: 409 });
    }
    const [scheduled] = await db.update(hcmEmploymentTermDecisions).set({
      status: "scheduled",
      failure: null,
      updatedAt: new Date(),
    }).where(and(
      eq(hcmEmploymentTermDecisions.id, id),
      eq(hcmEmploymentTermDecisions.status, "failed"),
    )).returning();
    if (!scheduled) return Response.json({ error: "Decision changed before retry." }, { status: 409 });
    await recordEmploymentDecisionEvidenceEvent({
      organizationId,
      decisionId: scheduled.id,
      employeeId: scheduled.employeeId,
      eventType: "retried",
      actor: user.name,
      actorUserId: user.id,
      metadata: { previousStatus: "failed", effectiveDate: String(scheduled.effectiveDate) },
    });
    if (String(scheduled.effectiveDate) <= philippineBusinessDate()) {
      try {
        const applied = await applyEmploymentTermDecision({ decisionId: id, actor: user.name, actorUserId: user.id });
        return Response.json({ decision: applied.decision, applied: true });
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "Decision application failed." }, { status: 409 });
      }
    }
    return Response.json({ decision: scheduled, applied: false });
  }

  const now = new Date();
  let sealed;
  try {
    sealed = await approveEmploymentDecisionWithEvidence({
      organizationId,
      decisionId: id,
      approverUserId: user.id,
      approverName: user.name,
      now,
    });
  } catch (error) {
    if (error instanceof DecisionEvidenceApprovalError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json({ error: "Employment-term decision approval failed." }, { status: 409 });
  }
  const scheduled = sealed.decision;

  await recordAuditEvent({
    organizationId,
    actor: user.name,
    action: "HCM employment-term decision approved",
    resource: `Employee #${scheduled.employeeId}`,
    metadata: {
      employmentTermDecisionId: id,
      effectiveDate: scheduled.effectiveDate,
      decisionKind: scheduled.decisionKind,
      evidenceSnapshotSha256: sealed.evidenceSnapshotSha256,
      evidenceNoteCount: sealed.noteCount,
      evidenceAttachmentCount: sealed.attachmentCount,
    },
  });

  if (String(scheduled.effectiveDate) <= philippineBusinessDate(now)) {
    try {
      const applied = await applyEmploymentTermDecision({ decisionId: id, actor: user.name, actorUserId: user.id, now });
      return Response.json({ decision: applied.decision, applied: true });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Decision application failed." }, { status: 409 });
    }
  }

  return Response.json({ decision: scheduled, applied: false });
}
