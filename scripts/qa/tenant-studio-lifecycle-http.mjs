/**
 * Synthetic PostgreSQL 16 / production-mode localhost HTTP proof for:
 * Automation Studio publish-rule, set-active and rollback-rule.
 * Two independent signed-in owners, real >6 victim IDs, no providers/workers,
 * no production data and ZERO whole-method coverage credit.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  STUDIO_LIFECYCLE_ORIGIN, STUDIO_LIFECYCLE_ROUTE,
  requireDisposableStudioLifecycleEnv, verifyStudioLifecycleSources,
  assertDeniedLifecycle, assertOwnedLifecycle,
} from "./tenant-studio-lifecycle-contract.mjs";

const plain = x => JSON.parse(JSON.stringify(x));
const conditions = { version: 1, all: [], any: [] };
const actions = [{
  type: "create_task", title: "Record fictional onboarding task",
  owner: "People Ops", kind: "automation",
}];

async function request(path, actor, body, opts = {}) {
  const method = body === undefined ? "GET" : "POST";
  const headers = {};
  if (opts.cookie !== null) headers.cookie = opts.cookie ?? actor.cookie;
  if (method === "POST") {
    headers["content-type"] = "application/json";
    headers.origin = opts.origin ?? STUDIO_LIFECYCLE_ORIGIN;
    headers["sec-fetch-site"] = opts.site ?? "same-origin";
  }
  const response = await fetch(STUDIO_LIFECYCLE_ORIGIN + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: response.status, text, json };
}
const post = (actor, body, opts) => request(STUDIO_LIFECYCLE_ROUTE, actor, body, opts);
const draftBody = (actor, name, id) => ({
  action: "save-rule", organizationId: actor.org.id,
  ...(id == null ? {} : { id }),
  name, trigger: "employee.hired", conditions, actions, active: false,
});
const preview = (actor, ruleId) => request(
  STUDIO_LIFECYCLE_ROUTE + "?organizationId=" + actor.org.id +
    "&previewRuleId=" + ruleId, actor
);
const command = (actor, action, ruleId, fields = {}) => ({
  organizationId: actor.org.id, action, ruleId, ...fields,
});

export async function proveStudioLifecycleIsolation() {
  // Refuse unsafe production/provider targets BEFORE importing app or database.
  requireDisposableStudioLifecycleEnv();
  verifyStudioLifecycleSources();

  const [{ db, pool }, s, orm, fixtures] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
  ]);
  const { and, asc, eq } = orm;
  const protectedTables = [
    "organizations", "userOrganizations", "employees", "employeePayProfiles",
    "automationRules", "automationRuleVersions", "automationExecutions",
    "automationOperationalCases", "automationEventLog", "payrollRuns",
    "outbox", "auditEvents",
  ];
  const allowedOwnWrites = new Set([
    "automationRules", "automationRuleVersions", "auditEvents",
  ]);

  async function snapshot(organizationId) {
    const result = {};
    for (const name of protectedTables) {
      const table = s[name];
      assert.ok(table?.id, "Missing tracked table id: " + name);
      const scope = name === "organizations" ? table.id : table.organizationId;
      assert.ok(scope, "Tracked table must have tenant scope: " + name);
      result[name] = plain(await db.select().from(table)
        .where(eq(scope, organizationId)).orderBy(asc(table.id)));
    }
    return result;
  }
  const baseline = new Map();
  let subjects;
  async function verifyAllUnchanged(label) {
    for (const actor of subjects) {
      assert.deepEqual(await snapshot(actor.org.id), baseline.get(actor.org.id),
        label + ": unauthorized SQL mutation in " + actor.label);
    }
  }
  async function denied(actor, body, status, label, opts) {
    const res = await post(actor, body, opts);
    assertDeniedLifecycle(res, status, subjects, label);
    await verifyAllUnchanged(label);
    return res;
  }
  async function ownDelta(actor, before, response, kind, version, active, auditAction, addVersion) {
    const { rule, published } = assertOwnedLifecycle(response, actor, kind, version, active);
    const after = await snapshot(actor.org.id);
    for (const name of protectedTables) {
      if (!allowedOwnWrites.has(name)) {
        assert.deepEqual(after[name], before[name], kind + ": cannot mutate " + name);
      }
    }
    assert.equal(after.automationRules.length, before.automationRules.length);
    assert.equal(after.automationRuleVersions.length,
      before.automationRuleVersions.length + addVersion);
    assert.equal(after.auditEvents.length, before.auditEvents.length + 1);
    assert.deepEqual(after.auditEvents.slice(0, -1), before.auditEvents,
      kind + ": earlier audit entries must be immutable");
    const audit = after.auditEvents.at(-1);
    assert.equal(audit.organizationId, actor.org.id);
    assert.equal(audit.action, auditAction);
    assert.equal(audit.metadata?.ruleId, actor.rule.id);
    assert.deepEqual(after.automationRules.find(row => row.id === actor.rule.id), plain(rule),
      kind + ": response must equal persisted own rule");
    assert.deepEqual(after.automationRuleVersions.find(row => row.id === published.id),
      plain(published), kind + ": response must equal persisted own version");
    assert.equal(after.automationRuleVersions.filter(row => row.status === "published").length, 1);
    baseline.set(actor.org.id, after);
    await verifyAllUnchanged(kind + ": own write changed another employer");
    return { rule, published };
  }

  let ownedPublications = 0, ownedActivations = 0, ownedDisables = 0;
  let ownedRollbacks = 0, foreignDenials = 0, otherDenials = 0;
  try {
    const pg = Number((await pool.query("SHOW server_version_num")).rows[0].server_version_num);
    assert.ok(pg >= 160000 && pg < 170000, "Fictional PostgreSQL 16 only");
    assert.equal((await db.select().from(s.organizations).limit(1)).length, 0,
      "An empty dedicated fictional employer database is mandatory");
    assert.equal((await db.select().from(s.users).limit(1)).length, 0,
      "An empty dedicated fictional user database is mandatory");
    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
    const a = await fixtures.seedEmployer("ATTA", nonce, fixtures.standaloneMakeSession);
    const b = await fixtures.seedEmployer("ATTB", nonce, fixtures.standaloneMakeSession);
    const fillers = [];
    for (let i = 0; i < 7; i++) {
      fillers.push(await fixtures.seedEmployer("FILL" + i, nonce, fixtures.standaloneMakeSession));
    }
    const victim = await fixtures.seedEmployer("VICTIM", nonce, fixtures.standaloneMakeSession);
    subjects = [a, b, victim];
    assert.equal(new Set(subjects.map(x => x.cookie)).size, 3);

    for (const field of ["org", "owner", "entity", "unit", "worker"]) {
      assert.ok(victim[field].id > Math.max(6, a[field].id, b[field].id),
        "Persisted victim employer identifier must exceed both attackers and six: " + field);
    }
    for (const filler of fillers) {
      const res = await post(filler, draftBody(filler, filler.marker + " inert filler"));
      assert.equal(res.status, 201, "Real filler draft creation required");
      assert.equal(res.json?.rule?.organizationId, filler.org.id);
      assert.equal(res.json?.rule?.active, false);
      assert.equal(res.json?.rule?.publishedVersion, 0);
    }

    for (const actor of subjects) {
      const signedIn = await request("/api/account", actor);
      assert.equal(signedIn.status, 200, "Valid signed-in fictional owner required");
      assert.equal(signedIn.json?.profile?.id, actor.owner.id);
      const res = await post(actor, draftBody(actor, actor.marker + " version one"));
      assert.equal(res.status, 201, actor.label + " real owned draft required");
      assert.equal(res.json?.draft?.status, "draft");
      assert.equal(res.json?.rule?.organizationId, actor.org.id);
      assert.equal(res.json?.rule?.active, false);
      assert.equal(res.json?.rule?.publishedVersion, 0);
      assert.equal(res.json?.draft?.version, 1);
      actor.rule = res.json.rule;
      actor.draft = res.json.draft;
    }
    assert.ok(victim.rule.id > 6 && victim.draft.id > 6,
      "Victim must own persisted high-ID rule and version records");
    for (const actor of subjects) baseline.set(actor.org.id, await snapshot(actor.org.id));

    // Protected victim preview is real, signed for that victim session only.
    const victimPreview = await preview(victim, victim.rule.id);
    assert.equal(victimPreview.status, 200);
    assert.equal(typeof victimPreview.json?.previewReceipt, "string");
    assert.ok(victimPreview.json.previewReceipt.length > 30);
    await verifyAllUnchanged("Impact Preview GET cannot mutate SQL");

    for (const actor of [a, b]) {
      const other = actor === a ? b : a;
      const firstPreview = await preview(actor, actor.rule.id);
      assert.equal(firstPreview.status, 200, "Own Impact Preview must work");
      assert.equal(firstPreview.json?.draft?.ruleId, actor.rule.id);
      assert.equal(firstPreview.json?.draft?.version, 1);
      assert.equal(typeof firstPreview.json?.previewReceipt, "string");
      await verifyAllUnchanged("Own preview read must not change SQL");

      await denied(actor, command(actor, "publish-rule", actor.rule.id,
        { humanApproved: false, previewReceipt: firstPreview.json.previewReceipt,
          limitedEvidenceAcknowledged: true }), 409, "missing human publication approval");
      otherDenials++;
      await denied(actor, command(actor, "publish-rule", actor.rule.id,
        { humanApproved: true, limitedEvidenceAcknowledged: true }),
        409, "missing signed Impact Preview receipt");
      otherDenials++;
      await denied(actor, command(actor, "publish-rule", actor.rule.id,
        { humanApproved: true, previewReceipt: victimPreview.json.previewReceipt,
          limitedEvidenceAcknowledged: true }), 409,
        "foreign tenant preview receipt must not authorize own draft");
      otherDenials++;
      await denied(actor, command(actor, "publish-rule", actor.rule.id,
        { humanApproved: true, previewReceipt: firstPreview.json.previewReceipt }),
        409, "authoritative evidence absence needs explicit acknowledgement");
      otherDenials++;

      // Persist a genuine draft edit to invalidate the earlier signed preview.
      const changed = await post(actor, draftBody(actor,
        actor.marker + " updated before publish", actor.rule.id));
      assert.equal(changed.status, 200);
      assert.equal(changed.json?.draft?.id, actor.draft.id);
      assert.equal(changed.json?.draft?.name, actor.marker + " updated before publish");
      baseline.set(actor.org.id, await snapshot(actor.org.id));
      await verifyAllUnchanged("Only owning employer may update draft");

      await denied(actor, command(actor, "publish-rule", actor.rule.id,
        { humanApproved: true, previewReceipt: firstPreview.json.previewReceipt,
          limitedEvidenceAcknowledged: true }), 409,
        "stale preview cannot publish changed definition");
      otherDenials++;

      // Unpublished drafts cannot be activated, even by an owning administrator.
      await denied(actor, command(actor, "set-active", actor.rule.id, { active: true }),
        409, "unpublished draft may not activate");
      otherDenials++;

      const freshPreview = await preview(actor, actor.rule.id);
      assert.equal(freshPreview.status, 200);
      assert.equal(freshPreview.json?.draft?.name, actor.marker + " updated before publish");
      const beforePublication = await snapshot(actor.org.id);
      const published = await post(actor, command(actor, "publish-rule", actor.rule.id, {
        humanApproved: true, previewReceipt: freshPreview.json.previewReceipt,
        limitedEvidenceAcknowledged: true,
      }));
      await ownDelta(actor, beforePublication, published, "publish-rule", 1, false,
        "Automation Studio draft published", 0);
      ownedPublications++;

      // A replay cannot publish the already consumed draft again.
      await denied(actor, command(actor, "publish-rule", actor.rule.id, {
        humanApproved: true, previewReceipt: freshPreview.json.previewReceipt,
        limitedEvidenceAcknowledged: true,
      }), 409, "published draft cannot be replayed");
      otherDenials++;

      const beforeEnabled = await snapshot(actor.org.id);
      const enabled = await post(actor,
        command(actor, "set-active", actor.rule.id, { active: true }));
      await ownDelta(actor, beforeEnabled, enabled, "set-active true", 2, true,
        "Automation Studio rule enabled", 1);
      ownedActivations++;

      const beforeDisabled = await snapshot(actor.org.id);
      const disabled = await post(actor,
        command(actor, "set-active", actor.rule.id, { active: false }));
      await ownDelta(actor, beforeDisabled, disabled, "set-active false", 3, false,
        "Automation Studio rule disabled", 1);
      ownedDisables++;

      const beforeRollback = await snapshot(actor.org.id);
      const rollback = await post(actor,
        command(actor, "rollback-rule", actor.rule.id, { targetVersion: 1 }));
      assert.equal(rollback.json?.restoredFromVersion, 1);
      assert.equal(rollback.json?.published?.sourceVersion, 1);
      await ownDelta(actor, beforeRollback, rollback, "rollback-rule", 4, false,
        "Automation Studio rule rolled back", 1);
      ownedRollbacks++;

      // Both attackers must fail every foreign selector with ALL tenant SQL
      // unchanged; use genuine victim and peer IDs, never fabricated IDs.
      for (const target of [victim, other]) {
        await denied(actor, command(actor, "publish-rule", target.rule.id, {
          humanApproved: true, previewReceipt: victimPreview.json.previewReceipt,
          limitedEvidenceAcknowledged: true,
        }), 409, "foreign publish rule ID");
        foreignDenials++;
        await denied(actor, command(actor, "rollback-rule", target.rule.id,
          { targetVersion: 1 }), 404, "foreign rollback rule ID");
        foreignDenials++;
        await denied(actor, command(actor, "set-active", target.rule.id,
          { active: true }), 404, "foreign set-active true rule ID");
        foreignDenials++;
        await denied(actor, command(actor, "set-active", target.rule.id,
          { active: false }), 404, "foreign set-active false rule ID");
        foreignDenials++;
      }
      for (const action of ["publish-rule", "rollback-rule", "set-active"]) {
        await denied(actor, { ...command(actor, action, victim.rule.id, {
          targetVersion: 1, active: true, humanApproved: true,
        }), organizationId: victim.org.id }, 403,
        "foreign organization selector " + action);
        foreignDenials++;
      }
      await denied(actor, command(actor, "rollback-rule", actor.rule.id,
        { targetVersion: 99 }), 404, "unknown own rollback target");
      otherDenials++;
    }

    // Ordinary authentication and same-origin mutation gates also apply.
    await denied(a, command(a, "set-active", a.rule.id, { active: true }),
      401, "anonymous lifecycle POST", { cookie: null });
    otherDenials++;
    await denied(a, command(a, "set-active", a.rule.id, { active: true }),
      403, "cross-site lifecycle POST",
      { origin: "https://attacker.invalid", site: "cross-site" });
    otherDenials++;
    await denied(a, command(a, "rollback-rule", "invalid", { targetVersion: 1 }),
      400, "invalid ruleId");
    otherDenials++;

    assert.equal(ownedPublications, 2);
    assert.equal(ownedActivations, 2);
    assert.equal(ownedDisables, 2);
    assert.equal(ownedRollbacks, 2);
    assert.equal(foreignDenials, 22);
    assert.equal(otherDenials, 17);
    await verifyAllUnchanged("final protected employer snapshots");

    console.log("TENANT_STUDIO_LIFECYCLE_HTTP_COMPLETE " + JSON.stringify({
      family: "automation-studio-publish-rollback-active",
      fictionalPG16: true, independentAuthenticatedOwners: 2,
      realVictimRuleAndVersionIdsAboveSix: true,
      ownedPublications, ownedActivations, ownedDisables, ownedRollbacks,
      foreignDenials, otherDenials, allTenantSqlProtected: true,
      noAutomationExecution: true, noExternalProviders: true,
      productionTested: false, wholePostCertified: false,
      methodCoverageCredits: 0, independentlyAccepted: false,
    }));
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.endsWith("tenant-studio-lifecycle-http.mjs")) {
  proveStudioLifecycleIsolation().catch(error => {
    console.error("TENANT_STUDIO_LIFECYCLE_HTTP_FAILED " +
      (error instanceof Error ? error.stack : String(error)));
    process.exitCode = 1;
  });
}
