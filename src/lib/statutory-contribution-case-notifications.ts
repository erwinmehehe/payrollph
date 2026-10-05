import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  statutoryContributionIssueCases,
  userOrganizations,
  users,
} from "@/db/schema";
import { PAYROLL_OPERATOR_ROLES, roleAllowed } from "@/lib/access";
import { queueMessage } from "@/lib/mailer";

type ContributionCase = typeof statutoryContributionIssueCases.$inferSelect;

function caseDedupeKey(input: {
  organizationId: number;
  caseId: number;
  event: "reported" | "review_started" | "referred" | "resolved";
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

function payrollBody(issue: ContributionCase, recipientName: string) {
  return [
    `Hi ${recipientName},`,
    "",
    "An employee reported a mandatory contribution issue in PayrollPH.",
    "",
    `${issue.agency} · ${issue.applicableMonth}`,
    `Issue type: ${issue.issueType.replaceAll("_", " ")}`,
    `Employee report: ${issue.description}`,
    "",
    "Open Payroll > Employee Contribution Cases to review the report against payslip, remittance and agency-posting evidence.",
    "",
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
      body: payrollBody(input.issue, recipient.name),
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
