/**
 * Real fictional PostgreSQL 16 / localhost Next HTTP proof for the safe
 * execution-recovery subset of Automation Studio POST.
 * No provider, scheduler, money, email or production employer is contacted.
 * No whole-method tenant credit is awarded.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  ORIGIN, ROUTE, requireDisposableStudioExecutionEnv,
  verifyStudioExecutionSources, assertDeniedExecution,
  assertOwnedCase, assertOwnRecovery,
} from "./tenant-studio-execution-contract.mjs";

const plain = x => JSON.parse(JSON.stringify(x));
const workflow = [{ type: "revoke_sessions" }];
const conditions = { version: 1, all: [], any: [] };
const note = "Fictional operations team reviewed this failed execution step.";

async function request(actor, body, opts = {}) {
  const headers = {
    "content-type": "application/json",
    origin: opts.origin ?? ORIGIN,
    "sec-fetch-site": opts.site ?? "same-origin",
  };
  if (opts.cookie !== null) headers.cookie = opts.cookie ?? actor.cookie;
  const response = await fetch(ORIGIN + ROUTE, {
    method: "POST", headers, body: JSON.stringify(body), redirect: "manual",
    cache: "no-store", signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: response.status, text, json };
}
const bodyFor = (actor, action, attrs = {}) =>
  ({ organizationId: actor.org.id, action, ...attrs });
const quarantine = (actor, id) => bodyFor(actor, "quarantine-execution-step",
  { executionId: id, stepIndex: 0, note });
const triage = (actor, caseId, transition) => bodyFor(actor, "triage-operational-case",
  { caseId, transition, note });
const retry = (actor, id) => bodyFor(actor, "retry-execution-step",
  { executionId: id, stepIndex: 0 });
const replay = (actor, id) => bodyFor(actor, "replay-execution",
  { executionId: id });

export async function proveStudioExecutionIsolation() {
  // Security interlock FIRST, before any application/database import.
  requireDisposableStudioExecutionEnv();
  verifyStudioExecutionSources();

  const [{ db, pool }, s, orm, fixtures] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
  ]);
  const { asc, eq } = orm;
  const tracked = [
    "organizations", "userOrganizations", "employees", "employeePayProfiles",
    "automationRules", "automationRuleVersions", "automationExecutions",
    "automationOperationalCases", "automationEventLog",
    "payrollRuns", "outbox", "auditEvents",
  ];
  async function snapshot(orgId) {
    const result = {};
    for (const key of tracked) {
      const table = s[key];
      assert.ok(table?.id, "Missing tracked table: " + key);
      const scope = key === "organizations" ? table.id : table.organizationId;
      assert.ok(scope, "Missing org scope on " + key);
      result[key] = plain(await db.select().from(table)
        .where(eq(scope, orgId)).orderBy(asc(table.id)));
    }
    return result;
  }

  let subjects = [];
  const baseline = new Map();
  async function allUnchanged(label) {
    for (const actor of subjects) {
      assert.deepEqual(await snapshot(actor.org.id), baseline.get(actor.org.id),
        label + " modified " + actor.label + " tenant rows/audit");
    }
  }
  async function denied(actor, body, status, label, opts) {
    const result = await request(actor, body, opts);
    assertDeniedExecution(result, status, subjects, label);
    await allUnchanged(label);
    return result;
  }
  async function owned(actor, body, status, label, assertSuccess, allowed) {
    const before = await snapshot(actor.org.id);
    const result = await request(actor, body);
    assert.equal(result.status, status, label + " HTTP status");
    assertSuccess(result);
    const after = await snapshot(actor.org.id);
    for (const key of tracked) {
      if (!allowed.has(key)) assert.deepEqual(after[key], before[key],
        label + ": own action changed forbidden table " + key);
    }
    assert.equal(after.auditEvents.length, before.auditEvents.length + 1,
      label + ": one immutable audit event required");
    assert.deepEqual(after.auditEvents.slice(0, -1), before.auditEvents);
    assert.equal(after.auditEvents.at(-1).organizationId, actor.org.id);
    baseline.set(actor.org.id, after);
    await allUnchanged(label + " changed a foreign employer");
    return result;
  }
  async function makeRule(actor) {
    const res = await request(actor, bodyFor(actor, "save-rule", {
      name: actor.marker + " fictional separation safeguard",
      trigger: "employee.separated", conditions, actions: workflow, active: false,
    }));
    assert.equal(res.status, 201, "Fictional separation rule must be created via actual HTTP");
    assert.equal(res.json?.rule?.organizationId, actor.org.id);
    assert.equal(res.json?.rule?.active, false);
    assert.equal(res.json?.rule?.publishedVersion, 0);
    actor.rule = res.json.rule;
  }
  async function makeFailed(actor, label) {
    const [row] = await db.insert(s.automationExecutions).values({
      organizationId: actor.org.id, ruleId: actor.rule.id,
      employeeId: actor.worker.id, trigger: "employee.separated",
      eventKey: actor.marker + "-failed-" + label,
      workflow, context: { evidence: "fictional-test-only" },
      status: "failed", cursor: 1,
      result: [{ type: "revoke_sessions", stepIndex: 0,
        status: "failed", error: "Fictional recoverable interrupted action" }],
      error: "Fictional recoverable interrupted action",
    }).returning();
    return row;
  }

  let ownQuarantines = 0, ownAcknowledgements = 0, ownRetries = 0;
  let ownResolves = 0, ownReopens = 0, ownReplays = 0;
  let foreignDenials = 0, otherDenials = 0;
  try {
    const pg = Number((await pool.query("SHOW server_version_num")).rows[0].server_version_num);
    assert.ok(pg >= 160000 && pg < 170000, "Disposable PostgreSQL 16 required");
    assert.equal((await db.select().from(s.organizations).limit(1)).length, 0,
      "Refuse existing employer tables");
    assert.equal((await db.select().from(s.users).limit(1)).length, 0,
      "Refuse existing accounts");
    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
    const a = await fixtures.seedEmployer("ATTA", nonce, fixtures.standaloneMakeSession);
    const b = await fixtures.seedEmployer("ATTB", nonce, fixtures.standaloneMakeSession);
    subjects = [a, b];
    for (const actor of subjects) {
      await makeRule(actor);
      actor.failed = await makeFailed(actor, "retry");
      actor.replaySource = await makeFailed(actor, "replay");
      const linkedAccounts = await db.select().from(s.users)
        .where(eq(s.users.employeeId, actor.worker.id));
      assert.equal(linkedAccounts.length, 0,
        "No real login may be linked to a fictional session-revocation worker");
      const res = await request(actor, quarantine(actor, actor.failed.id));
      assert.equal(res.status, 201);
      assert.equal(res.json?.created, true);
      actor.case = assertOwnedCase(res, actor, "open", true);
      const actual = await snapshot(actor.org.id);
      assert.deepEqual(actual.automationOperationalCases.find(x => x.id === actor.case.id),
        plain(actor.case), "Quarantine case must be persisted");
      ownQuarantines++;
    }

    const fillers = [];
    for (let i = 0; i < 7; i++) {
      const filler = await fixtures.seedEmployer("FILL" + i, nonce,
        fixtures.standaloneMakeSession);
      await makeRule(filler);
      filler.failed = await makeFailed(filler, "filler");
      const res = await request(filler, quarantine(filler, filler.failed.id));
      assert.equal(res.status, 201, "Real filler case required for victim ID floor");
      fillers.push(filler);
    }
    const victim = await fixtures.seedEmployer("VICTIM", nonce,
      fixtures.standaloneMakeSession);
    await makeRule(victim);
    victim.failed = await makeFailed(victim, "retry");
    victim.replaySource = await makeFailed(victim, "replay");
    const victimCase = await request(victim, quarantine(victim, victim.failed.id));
    assert.equal(victimCase.status, 201, "Real owned victim case control required");
    victim.case = assertOwnedCase(victimCase, victim, "open", true);
    subjects.push(victim);

    for (const field of ["org", "owner", "entity", "unit", "worker"]) {
      assert.ok(victim[field].id > Math.max(6, a[field].id, b[field].id),
        "Real higher-ID victim identity missing " + field);
    }
    for (const field of ["rule", "failed", "replaySource", "case"]) {
      assert.ok(victim[field].id > Math.max(6, a[field].id, b[field].id),
        "Real higher-ID victim operational resource missing " + field);
    }
    for (const actor of subjects) {
      const res = await fetch(ORIGIN + "/api/account", {
        headers: { cookie: actor.cookie }, redirect: "manual",
        cache: "no-store", signal: AbortSignal.timeout(30000),
      });
      assert.equal(res.status, 200, "Session must be authenticated");
      assert.equal((await res.json()).profile.id, actor.owner.id);
      baseline.set(actor.org.id, await snapshot(actor.org.id));
    }

    for (const actor of [a, b]) {
      const other = actor === a ? b : a;

      // Open dead-letter records block retries until a human reviews them.
      await denied(actor, retry(actor, actor.failed.id), 409,
        "retry cannot bypass open dead-letter case");
      otherDenials++;

      const again = await request(actor, quarantine(actor, actor.failed.id));
      assert.equal(again.status, 200, "Idempotent quarantine must not duplicate case");
      assert.equal(again.json?.created, false);
      assert.equal(again.json?.operationalCase?.id, actor.case.id);
      await allUnchanged("Idempotent quarantine must not write SQL");

      const acknowledged = await owned(actor, triage(actor, actor.case.id, "acknowledge"),
        200, "acknowledge", res => {
          assert.equal(assertOwnedCase(res, actor, "acknowledged").id, actor.case.id);
          assert.equal(res.json?.operationalCase?.acknowledgedByUserId, actor.owner.id);
        }, new Set(["automationOperationalCases", "auditEvents"]));
      actor.case = acknowledged.json.operationalCase;
      ownAcknowledgements++;

      const recovered = await owned(actor, retry(actor, actor.failed.id), 200,
        "failed-step retry", res => {
          const execution = assertOwnRecovery(res, actor, "retry");
          assert.equal(execution.id, actor.failed.id);
        }, new Set(["automationExecutions", "auditEvents"]));
      assert.equal(recovered.json.execution.status, "completed");
      ownRetries++;

      const resolved = await owned(actor, triage(actor, actor.case.id, "resolve"),
        200, "resolve dead letter", res =>
          assert.equal(assertOwnedCase(res, actor, "resolved").id, actor.case.id),
        new Set(["automationOperationalCases", "auditEvents"]));
      actor.case = resolved.json.operationalCase;
      ownResolves++;

      const reopened = await owned(actor, triage(actor, actor.case.id, "reopen"),
        200, "reopen dead letter", res =>
          assert.equal(assertOwnedCase(res, actor, "open").id, actor.case.id),
        new Set(["automationOperationalCases", "auditEvents"]));
      actor.case = reopened.json.operationalCase;
      ownReopens++;

      const replayed = await owned(actor, replay(actor, actor.replaySource.id),
        201, "safe stored-snapshot replay", res => {
          const execution = assertOwnRecovery(res, actor, "replay");
          assert.ok(execution.id > actor.replaySource.id);
        }, new Set(["automationExecutions", "auditEvents"]));
      assert.equal(replayed.json.execution.status, "completed");
      ownReplays++;

      await denied(actor, retry(actor, actor.failed.id), 409,
        "already completed retry cannot repeat");
      otherDenials++;
      await denied(actor, replay(actor, actor.failed.id), 409,
        "completed execution cannot replay");
      otherDenials++;
      await denied(actor, quarantine(actor, actor.failed.id), 409,
        "completed execution cannot be quarantined anew");
      otherDenials++;

      // Real victim and real peer IDs, on the attacker's OWN organization
      // selector, must be rejected without changing protected SQL.
      for (const target of [victim, other]) {
        await denied(actor, quarantine(actor, target.failed.id), 409,
          "foreign execution quarantine ID");
        foreignDenials++;
        await denied(actor, triage(actor, target.case.id, "acknowledge"), 404,
          "foreign dead-letter case ID");
        foreignDenials++;
        await denied(actor, retry(actor, target.failed.id), 409,
          "foreign failed-step retry ID");
        foreignDenials++;
        await denied(actor, replay(actor, target.replaySource.id), 409,
          "foreign snapshot replay ID");
        foreignDenials++;
      }
      for (const original of [
        quarantine(actor, victim.failed.id),
        triage(actor, victim.case.id, "acknowledge"),
        retry(actor, victim.failed.id),
        replay(actor, victim.replaySource.id),
      ]) {
        await denied(actor, { ...original, organizationId: victim.org.id },
          403, "foreign tenant organization selector");
        foreignDenials++;
      }
      for (const malformed of [
        quarantine(actor, "invalid"),
        triage(actor, actor.case.id, "invalid"),
        retry(actor, "invalid"),
        replay(actor, "invalid"),
      ]) {
        await denied(actor, malformed, 400, "malformed execution/case command");
        otherDenials++;
      }
    }

    for (const action of ["draft-from-language", "save-language-draft"]) {
      await denied(a, bodyFor(a, action, { request: "Draft a fictional workflow",
        draft: { name: "Denied by release gate" } }), 403,
      "disabled natural-language/model action " + action);
      otherDenials++;
    }
    await denied(a, replay(a, a.replaySource.id), 401,
      "anonymous replay denied", { cookie: null });
    otherDenials++;
    await denied(a, retry(a, a.failed.id), 403,
      "cross-site retry denied",
      { origin: "https://attacker.invalid", site: "cross-site" });
    otherDenials++;

    assert.equal(ownQuarantines, 2);
    assert.equal(ownAcknowledgements, 2);
    assert.equal(ownRetries, 2);
    assert.equal(ownResolves, 2);
    assert.equal(ownReopens, 2);
    assert.equal(ownReplays, 2);
    assert.equal(foreignDenials, 24);
    assert.equal(otherDenials, 20);
    await allUnchanged("final multi-employer/audit snapshot");

    console.log("TENANT_STUDIO_EXECUTION_HTTP_COMPLETE " + JSON.stringify({
      family: "studio-execution-quarantine-triage-retry-replay",
      fictionalPG16: true, twoIndependentAuthenticatedOwners: true,
      higherIdVictimOperationalResources: true,
      ownQuarantines, ownAcknowledgements, ownRetries, ownResolves,
      ownReopens, ownReplays, foreignDenials, otherDenials,
      foreignAndOwnSqlBound: true, noExternalProviderCalls: true,
      noMoneyOrPayrollRelease: true, languageDraftDisabled: true,
      productionTested: false, independentlyAccepted: false,
      wholePostCertified: false, newCoverageCredits: 0,
    }));
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.endsWith("tenant-studio-execution-http.mjs")) {
  proveStudioExecutionIsolation().catch(error => {
    console.error("TENANT_STUDIO_EXECUTION_HTTP_FAILED " +
      (error instanceof Error ? error.stack : String(error)));
    process.exitCode = 1;
  });
}
