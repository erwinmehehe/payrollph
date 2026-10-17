import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  employees, legalEntities, organizations, outbox, statutoryContributionIssueCases, userOrganizations, users,
} from "../src/db/schema";
import { runScheduledContributionCaseEscalations } from "../src/lib/statutory-contribution-case-escalations";

// Scheduler leases fence completion receipts, not in-flight work, so two workers can
// briefly run the same job after a takeover. Escalation notices must not be duplicated.

test("overlapping contribution-case escalation runs queue one notice per recipient", async () => {
  const marker = randomUUID().slice(0, 10);
  const [org] = await db.insert(organizations).values({ name: "Overlap cases " + marker, legalName: "Overlap cases " + marker }).returning();
  try {
    const [entity] = await db.insert(legalEntities).values({
      organizationId: org.id, code: "OVC", displayName: "Overlap employer", legalName: "Overlap employer Inc.", primaryEntity: true,
    }).returning();
    const [employee] = await db.insert(employees).values({
      organizationId: org.id, legalEntityId: entity.id, employeeNo: "OC-" + marker, firstName: "Overlap", lastName: "Member",
      title: "Analyst", avatarInitials: "OM", basicRate: "30000.00", startDate: "2025-01-01",
    }).returning();
    const [owner] = await db.insert(users).values({
      email: `overlap-owner-${marker}@example.test`, name: "Overlap Owner", passwordHash: "no-login",
    }).returning();
    await db.insert(userOrganizations).values({ userId: owner.id, organizationId: org.id, role: "owner" });
    const longAgo = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000);
    await db.insert(statutoryContributionIssueCases).values({
      organizationId: org.id, legalEntityId: entity.id, employeeId: employee.id, agency: "SSS", applicableMonth: "2026-06",
      issueType: "missing_identifier", description: "Synthetic overdue case", employeeSnapshot: {},
      reportedByName: "CI", createdAt: longAgo, updatedAt: longAgo,
    });

    const results = await Promise.all([1, 2, 3, 4].map(() => runScheduledContributionCaseEscalations({
      actor: "CI overlap", now: new Date(), force: true,
    })));
    assert.ok(results.some((r) => !r.skipped && r.escalated === 1), "at least one worker escalated the overdue case");

    const notices = await db.select().from(outbox).where(eq(outbox.organizationId, org.id));
    const escalations = notices.filter((row) => row.purpose === "employee-contribution-case");
    assert.equal(escalations.length, 1, `one notice for the single owner recipient, got ${escalations.length}`);
    assert.equal(new Set(escalations.map((row) => row.dedupeKey)).size, escalations.length);
  } finally {
    await db.delete(outbox).where(eq(outbox.organizationId, org.id));
    await db.delete(statutoryContributionIssueCases).where(eq(statutoryContributionIssueCases.organizationId, org.id));
    await db.delete(userOrganizations).where(eq(userOrganizations.organizationId, org.id));
    await db.delete(employees).where(eq(employees.organizationId, org.id));
    await db.delete(legalEntities).where(eq(legalEntities.organizationId, org.id));
    await db.delete(organizations).where(eq(organizations.id, org.id)).catch(() => undefined);
  }
});
