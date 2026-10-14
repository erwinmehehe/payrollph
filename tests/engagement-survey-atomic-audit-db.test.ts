import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { auditEvents, engagementSurveys, organizations } from "../src/db/schema";
import {
  closeEngagementSurvey, closedSurveyDisclosure, createEngagementSurveyWithAudit,
  isOpenSurveyConflict,
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
    const auditRows = () => db.select({
      action: auditEvents.action,
      actor: auditEvents.actor,
      resource: auditEvents.resource,
      metadata: auditEvents.metadata,
    }).from(auditEvents).where(eq(auditEvents.organizationId, organizationId))
      .orderBy(auditEvents.id);
    assert.deepEqual((await auditRows()).map(row => row.action), ["Engagement survey opened"]);

    await assert.rejects(
      createEngagementSurveyWithAudit({
        organizationId, question, createdByUserId: null, actor: "HR maker",
      }),
      (error: unknown) => isOpenSurveyConflict(error),
      "Actual PostgreSQL duplicate-open constraint must be classified precisely",
    );
    assert.equal((await auditRows()).length, 1,
      "Rejected duplicate opens must not leave phantom audit receipts");

    await assert.rejects(closeEngagementSurvey(organizationId, survey.id, {
      actor: invalidActor, actorUserId: null,
    }));
    const [stillOpen] = await db.select({ status: engagementSurveys.status })
      .from(engagementSurveys).where(eq(engagementSurveys.id, survey.id));
    assert.equal(stillOpen.status, "open", "A failed close-audit must not close the survey");
    assert.equal((await auditRows()).length, 1, "No false close audit can survive rollback");
    assert.equal(await closeEngagementSurvey(organizationId + 1, survey.id, {
      actor: "Other tenant", actorUserId: null,
    }), false, "Cross-tenant close must not change another organization's survey");
    const closes = await Promise.all([
      closeEngagementSurvey(organizationId, survey.id, {
        actor: "HR checker", actorUserId: null,
      }),
      closeEngagementSurvey(organizationId, survey.id, {
        actor: "HR checker", actorUserId: null,
      }),
    ]);
    assert.equal(closes.filter(Boolean).length, 1,
      "Concurrent close requests must commit exactly one transition");
    assert.equal(await closeEngagementSurvey(organizationId, survey.id, {
      actor: "HR checker", actorUserId: null,
    }), false, "Repeated closure must remain idempotent");
    const [closed] = await db.select({ status: engagementSurveys.status })
      .from(engagementSurveys).where(eq(engagementSurveys.id, survey.id));
    assert.equal(closed.status, "closed");
    const receipts = await auditRows();
    assert.deepEqual(receipts.map(row => row.action), [
      "Engagement survey opened", "Engagement survey closed",
    ]);
    assert.deepEqual(receipts.map(row => row.resource), [
      "engagement_survey", "engagement_survey",
    ]);
    assert.deepEqual(receipts.map(row => row.metadata), [
      { surveyId: survey.id, actorUserId: null },
      { surveyId: survey.id, actorUserId: null },
    ]);
    assert.equal(receipts[1].actor, "HR checker");

    const legacy = await createEngagementSurveyWithAudit({
      organizationId, question, createdByUserId: null, actor: "Legacy fixture",
    });
    assert.equal(await closeEngagementSurvey(organizationId, legacy.id), true,
      "Existing service-only callers remain compatible");
    const legacyReceipts = await auditRows();
    assert.equal(legacyReceipts.length, 4);
    assert.deepEqual(legacyReceipts.slice(2).map(row => row.action), [
      "Engagement survey opened", "Engagement survey closed",
    ]);
    assert.equal(legacyReceipts[3].actor, "Unattributed legacy service caller",
      "No close may succeed without an audit receipt, even with no actor context");
    assert.deepEqual(legacyReceipts[3].metadata,
      { surveyId: legacy.id, actorUserId: null });
  } finally {
    await db.delete(organizations).where(eq(organizations.id, organizationId));
  }
});

test("only the specific open-survey uniqueness violation is an expected conflict", () => {
  const openSurvey = { code: "23505", constraint: "engagement_surveys_one_open_per_org" };
  assert.equal(isOpenSurveyConflict(openSurvey), true);
  assert.equal(isOpenSurveyConflict({ cause: { cause: openSurvey } }), true,
    "Drizzle-wrapped Postgres uniqueness errors must preserve the intended conflict");
  for (const unrelated of [
    { code: "23505", constraint: "engagement_survey_participants_one_per_worker" },
    { code: "23505", constraint: "audit_events_pkey" },
    { code: "23505" },
    { code: "23503", constraint: "engagement_surveys_one_open_per_org" },
    { cause: { code: "23505", constraint: "another_table_pkey" } },
    { cause: null },
    "23505",
    null,
  ]) {
    assert.equal(isOpenSurveyConflict(unrelated), false,
      "Unrelated/unspecified database errors must not be disguised as duplicate surveys");
  }
  const cyclic: { cause?: unknown } = {};
  cyclic.cause = cyclic;
  assert.equal(isOpenSurveyConflict(cyclic), false, "Circular causes must fail closed");
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
