import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { auditEvents, engagementSurveys, organizations } from "../src/db/schema";
import {
  closeEngagementSurvey, closedSurveyDisclosure, createEngagementSurveyWithAudit,
} from "../src/lib/engagement-survey";

test("survey lifecycle and append-only audit receipt commit or roll back together", async () => {
  const tag = randomUUID().slice(0, 9);
  const [organization] = await db.insert(organizations).values({
    name: "Survey audit " + tag, legalName: "Survey audit " + tag,
  }).returning({ id: organizations.id });
  const organizationId = organization.id;
  const question = "How would you rate your experience at work?";
  const invalidActor = "X".repeat(121); // audit_events.actor is varchar(120)
  try {
    await assert.rejects(createEngagementSurveyWithAudit({
      organizationId, question, createdByUserId: null, actor: invalidActor,
    }));
    assert.deepEqual(await db.select({ id: engagementSurveys.id }).from(engagementSurveys)
      .where(eq(engagementSurveys.organizationId, organizationId)), [],
      "A failed audit insert must roll back survey creation");

    const survey = await createEngagementSurveyWithAudit({
      organizationId, question, createdByUserId: null, actor: "HR maker",
    });
    const auditRows = () => db.select({ action: auditEvents.action }).from(auditEvents)
      .where(eq(auditEvents.organizationId, organizationId));
    assert.deepEqual((await auditRows()).map(row => row.action), ["Engagement survey opened"]);

    await assert.rejects(closeEngagementSurvey(organizationId, survey.id, {
      actor: invalidActor, actorUserId: null,
    }));
    const [stillOpen] = await db.select({ status: engagementSurveys.status })
      .from(engagementSurveys).where(eq(engagementSurveys.id, survey.id));
    assert.equal(stillOpen.status, "open", "A failed close-audit must not close the survey");
    assert.equal((await auditRows()).length, 1, "No false close audit can survive rollback");

    assert.equal(await closeEngagementSurvey(organizationId, survey.id, {
      actor: "HR checker", actorUserId: null,
    }), true);
    assert.equal(await closeEngagementSurvey(organizationId, survey.id, {
      actor: "HR checker", actorUserId: null,
    }), false, "Repeated closure must be idempotent");
    const [closed] = await db.select({ status: engagementSurveys.status })
      .from(engagementSurveys).where(eq(engagementSurveys.id, survey.id));
    assert.equal(closed.status, "closed");
    assert.deepEqual((await auditRows()).map(row => row.action), [
      "Engagement survey opened", "Engagement survey closed",
    ]);
  } finally {
    await db.delete(organizations).where(eq(organizations.id, organizationId));
  }
});

test("closed survey disclosure refuses inconsistent or malformed totals", () => {
  const base = {
    question: "How would you rate your experience at work?",
    status: "closed", responseCount: 5, scoreSum: 15,
  };
  assert.equal(closedSurveyDisclosure(base).disclosure, "available");
  for (const [responseCount, scoreSum] of [
    [4, 12], [5, 0], [5, 26], [5, Number.NaN], [5.1, 15],
    [Number.POSITIVE_INFINITY, 15],
  ]) {
    assert.equal(closedSurveyDisclosure({ ...base, responseCount, scoreSum }).disclosure,
      "suppressed", "Invalid or small totals must not be published");
  }
  assert.equal(closedSurveyDisclosure({ ...base, status: "open" }).disclosure, "suppressed");
});
