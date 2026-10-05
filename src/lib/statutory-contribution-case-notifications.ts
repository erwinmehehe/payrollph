import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  statutoryContributionIssueCases,
  userOrganizations,
  users,
} from "@/db/schema";
import { PAYROLL_OPERATOR_ROLES, roleAllowed } from "@/lib/access";
import type { ContributionCaseEscalationStage } from "@/lib/statutory-contribution-case-aging";
import { queueMessage } from "@/lib/mailer";

type ContributionCase = typeof statutoryContributionIssueCases.$inferSelect;

function caseDedupeKey(input: {
  organizationId: number;
  caseId: number;
  event: string;
  recipientUserId: number;
}) {
  return [
    "employee-contribution-case",
    input.organizationId,
    input.caseId,
    input.event,
    `user-${input.recipientUserId}`,
  ].join(":").slice(0, 200);
}

function payrollBody(
  issue: ContributionCase,
  recipientName: string,
  event: "reported" | "review_overdue" | "resolution_overdue" = "reported",
  stage: ContributionCaseEscalationStage = 0,
) {
  const opening = event === "reported"
    ? "An employee reported a mandatory contribution issue in PayrollPH."
    : event === "review_overdue"
      ? "A mandatory contribution case has missed PayrollPH's internal first-review target."
      : "A mandatory contribution case has missed PayrollPH's internal resolution target.";

  const escalation =
    stage >= 3
      ? "Escalation stage: executive follow-up after 5 business days overdue"
      : stage === 2
        ? "Escalation stage: follow-up after 2 business days overdue"
        : stage === 1
          ? "Escalation stage: initial overdue alert"
          : null;

  return [
    `Hi ${recipientName},`,
    "",
    opening,
    "",
    `${issue.agency} · ${issue.applicableMonth}`,
    `Issue type: ${issue.issueType.replaceAll("_", " ")}`,
    `Employee report: ${issue.description}`,
    `Case status: ${issue.status.replaceAll("_", " ")}`,
    issue.assignedToName ? `Assigned to: ${issue.assignedToName}` : "Assigned to: unassigned",
    ...(escalation ? [escalation] : []),
    "",
    "Open Payroll > Employee Contribution Cases to review the report against payslip, remittance and agency-posting evidence.",
    "",
    "PayrollPH service targets are internal operational targets, not statutory or agency deadlines.",
    "Do not change statutory evidence from the case itself. Use the audited correction workflow when evidence must be corrected.",
  ].join("\n");
}

function employeeBody(
  issue: ContributionCase,
  recipientName: string,
  event: "review_started" | "referred" | "resolved",
) {
  if (event === "review_started") {
    return [
      `Hi ${recipientName},`,
      "",
      "Payroll has started reviewing the mandatory contribution issue you reported.",
      "",
      `${issue.agency} · ${issue.applicableMonth}`,
      `Issue: ${issue.issueType.replaceAll("_", " ")}`,
      `Reviewer: ${issue.assignedToName ?? "Payroll team"}`,
      "",
      "You can track the case in Employee Self-Service > Pay > Contribution Cases.",
      "",
      "You do not need to share your agency password, OTP or login credentials with payroll.",
    ].join("\n");
  }

  if (event === "referred") {
    return [
      `Hi ${recipientName},`,
      "",
      "Payroll has referred your mandatory contribution issue to the agency for further verification.",
      "",
      `${issue.agency} · ${issue.applicableMonth}`,
      `Payroll note: ${issue.resolutionNote ?? "Agency verification is required."}`,
      `Reviewer: ${issue.assignedToName ?? "Payroll team"}`,
      "",
      "Your PayrollPH case remains open while the agency response is pending.",
      "You can keep tracking it in Employee Self-Service > Pay > Contribution Cases.",
    ].join("\n");
  }

  return [
    `Hi ${recipientName},`,
    "",
    "Payroll has resolved the mandatory contribution issue you reported.",
    "",
    `${issue.agency} · ${issue.applicableMonth}`,
    `Outcome: ${String(issue.resolutionOutcome ?? "resolved").replaceAll("_", " ")}`,
    `Payroll response: ${issue.resolutionNote ?? "See Employee Self-Service for the case outcome."}`,
    `Resolved by: ${issue.resolvedByName ?? "Payroll team"}`,
    "",
    "You can review the full case status in Employee Self-Service > Pay > Contribution Cases.",
  ].join("\n");
}

export async function notifyPayrollOfContributionCase(input: {
  issue: ContributionCase;
  actor: string;
}) {
  const recipients = await db.select({
    userId: userOrganizations.userId,
    role: userOrganizations.role,
    orgUnitId: userOrganizations.orgUnitId,
    name: users.name,
    email: users.email,
  })
    .from(userOrganizations)
    .innerJoin(users, eq(userOrganizations.userId, users.id))
    .where(eq(userOrganizations.organizationId, input.issue.organizationId));

  const payrollRecipients = recipients.filter((recipient) =>
    recipient.orgUnitId == null
    && roleAllowed(recipient.role, PAYROLL_OPERATOR_ROLES),
  );

  const results = [];
  for (const recipient of payrollRecipients) {
    results.push(await queueMessage({
      organizationId: input.issue.organizationId,
      recipient: recipient.email,
      subject: `[Payroll compliance] Employee reported ${input.issue.agency} contribution issue`.slice(0, 180),
      body: payrollBody(input.issue, recipient.name, "reported"),
      purpose: "employee-contribution-case",
      dedupeKey: caseDedupeKey({
        organizationId: input.issue.organizationId,
        caseId: input.issue.id,
        event: "reported",
        recipientUserId: recipient.userId,
      }),
      metadata: {
        contributionCaseId: input.issue.id,
        event: "reported",
        employeeId: input.issue.employeeId,
        agency: input.issue.agency,
        applicableMonth: input.issue.applicableMonth,
        recipientUserId: recipient.userId,
      },
      audit: {
        actor: input.actor,
        metadata: {
          contributionCaseId: input.issue.id,
          event: "reported",
          recipientUserId: recipient.userId,
        },
      },
    }));
  }
  return results;
}


export async function notifyEmployeeOfContributionCaseUpdate(input: {
  issue: ContributionCase;
  eventId: number;
  message: string;
  actor: string;
}) {
  const [recipient] = await db.select({
    userId: users.id,
    name: users.name,
    email: users.email,
  })
    .from(users)
    .where(and(
      eq(users.employeeId, input.issue.employeeId),
      eq(users.role, "employee"),
    ))
    .limit(1);

  if (!recipient) return [];

  return [await queueMessage({
    organizationId: input.issue.organizationId,
    recipient: recipient.email,
    subject: `Payroll update on your ${input.issue.agency} contribution case`.slice(0, 180),
    body: [
      `Hi ${recipient.name},`,
      "",
      "Payroll posted an update on the mandatory contribution issue you reported.",
      "",
      `${input.issue.agency} · ${input.issue.applicableMonth}`,
      `Update from ${input.actor}: ${input.message}`,
      "",
      "You can review the full timeline in Employee Self-Service > Pay > Contribution Cases.",
      "",
      "You do not need to share your agency password, OTP or login credentials with payroll.",
    ].join("\n"),
    purpose: "employee-contribution-case",
    dedupeKey: caseDedupeKey({
      organizationId: input.issue.organizationId,
      caseId: input.issue.id,
      event: `payroll_update-${input.eventId}`,
      recipientUserId: recipient.userId,
    }),
    metadata: {
      contributionCaseId: input.issue.id,
      caseEventId: input.eventId,
      event: "payroll_update",
      employeeId: input.issue.employeeId,
      agency: input.issue.agency,
      applicableMonth: input.issue.applicableMonth,
      recipientUserId: recipient.userId,
    },
    audit: {
      actor: input.actor,
      metadata: {
        contributionCaseId: input.issue.id,
        caseEventId: input.eventId,
        event: "payroll_update",
        recipientUserId: recipient.userId,
      },
    },
  })];
}

export async function notifyEmployeeOfContributionCase(input: {
  issue: ContributionCase;
  event: "review_started" | "referred" | "resolved";
  actor: string;
}) {
  const [recipient] = await db.select({
    userId: users.id,
    name: users.name,
    email: users.email,
  })
    .from(users)
    .where(and(
      eq(users.employeeId, input.issue.employeeId),
      eq(users.role, "employee"),
    ))
    .limit(1);

  if (!recipient) return [];

  const subject = input.event === "review_started"
    ? `Payroll is reviewing your ${input.issue.agency} contribution issue`
    : input.event === "referred"
      ? `Your ${input.issue.agency} contribution issue was referred to the agency`
      : `Your ${input.issue.agency} contribution issue was resolved`;

  return [await queueMessage({
    organizationId: input.issue.organizationId,
    recipient: recipient.email,
    subject: subject.slice(0, 180),
    body: employeeBody(input.issue, recipient.name, input.event),
    purpose: "employee-contribution-case",
    dedupeKey: caseDedupeKey({
      organizationId: input.issue.organizationId,
      caseId: input.issue.id,
      event: input.event,
      recipientUserId: recipient.userId,
    }),
    metadata: {
      contributionCaseId: input.issue.id,
      event: input.event,
      employeeId: input.issue.employeeId,
      agency: input.issue.agency,
      applicableMonth: input.issue.applicableMonth,
      recipientUserId: recipient.userId,
    },
    audit: {
      actor: input.actor,
      metadata: {
        contributionCaseId: input.issue.id,
        event: input.event,
        recipientUserId: recipient.userId,
      },
    },
  })];
}


export async function notifyPayrollOfContributionCaseEscalation(input: {
  issue: ContributionCase;
  event: "review_overdue" | "resolution_overdue";
  stage: ContributionCaseEscalationStage;
  actor: string;
}) {
  const recipients = await db.select({
    userId: userOrganizations.userId,
    role: userOrganizations.role,
    orgUnitId: userOrganizations.orgUnitId,
    name: users.name,
    email: users.email,
  })
    .from(userOrganizations)
    .innerJoin(users, eq(userOrganizations.userId, users.id))
    .where(eq(userOrganizations.organizationId, input.issue.organizationId));

  const payrollRecipients = recipients.filter((recipient) =>
    recipient.orgUnitId == null
    && roleAllowed(recipient.role, PAYROLL_OPERATOR_ROLES),
  );
  const ownerAdmins = payrollRecipients.filter((recipient) =>
    recipient.role === "owner" || recipient.role === "admin",
  );
  const assigned = input.issue.assignedToUserId == null
    ? []
    : payrollRecipients.filter((recipient) => recipient.userId === input.issue.assignedToUserId);

  const selected =
    input.stage === 1
      ? payrollRecipients
      : [...new Map([...ownerAdmins, ...assigned].map((recipient) => [recipient.userId, recipient])).values()];

  const prefix = input.stage >= 3
    ? "[Executive payroll compliance]"
    : input.stage === 2
      ? "[Payroll compliance follow-up]"
      : "[Payroll compliance]";
  const subject = input.event === "review_overdue"
    ? `${prefix} Contribution case needs review: ${input.issue.agency}`
    : `${prefix} Contribution case resolution target missed: ${input.issue.agency}`;

  const results = [];
  for (const recipient of selected) {
    results.push(await queueMessage({
      organizationId: input.issue.organizationId,
      recipient: recipient.email,
      subject: subject.slice(0, 180),
      body: payrollBody(input.issue, recipient.name, input.event, input.stage),
      purpose: "employee-contribution-case",
      dedupeKey: caseDedupeKey({
        organizationId: input.issue.organizationId,
        caseId: input.issue.id,
        event: `${input.event}:stage-${input.stage}`,
        recipientUserId: recipient.userId,
      }),
      metadata: {
        contributionCaseId: input.issue.id,
        event: input.event,
        escalationStage: input.stage,
        employeeId: input.issue.employeeId,
        agency: input.issue.agency,
        applicableMonth: input.issue.applicableMonth,
        recipientUserId: recipient.userId,
        internalServiceTarget: true,
      },
      audit: {
        actor: input.actor,
        metadata: {
          contributionCaseId: input.issue.id,
          event: input.event,
          escalationStage: input.stage,
          recipientUserId: recipient.userId,
          internalServiceTarget: true,
        },
      },
    }));
  }
  return results;
}
