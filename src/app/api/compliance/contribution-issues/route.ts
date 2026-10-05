import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  complianceActionTasks,
  employees,
  statutoryContributionIssueCases,
  statutoryRemittanceMembers,
} from "@/db/schema";
import { getAccess, PAYROLL_OPERATOR_ROLES, roleAllowed } from "@/lib/access";
import { recordAuditEvent } from "@/lib/audit";
import { notifyEmployeeOfContributionCase } from "@/lib/statutory-contribution-case-notifications";
import { contributionCaseServiceStatus, contributionCaseServiceTargets } from "@/lib/statutory-contribution-case-aging";
import { invalidateStatutoryRemittanceMonthCertification } from "@/lib/statutory-remittance-certification";
import { getSessionUser } from "@/lib/auth";
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
  if (!Number.isInteger(organizationId)) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const denied = await requirePayrollOperator(user.id, organizationId);
  if (denied) return denied;

  const rows = await db.select({
    issue: statutoryContributionIssueCases,
    employeeNo: employees.employeeNo,
    firstName: employees.firstName,
    lastName: employees.lastName,
  })
    .from(statutoryContributionIssueCases)
    .innerJoin(employees, eq(statutoryContributionIssueCases.employeeId, employees.id))
    .where(eq(statutoryContributionIssueCases.organizationId, organizationId))
    .orderBy(
      asc(statutoryContributionIssueCases.status),
      desc(statutoryContributionIssueCases.createdAt),
      desc(statutoryContributionIssueCases.id),
    )
    .limit(100);

  return Response.json({
    cases: rows.map((row) => ({
      ...row.issue,
      employeeNo: row.employeeNo,
      employeeName: `${row.firstName} ${row.lastName}`,
      service: contributionCaseServiceStatus(row.issue),
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

  if (action === "start_review") {
    const now = new Date();
    const [updated] = await db.update(statutoryContributionIssueCases).set({
      status: "in_review",
      assignedToUserId: user.id,
      assignedToName: user.name,
      reviewStartedAt: issue.reviewStartedAt ?? now,
      updatedAt: now,
    }).where(and(
      eq(statutoryContributionIssueCases.id, caseId),
      eq(statutoryContributionIssueCases.organizationId, organizationId),
    )).returning();

    const serviceTargets = contributionCaseServiceTargets(updated);

    await db.update(complianceActionTasks).set({
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
        eq(statutoryRemittanceMembers.employeeId, issue.employeeId),
      )).limit(1);
      if (!member || member.postingStatus !== "confirmed") {
        return Response.json({
          error: "The linked agency posting is not confirmed yet. Reconcile the posting evidence before resolving the case as confirmed.",
        }, { status: 409 });
      }
    }

    const now = new Date();
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
    error: "Unsupported action. Use start_review or resolve.",
  }, { status: 400 });
}
