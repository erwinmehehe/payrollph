import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import { organizations, outbox, payrollRuns, userOrganizations, users } from "../src/db/schema";
import type { ComplianceCalendarItem } from "../src/lib/compliance-calendar";
import {
  COMPLIANCE_DEADLINE_ALERT_PURPOSE,
  actionableDeadlineAlerts,
  deadlineDigestBody,
  hasNewDeadlineStage,
  runScheduledComplianceDeadlineAlerts,
} from "../src/lib/compliance-deadline-alerts";

const item = (id: string, status: ComplianceCalendarItem["status"]): ComplianceCalendarItem => ({
  id,
  agency: "BIR",
  obligation: `Obligation ${id}`,
  applicableMonth: "2026-09",
  dueDate: "2026-10-10",
  status,
  detail: "Detail.",
  sourceLabel: "BIR",
  sourceUrl: "https://www.bir.gov.ph/Tax-Reminder",
  exactness: "nominal",
});

test("only due-soon, overdue, exception and past-due verification items alert", () => {
  const alerts = actionableDeadlineAlerts([
    item("a", "due-soon"), item("b", "upcoming"), item("c", "complete"),
    item("d", "overdue"), item("e", "verification-required"), item("f", "exception"),
    item("g", "configuration-required"), item("h", "posting-pending"),
  ]);
  assert.deepEqual(alerts.map((alert) => alert.itemStage), ["a:due-soon", "d:overdue", "e:verification-required", "f:exception"]);
});

test("a digest is sent only when an obligation enters a new actionable stage", () => {
  const current = actionableDeadlineAlerts([item("a", "due-soon"), item("b", "overdue")]);
  assert.equal(hasNewDeadlineStage(current, []), true);
  assert.equal(hasNewDeadlineStage(current, ["a:due-soon", "b:overdue"]), false);
  assert.equal(hasNewDeadlineStage(current, ["a:due-soon", "b:overdue", "old:overdue"]), false, "resolved items do not re-trigger");
  assert.equal(hasNewDeadlineStage(actionableDeadlineAlerts([item("a", "overdue")]), ["a:due-soon"]), true, "escalation re-triggers");
});

test("the digest names each obligation, its stage and due date", () => {
  const body = deadlineDigestBody({
    recipientName: "Ana",
    organizationName: "Acme",
    today: "2026-10-08",
    alerts: actionableDeadlineAlerts([item("a", "due-soon"), item("b", "overdue")]),
  });
  assert.match(body, /Acme has 2 statutory obligations/);
  assert.match(body, /\[DUE WITHIN 7 DAYS\] Obligation a \(2026-09\) due 2026-10-10/);
  assert.match(body, /\[OVERDUE\] Obligation b/);
});

test("the scheduled job emails company-wide payroll admins once per new stage", async () => {
  const suffix = randomUUID().slice(0, 8);
  const [organization] = await db.insert(organizations).values({
    name: `Deadline Alerts ${suffix}`,
    legalName: `Deadline Alerts ${suffix} Inc.`,
    philHealthEmployerNo: "00-123456789-3",
  }).returning();
  const createdUsers = await db.insert(users).values([
    { email: `deadline-owner-${suffix}@example.invalid`, name: "Owner", passwordHash: "test-only" },
    { email: `deadline-hr-${suffix}@example.invalid`, name: "HR", passwordHash: "test-only" },
    { email: `deadline-scoped-${suffix}@example.invalid`, name: "Scoped Admin", passwordHash: "test-only" },
  ]).returning();
  const [owner, hr, scoped] = createdUsers;
  try {
    await db.insert(userOrganizations).values([
      { userId: owner.id, organizationId: organization.id, role: "owner" },
      { userId: hr.id, organizationId: organization.id, role: "hr" },
      { userId: scoped.id, organizationId: organization.id, role: "admin", orgUnitId: 999 },
    ]);
    await db.insert(payrollRuns).values({
      organizationId: organization.id,
      periodLabel: "Sep 16-30 deadline QA",
      periodStart: "2026-09-16",
      periodEnd: "2026-09-30",
      payDate: "2026-09-30",
      scopeLabel: "All locations",
      status: "Released",
      employeeCount: 1,
      processedChunks: 1,
      totalChunks: 1,
      grossPay: "30000.00",
      netPay: "25000.00",
    });

    const digests = () => db.select().from(outbox).where(and(
      eq(outbox.organizationId, organization.id),
      eq(outbox.purpose, COMPLIANCE_DEADLINE_ALERT_PURPOSE),
    ));

    const first = await runScheduledComplianceDeadlineAlerts({ now: new Date("2026-10-08T02:00:00Z"), organizationIds: [organization.id] });
    assert.equal(first[0]?.queued, 1);
    const afterFirst = await digests();
    assert.deepEqual(afterFirst.map((row) => row.recipient), [owner.email], "HR and unit-scoped admins are not deadline recipients");
    assert.match(afterFirst[0].body, /BIR Form 1601-C withholding remittance \(2026-09\) due 2026-10-10/);

    const repeat = await runScheduledComplianceDeadlineAlerts({ now: new Date("2026-10-08T05:00:00Z"), organizationIds: [organization.id] });
    assert.equal(repeat[0]?.queued, 0);
    assert.equal((await digests()).length, 1, "an unchanged set of deadlines is not re-sent");

    const escalated = await runScheduledComplianceDeadlineAlerts({ now: new Date("2026-10-12T02:00:00Z"), organizationIds: [organization.id] });
    assert.equal(escalated[0]?.queued, 1, "the 1601-C target passing is a new stage");
    assert.equal((await digests()).length, 2);
  } finally {
    await db.delete(outbox).where(eq(outbox.organizationId, organization.id));
    await db.delete(organizations).where(eq(organizations.id, organization.id));
    await db.delete(users).where(inArray(users.id, createdUsers.map((user) => user.id)));
  }
});
