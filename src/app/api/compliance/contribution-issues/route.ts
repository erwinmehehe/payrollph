import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  complianceActionTasks,
  employees,
  statutoryContributionIssueCases,
  statutoryContributionIssueEvents,
  statutoryRemittanceCorrectionRequests,
  statutoryRemittanceMembers,
} from "@/db/schema";
import { getAccess, PAYROLL_OPERATOR_ROLES, roleAllowed } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { notifyEmployeeOfContributionCase, notifyEmployeeOfContributionCaseUpdate } from "@/lib/statutory-contribution-case-notifications";
import { contributionCaseServiceStatus, contributionCaseServiceTargets } from "@/lib/statutory-contribution-case-aging";
import {
  contributionCaseOutcomeAllowed,
  contributionCaseResolutionPolicyMessage,
} from "@/lib/statutory-contribution-case-resolution";
import { invalidateStatutoryRemittanceMonthCertification } from "@/lib/statutory-remittance-certification";
import { getSessionUser } from "@/lib/auth";
import { resolveComplianceLegalEntity } from "@/lib/legal-entity";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
  requireSensitiveActionMfa,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";

const RESOLUTION_OUTCOMES = new Set([
  "posting_confirmed",
  "correction_completed",
  "no_issue_found",
  "employee_advised",
  "referred_to_agency",
]);

async function requirePayrollOperator(userId: number, organizationId: number) {
  const access = await getAccess(userId, organizationId);
  if (!access) {
    return Response.json({ error: "You do not have access to this workspace." }, { status: 403 });
  }
  if (!access.companyWide) {
    return Response.json({
      error: "Employee contribution cases are company-wide payroll compliance records.",
    }, { status: 403 });
  }
  if (!roleAllowed(access.role, PAYROLL_OPERATOR_ROLES)) {
    return Response.json({
      error: "Only authorized payroll operators can review employee contribution cases.",
      role: access.role,
    }, { status: 403 });
  }
  return null;
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const organizationId = Number(url.searchParams.get("organizationId"));
  const requestedLegalEntityId = Number(url.searchParams.get("legalEntityId") ?? 0);
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const denied = await requirePayrollOperator(user.id, organizationId);
  if (denied) return denied;

  let legalEntity;
  try {
    legalEntity = await resolveComplianceLegalEntity({
      organizationId,
      legalEntityId: requestedLegalEntityId || null,
    });
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "Legal employer could not be resolved.",
    }, { status: 409 });
  }

  const rows = await db.select({
    issue: statutoryContributionIssueCases,
    employeeNo: employees.employeeNo,
    firstName: employees.firstName,
    lastName: employees.lastName,
  })
    .from(statutoryContributionIssueCases)
    .innerJoin(employees, eq(statutoryContributionIssueCases.employeeId, employees.id))
    .where(and(
      eq(statutoryContributionIssueCases.organizationId, organizationId),
      eq(statutoryContributionIssueCases.legalEntityId, legalEntity.id),
    ))
    .orderBy(
      asc(statutoryContributionIssueCases.status),
      desc(statutoryContributionIssueCases.createdAt),
      desc(statutoryContributionIssueCases.id),
    )
    .limit(100);

  const caseIds = rows.map((row) => row.issue.id);
  const events = caseIds.length
    ? await db.select().from(statutoryContributionIssueEvents)
        .where(and(
          eq(statutoryContributionIssueEvents.organizationId, organizationId),
          inArray(statutoryContributionIssueEvents.caseId, caseIds),
        ))
        .orderBy(desc(statutoryContributionIssueEvents.createdAt), desc(statutoryContributionIssueEvents.id))
        .limit(500)
    : [];
  const eventsByCase = new Map<number, typeof events>();
  for (const event of events) {
    eventsByCase.set(event.caseId, [...(eventsByCase.get(event.caseId) ?? []), event]);
  }

  return Response.json({
    legalEntity: { id: legalEntity.id, code: legalEntity.code, displayName: legalEntity.displayName },
    cases: rows.map((row) => ({
      ...row.issue,
      employeeNo: row.employeeNo,
      employeeName: `${row.firstName} ${row.lastName}`,
      service: contributionCaseServiceStatus(row.issue),
      events: eventsByCase.get(row.issue.id) ?? [],
    })),
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
  const caseId = Number(body.caseId);

  if (!Number.isInteger(organizationId) || !Number.isInteger(caseId)) {
    return Response.json({ error: "organizationId and caseId are required." }, { status: 400 });
  }

  const denied = await requirePayrollOperator(user.id, organizationId);
  if (denied) return denied;

  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: `employee-contribution-case-${action || "mutation"}`,
    resourceId: organizationId,
    limit: 30,
    windowMs: 5 * 60_000,
  });
  if (rateDenied) return rateDenied;

  const [issue] = await db.select().from(statutoryContributionIssueCases)
    .where(and(
      eq(statutoryContributionIssueCases.id, caseId),
      eq(statutoryContributionIssueCases.organizationId, organizationId),
    ))
    .limit(1);

  if (!issue) return Response.json({ error: "Contribution issue case not found." }, { status: 404 });
  if (issue.status === "resolved") {
    return Response.json({ error: "Resolved contribution issue cases are immutable." }, { status: 409 });
  }

  const sourceKey = `employee-contribution-issue:${issue.id}`;

  if (issue.assignedToUserId != null && issue.assignedToUserId !== user.id) {
    return Response.json({
      error: `This contribution case is assigned to ${issue.assignedToName ?? "another payroll operator"}.`,
    }, { status: 409 });
  }

  if (action === "start_review" && issue.status !== "open") {
    return Response.json({ error: "This case review has already started." }, { status: 409 });
  }

  if (action === "start_review") {
    const now = new Date();
    const updated = await db.transaction(async (tx) => {
      const [next] = await tx.update(statutoryContributionIssueCases).set({
        status: "in_review",
        assignedToUserId: user.id,
        assignedToName: user.name,
        reviewStartedAt: issue.reviewStartedAt ?? now,
        updatedAt: now,
      }).where(and(
        eq(statutoryContributionIssueCases.id, caseId),
        eq(statutoryContributionIssueCases.organizationId, organizationId),
      )).returning();

      const serviceTargets = contributionCaseServiceTargets(next);
      await tx.update(complianceActionTasks).set({
        status: "in_progress",
        assignedToUserId: user.id,
        assignedToName: user.name,
        acknowledgedAt: now,
        acknowledgedByUserId: user.id,
        acknowledgedByName: user.name,
        dueDate: serviceTargets.resolutionDue.toISOString().slice(0, 10),
        updatedAt: now,
      }).where(and(
        eq(complianceActionTasks.organizationId, organizationId),
        eq(complianceActionTasks.sourceType, "employee_contribution_issue"),
        eq(complianceActionTasks.sourceKey, sourceKey),
      ));

      await tx.insert(statutoryContributionIssueEvents).values({
        organizationId,
        caseId,
        employeeId: issue.employeeId,
        eventType: "review_started",
        visibility: "employee",
        message: `Payroll review started by ${user.name}.`,
        actorUserId: user.id,
        actorName: user.name,
      });

      return next;
    });

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Employee contribution issue review started",
      resource: `${issue.agency} · ${issue.applicableMonth} · case #${issue.id}`,
      metadata: {
        caseId: issue.id,
        employeeId: issue.employeeId,
        assignedToUserId: user.id,
      },
    });

    try {
      await notifyEmployeeOfContributionCase({
        issue: updated,
        event: "review_started",
        actor: user.name,
      });
    } catch {
      // Case ownership is authoritative even when notification delivery is unavailable.
    }

    return Response.json({ case: updated });
  }

  if (action === "add_update") {
    if (issue.status !== "in_review") {
      return Response.json({ error: "Start review before posting an employee-visible case update." }, { status: 409 });
    }

    const message = String(body.message ?? "").trim().replace(/\s+/g, " ").slice(0, 1000);
    if (message.length < 20) {
      return Response.json({ error: "A case update of at least 20 characters is required." }, { status: 400 });
    }

    const now = new Date();
    const result = await db.transaction(async (tx) => {
      const [updated] = await tx.update(statutoryContributionIssueCases).set({
        updatedAt: now,
      }).where(and(
        eq(statutoryContributionIssueCases.id, caseId),
        eq(statutoryContributionIssueCases.organizationId, organizationId),
      )).returning();

      const [event] = await tx.insert(statutoryContributionIssueEvents).values({
        organizationId,
        caseId,
        employeeId: issue.employeeId,
        eventType: "payroll_update",
        visibility: "employee",
        message,
        actorUserId: user.id,
        actorName: user.name,
      }).returning();

      return { updated, event };
    });

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Employee contribution issue update posted",
      resource: `${issue.agency} · ${issue.applicableMonth} · case #${issue.id}`,
      metadata: {
        caseId: issue.id,
        employeeId: issue.employeeId,
        caseEventId: result.event.id,
        message,
      },
    });

    try {
      await notifyEmployeeOfContributionCaseUpdate({
        issue: result.updated,
        eventId: result.event.id,
        message,
        actor: user.name,
      });
    } catch {
      // The append-only case event remains authoritative if notification delivery is unavailable.
    }

    return Response.json({ case: result.updated, event: result.event });
  }

  if (action === "resolve") {
    const mfaDenied = requireSensitiveActionMfa(user);
    if (mfaDenied) return mfaDenied;

    const resolutionOutcome = String(body.resolutionOutcome ?? "").trim();
    const resolutionNote = String(body.resolutionNote ?? "").trim().replace(/\s+/g, " ").slice(0, 600);
    if (!RESOLUTION_OUTCOMES.has(resolutionOutcome) || resolutionNote.length < 20) {
      return Response.json({
        error: "A supported resolution outcome and a resolution note of at least 20 characters are required.",
      }, { status: 400 });
    }

    if (!contributionCaseOutcomeAllowed(
      issue.issueType,
      resolutionOutcome,
      { hasLinkedPosting: issue.remittanceMemberId != null },
    )) {
      return Response.json({
        error: contributionCaseResolutionPolicyMessage(issue.issueType),
        issueType: issue.issueType,
        resolutionOutcome,
      }, { status: 409 });
    }

    if (resolutionOutcome === "posting_confirmed") {
      if (!issue.remittanceMemberId) {
        return Response.json({
          error: "This case has no linked agency posting record to confirm.",
        }, { status: 409 });
      }
      const [member] = await db.select({
        postingStatus: statutoryRemittanceMembers.postingStatus,
      }).from(statutoryRemittanceMembers).where(and(
        eq(statutoryRemittanceMembers.id, issue.remittanceMemberId),
        eq(statutoryRemittanceMembers.organizationId, organizationId),
        eq(statutoryRemittanceMembers.legalEntityId, issue.legalEntityId),
        eq(statutoryRemittanceMembers.employeeId, issue.employeeId),
      )).limit(1);
      if (!member || member.postingStatus !== "confirmed") {
        return Response.json({
          error: "The linked agency posting is not confirmed yet. Reconcile the posting evidence before resolving the case as confirmed.",
        }, { status: 409 });
      }
    }

    if (resolutionOutcome === "correction_completed") {
      if (!issue.batchId) {
        return Response.json({
          error: "This case has no linked remittance batch to prove a completed correction.",
        }, { status: 409 });
      }
      const corrections = await db.select().from(statutoryRemittanceCorrectionRequests)
        .where(and(
          eq(statutoryRemittanceCorrectionRequests.organizationId, organizationId),
          eq(statutoryRemittanceCorrectionRequests.batchId, issue.batchId),
          eq(statutoryRemittanceCorrectionRequests.status, "approved"),
        ));
      const applied = corrections.some((correction) =>
        correction.appliedAt != null
        && (
          issue.remittanceMemberId != null
            ? correction.targetType === "member_posting"
              && correction.memberId === issue.remittanceMemberId
            : correction.targetType === "batch_payment"
        ),
      );
      if (!applied) {
        return Response.json({
          error: "No approved and applied remittance correction is linked to this case. Complete the audited correction workflow first.",
        }, { status: 409 });
      }
    }

    const now = new Date();

    if (resolutionOutcome === "referred_to_agency") {
      const result = await db.transaction(async (tx) => {
        const [updated] = await tx.update(statutoryContributionIssueCases).set({
          status: "in_review",
          assignedToUserId: issue.assignedToUserId ?? user.id,
          assignedToName: issue.assignedToName ?? user.name,
          reviewStartedAt: issue.reviewStartedAt ?? now,
          resolutionOutcome,
          resolutionNote,
          resolvedByUserId: null,
          resolvedByName: null,
          resolvedAt: null,
          updatedAt: now,
        }).where(and(
          eq(statutoryContributionIssueCases.id, caseId),
          eq(statutoryContributionIssueCases.organizationId, organizationId),
        )).returning();

        await tx.update(complianceActionTasks).set({
          status: "in_progress",
          assignedToUserId: updated.assignedToUserId,
          assignedToName: updated.assignedToName,
          acknowledgedAt: now,
          acknowledgedByUserId: user.id,
          acknowledgedByName: user.name,
          resolvedAt: null,
          updatedAt: now,
        }).where(and(
          eq(complianceActionTasks.organizationId, organizationId),
          eq(complianceActionTasks.sourceType, "employee_contribution_issue"),
          eq(complianceActionTasks.sourceKey, sourceKey),
        ));

        await tx.insert(statutoryContributionIssueEvents).values({
          organizationId,
          caseId,
          employeeId: issue.employeeId,
          eventType: "referred_to_agency",
          visibility: "employee",
          message: `Referred to the agency for verification. ${resolutionNote}`,
          actorUserId: user.id,
          actorName: user.name,
        });

        return updated;
      });

      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Employee contribution issue referred to agency",
        resource: `${issue.agency} · ${issue.applicableMonth} · case #${issue.id}`,
        metadata: {
          caseId: issue.id,
          employeeId: issue.employeeId,
          resolutionNote,
          linkedMemberId: issue.remittanceMemberId,
        },
      });

      try {
        await notifyEmployeeOfContributionCase({
          issue: result,
          event: "referred",
          actor: user.name,
        });
      } catch {
        // Referral state remains authoritative even when notification delivery is unavailable.
      }

      return Response.json({ case: result, resolved: false });
    }
    const result = await db.transaction(async (tx) => {
      const [updated] = await tx.update(statutoryContributionIssueCases).set({
        status: "resolved",
        assignedToUserId: issue.assignedToUserId ?? user.id,
        assignedToName: issue.assignedToName ?? user.name,
        reviewStartedAt: issue.reviewStartedAt ?? now,
        resolutionOutcome,
        resolutionNote,
        resolvedByUserId: user.id,
        resolvedByName: user.name,
        resolvedAt: now,
        updatedAt: now,
      }).where(and(
        eq(statutoryContributionIssueCases.id, caseId),
        eq(statutoryContributionIssueCases.organizationId, organizationId),
      )).returning();

      await tx.update(complianceActionTasks).set({
        status: "resolved",
        resolvedAt: now,
        updatedAt: now,
      }).where(and(
        eq(complianceActionTasks.organizationId, organizationId),
        eq(complianceActionTasks.sourceType, "employee_contribution_issue"),
        eq(complianceActionTasks.sourceKey, sourceKey),
      ));

      await tx.insert(statutoryContributionIssueEvents).values({
        organizationId,
        caseId,
        employeeId: issue.employeeId,
        eventType: "resolved",
        visibility: "employee",
        message: `Resolved as ${resolutionOutcome.replaceAll("_", " ")}. ${resolutionNote}`,
        actorUserId: user.id,
        actorName: user.name,
      });

      return updated;
    });

    await recordAuditEvent({
      organizationId,
      actor: user.name,
      action: "Employee contribution issue resolved",
      resource: `${issue.agency} · ${issue.applicableMonth} · case #${issue.id}`,
      metadata: {
        caseId: issue.id,
        employeeId: issue.employeeId,
        resolutionOutcome,
        resolutionNote,
        linkedMemberId: issue.remittanceMemberId,
      },
    });

    const invalidatedClosures = await invalidateStatutoryRemittanceMonthCertification({
      organizationId,
      legalEntityId: issue.legalEntityId,
      applicableMonth: issue.applicableMonth,
      reason: `Employee contribution case #${issue.id} resolution changed certified month evidence.`,
    });
    if (invalidatedClosures.length > 0) {
      await recordAuditEvent({
        organizationId,
        actor: user.name,
        action: "Statutory remittance month certification invalidated",
        resource: issue.applicableMonth,
        metadata: {
          reason: "employee_contribution_issue_resolved",
          caseId: issue.id,
          invalidatedClosureIds: invalidatedClosures.map((row) => row.id),
        },
      });
    }

    try {
      await notifyEmployeeOfContributionCase({
        issue: result,
        event: "resolved",
        actor: user.name,
      });
    } catch {
      // The audited case resolution remains authoritative if email delivery is unavailable.
    }

    return Response.json({ case: result });
  }

  return Response.json({
    error: "Unsupported action. Use start_review, add_update or resolve.",
  }, { status: 400 });
}
