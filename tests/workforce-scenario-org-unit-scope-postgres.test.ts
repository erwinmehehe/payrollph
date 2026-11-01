import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";

const enabled = process.env.WORKFORCE_SCENARIO_SCOPE_PROOF_MODE === "disposable-only";
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.protocol, "postgresql:");
  assert.equal(url.pathname, "/app_db");
  assert.equal(url.username, "postgres");
}

test("PG: scenario POST refuses another employer's and a nonexistent org unit identically", { skip: !enabled }, async () => {
  const require = createRequire(import.meta.url);
  const authPath = require.resolve("../src/lib/auth.ts"), originalAuth = require(authPath);
  let identity: unknown = null;
  // Route fixture only: real SQL authorization; no claim of browser/session proof.
  require.cache[authPath]!.exports = { ...originalAuth, getSessionUser: async () => identity };
  const { db, pool } = await import("../src/db");
  const s = await import("../src/db/schema");
  const { eq, inArray } = await import("drizzle-orm");
  const post = require("../src/app/api/workforce-planning/scenarios/route.ts").POST;
  const nonce = randomBytes(8).toString("hex");
  const savedBase = process.env.APP_BASE_URL;
  process.env.APP_BASE_URL = "http://127.0.0.1:3011";
  const orgs: number[] = [], users: number[] = [];
  try {
    const [attackerOrg, victimOrg] = await db.insert(s.organizations).values([
      { name: "Fictional scope attacker " + nonce, legalName: "Fictional attacker" },
      { name: "Fictional scope victim " + nonce, legalName: "Fictional victim" },
    ]).returning();
    orgs.push(attackerOrg.id, victimOrg.id);
    const entities = await db.insert(s.legalEntities).values([attackerOrg, victimOrg].map(org => ({
      organizationId: org.id, code: "PRIMARY", legalName: org.legalName, displayName: org.name, primaryEntity: true,
    }))).returning();
    const [ownUnit, victimUnit] = await db.insert(s.orgUnits).values([attackerOrg, victimOrg].map((org, i) => ({
      organizationId: org.id, legalEntityId: entities[i].id, type: "department",
      name: "Fictional unit " + i + nonce, code: "SCOPE-" + i,
    }))).returning();
    const [owner] = await db.insert(s.users).values({
      email: `scope-${nonce}@example.invalid`, name: "Fictional owner", passwordHash: "not-a-login", role: "owner",
    }).returning();
    users.push(owner.id);
    await db.insert(s.userOrganizations).values({ organizationId: attackerOrg.id, userId: owner.id, role: "owner", active: true });
    identity = owner;

    const request = (scopeOrgUnitId: number) => new Request("http://127.0.0.1:3011/api/workforce-planning/scenarios", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:3011", "content-type": "application/json" },
      body: JSON.stringify({
        organizationId: attackerOrg.id, name: "Scope probe " + nonce,
        startDate: "2026-11-01", endDate: "2026-11-30", scopeOrgUnitId,
      }),
    });
    const scenarioRows = () => db.select().from(s.workforcePlanningScenarios)
      .where(eq(s.workforcePlanningScenarios.organizationId, attackerOrg.id));

    // Control: the caller's own unit still works and writes exactly one row.
    const own = await post(request(ownUnit.id));
    assert.equal(own.status, 201);
    assert.equal((await scenarioRows()).length, 1);

    const maxId = Math.max(...(await db.select({ id: s.orgUnits.id }).from(s.orgUnits)).map(row => row.id));
    const foreign = await post(request(victimUnit.id));
    const missing = await post(request(maxId + 1_000_000));
    const foreignBody = await foreign.text();
    const missingBody = await missing.text();

    assert.equal(foreign.status, 403);
    assert.equal(missing.status, foreign.status, "missing and foreign units must share a status");
    assert.equal(missingBody, foreignBody, "missing and foreign units must share a body");
    for (const body of [foreignBody, missingBody]) {
      assert.ok(!/Failed query|insert into|workforce_planning_scenarios/i.test(body), "no SQL text may reach the client");
    }

    // Nothing was written by the refused requests, and no row points at the victim.
    assert.equal((await scenarioRows()).length, 1);
    const referencing = await db.select().from(s.workforcePlanningScenarios)
      .where(eq(s.workforcePlanningScenarios.scopeOrgUnitId, victimUnit.id));
    assert.equal(referencing.length, 0);
  } finally {
    if (savedBase === undefined) delete process.env.APP_BASE_URL; else process.env.APP_BASE_URL = savedBase;
    if (orgs.length) {
      await db.delete(s.workforcePlanningScenarios).where(inArray(s.workforcePlanningScenarios.organizationId, orgs)).catch(() => undefined);
      await db.delete(s.organizations).where(inArray(s.organizations.id, orgs)).catch(() => undefined);
    }
    if (users.length) await db.delete(s.users).where(inArray(s.users.id, users)).catch(() => undefined);
    await pool.end();
  }
});
