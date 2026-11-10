/**
 * Real PostgreSQL 16 / production-mode localhost HTTP tenant evidence for
 * Automation Studio save-rule (create/update) and create-from-template.
 * Every workflow remains an unpublished draft. ZERO full-POST coverage credits.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  STUDIO_DRAFT_ORIGIN, STUDIO_DRAFT_ROUTE, STUDIO_DRAFT_TEMPLATE,
  requireDisposableStudioDraftEnv, verifyStudioDraftSources,
  assertDeniedDraft, assertOwnedDraft,
} from "./tenant-studio-draft-contract.mjs";

const plain = x => JSON.parse(JSON.stringify(x));
const conditions = { version: 1, all: [], any: [] };
const actions = [{
  type: "create_task", title: "Verify fictional onboarding evidence",
  owner: "People Ops", kind: "automation",
}];

async function post(actor, body, options = {}) {
  const headers = {
    "content-type": "application/json",
    origin: options.origin ?? STUDIO_DRAFT_ORIGIN,
    "sec-fetch-site": options.site ?? "same-origin",
  };
  if (options.cookie !== null) headers.cookie = options.cookie ?? actor.cookie;
  const response = await fetch(STUDIO_DRAFT_ORIGIN + STUDIO_DRAFT_ROUTE, {
    method: "POST", headers, body: JSON.stringify(body), redirect: "manual",
    cache: "no-store", signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* fail the exact status/body assertion */ }
  return { status: response.status, text, json };
}
const saveBody = (actor, name, id = undefined) => ({
  organizationId: actor.org.id, action: "save-rule",
  ...(id === undefined ? {} : { id }),
  name, trigger: "employee.hired", conditions, actions, active: false,
});
const templateBody = (actor, name) => ({
  organizationId: actor.org.id, action: "create-from-template",
  templateId: STUDIO_DRAFT_TEMPLATE, name,
});

export async function proveStudioDraftIsolation() {
  // Source and environment interlocks execute before importing any DB/app code.
  requireDisposableStudioDraftEnv();
  verifyStudioDraftSources();
  const [{ db, pool }, s, orm, fixtures] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
  ]);
  const { and, asc, eq } = orm;
  const tracked = [
    "organizations", "userOrganizations", "employees", "employeePayProfiles",
    "automationRules", "automationRuleVersions", "automationExecutions",
    "automationOperationalCases", "automationEventLog", "payrollRuns",
    "outbox", "auditEvents",
  ];
  async function snapshot(organizationId) {
    const result = {};
    for (const name of tracked) {
      const table = s[name];
      assert.ok(table?.id, "Tracked table missing ID: " + name);
      const column = name === "organizations" ? table.id : table.organizationId;
      assert.ok(column, "Tracked table missing employer scope: " + name);
      result[name] = plain(await db.select().from(table)
        .where(eq(column, organizationId)).orderBy(asc(table.id)));
    }
    return result;
  }
  function assertCreateDelta(before, after, actor, response, name, expectedAudit, active) {
    const { rule, draft } = assertOwnedDraft(response, actor, expectedAudit, name);
    assert.equal(draft.active, active, "Expected unpublished draft active preference");
    for (const table of tracked) {
      const diffAllowed = ["automationRules", "automationRuleVersions", "auditEvents"].includes(table);
      if (!diffAllowed) assert.deepEqual(after[table], before[table],
        "Creating a draft must not touch " + table);
    }
    assert.equal(after.automationRules.length, before.automationRules.length + 1);
    assert.equal(after.automationRuleVersions.length, before.automationRuleVersions.length + 1);
    assert.equal(after.auditEvents.length, before.auditEvents.length + 1);
    const storedRule = after.automationRules.find(x => x.id === rule.id);
    const storedDraft = after.automationRuleVersions.find(x => x.id === draft.id);
    assert.deepEqual(storedRule, plain(rule), "Response must equal persisted own rule");
    assert.deepEqual(storedDraft, plain(draft), "Response must equal persisted own draft");
    assert.equal(storedRule.organizationId, actor.org.id);
    assert.equal(storedDraft.organizationId, actor.org.id);
    assert.equal(storedRule.publishedVersion, 0);
    assert.equal(storedRule.active, false);
    assert.equal(storedDraft.status, "draft");
    assert.equal(storedDraft.createdByUserId, actor.owner.id);
    const audit = after.auditEvents.at(-1);
    assert.equal(audit.organizationId, actor.org.id);
    assert.equal(audit.action, expectedAudit);
    assert.equal(audit.metadata?.ruleId, rule.id);
    assert.deepEqual(after.auditEvents.slice(0, -1), before.auditEvents,
      "Existing audit receipts must be immutable");
    return { rule, draft };
  }

  let ownCreates = 0, ownUpdates = 0, foreignDenials = 0, otherDenials = 0;
  try {
    const version = Number((await pool.query("SHOW server_version_num")).rows[0].server_version_num);
    assert.ok(version >= 160000 && version < 170000, "Only fictional PostgreSQL 16 is accepted");
    assert.equal((await db.select().from(s.organizations).limit(1)).length, 0,
      "Refuse any pre-populated employer DB");
    assert.equal((await db.select().from(s.users).limit(1)).length, 0,
      "Refuse any pre-populated identity DB");

    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
    const a = await fixtures.seedEmployer("ATTA", nonce, fixtures.standaloneMakeSession);
    const b = await fixtures.seedEmployer("ATTB", nonce, fixtures.standaloneMakeSession);
    const fillers = [];
    for (let i = 0; i < 7; i++) {
      fillers.push(await fixtures.seedEmployer("FILL" + i, nonce, fixtures.standaloneMakeSession));
    }
    const victim = await fixtures.seedEmployer("VICTIM", nonce, fixtures.standaloneMakeSession);
    const subjects = [a, b, victim];
    for (const actor of subjects) {
      const response = await fetch(STUDIO_DRAFT_ORIGIN + "/api/account", {
        headers: { cookie: actor.cookie }, cache: "no-store",
        redirect: "manual", signal: AbortSignal.timeout(30000),
      });
      assert.equal(response.status, 200, actor.label + ": real session required");
      assert.equal((await response.json()).profile.id, actor.owner.id);
    }
    for (const field of ["org", "owner", "entity", "unit", "worker"]) {
      assert.ok(victim[field].id > Math.max(6, a[field].id, b[field].id),
        "Real high-ID victim " + field + " missing");
    }

    // Persist filler drafts via genuine HTTP so victim rule/version IDs exceed
    // six without inventing identifiers or introducing real automation events.
    for (const filler of fillers) {
      const name = filler.marker + " inert filler";
      const result = await post(filler, templateBody(filler, name));
      assertOwnedDraft(result, filler, "filler template", name);
    }
    const victimBefore = await snapshot(victim.org.id);
    const victimName = victim.marker + " protected draft";
    const victimCreate = await post(victim, saveBody(victim, victimName));
    const victimAfter = await snapshot(victim.org.id);
    victim.saved = assertCreateDelta(victimBefore, victimAfter, victim, victimCreate,
      victimName, "Automation Studio draft created", false);
    ownCreates++;
    assert.ok(victim.saved.rule.id > 6 && victim.saved.draft.id > 6,
      "The victim's real rule/version IDs must be greater than six");
    const baseline = new Map(subjects.map(x => [x.org.id, null]));
    for (const actor of subjects) baseline.set(actor.org.id, await snapshot(actor.org.id));
    const assertAllUnchanged = async label => {
      for (const actor of subjects) {
        assert.deepEqual(await snapshot(actor.org.id), baseline.get(actor.org.id),
          label + ": unauthorized SQL change to " + actor.label);
      }
    };
    const denied = async (actor, body, status, label, options = {}) => {
      const response = await post(actor, body, options);
      assertDeniedDraft(response, status, subjects, label);
      await assertAllUnchanged(label);
      if (label.includes("foreign")) foreignDenials++;
      else otherDenials++;
      return response;
    };

    for (const actor of [a, b]) {
      const name = actor.marker + " own draft";
      const before = await snapshot(actor.org.id);
      const res = await post(actor, saveBody(actor, name));
      const after = await snapshot(actor.org.id);
      actor.saved = assertCreateDelta(before, after, actor, res,
        name, "Automation Studio draft created", false);
      baseline.set(actor.org.id, after);
      await assertAllUnchanged("owned save-rule left other tenants unchanged");
      ownCreates++;

      const templateName = actor.marker + " own template";
      const templateBefore = await snapshot(actor.org.id);
      const templated = await post(actor, templateBody(actor, templateName));
      const templateAfter = await snapshot(actor.org.id);
      actor.template = assertCreateDelta(templateBefore, templateAfter, actor,
        templated, templateName, "Automation Studio template instantiated as draft", true);
      assert.equal(templated.json?.template?.id, STUDIO_DRAFT_TEMPLATE);
      baseline.set(actor.org.id, templateAfter);
      await assertAllUnchanged("owned template creation isolated");
      ownCreates++;

      const changedName = actor.marker + " revised draft";
      const updateBefore = await snapshot(actor.org.id);
      const updated = await post(actor, saveBody(actor, changedName, actor.saved.rule.id));
      assert.equal(updated.status, 200, "A persisted own draft update must return HTTP 200");
      assert.equal(updated.json?.created, false);
      assert.equal(updated.json?.rule?.id, actor.saved.rule.id);
      assert.equal(updated.json?.draft?.id, actor.saved.draft.id);
      assert.equal(updated.json?.draft?.name, changedName);
      assert.equal(updated.json?.draft?.status, "draft");
      const updateAfter = await snapshot(actor.org.id);
      assert.equal(updateAfter.automationRules.length, updateBefore.automationRules.length);
      assert.equal(updateAfter.automationRuleVersions.length, updateBefore.automationRuleVersions.length);
      assert.equal(updateAfter.auditEvents.length, updateBefore.auditEvents.length + 1);
      assert.equal(updateAfter.auditEvents.at(-1).action, "Automation Studio draft updated");
      const persistedVersion = updateAfter.automationRuleVersions
        .find(x => x.id === actor.saved.draft.id);
      assert.deepEqual(persistedVersion, plain(updated.json.draft));
      assert.equal(updateAfter.automationRules.find(x => x.id === actor.saved.rule.id).active, false);
      assert.equal(updateAfter.automationRules.find(x => x.id === actor.saved.rule.id).publishedVersion, 0);
      for (const table of tracked.filter(x =>
        !["automationRules", "automationRuleVersions", "auditEvents"].includes(x))) {
        assert.deepEqual(updateAfter[table], updateBefore[table],
          "Updating a draft must not touch " + table);
      }
      baseline.set(actor.org.id, updateAfter);
      await assertAllUnchanged("owned draft update isolated");
      ownUpdates++;
    }

    for (const actor of [a, b]) {
      const foreignOrgBody = { ...saveBody(actor, actor.marker + " foreign update", victim.saved.rule.id),
        organizationId: victim.org.id };
      await denied(actor, foreignOrgBody, 403, actor.label + " foreign organization update");
      await denied(actor, saveBody(actor, actor.marker + " foreign rule", victim.saved.rule.id),
        404, actor.label + " foreign rule ID in owned organization");
      await denied(actor, { ...templateBody(actor, actor.marker + " foreign template"),
        organizationId: victim.org.id }, 403, actor.label + " foreign template creation");
      const other = actor === a ? b : a;
      await denied(actor, saveBody(actor, actor.marker + " foreign peer", other.saved.rule.id),
        404, actor.label + " foreign peer rule ID");
    }
    await denied(a, { ...templateBody(a, a.marker + " unknown template"),
      templateId: "fictional-unknown-template" }, 404, "unknown template");
    await denied(a, { ...saveBody(a, ""), name: "" }, 400, "invalid draft name");
    await denied(a, { organizationId: a.org.id, action: "unsupported-future-action" },
      400, "unsupported action");
    await denied(a, { organizationId: a.org.id, action: "publish-rule",
      ruleId: a.saved.rule.id, humanApproved: true }, 409,
      "cannot publish a draft without session-bound Impact Preview receipt");
    await denied(a, { organizationId: a.org.id, action: "set-active",
      ruleId: a.saved.rule.id, active: true }, 409,
      "unpublished rule cannot become active");
    await denied(a, saveBody(a, a.marker + " anonymous"), 401, "anonymous",
      { cookie: null });
    await denied(a, saveBody(a, a.marker + " cross-site"), 403, "cross-site",
      { origin: "https://attacker.invalid", site: "cross-site" });

    const [hr] = await db.insert(s.users).values({
      email: "studio-draft-hr-" + nonce + "@example.invalid",
      name: "Fictional HR caller", passwordHash: "fictional-no-login",
      role: "owner", totpEnabled: true,
    }).returning();
    await db.insert(s.userOrganizations).values({
      userId: hr.id, organizationId: a.org.id, role: "hr", active: true,
    });
    const hrSession = await fixtures.standaloneMakeSession(hr.id);
    await db.update(s.sessions).set({ mfaVerifiedAt: new Date() })
      .where(eq(s.sessions.id, hrSession.id));
    baseline.set(a.org.id, await snapshot(a.org.id));
    await denied(a, saveBody(a, a.marker + " HR denied"), 403,
      "non-admin HR denied", { cookie: hrSession.cookie });

    const [session] = await db.select().from(s.sessions)
      .where(eq(s.sessions.userId, a.owner.id)).limit(1);
    await db.update(s.sessions).set({ mfaVerifiedAt: null }).where(eq(s.sessions.id, session.id));
    await denied(a, saveBody(a, a.marker + " no-MFA denied"), 403, "missing MFA");
    await db.update(s.sessions).set({ mfaVerifiedAt: new Date() }).where(eq(s.sessions.id, session.id));
    await db.update(s.userOrganizations).set({ active: false })
      .where(and(eq(s.userOrganizations.userId, a.owner.id),
        eq(s.userOrganizations.organizationId, a.org.id)));
    baseline.set(a.org.id, await snapshot(a.org.id));
    await denied(a, saveBody(a, a.marker + " revoked denied"), 403,
      "revoked membership with a live session");
    await db.update(s.userOrganizations).set({ active: true })
      .where(and(eq(s.userOrganizations.userId, a.owner.id),
        eq(s.userOrganizations.organizationId, a.org.id)));
    baseline.set(a.org.id, await snapshot(a.org.id));
    await assertAllUnchanged("final protected-tenant SQL snapshots");

    assert.equal(ownCreates, 5, "Two owners and the real victim must persist 5 drafts");
    assert.equal(ownUpdates, 2, "Both independent owners must update their own draft");
    assert.equal(foreignDenials, 8, "Each attacker must fail all four real foreign selectors");
    assert.equal(otherDenials, 14, "All other security denials must execute");
    console.log("TENANT_STUDIO_DRAFT_HTTP_COMPLETE " + JSON.stringify({
      family: "automation-studio-rule-draft-and-template",
      fictionalPG16: true, ownCreates, ownUpdates, foreignDenials, otherDenials,
      victimRuleAndVersionIdsOverSix: true,
      victimSQLUnchangedByAttackers: true, rulesUnpublishedAndInactive: true,
      automationExecutions: 0, externalProviders: 0,
      wholePostCertified: false, methodCoverageCredits: 0,
      productionCertified: false, independentlyAccepted: false,
    }));
  } finally {
    await pool.end();
  }
}
if (process.argv[1]?.endsWith("tenant-studio-draft-http.mjs")) {
  proveStudioDraftIsolation().catch(e => {
    console.error("TENANT_STUDIO_DRAFT_HTTP_FAILED " + (e?.stack ?? String(e)));
    process.exitCode = 1;
  });
}
