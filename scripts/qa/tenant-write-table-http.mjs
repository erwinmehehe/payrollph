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
import { loadTenantRows } from "./tenant-table-loader.mjs";
import { randomUUID } from "node:crypto";
import { asc, eq, inArray } from "drizzle-orm";
import { db, pool } from "../../src/db";
import {
  approvalDelegations, benefitEnrollments, benefitPlans, dataRequests, disciplinaryCases, earnedWageRequests, engagementSurveys, hcmEmploymentTermDecisions,
  hcmEmploymentTerms, hcmLifecyclePolicies, hcmLifecyclePolicyEvents, hcmSkills, performanceSkillDevelopmentPlans, sessions,
  workerEffectiveChanges, performanceOneOnOnes, performanceOneOnOneActionItems, performanceOneOnOneActionItemEvents, hcmEmploymentDecisionEvents, hcmBusinessProcessDefinitions, hcmBusinessProcessInstances, hcmJobProfileSkillRequirements, jobProfiles, automationOperationalCases, orgUnits, apiKeys, organizations, organizationSecurityPolicies, automationExecutions, employees, auditEvents, performanceGoals, performanceCycles, performanceReviews, performanceCalibrationSessions, performanceCalibrationEntries, performanceCalibrationFlags, performanceCalibrationPolicies, performanceCalibrationPolicyEvents, performanceSkillDevelopmentMilestones, performanceSkillDevelopmentPlanEvents, performanceActionReminderPolicies, performanceActionReminderPolicyEvents, employeeLoans, loanPayments, payrollRuns, payrollEntries, employeePayProfiles, employeePayRevisions, users, userOrganizations,
} from "../../src/db/schema";
import { organizationModuleSettings } from "../../src/lib/tenant-module-storage";
import {
  addWorker, requireTenantTableDisposable, seedEmployer, standaloneExpectStatus,
  standaloneMakeSession, standaloneRequest, victimSnapshot,
} from "./tenant-table-http.mjs";
import { auditBusinessSnapshot, seedTableRow } from "./tenant-table-invariants.mjs";
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
// Family row factories receive only the shared fixture/proof dependencies.


export async function verifyTenantWriteTable(_f, {
  request = standaloneRequest, expectStatus = standaloneExpectStatus, makeSession = standaloneMakeSession,
} = {}) {
  requireTenantTableDisposable();
  const TENANT_WRITE_TABLE = await loadTenantRows("write", { addWorker, approvalDelegations, asc, assert, benefitEnrollments, benefitPlans, dataRequests, db, disciplinaryCases, earnedWageRequests, engagementSurveys, eq, hcmEmploymentTermDecisions, hcmEmploymentTerms, hcmLifecyclePolicies, hcmLifecyclePolicyEvents, hcmSkills, organizationModuleSettings, performanceSkillDevelopmentPlans, workerEffectiveChanges, performanceOneOnOnes, performanceOneOnOneActionItems, performanceOneOnOneActionItemEvents, hcmEmploymentDecisionEvents, hcmBusinessProcessDefinitions, hcmBusinessProcessInstances, hcmJobProfileSkillRequirements, jobProfiles, automationOperationalCases, orgUnits, pool, apiKeys, organizations, organizationSecurityPolicies, automationExecutions, employees, auditEvents, auditBusinessSnapshot, performanceGoals, performanceCycles, performanceReviews, performanceCalibrationSessions, performanceCalibrationEntries, performanceCalibrationFlags, performanceCalibrationPolicies, performanceCalibrationPolicyEvents, performanceSkillDevelopmentMilestones, performanceSkillDevelopmentPlanEvents, performanceActionReminderPolicies, performanceActionReminderPolicyEvents, employeeLoans, loanPayments, payrollRuns, payrollEntries, employeePayProfiles, employeePayRevisions, users, userOrganizations });
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

