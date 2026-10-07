import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  complianceActionTasks,
  employees,
  statutoryContributionIssueCases,
  statutoryContributionIssueEvents,
  statutoryRemittanceBatches,
  statutoryRemittanceMembers,
} from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit";
import { notifyPayrollOfContributionCase } from "@/lib/statutory-contribution-case-notifications";
import { contributionCaseServiceStatus, contributionCaseServiceTargets } from "@/lib/statutory-contribution-case-aging";
import { invalidateStatutoryRemittanceMonthCertification } from "@/lib/statutory-remittance-certification";
import { getSessionUser } from "@/lib/auth";
import {
  enforceSameOriginMutation,
  enforceSensitiveActionRateLimit,
} from "@/lib/security-request";

export const dynamic = "force-dynamic";

const AGENCIES = new Set(["SSS", "PhilHealth", "Pag-IBIG"]);
const ISSUE_TYPES = new Set([
  "missing_posting",
  "wrong_posted_amount",
  "unexpected_deduction",
  "missing_payslip_evidence",
  "other",
]);

async function employeeContext() {
  const user = await getSessionUser();
  if (!user) {
    return { user: null, employee: null, denied: Response.json({ error: "Authentication required." }, { status: 401 }) };
  }
  if (user.role !== "employee" || !user.employeeId) {
    return {
      user,
      employee: null,
      denied: Response.json({ error: "This endpoint is for linked employee self-service accounts." }, { status: 403 }),
    };
  }
  const [employee] = await db.select().from(employees).where(eq(employees.id, user.employeeId)).limit(1);
  if (!employee) {
    return { user, employee: null, denied: Response.json({ error: "Employee record not found." }, { status: 404 }) };
  }
  return { user, employee, denied: null };
}

export async function GET() {
  const context = await employeeContext();
  if (context.denied) return context.denied;
  const user = context.user!;
  const employee = context.employee!;
  if (!employee.legalEntityId) {
    return Response.json({ error: "Your employee record has no legal employer. Contact payroll before reviewing contribution evidence." }, { status: 409 });
  }

  const cases = await db.select().from(statutoryContributionIssueCases)
    .where(and(
      eq(statutoryContributionIssueCases.organizationId, employee.organizationId),
      eq(statutoryContributionIssueCases.legalEntityId, employee.legalEntityId),
      eq(statutoryContributionIssueCases.employeeId, employee.id),
    ))
    .orderBy(desc(statutoryContributionIssueCases.createdAt), desc(statutoryContributionIssueCases.id))
    .limit(30);

  const events = await db.select().from(statutoryContributionIssueEvents)
    .where(and(
      eq(statutoryContributionIssueEvents.organizationId, employee.organizationId),
      eq(statutoryContributionIssueEvents.employeeId, employee.id),
      eq(statutoryContributionIssueEvents.visibility, "employee"),
    ))
    .orderBy(desc(statutoryContributionIssueEvents.createdAt), desc(statutoryContributionIssueEvents.id))
    .limit(200);
  const eventsByCase = new Map<number, typeof events>();
  for (const event of events) {
    eventsByCase.set(event.caseId, [...(eventsByCase.get(event.caseId) ?? []), event]);
  }

  return Response.json({
    cases: cases.map((row) => ({
      id: row.id,
      agency: row.agency,
      applicableMonth: row.applicableMonth,
      issueType: row.issueType,
      description: row.description,
      status: row.status,
      assignedToName: row.assignedToName,
      resolutionOutcome: row.resolutionOutcome,
      resolutionNote: row.resolutionNote,
      resolvedByName: row.resolvedByName,
      resolvedAt: row.resolvedAt,
      createdAt: row.createdAt,
      service: contributionCaseServiceStatus(row),
      events: eventsByCase.get(row.id) ?? [],
    })),
    userId: user.id,
  });
}

export async function POST(request: Request) {
  const originDenied = enforceSameOriginMutation(request);
  if (originDenied) return originDenied;

  const context = await employeeContext();
  if (context.denied) return context.denied;
  const user = context.user!;
  const employee = context.employee!;
  const legalEntityId = employee.legalEntityId;
  if (!legalEntityId) {
    return Response.json({ error: "Your employee record has no legal employer. Contact payroll before reporting a contribution issue." }, { status: 409 });
  }

  const rateDenied = await enforceSensitiveActionRateLimit(request, {
    userId: user.id,
    action: "employee-contribution-issue",
    resourceId: employee.organizationId,
    limit: 6,
    windowMs: 60 * 60_000,
  });
  if (rateDenied) return rateDenied;

  const body = await request.json().catch(() => ({}));
  const agency = String(body.agency ?? "").trim();
  const applicableMonth = String(body.applicableMonth ?? "").trim();
  const issueType = String(body.issueType ?? "").trim();
  const description = String(body.description ?? "").trim().replace(/\s+/g, " ").slice(0, 500);
  const memberId = body.memberId == null || body.memberId === "" ? null : Number(body.memberId);

  if (
    !AGENCIES.has(agency)
    || !/^\d{4}-\d{2}$/.test(applicableMonth)
    || !ISSUE_TYPES.has(issueType)
    || description.length < 20
    || (memberId != null && !Number.isInteger(memberId))
  ) {
    return Response.json({
      error: "agency, applicableMonth, a supported issueType, and a description of at least 20 characters are required.",
    }, { status: 400 });
  }

  let member: typeof statutoryRemittanceMembers.$inferSelect | null = null;
  let batch: typeof statutoryRemittanceBatches.$inferSelect | null = null;

  if (memberId != null) {
    const [row] = await db.select({
      member: statutoryRemittanceMembers,
      batch: statutoryRemittanceBatches,
    })
      .from(statutoryRemittanceMembers)
      .innerJoin(statutoryRemittanceBatches, eq(statutoryRemittanceMembers.batchId, statutoryRemittanceBatches.id))
      .where(and(
        eq(statutoryRemittanceMembers.id, memberId),
        eq(statutoryRemittanceMembers.organizationId, employee.organizationId),
        eq(statutoryRemittanceMembers.legalEntityId, legalEntityId),
        eq(statutoryRemittanceMembers.employeeId, employee.id),
      ))
      .limit(1);

    if (!row) {
      return Response.json({ error: "That contribution record is not part of your employee account." }, { status: 404 });
    }
    if (row.batch.legalEntityId !== legalEntityId || row.batch.agency !== agency || row.batch.applicableMonth !== applicableMonth) {
      return Response.json({ error: "The selected contribution record does not match the agency/month being reported." }, { status: 409 });
    }
    member = row.member;
    batch = row.batch;
  }

  const duplicate = await db.select({ id: statutoryContributionIssueCases.id })
    .from(statutoryContributionIssueCases)
    .where(and(
      eq(statutoryContributionIssueCases.organizationId, employee.organizationId),
      eq(statutoryContributionIssueCases.legalEntityId, legalEntityId),
      eq(statutoryContributionIssueCases.employeeId, employee.id),
      eq(statutoryContributionIssueCases.agency, agency),
      eq(statutoryContributionIssueCases.applicableMonth, applicableMonth),
      eq(statutoryContributionIssueCases.issueType, issueType),
      inArray(statutoryContributionIssueCases.status, ["open", "in_review"]),
    ))
    .limit(1);

  if (duplicate.length) {
    return Response.json({
      error: "You already have an open case for this agency, month and issue type.",
      caseId: duplicate[0].id,
    }, { status: 409 });
  }

  const snapshot = member && batch
    ? {
        memberFound: true,
        memberId: member.id,
        batchId: batch.id,
        paymentStatus: batch.status,
        dueDate: batch.dueDate,
        amountPaid: batch.amountPaid,
        paidAt: batch.paidAt,
        employeeShare: member.employeeShare,
        employerShare: member.employerShare,
        totalContribution: member.totalContribution,
        postingStatus: member.postingStatus,
        postingReference: member.postingReference,
        postedAmount: member.postedAmount,
        postedAt: member.postedAt,
        exceptionNote: member.exceptionNote,
      }
    : {
        memberFound: false,
        agency,
        applicableMonth,
      };

  const created = await db.transaction(async (tx) => {
    const [issue] = await tx.insert(statutoryContributionIssueCases).values({
      organizationId: employee.organizationId,
      legalEntityId: legalEntityId,
      employeeId: employee.id,
      batchId: batch?.id ?? null,
      remittanceMemberId: member?.id ?? null,
      agency,
      applicableMonth,
      issueType,
      description,
      employeeSnapshot: snapshot,
      status: "open",
      reportedByUserId: user.id,
      reportedByName: user.name,
    }).returning();

    await tx.insert(statutoryContributionIssueEvents).values({
      organizationId: employee.organizationId,
      caseId: issue.id,
      employeeId: employee.id,
      eventType: "reported",
      visibility: "employee",
      message: `Employee reported: ${description}`,
      actorUserId: user.id,
      actorName: user.name,
    });

    const serviceTargets = contributionCaseServiceTargets(issue);

    await tx.insert(complianceActionTasks).values({
      organizationId: employee.organizationId,
      sourceType: "employee_contribution_issue",
      sourceKey: `employee-contribution-issue:${issue.id}`,
      agency,
      applicableMonth,
      severity: member?.postingStatus === "exception" ? "danger" : "warning",
      title: `${agency} contribution issue reported by ${employee.employeeNo}`.slice(0, 180),
      detail: `${applicableMonth} · ${issueType.replaceAll("_", " ")} · ${description}`.slice(0, 360),
      status: "open",
      dueDate: serviceTargets.firstReviewDue.toISOString().slice(0, 10),
      firstDetectedAt: new Date(),
      lastDetectedAt: new Date(),
    });

    return issue;
  });

  await recordAuditEvent({
    organizationId: employee.organizationId,
    actor: user.name,
    action: "Employee statutory contribution issue reported",
    resource: `${agency} · ${applicableMonth} · ${employee.employeeNo}`,
    metadata: {
      caseId: created.id,
      legalEntityId: legalEntityId,
      employeeId: employee.id,
      issueType,
      memberId: member?.id ?? null,
      batchId: batch?.id ?? null,
      snapshot,
    },
  });

  const invalidatedClosures = await invalidateStatutoryRemittanceMonthCertification({
    organizationId: employee.organizationId,
    legalEntityId: legalEntityId,
    applicableMonth,
    reason: `Employee contribution case #${created.id} was reported after month certification.`,
  });
  if (invalidatedClosures.length > 0) {
    await recordAuditEvent({
      organizationId: employee.organizationId,
      actor: user.name,
      action: "Statutory remittance month certification invalidated",
      resource: applicableMonth,
      metadata: {
        reason: "employee_contribution_issue_reported",
        caseId: created.id,
        invalidatedClosureIds: invalidatedClosures.map((row) => row.id),
      },
    });
  }

  try {
    await notifyPayrollOfContributionCase({
      issue: created,
      actor: user.name,
    });
  } catch {
    // The compliance case is authoritative even when notification delivery is unavailable.
  }

  return Response.json({
    case: {
      id: created.id,
      agency: created.agency,
      applicableMonth: created.applicableMonth,
      issueType: created.issueType,
      status: created.status,
      createdAt: created.createdAt,
      service: contributionCaseServiceStatus(created),
    },
  }, { status: 201 });
}
