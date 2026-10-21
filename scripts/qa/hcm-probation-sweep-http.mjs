/**
 * Fail-closed HCM probation GET/POST/PATCH proof:
 * real signed-in fictional owners, distinct real employers and employees,
 * actual PostgreSQL rows, no production, no government filings or payments.
 * A denied victim read or write cannot be called a positive test.
 */
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "../../src/db";
import { employees as employeeTable, hcmEmploymentTerms, hcmProbationReviews } from "../../src/db/schema";

export async function verifyHcmProbationSweep(f, { request, expectStatus }) {
  if (process.env.CI !== "true" ||
      process.env.TENANT_SECOND_PASS_MODE !== "isolated-ci-only") {
    throw Error("HCM probation tenant proof requires disposable CI.");
  }
  // Dedicated synthetic employees avoid changing existing workforce control fixtures
  // and ensure no prior HCM test has an active term for these workers.
  const employees = [];
  const terms = [];
  for (const idx of [0, 1, 2]) {
    const [worker] = await db.insert(employeeTable).values({
      organizationId: f.orgs[idx].id,
      legalEntityId: f.entities[idx].id,
      orgUnitId: f.ownedUnits[idx].id,
      employeeNo: "QA-PROBATION-" + f.orgs[idx].id,
      firstName: "FictionalProbation", lastName: "Employee" + idx,
      title: "Synthetic HCM probation subject", avatarInitials: "FP",
      basicRate: "20000.00", startDate: "2026-08-01",
    }).returning();
    employees.push(worker);
    const [term] = await db.insert(hcmEmploymentTerms).values({
      organizationId: f.orgs[idx].id,
      employeeId: employees[idx].id,
      employmentType: "probationary",
      termKind: "probationary",
      effectiveFrom: "2026-08-01",
      probationReviewDate: "2026-10-01",
      status: "active",
      reason: "Fictional probation review tenant-isolation proof",
      requestedBy: "Synthetic CI",
    }).returning();
    terms.push(term);
  }
  // A real victim-only review is mandatory; guessing an absent ID is not proof.
  const victimCreated = expectStatus(await request("/api/hcm/probation-reviews", {
    method: "POST", cookie: f.ownerSessions[0].cookie,
    body: { organizationId: f.orgs[0].id, employeeId: employees[0].id,
      employmentTermId: terms[0].id, summary: "Fictional victim-only probation assessment" },
  }), 201, "Victim must create own real probation review");
  const victimReviewId = victimCreated.json?.review?.id;
  assert.ok(victimReviewId > 0, "Existing victim review ID must be real");
  const victimBefore = await db.select().from(hcmProbationReviews)
    .where(eq(hcmProbationReviews.organizationId, f.orgs[0].id));

  for (const idx of [1, 2]) {
    const own = f.orgs[idx];
    const victim = f.orgs[0];
    const cookie = f.ownerSessions[idx].cookie;
    const ownPost = expectStatus(await request("/api/hcm/probation-reviews", {
      method: "POST", cookie,
      body: { organizationId: own.id, employeeId: employees[idx].id,
        employmentTermId: terms[idx].id, summary: "Fictional owned probation assessment" },
    }), 201, "Own employer probation review POST must succeed");
    assert.equal(ownPost.json?.review?.organizationId, own.id);
    const ownReviewId = ownPost.json?.review?.id;
    assert.ok(ownReviewId > 0 && ownReviewId !== victimReviewId);
    const ownRead = expectStatus(await request(
      "/api/hcm/probation-reviews?organizationId=" + own.id +
      "&employeeId=" + employees[idx].id + "&employmentTermId=" + terms[idx].id,
      { cookie }), 200, "Own employer probation review GET must return actual review");
    assert.equal(ownRead.json?.organizationId, own.id);
    assert.equal(ownRead.json?.review?.id, ownReviewId);
    assert.equal(ownRead.json?.employee?.id, employees[idx].id);
    assert.ok(ownRead.json?.events?.length > 0,
      "Positive GET must contain real persisted review events");
    expectStatus(await request(
      "/api/hcm/probation-reviews?organizationId=" + victim.id +
      "&employeeId=" + employees[0].id + "&employmentTermId=" + terms[0].id,
      { cookie }), 403, "Foreign victim probation GET denied");
    const ownPatch = expectStatus(await request("/api/hcm/probation-reviews", {
      method: "PATCH", cookie,
      body: { organizationId: own.id, id: ownReviewId, action: "save",
        summary: "Synthetic authorized review update, still draft" },
    }), 200, "Own employer probation PATCH must persist change");
    assert.equal(ownPatch.json?.review?.id, ownReviewId);
    assert.equal(ownPatch.json?.review?.organizationId, own.id);
    expectStatus(await request("/api/hcm/probation-reviews", {
      method: "POST", cookie,
      body: { organizationId: victim.id, employeeId: employees[0].id,
        employmentTermId: terms[0].id, summary: "Unauthorized victim write" },
    }), 403, "Foreign victim probation POST denied");
    expectStatus(await request("/api/hcm/probation-reviews", {
      method: "PATCH", cookie,
      body: { organizationId: victim.id, id: victimReviewId, action: "save",
        summary: "Unauthorized victim rewrite attempt" },
    }), 403, "Foreign victim probation PATCH denied");
  }
  const victimAfter = await db.select().from(hcmProbationReviews)
    .where(eq(hcmProbationReviews.organizationId, f.orgs[0].id));
  assert.deepEqual(victimAfter, victimBefore,
    "Real denied foreign POST/PATCH must leave victim probation unchanged");
}
