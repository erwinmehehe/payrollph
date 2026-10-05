import { and, eq, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  statutoryRemittanceObligations,
  userOrganizations,
  users,
} from "@/db/schema";
import { queueMessage } from "@/lib/mailer";

const REMINDER_ROLES = ["owner", "admin", "bookkeeper", "hr", "payroll"];

function phDate(now: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Manila",
  }).format(now);
}

function daysBetween(from: string, to: string) {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}

export async function queueStatutoryRemittanceReminders(now = new Date()) {
  const today = phDate(now);
  const month = today.slice(0, 7);
  const obligations = await db.select().from(statutoryRemittanceObligations)
    .where(ne(statutoryRemittanceObligations.status, "confirmed"));

  type ReminderCandidate = {
    row: (typeof obligations)[number];
    stage: "needs-configuration" | "overdue" | "due-soon";
    daysRemaining: number | null;
  };
  const candidates: ReminderCandidate[] = [];
  for (const row of obligations) {
    const dueDate = row.dueDate ? String(row.dueDate) : null;
    if (!dueDate) {
      if (row.applicableMonth < month) {
        candidates.push({ row, stage: "needs-configuration", daysRemaining: null });
      }
      continue;
    }
    const daysRemaining = daysBetween(today, dueDate);
    if (daysRemaining < 0) {
      candidates.push({ row, stage: "overdue", daysRemaining });
      continue;
    }
    if (daysRemaining <= 3) {
      candidates.push({ row, stage: "due-soon", daysRemaining });
    }
  }

  let queued = 0;
  let skipped = 0;
  for (const candidate of candidates) {
    const recipients = await db.select({
      email: users.email,
      name: users.name,
      role: userOrganizations.role,
    })
      .from(userOrganizations)
      .innerJoin(users, eq(userOrganizations.userId, users.id))
      .where(and(
        eq(userOrganizations.organizationId, candidate.row.organizationId),
        isNull(userOrganizations.orgUnitId),
      ));

    const eligible = recipients.filter((recipient) =>
      REMINDER_ROLES.includes(recipient.role) && Boolean(recipient.email?.trim()),
    );

    for (const recipient of eligible) {
      const stageLabel =
        candidate.stage === "overdue"
          ? "OVERDUE"
          : candidate.stage === "due-soon"
            ? "DUE SOON"
            : "DEADLINE SETUP REQUIRED";
      const deadlineText = candidate.row.dueDate
        ? `Due date: ${candidate.row.dueDate}`
        : `Deadline cannot be calculated: ${candidate.row.dueRule}`;
      const result = await queueMessage({
        organizationId: candidate.row.organizationId,
        recipient: recipient.email,
        subject: `${stageLabel}: ${candidate.row.agency} contributions for ${candidate.row.applicableMonth}`,
        purpose: "statutory-remittance-reminder",
        dedupeKey: candidate.stage === "overdue"
          ? `statutory-remittance:${candidate.row.id}:overdue:${today}:${recipient.email}`
          : `statutory-remittance:${candidate.row.id}:${candidate.stage}:${candidate.row.dueDate ?? candidate.row.applicableMonth}:${recipient.email}`,
        body: [
          `Hi ${recipient.name},`,
          "",
          `${candidate.row.agency} contribution remittance for ${candidate.row.applicableMonth} is ${stageLabel.toLowerCase()}.`,
          `Expected total: PHP ${Number(candidate.row.expectedTotalAmount).toFixed(2)}`,
          deadlineText,
          `Current status: ${candidate.row.status.replaceAll("_", " ")}`,
          "",
          "Open Exports → Contribution Remittance Control. Record the exact payment reference and amount, then have a different authorized reviewer confirm agency posting.",
          "",
          "PayrollPH blocks future payroll release after an unresolved remittance becomes overdue.",
        ].join("\n"),
        audit: {
          actor: "System",
          metadata: {
            remittanceObligationId: candidate.row.id,
            agency: candidate.row.agency,
            applicableMonth: candidate.row.applicableMonth,
            stage: candidate.stage,
          },
        },
      });
      if (result.status === "sent" || result.status === "queued") queued += 1;
      else skipped += 1;
    }
  }

  return {
    checked: obligations.length,
    candidates: candidates.length,
    queued,
    skipped,
    at: now.toISOString(),
  };
}
