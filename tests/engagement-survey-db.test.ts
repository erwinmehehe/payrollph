import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  employees, engagementSurveys, engagementSurveyParticipants, organizations,
} from "../src/db/schema";
import {
  submitAnonymousSurveyRating, closeEngagementSurvey,
  closedSurveyDisclosure, listSurveysForTenant,
} from "../src/lib/engagement-survey";

test("survey stores aggregate ratings, enforces 5-person privacy floor, one reply, tenant isolation and close lock", async () => {
  const code = randomUUID().slice(0, 9);
  const ids: number[] = [];
  try {
    const [a, b] = await db.insert(organizations).values([
      { name: "Survey A "+code, legalName: "Survey A "+code },
      { name: "Survey B "+code, legalName: "Survey B "+code },
    ]).returning({ id: organizations.id });
    ids.push(a.id, b.id);
    const [survey] = await db.insert(engagementSurveys).values({
      organizationId: a.id, question: "How would you rate your experience?",
    }).returning();
    const members = await db.insert(employees).values(
      Array.from({ length: 6 }, (_, i) => ({
        organizationId: a.id, employeeNo: `SUR-A-${code}-${i}`,
        firstName: "Survey", lastName: `Participant${i}`,
        title: "Worker", avatarInitials: "SP",
        basicRate: "10000.00", startDate: "2026-01-01",
      })),
    ).returning({ id: employees.id });
    const [foreign] = await db.insert(employees).values({
      organizationId: b.id, employeeNo: "SUR-B-"+code,
      firstName: "Foreign", lastName: "Participant", title: "Worker",
      avatarInitials: "FP", basicRate: "30000.00", startDate: "2026-01-01",
    }).returning({ id: employees.id });
    const inputs = members.slice(0, 5).map((member, index) => ({
      organizationId: a.id, surveyId: survey.id,
      employeeId: member.id, score: index + 1,
    }));
    for (const input of inputs.slice(0, 4)) {
      assert.equal((await submitAnonymousSurveyRating(input)).accepted, true);
    }
    const [{ responseCount: four, scoreSum: fourSum }] =
      await db.select().from(engagementSurveys).where(eq(engagementSurveys.id, survey.id));
    assert.equal(four, 4);
    assert.equal(fourSum, 10);
    assert.equal(closedSurveyDisclosure({
      question: survey.question, status: "open", responseCount: four, scoreSum: fourSum,
    }).disclosure, "suppressed");

    assert.deepEqual(await submitAnonymousSurveyRating({
      organizationId: a.id, surveyId: survey.id,
      employeeId: foreign.id, score: 4,
    }), { accepted: false, reason: "unavailable" });
    const [first, replay] = await Promise.all([
      submitAnonymousSurveyRating(inputs[4]),
      submitAnonymousSurveyRating(inputs[4]),
    ]);
    assert.equal([first.accepted, replay.accepted].filter(Boolean).length, 1);

    const participants = await db.select().from(engagementSurveyParticipants)
      .where(eq(engagementSurveyParticipants.surveyId, survey.id));
    assert.equal(participants.length, 5);
    assert.ok(participants.every(row => typeof row.employeeId === "number"));
    assert.equal(participants.some(row => "score" in row), false,
      "No individual response is persisted with an identity");

    assert.equal(await closeEngagementSurvey(a.id, survey.id), true);
    assert.equal(await closeEngagementSurvey(a.id, survey.id), false);
    assert.deepEqual(await submitAnonymousSurveyRating({
      organizationId: a.id, surveyId: survey.id, employeeId: members[5].id, score: 5,
    }), { accepted: false, reason: "unavailable" });

    const own = await listSurveysForTenant(a.id);
    const other = await listSurveysForTenant(b.id);
    assert.equal(other.length, 0);
    assert.equal(own.length, 1);
    assert.deepEqual(closedSurveyDisclosure(own[0]), {
      question: survey.question, status: "closed", disclosure: "available",
      responses: 5, average: 3,
    });
    assert.equal(closedSurveyDisclosure({
      question: "Private", status: "closed", responseCount: 4, scoreSum: 20,
    }).disclosure, "suppressed");
  } finally {
    for (const id of ids) await db.delete(organizations).where(eq(organizations.id, id));
  }
});
