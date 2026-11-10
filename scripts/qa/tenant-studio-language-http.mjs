/**
 * Real PostgreSQL 16 / localhost Next.js multi-employer proof for the
 * model-disabled, approved-template Automation Studio language lane.
 * All rule saves remain inert drafts. No external model, provider or money.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  ORIGIN, ROUTE, PROMPT, requireDisposableStudioLanguageEnv,
  verifyStudioLanguageSources, assertDeniedLanguage,
  assertOwnProposal, assertOwnedLanguageSave,
} from "./tenant-studio-language-contract.mjs";

const plain = x => JSON.parse(JSON.stringify(x));
const conditions = { version: 1, all: [], any: [] };
const actions = [{ type: "create_task", title: "Review fictional onboarding",
  owner: "People Ops", kind: "automation" }];

async function post(actor, action, data = {}, opts = {}) {
  const headers = {
    "content-type": "application/json",
    origin: opts.origin ?? ORIGIN,
    "sec-fetch-site": opts.site ?? "same-origin",
  };
  if (opts.cookie !== null) headers.cookie = opts.cookie ?? actor.cookie;
  const response = await fetch(ORIGIN + ROUTE, {
    method: "POST", headers,
    body: JSON.stringify({ organizationId: actor.org.id, action, ...data }),
    redirect: "manual", cache: "no-store",
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* strict assertions reject it */ }
  return { status: response.status, text, json };
}
async function account(actor) {
  const response = await fetch(ORIGIN + "/api/account", {
    headers: { cookie: actor.cookie }, redirect: "manual",
    cache: "no-store", signal: AbortSignal.timeout(30000),
  });
  assert.equal(response.status, 200, "Real signed-in fictional employer required");
  assert.equal((await response.json()).profile.id, actor.owner.id);
}

export async function proveStudioLanguageTenantIsolation() {
  // All safety/source checks run before DB and app modules are imported.
  requireDisposableStudioLanguageEnv();
  verifyStudioLanguageSources();
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
    "automationOperationalCases", "automationEventLog", "payrollRuns",
    "outbox", "auditEvents",
  ];
  async function snapshot(orgId) {
    const data = {};
    for (const name of tracked) {
      const table = s[name];
      assert.ok(table?.id, "Source table missing primary key: " + name);
      const scope = name === "organizations" ? table.id : table.organizationId;
      assert.ok(scope, "Tracked source table must be organization scoped: " + name);
      data[name] = plain(await db.select().from(table)
        .where(eq(scope, orgId)).orderBy(asc(table.id)));
    }
    return data;
  }
  let subjects = [];
  const baseline = new Map();
  async function unchanged(label) {
    for (const actor of subjects) {
      assert.deepEqual(await snapshot(actor.org.id), baseline.get(actor.org.id),
        label + ": protected employer SQL/audit changed for " + actor.label);
    }
  }
  async function denied(actor, action, data, status, label, opts) {
    const res = await post(actor, action, data, opts);
    assertDeniedLanguage(res, status, subjects, label);
    await unchanged(label);
    return res;
  }
  async function proposal(actor) {
    const before = await snapshot(actor.org.id);
    const res = await post(actor, "draft-from-language", { request: PROMPT });
    const parsed = assertOwnProposal(res);
    const after = await snapshot(actor.org.id);
    assert.equal(after.auditEvents.length, before.auditEvents.length + 1,
      "Model-disabled language proposal may write one own-tenant audit");
    assert.equal(after.auditEvents.at(-1).action, "Automation Studio language draft proposed");
    assert.equal(after.auditEvents.at(-1).organizationId, actor.org.id);
    assert.deepEqual(after.auditEvents.slice(0, -1), before.auditEvents);
    for (const table of tracked) {
      if (table !== "auditEvents") assert.deepEqual(after[table], before[table],
        "Proposal must not persist or execute a workflow: " + table);
    }
    assert.ok(!after.auditEvents.some(row =>
      row.action === "External model draft request authorized"),
    "No external AI request may be authorized");
    baseline.set(actor.org.id, after);
    await unchanged("Own proposal changed other tenant data");
    actor.proposal = parsed;
    return parsed;
  }
  async function save(actor, override = {}) {
    const before = await snapshot(actor.org.id);
    const res = await post(actor, "save-language-draft", {
      draft: actor.proposal.draft, proposalReceipt: actor.proposal.receipt,
      active: true, ...override,
    });
    const owned = assertOwnedLanguageSave(res, actor);
    const after = await snapshot(actor.org.id);
    for (const table of tracked) {
      if (!["automationRules", "automationRuleVersions", "auditEvents"].includes(table))
        assert.deepEqual(after[table], before[table],
          "Language save must not touch other business data: " + table);
    }
    assert.equal(after.automationRules.length, before.automationRules.length + 1);
    assert.equal(after.automationRuleVersions.length, before.automationRuleVersions.length + 1);
    assert.equal(after.auditEvents.length, before.auditEvents.length + 1);
    assert.deepEqual(after.auditEvents.slice(0, -1), before.auditEvents);
    assert.equal(after.auditEvents.at(-1).organizationId, actor.org.id);
    assert.equal(after.auditEvents.at(-1).action, "Automation Studio signed language draft saved");
    assert.deepEqual(after.automationRules.find(x => x.id === owned.rule.id), plain(owned.rule),
      "Language-save response must equal persisted own rule");
    assert.deepEqual(after.automationRuleVersions.find(x => x.id === owned.draft.id), plain(owned.draft),
      "Language-save response must equal persisted own draft");
    assert.equal(owned.rule.active, false);
    assert.equal(owned.rule.publishedVersion, 0);
    baseline.set(actor.org.id, after);
    await unchanged("Signed own language save changed a foreign tenant");
    actor.saved = owned;
    return owned;
  }

  let ownProposals = 0, signedOwnSaves = 0;
  let foreignDenials = 0, otherDenials = 0;
  try {
    const pg = Number((await pool.query("SHOW server_version_num")).rows[0].server_version_num);
    assert.ok(pg >= 160000 && pg < 170000, "Disposable PostgreSQL 16 required");
    assert.equal((await db.select().from(s.organizations).limit(1)).length, 0,
      "Refuse pre-existing employer database");
    assert.equal((await db.select().from(s.users).limit(1)).length, 0,
      "Refuse pre-existing identity database");
    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
    const a = await fixtures.seedEmployer("ATTA", nonce, fixtures.standaloneMakeSession);
    const b = await fixtures.seedEmployer("ATTB", nonce, fixtures.standaloneMakeSession);
    const fillers = [];
    for (let i = 0; i < 7; i++)
      fillers.push(await fixtures.seedEmployer("FILL" + i, nonce,
        fixtures.standaloneMakeSession));
    const victim = await fixtures.seedEmployer("VICTIM", nonce,
      fixtures.standaloneMakeSession);
    subjects = [a, b, victim];
    assert.equal(new Set(subjects.map(x => x.cookie)).size, 3);
    for (const field of ["org", "owner", "entity", "unit", "worker"]) {
      assert.ok(victim[field].id > Math.max(6, a[field].id, b[field].id),
        "Real persisted victim business ID >6 required: " + field);
    }
    for (const actor of subjects) await account(actor);

    // Genuine filler HTTP writes establish high victim rule and version IDs.
    for (const filler of fillers) {
      const res = await post(filler, "save-rule", {
        name: filler.marker + " inert filler",
        trigger: "employee.hired", conditions, actions, active: false,
      });
      assert.equal(res.status, 201, "Persisted filler draft required");
      assert.equal(res.json?.rule?.organizationId, filler.org.id);
      assert.equal(res.json?.rule?.active, false);
      assert.equal(res.json?.draft?.status, "draft");
    }
    for (const actor of subjects) baseline.set(actor.org.id, await snapshot(actor.org.id));

    // Real victim positive control: receipt issued to victim identity only.
    await proposal(victim);
    ownProposals++;
    await save(victim);
    signedOwnSaves++;
    assert.ok(victim.saved.rule.id > 6 && victim.saved.draft.id > 6,
      "Real high-ID victim language rule/version required");
    await unchanged("High-ID victim fixture must remain protected");

    // Both independent attackers obtain their own genuine signed proposals.
    for (const actor of [a, b]) {
      const other = actor === a ? b : a;
      await proposal(actor);
      ownProposals++;
      assert.notEqual(actor.proposal.receipt, victim.proposal.receipt);
      if (other.proposal) assert.notEqual(actor.proposal.receipt, other.proposal.receipt);

      await denied(actor, "save-language-draft", {
        draft: { ...actor.proposal.draft, name: "Tampered other definition" },
        proposalReceipt: actor.proposal.receipt,
      }, 409, "changed typed definition must not reuse receipt");
      otherDenials++;

      await denied(actor, "save-language-draft", {
        draft: actor.proposal.draft,
        proposalReceipt: actor.proposal.receipt + "tampered",
      }, 409, "modified signature denied");
      otherDenials++;

      await denied(actor, "save-language-draft", {
        draft: actor.proposal.draft,
      }, 409, "missing signed proposal receipt");
      otherDenials++;

      await denied(actor, "save-language-draft", {
        draft: actor.proposal.draft, proposalReceipt: victim.proposal.receipt,
      }, 409, "victim session receipt cannot authorize attacker draft");
      otherDenials++;

      await denied(actor, "save-language-draft", {
        draft: { ...actor.proposal.draft, actions: [] },
        proposalReceipt: actor.proposal.receipt,
      }, 400, "invalid action structure denied");
      otherDenials++;

      for (const action of ["save-language-draft", "draft-from-language"]) {
        const details = action === "save-language-draft"
          ? { draft: actor.proposal.draft, proposalReceipt: actor.proposal.receipt }
          : { request: PROMPT };
        await denied(actor, action, {
          ...details, organizationId: victim.org.id,
        }, 403, "foreign organization " + action);
        foreignDenials++;
        await denied(actor, action, {
          ...details, organizationId: other.org.id,
        }, 403, "peer organization " + action);
        foreignDenials++;
      }

      await save(actor);
      signedOwnSaves++;
    }

    await denied(a, "save-language-draft", {
      draft: a.proposal.draft, proposalReceipt: a.proposal.receipt,
    }, 401, "anonymous signed save denied", { cookie: null });
    otherDenials++;

    await denied(a, "draft-from-language", { request: PROMPT }, 403,
      "cross-site language request denied",
      { origin: "https://attacker.invalid", site: "cross-site" });
    otherDenials++;

    assert.equal(ownProposals, 3);
    assert.equal(signedOwnSaves, 3);
    assert.equal(foreignDenials, 8);
    assert.equal(otherDenials, 12);
    await unchanged("Final owned/foreign language SQL snapshots");

    console.log("TENANT_STUDIO_LANGUAGE_HTTP_COMPLETE " + JSON.stringify({
      family: "automation-studio-language-proposal-signed-draft",
      fictionalPG16: true, independentlyAuthenticatedOwners: 2,
      realHighIdVictimRuleAndVersion: true,
      ownedProposals: ownProposals, signedOwnSaves,
      foreignDenials, otherDenials, realSignedSessionReceipts: true,
      noExternalModel: true, noPublishedOrActiveRule: true,
      noAutomationExecutionOrOutbox: true, protectedSQLUnchangedOnDenial: true,
      methodCoverageCredits: 0, wholePostCertified: false,
      independentlyAccepted: false, productionTested: false,
    }));
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.endsWith("tenant-studio-language-http.mjs")) {
  proveStudioLanguageTenantIsolation().catch(error => {
    console.error("TENANT_STUDIO_LANGUAGE_HTTP_FAILED " +
      (error instanceof Error ? error.stack : String(error)));
    process.exitCode = 1;
  });
}
