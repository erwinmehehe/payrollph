/**
 * TABLE-DRIVEN TENANT ISOLATION PROOF for employer-scoped WRITES (POST/PATCH/PUT/DELETE) whose employer
 * comes from the session plus either a body/query `organizationId` or the id of the row being changed.
 * One row per method; every row runs for TWO independent attacker employers against a higher-ID victim:
 *   1. the own-employer write succeeds with the exact status AND the own employer's rows change in the
 *      way the row's `expect` describes (read back from PostgreSQL, never trusted from the response);
 *   2. the same session naming the victim employer (its organizationId, or the id of a victim row) is
 *      denied with the exact status;
 *   3. an optional forged-reference request (own employer, victim row/employee id) is refused and writes
 *      nothing;
 *   4. the victim's rows (row-specific state, organizations/employees/units/entities and audit) are
 *      byte-identical afterwards, and no victim marker appears in any response;
 *   5. `expect` must reject the other attacker's genuine before/after, so a proof cannot pass on data
 *      that is not its own employer's.
 * Fixture-only, fictional PostgreSQL rows on the disposable 127.0.0.1 app_db; production-mode localhost
 * HTTP. No provider, payout, filing or production system is contacted.
 *
 * Standalone: TENANT_SECOND_PASS_MODE=isolated-ci-only CI=true node --import tsx scripts/qa/tenant-write-table-http.mjs
 * Developer aid: TENANT_TABLE_TRY=1 reports every failing row (never credits).
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "../../src/db";
import {
  approvalDelegations, benefitEnrollments, benefitPlans, dataRequests, disciplinaryCases, earnedWageRequests, engagementSurveys, hcmEmploymentTermDecisions,
  hcmEmploymentTerms, hcmLifecyclePolicies, hcmLifecyclePolicyEvents, hcmSkills, performanceSkillDevelopmentPlans, sessions,
  workerEffectiveChanges,
} from "../../src/db/schema";
import { organizationModuleSettings } from "../../src/lib/tenant-module-storage";
import {
  addWorker, requireTenantTableDisposable, seedEmployer, standaloneExpectStatus,
  standaloneMakeSession, standaloneRequest, victimSnapshot,
} from "./tenant-table-http.mjs";
import { seedTableRow } from "./tenant-table-invariants.mjs";
/** Plain-JSON copy of rows so dates and decimals compare by value. */
const plain = (rows) => JSON.parse(JSON.stringify(rows));

/**
 * Rows. `key` is exactly "<METHOD> <manifest route>".
 *  - flags: server env flags that must be "true" in the job running this row.
 *  - seed(employer): fictional rows each employer (victim included) starts with; its return value is ctx.seeded.
 *  - state(orgId): the target rows of one employer as plain JSON (read from PostgreSQL).
 *  - ownBody(ctx) / foreignBody(ctx): what the attacker sends for its own employer / naming the victim (a row
 *    with no body, e.g. DELETE, omits them and uses query(ctx, "own" | "foreign" | "forged") instead).
 *  - expect(before, after, ctx, response): assertions on the own employer's state change.
 *  - forged: optional { body(ctx), status } naming a victim row while claiming the own employer.
 */
export const TENANT_WRITE_TABLE = Object.freeze([
  { key: "POST discipline", status: 201,
    state: (orgId) => db.select().from(disciplinaryCases).where(eq(disciplinaryCases.organizationId, orgId)).orderBy(asc(disciplinaryCases.id)),
    ownBody: (c) => ({ organizationId: c.orgId, employeeId: c.workerId, offense: c.marker, incidentDate: "2026-02-02", nteDetails: "Fictional notice " + c.marker }),
    foreignBody: (c) => ({ organizationId: c.victim.org.id, employeeId: c.workerId, offense: c.marker, incidentDate: "2026-02-02", nteDetails: "Fictional notice " + c.marker }),
    forged: { status: 404, body: (c) => ({ organizationId: c.orgId, employeeId: c.victim.worker.id, offense: c.marker, incidentDate: "2026-02-02", nteDetails: "Fictional notice " + c.marker }) },
    expect: (before, after, c) => {
      assert.equal(after.length, before.length + 1, "exactly one case is created");
      const row = after.find((r) => r.offense === c.marker);
      assert.ok(row, "the created case carries the own marker");
      assert.equal(row.organizationId, c.orgId);
      assert.equal(row.employeeId, c.workerId);
      assert.equal(row.status, "nte_issued");
    } },
  { key: "PATCH delegations",
    seed: async (e) => (await db.insert(approvalDelegations).values({ organizationId: e.org.id, fromApprover: e.marker, toApprover: e.marker + "-TO",
      startsOn: "2026-01-01", endsOn: "2026-12-31" }).returning())[0],
    state: (orgId) => db.select().from(approvalDelegations).where(eq(approvalDelegations.organizationId, orgId)).orderBy(asc(approvalDelegations.id)),
    ownBody: (c) => ({ id: c.seeded.id, active: false }),
    foreignBody: (c) => ({ id: c.victimSeeded.id, active: false }),
    expect: (before, after, c) => {
      const row = after.find((r) => r.id === c.seeded.id);
      assert.ok(row, "the own delegation is still the own employer's");
      assert.equal(row.organizationId, c.orgId);
      assert.equal(row.fromApprover, c.marker);
      assert.equal(row.active, false, "the own delegation is revoked");
    } },
  { key: "PATCH tenant-modules", flags: ["CORE_MODULE_NAVIGATION_ENABLED"],
    // A distinct module list per employer; the write must add exactly "spend" to the own list.
    seed: async (e) => {
      const modules = { ATTA: ["workforce"], ATTB: ["workforce", "planning"], VICTIM: ["it", "automation"] }[e.label];
      await db.update(organizationModuleSettings).set({ enabledModules: modules }).where(eq(organizationModuleSettings.id, e.org.id));
      return modules;
    },
    state: (orgId) => db.select({ id: organizationModuleSettings.id, enabledModules: organizationModuleSettings.enabledModules })
      .from(organizationModuleSettings).where(eq(organizationModuleSettings.id, orgId)),
    ownBody: (c) => ({ organizationId: c.orgId, moduleId: "spend", enabled: true }),
    foreignBody: (c) => ({ organizationId: c.victim.org.id, moduleId: "spend", enabled: true }),
    expect: (before, after, c) => {
      assert.deepEqual([...after[0].enabledModules].sort(), [...c.seeded, "spend"].sort(), "the own module list gains exactly spend");
    } },
  { key: "POST compliance/data-requests", status: 201,
    state: (orgId) => db.select().from(dataRequests).where(eq(dataRequests.organizationId, orgId)).orderBy(asc(dataRequests.id)),
    ownBody: (c) => ({ organizationId: c.orgId, subjectEmail: c.marker + "@example.invalid", requestType: "access" }),
    foreignBody: (c) => ({ organizationId: c.victim.org.id, subjectEmail: c.marker + "@example.invalid", requestType: "access" }),
    expect: (before, after, c) => {
      assert.equal(after.length, before.length + 1, "exactly one data-subject request is created");
      const row = after.find((r) => r.subjectEmail === (c.marker + "@example.invalid").toLowerCase());
      assert.ok(row, "the created request carries the own marker");
      assert.equal(row.organizationId, c.orgId);
    } },
  { key: "PATCH earned-wage",
    seed: async (e) => (await db.insert(earnedWageRequests).values({ organizationId: e.org.id, employeeId: e.worker.id, requestedAmount: "100.00" }).returning())[0],
    state: (orgId) => db.select().from(earnedWageRequests).where(eq(earnedWageRequests.organizationId, orgId)).orderBy(asc(earnedWageRequests.id)),
    ownBody: (c) => ({ id: c.seeded.id, status: "approved" }),
    foreignBody: (c) => ({ id: c.victimSeeded.id, status: "approved" }),
    expect: (before, after, c) => {
      const row = after.find((r) => r.id === c.seeded.id);
      assert.ok(row, "the own request is still the own employer's");
      assert.equal(row.organizationId, c.orgId);
      assert.equal(row.employeeId, c.workerId);
      assert.equal(row.status, "approved");
    } },
  { key: "POST hcm/engagement-surveys", status: 201, flags: ["ENGAGEMENT_SURVEY_ENABLED"],
    state: (orgId) => db.select().from(engagementSurveys).where(eq(engagementSurveys.organizationId, orgId)).orderBy(asc(engagementSurveys.id)),
    ownBody: (c) => ({ organizationId: c.orgId, action: "create", question: "Fictional pulse question " + c.marker }),
    foreignBody: (c) => ({ organizationId: c.victim.org.id, action: "create", question: "Fictional pulse question " + c.marker }),
    expect: (before, after, c) => {
      assert.equal(after.length, before.length + 1, "exactly one survey is created");
      const row = after.find((r) => r.question === "Fictional pulse question " + c.marker);
      assert.ok(row, "the created survey carries the own marker");
      assert.equal(row.organizationId, c.orgId);
      assert.equal(row.status, "open");
    } },
  { key: "PATCH hcm/employment-terms",
    seed: async (e) => (await db.insert(hcmEmploymentTerms).values({ organizationId: e.org.id, employeeId: (await addWorker(e, "TRM")).id,
      employmentType: "regular", termKind: "regular", effectiveFrom: "2026-01-05", reason: e.marker, requestedBy: e.marker }).returning())[0],
    state: (orgId) => db.select().from(hcmEmploymentTerms).where(eq(hcmEmploymentTerms.organizationId, orgId)).orderBy(asc(hcmEmploymentTerms.id)),
    ownBody: (c) => ({ id: c.seeded.id, organizationId: c.orgId, action: "cancel" }),
    foreignBody: (c) => ({ id: c.victimSeeded.id, organizationId: c.victim.org.id, action: "cancel" }),
    forged: { status: 404, body: (c) => ({ id: c.victimSeeded.id, organizationId: c.orgId, action: "cancel" }) },
    expect: (before, after, c) => {
      const row = after.find((r) => r.id === c.seeded.id);
      assert.ok(row && row.reason === c.marker, "the own term is still the own employer's");
      assert.equal(row.organizationId, c.orgId);
      assert.equal(row.status, "cancelled");
    } },
  { key: "PATCH hcm/employment-term-decisions",
    seed: async (e) => {
      const worker = await addWorker(e, "DEC");
      const [term] = await db.insert(hcmEmploymentTerms).values({ organizationId: e.org.id, employeeId: worker.id, employmentType: "probationary",
        termKind: "probationary", effectiveFrom: "2026-01-05", reason: e.marker + " term", requestedBy: e.marker }).returning();
      return (await db.insert(hcmEmploymentTermDecisions).values({ organizationId: e.org.id, employeeId: worker.id, employmentTermId: term.id,
        decisionKind: "continue_current", effectiveDate: "2026-07-05", reason: e.marker, requestedBy: e.marker }).returning())[0];
    },
    state: (orgId) => db.select().from(hcmEmploymentTermDecisions).where(eq(hcmEmploymentTermDecisions.organizationId, orgId)).orderBy(asc(hcmEmploymentTermDecisions.id)),
    ownBody: (c) => ({ id: c.seeded.id, organizationId: c.orgId, action: "cancel" }),
    foreignBody: (c) => ({ id: c.victimSeeded.id, organizationId: c.victim.org.id, action: "cancel" }),
    forged: { status: 404, body: (c) => ({ id: c.victimSeeded.id, organizationId: c.orgId, action: "cancel" }) },
    expect: (before, after, c) => {
      const row = after.find((r) => r.id === c.seeded.id);
      assert.ok(row && row.reason === c.marker, "the own decision is still the own employer's");
      assert.equal(row.organizationId, c.orgId);
      assert.equal(row.status, "cancelled");
    } },
  { key: "PATCH hcm/effective-changes",
    deny: 404, // a victim row is reported as not found, never confirmed
    seed: async (e) => (await db.insert(workerEffectiveChanges).values({ organizationId: e.org.id, employeeId: (await addWorker(e, "EFF")).id,
      effectiveDate: "2026-06-01", reason: e.marker, requestedBy: e.marker }).returning())[0],
    state: (orgId) => db.select().from(workerEffectiveChanges).where(eq(workerEffectiveChanges.organizationId, orgId)).orderBy(asc(workerEffectiveChanges.id)),
    ownBody: (c) => ({ id: c.seeded.id, organizationId: c.orgId, action: "cancel" }),
    foreignBody: (c) => ({ id: c.victimSeeded.id, organizationId: c.victim.org.id, action: "cancel" }),
    expect: (before, after, c) => {
      const row = after.find((r) => r.id === c.seeded.id);
      assert.ok(row && row.reason === c.marker, "the own change is still the own employer's");
      assert.equal(row.organizationId, c.orgId);
      assert.equal(row.status, "cancelled");
    } },
  { key: "POST benefits", status: 201,
    seed: async (e) => (await db.insert(benefitPlans).values({ organizationId: e.org.id, name: e.marker + " plan", category: "voluntary" }).returning())[0],
    state: (orgId) => db.select().from(benefitEnrollments).where(eq(benefitEnrollments.organizationId, orgId)).orderBy(asc(benefitEnrollments.id)),
    ownBody: (c) => ({ organizationId: c.orgId, employeeId: c.workerId, planId: c.seeded.id, monthlyContribution: 100, startedOn: "2026-03-02" }),
    foreignBody: (c) => ({ organizationId: c.victim.org.id, employeeId: c.workerId, planId: c.seeded.id, monthlyContribution: 100, startedOn: "2026-03-02" }),
    expect: (before, after, c) => {
      assert.equal(after.length, before.length + 1, "exactly one enrolment is created");
      const row = after.find((r) => r.employeeId === c.workerId && r.planId === c.seeded.id);
      assert.ok(row, "the created enrolment links the own worker to the own plan");
      assert.equal(row.organizationId, c.orgId);
    } },
  { key: "DELETE benefits",
    seed: async (e) => {
      const [plan] = await db.insert(benefitPlans).values({ organizationId: e.org.id, name: e.marker + " end plan", category: "voluntary" }).returning();
      return (await db.insert(benefitEnrollments).values({ organizationId: e.org.id, employeeId: e.worker.id, planId: plan.id, startedOn: "2026-01-05" }).returning())[0];
    },
    state: (orgId) => db.select().from(benefitEnrollments).where(eq(benefitEnrollments.organizationId, orgId)).orderBy(asc(benefitEnrollments.id)),
    query: (c, target) => "id=" + (target === "own" ? c.seeded.id : c.victimSeeded.id),
    expect: (before, after, c) => {
      const row = after.find((r) => r.id === c.seeded.id);
      assert.ok(row, "the own enrolment is still the own employer's");
      assert.equal(row.organizationId, c.orgId);
      assert.equal(row.employeeId, c.workerId);
      assert.equal(row.status, "ended");
    } },
  { key: "PATCH hcm/lifecycle-policy",
    // A distinct action window per employer: the saved window must be exactly the own request's.
    state: async (orgId) => ({
      policies: await db.select().from(hcmLifecyclePolicies).where(eq(hcmLifecyclePolicies.organizationId, orgId)).orderBy(asc(hcmLifecyclePolicies.id)),
      events: await db.select().from(hcmLifecyclePolicyEvents).where(eq(hcmLifecyclePolicyEvents.organizationId, orgId)).orderBy(asc(hcmLifecyclePolicyEvents.id)),
    }),
    ownBody: (c) => ({ organizationId: c.orgId, expectedVersion: 0, actionWindowDays: 40 + c.rank, reminderDays: [14, 7, 1, 0], overdueEscalationDays: [1, 5],
      requireManagerReviewForProbation: false, requireDecisionRationaleNote: false, requireNonRenewalAttachment: false }),
    foreignBody: (c) => ({ organizationId: c.victim.org.id, expectedVersion: 0, actionWindowDays: 40 + c.rank, reminderDays: [14, 7, 1, 0], overdueEscalationDays: [1, 5],
      requireManagerReviewForProbation: false, requireDecisionRationaleNote: false, requireNonRenewalAttachment: false }),
    expect: (before, after, c) => {
      assert.equal(after.policies.length, 1, "the own employer gains exactly one policy row");
      assert.equal(after.policies[0].organizationId, c.orgId);
      assert.equal(after.policies[0].actionWindowDays, 40 + c.rank, "the saved window is the own request's");
      assert.equal(after.events.length, before.events.length + 1, "one audit-style policy event is recorded");
    } },
  { key: "PATCH performance/development-plans",
    seed: async (e) => {
      const [skill] = await db.insert(hcmSkills).values({ organizationId: e.org.id, code: e.marker + "-DP", name: e.marker }).returning();
      return (await db.insert(performanceSkillDevelopmentPlans).values({ organizationId: e.org.id, employeeId: e.worker.id, skillId: skill.id,
        title: e.marker, objective: "Fictional objective " + e.marker, targetProficiency: "4.00", targetDate: "2026-12-31", createdByName: e.marker }).returning())[0];
    },
    state: (orgId) => db.select().from(performanceSkillDevelopmentPlans).where(eq(performanceSkillDevelopmentPlans.organizationId, orgId)).orderBy(asc(performanceSkillDevelopmentPlans.id)),
    ownBody: (c) => ({ organizationId: c.orgId, entityType: "plan", id: c.seeded.id, status: "in_progress" }),
    foreignBody: (c) => ({ organizationId: c.victim.org.id, entityType: "plan", id: c.victimSeeded.id, status: "in_progress" }),
    forged: { status: 404, body: (c) => ({ organizationId: c.orgId, entityType: "plan", id: c.victimSeeded.id, status: "in_progress" }) },
    expect: (before, after, c) => {
      const row = after.find((r) => r.id === c.seeded.id);
      assert.ok(row && row.title === c.marker, "the own plan is still the own employer's");
      assert.equal(row.organizationId, c.orgId);
      assert.equal(row.status, "in_progress");
    } },
]);

export async function verifyTenantWriteTable(_f, {
  request = standaloneRequest, expectStatus = standaloneExpectStatus, makeSession = standaloneMakeSession,
} = {}) {
  requireTenantTableDisposable();
  const profile = process.env.TENANT_TABLE_PROFILE ?? "default";
  const rows = TENANT_WRITE_TABLE.filter((row) => (row.profile ?? "default") === profile);
  if (rows.length === 0 && process.env.TENANT_WRITE_TABLE_ALLOW_EMPTY_PROFILE === "1") {
    // The shared workflow runs this step in every profile job; a profile with no write rows says so and proves nothing.
    console.log(JSON.stringify({ kind: "tenant-write-table-skip", profile, rows: 0, credited: 0 }));
    return { rows: 0, pairs: 0 };
  }
  assert.ok(rows.length > 0, "tenant write table profile " + profile + " has no rows; an empty job proves nothing");
  const tryMode = process.env.TENANT_TABLE_TRY === "1";
  const tryFailures = [];
  const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
  // Attackers first, victim last: every victim ID is larger than any attacker-owned ID.
  const employers = [null];
  for (const label of ["ATTA", "ATTB"]) employers.push(await seedEmployer(label, nonce, makeSession));
  const victim = employers[0] = await seedEmployer("VICTIM", nonce, makeSession);
  for (const field of ["org", "worker", "unit", "entity"]) {
    assert.ok(Number.isSafeInteger(victim[field].id) && victim[field].id > employers[1][field].id && victim[field].id > employers[2][field].id,
      "Victim-only " + field + " ID must really exist and exceed both attackers' IDs");
  }
  const seedFailures = new Map();
  for (const item of rows) {
    if (!item.seed) continue;
    try {
      await seedTableRow(item, employers);
    } catch (error) {
      if (!tryMode) throw error;
      seedFailures.set(item.key, String(error.cause?.message ?? error.message).split("\n")[0].slice(0, 200));
    }
  }
  const victimBefore = await victimSnapshot(victim.org.id);
  const victimStatesBefore = new Map();
  for (const item of rows) {
    if (!seedFailures.has(item.key)) victimStatesBefore.set(item.key, plain(await item.state(victim.org.id)));
  }
  const passed = new Set();
  const firstAttacker = new Map();
  let discriminatingProofs = 0;
  let forgedProofs = 0;

  for (const idx of [1, 2]) {
    const own = employers[idx];
    const base = { org: own.org, entity: own.entity, unit: own.unit, worker: own.worker, owner: own.owner, marker: own.marker,
      orgId: own.org.id, workerId: own.worker.id, unitId: own.unit.id, entityId: own.entity.id, rank: own.rank, victim };
    for (const item of rows) {
      const ctx = { ...base, seeded: own.seeded[item.key], victimSeeded: victim.seeded[item.key] };
      const [method, route] = item.key.split(" ");
      assert.ok(["POST", "PATCH", "PUT", "DELETE"].includes(method), item.key + ": the write table proves mutating methods only");
      for (const flag of item.flags ?? []) assert.equal(process.env[flag], "true", item.key + ": server flag " + flag + " must be on in this job");
      for (const field of ["state", "expect"]) assert.equal(typeof item[field], "function", item.key + ": a write row needs " + field + " to be credited");
      assert.ok((item.ownBody && item.foreignBody) || (item.query && method === "DELETE"), item.key + ": a write row needs own and foreign requests");
      const urlFor = (target) => "/api/" + route + (item.query ? "?" + item.query(ctx, target) : "");
      try {
        if (seedFailures.has(item.key)) throw new Error("seed failed: " + seedFailures.get(item.key));
        const ownBefore = plain(await item.state(own.org.id));
        const owned = expectStatus(await request(urlFor("own"), { method, cookie: own.cookie, body: item.ownBody?.(ctx) }), item.status ?? 200, item.key + " own employer write");
        const ownAfter = plain(await item.state(own.org.id));
        assert.notDeepEqual(ownAfter, ownBefore, item.key + ": the own write must change the own employer's rows");
        await item.expect(ownBefore, ownAfter, ctx, owned);
        // The proof must tell employers apart: the first attacker's genuine before/after fails the second's expectations.
        if (idx === 1) firstAttacker.set(item.key, { ownBefore, ownAfter, owned });
        else {
          const first = firstAttacker.get(item.key);
          await assert.rejects(async () => item.expect(first.ownBefore, first.ownAfter, ctx, first.owned),
            item.key + ": expect accepts another employer's data");
          discriminatingProofs++;
        }
        assert.ok(!owned.text.includes(victim.marker), item.key + ": own response leaked a victim marker");
        const foreign = expectStatus(await request(urlFor("foreign"), { method, cookie: own.cookie, body: item.foreignBody?.(ctx) }), item.deny ?? 403, item.key + " victim employer");
        assert.ok(!foreign.text.includes(victim.marker), item.key + ": denial leaked a victim marker");
        assert.deepEqual(plain(await item.state(own.org.id)), ownAfter, item.key + ": a denied victim write must not change the own employer either");
        if (item.forged) {
          const refused = expectStatus(await request(urlFor("forged"), { method, cookie: own.cookie, body: item.forged.body?.(ctx) }), item.forged.status, item.key + " forged victim reference");
          assert.ok(!refused.text.includes(victim.marker), item.key + ": forged refusal leaked a victim marker");
          assert.deepEqual(plain(await item.state(own.org.id)), ownAfter, item.key + ": a forged victim reference must write nothing");
          forgedProofs++;
        }
        passed.add(item.key + "#" + idx);
      } catch (error) {
        if (!tryMode) throw error;
        tryFailures.push(item.key + " (attacker " + idx + "): " + String(error.message ?? error).split("\n")[0].slice(0, 230));
      }
    }
  }

  if (tryMode) {
    const failedKeys = new Set(tryFailures.map((line) => line.split(" (attacker")[0]));
    console.log(JSON.stringify({ kind: "tenant-write-table-try", profile, credited: 0, rows: rows.length,
      passingRows: rows.filter((row) => !failedKeys.has(row.key)).map((row) => row.key), failures: tryFailures }, null, 1));
    return { tried: rows.length };
  }
  const victimAfter = await victimSnapshot(victim.org.id);
  assert.deepEqual(victimAfter, victimBefore, "denied writes leave the victim employer's rows and audit trail unchanged");
  for (const item of rows) {
    assert.deepEqual(plain(await item.state(victim.org.id)), victimStatesBefore.get(item.key), item.key + ": the victim's target rows are unchanged");
  }
  assert.equal(passed.size, rows.length * 2, "every row passed for both independent attacker employers");
  assert.equal(discriminatingProofs, rows.length, "every row's expect rejected the other attacker's genuine before/after");
  await db.delete(sessions).where(inArray(sessions.userId, employers.map((e) => e.owner.id)));
  console.log(JSON.stringify({ kind: "tenant-write-table-proof", profile, rows: rows.length, ownAndForeignPairs: passed.size,
    discriminatingProofs, forgedReferenceProofs: forgedProofs, victimDatabaseUnchanged: true, productionTested: false, certified: false }));
  return { rows: rows.length, pairs: passed.size };
}

if (process.argv[1] && process.argv[1].replaceAll("\\", "/").endsWith("scripts/qa/tenant-write-table-http.mjs")) {
  verifyTenantWriteTable(null).then(() => process.exit(0), (error) => { console.error(error); process.exit(1); });
}

