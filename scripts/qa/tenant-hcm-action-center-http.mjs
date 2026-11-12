/** Real signed-session SSR isolation. NO production, provider or payroll actions. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { ORIGIN, PAGE, SOURCE_PINS, requireFictionalEnvironment, verifySources,
  assertOwnPage, assertDenied, assertNoLeak, assertSqlUnchanged
} from "./tenant-hcm-action-center-contract.mjs";
const plain = x => JSON.parse(JSON.stringify(x));
const url = id => PAGE + "?organizationId=" + id;
async function get(path, cookie, extra = {}) {
  assert.ok(path === "/api/account" || path === PAGE || path.startsWith(PAGE + "?"));
  assert.ok(!path.includes("://") && !path.includes("#"));
  const res = await fetch(ORIGIN + path, { method: "GET", redirect: "manual",
    cache: "no-store", headers: { ...extra, ...(cookie ? { cookie } : {}) },
    signal: AbortSignal.timeout(30000) });
  const text = await res.text();
  return { status: res.status, text, headers: res.headers };
}
export async function proveActionCenter() {
  // Refuse unsafe targets and source drift BEFORE loading any database fixture.
  requireFictionalEnvironment();
  verifySources();
  const [{ db, pool }, s, { and, asc, eq }, fixture] = await Promise.all([
    import("../../src/db/index.ts"), import("../../src/db/schema.ts"),
    import("drizzle-orm"), import("./tenant-table-http.mjs")
  ]);
  const tables = ["organizations", "legalEntities", "orgUnits", "userOrganizations",
    "userLegalEntityGrants", "permissionSets", "userPermissionAssignments", "approvalDelegations",
    "employees", "employeePayProfiles", "hcmBusinessProcessInstances",
    "hcmBusinessProcessInstanceSteps", "hcmLifecycleNotificationTasks", "provisioningTasks",
    "automationOperationalCases", "auditEvents", "payrollRuns", "payoutBatches", "outbox"];
  async function snapshot(org) {
    const result = {};
    for (const name of tables) {
      const t = s[name];
      assert.ok(t?.id && (name === "organizations" || t.organizationId), "Unknown protected table " + name);
      result[name] = plain(await db.select().from(t)
        .where(eq(name === "organizations" ? t.id : t.organizationId, org)).orderBy(asc(t.id)));
    }
    return result;
  }
  let ownPages = 0, foreignDenials = 0, denials = 0, snapshotChecks = 0;
  try {
    const pg = Number((await pool.query("SHOW server_version_num")).rows[0].server_version_num);
    assert.ok(pg >= 160000 && pg < 170000, "Fictional PG16 required");
    for (const t of [s.organizations, s.users])
      assert.equal((await db.select().from(t).limit(1)).length, 0, "Refuse nonempty fixture database");
    const nonce = randomUUID().replaceAll("-", "").slice(0, 12);
    async function seed(label, processType = "transfer", processLabel = "Transfer") {
      const a = await fixture.seedEmployer(label, nonce, fixture.standaloneMakeSession);
      a.processLabel = processLabel;
      a.secrets = ["PRIVATE-NAME-" + label + nonce, "PRIVATE-NOTE-" + label + nonce];
      // Global owner role is deliberately NOT the organization authorization.
      const [membership] = await db.update(s.userOrganizations).set({ role: "hr" })
        .where(and(eq(s.userOrganizations.userId, a.owner.id),
          eq(s.userOrganizations.organizationId, a.org.id))).returning();
      a.membership = membership;
      await db.update(s.employees).set({ firstName: a.secrets[0] }).where(eq(s.employees.id, a.worker.id));
      const [flow] = await db.insert(s.hcmBusinessProcessInstances).values({
        organizationId: a.org.id, employeeId: a.worker.id, definitionCode: "action-center-proof",
        definitionVersion: 1, processType, sourceType: "fictional-page-proof", sourceKey: a.marker,
        definitionSnapshot: { steps: [], privateNote: a.secrets[1] },
        initiatedByName: "Fictional maker", status: "in_progress"
      }).returning();
      a.flow = flow;
      const [step] = await db.insert(s.hcmBusinessProcessInstanceSteps).values({
        organizationId: a.org.id, instanceId: flow.id, stepIndex: 0,
        stepType: "approval", label: a.secrets[1], assignee: "role:hr", status: "pending"
      }).returning();
      a.step = step;
      const [lifecycle] = await db.insert(s.hcmLifecycleNotificationTasks).values({
        organizationId: a.org.id, employeeId: a.worker.id, sourceType: "employment_term",
        sourceId: a.worker.id, sourceKey: a.marker, action: "review", stage: "upcoming",
        severity: "warning", title: a.secrets[1], detail: a.secrets[1], dueDate: "2026-11-01"
      }).returning();
      a.lifecycle = lifecycle;
      const [provisioning] = await db.insert(s.provisioningTasks).values({
        organizationId: a.org.id, employeeId: a.worker.id, kind: "onboarding",
        title: a.secrets[1], done: false
      }).returning();
      a.provisioning = provisioning;
      const [ownedCase] = await db.insert(s.automationOperationalCases).values({
        organizationId: a.org.id, caseType: "coverage_recovery", sourceType: "fictional-page-proof",
        sourceId: a.worker.id, assignedOwnerUserId: a.owner.id, ownerTeam: "HR Operations",
        title: a.secrets[1], detail: a.secrets[1], status: "open"
      }).returning();
      a.ownedCase = ownedCase;
      return a;
    }
    const fillers = [];
    for (let i = 1; i <= 7; i++) fillers.push(await seed("FILL" + i));
    const a = await seed("ATTA"), b = await seed("ATTB", "hire", "Hire");
    const victim = await seed("VICTIM", "termination", "Termination");
    const actors = [a, b, victim], all = [...fillers, ...actors];
    assert.deepEqual(actors.map(x => x.org.id), [8, 9, 10]);
    assert.equal(new Set(actors.map(x => x.cookie)).size, 3);
    for (const k of ["org", "owner", "worker", "flow", "step", "lifecycle", "provisioning", "ownedCase"])
      assert.ok(victim[k].id > Math.max(a[k].id, b[k].id, 6), "Real higher-ID victim required: " + k);

    // Valid victim records assigned to each foreign actor must not inflate own case counts.
    for (const actor of [a, b]) await db.insert(s.automationOperationalCases).values({
      organizationId: victim.org.id, caseType: "timesheet_escalation", sourceType: "fictional-page-proof",
      sourceId: actor.worker.id, assignedOwnerUserId: actor.owner.id, ownerTeam: "HR Operations",
      title: victim.secrets[1], detail: victim.secrets[1], status: "open"
    });
    const [overlay] = await db.insert(s.permissionSets).values({ organizationId: a.org.id,
      name: "Fictional action-center restriction", permissions: ["people.admin"], active: true }).returning();
    await db.insert(s.userPermissionAssignments).values({ organizationId: a.org.id,
      userOrganizationId: a.membership.id, permissionSetId: overlay.id });
    const baselines = new Map();
    for (const actor of all) baselines.set(actor.org.id, await snapshot(actor.org.id));
    async function unchanged(label) {
      for (const actor of all) {
        assertSqlUnchanged(baselines.get(actor.org.id), await snapshot(actor.org.id), label);
        snapshotChecks++;
      }
    }
    async function own(actor, headers) {
      assertOwnPage(await get(url(actor.org.id), actor.cookie, headers), actor, all);
      ownPages++;
      await unchanged("owned SSR");
    }
    async function deny(path, cookie, headers, foreign = false) {
      assertDenied(await get(path, cookie, headers), all);
      denials++; if (foreign) foreignDenials++;
      await unchanged("denied SSR");
    }
    async function identity(actor) {
      const account = await get("/api/account", actor.cookie);
      assert.equal(account.status, 200, "Actual authenticated session required");
      assert.equal(JSON.parse(account.text).profile.id, actor.owner.id);
    }
    // Only the exact intentional fixture change may alter the comparison baseline.
    async function fixtureChange(table, id, patch) {
      await unchanged("before controlled fixture change");
      const expected = structuredClone(baselines.get(a.org.id));
      const row = expected[table].find(x => x.id === id);
      assert.ok(row, "Controlled fixture row must already exist");
      Object.assign(row, patch);
      await db.update(s[table]).set(patch).where(and(eq(s[table].id, id), eq(s[table].organizationId, a.org.id)));
      assertSqlUnchanged(expected, await snapshot(a.org.id), "only declared fixture fields change");
      baselines.set(a.org.id, expected);
    }
    for (const actor of actors) { await identity(actor); await own(actor); }
    for (const actor of [a, b]) {
      for (const target of actors.filter(x => x !== actor)) {
        await deny(url(target.org.id), actor.cookie, {}, true);
        await deny(url(target.org.id), actor.cookie,
          { "x-organization-id": String(actor.org.id), "x-tenant-id": String(actor.org.id) }, true);
      }
      await own(actor, { "x-organization-id": String(victim.org.id), "x-tenant-id": String(victim.org.id) });
      for (const id of ["", "0", "-1", "01", "1e0", "bad", "9007199254740992", "999999"])
        await deny(url(id), actor.cookie);
      await deny(PAGE, actor.cookie);
      for (const ids of [[actor.org.id, victim.org.id], [victim.org.id, actor.org.id], [actor.org.id, actor.org.id]])
        await deny(url(ids[0]) + "&organizationId=" + ids[1], actor.cookie);
      await deny(url(fillers[0].org.id), actor.cookie); // Existing but rollout-disabled employer.
    }
    await deny(url(fillers[0].org.id), fillers[0].cookie);
    const anonymous = await get(url(a.org.id));
    assert.equal(anonymous.status, 307, "Anonymous session must redirect to login");
    assert.equal(new URL(anonymous.headers.get("location"), ORIGIN).pathname, "/login");
    assertNoLeak(anonymous, all);
    await unchanged("anonymous redirect");

    for (const patch of [{ role: "bookkeeper" }, { role: "employee" },
      { role: "manager", orgUnitId: a.unit.id }, { role: "hr", orgUnitId: a.unit.id },
      { role: "hr", orgUnitId: null, active: false }]) {
      await fixtureChange("userOrganizations", a.membership.id, patch);
      await identity(a); // A still-valid account is NOT current employer permission.
      await deny(url(a.org.id), a.cookie);
    }
    await fixtureChange("userOrganizations", a.membership.id, { role: "hr", orgUnitId: null, active: true });
    await own(a);
    await fixtureChange("permissionSets", overlay.id, { permissions: [] });
    await identity(a);
    await deny(url(a.org.id), a.cookie);
    await fixtureChange("permissionSets", overlay.id, { permissions: ["people.admin"] });
    await own(a);
    await own(victim);
    assert.equal(ownPages, 8);
    assert.equal(foreignDenials, 8);
    assert.equal(denials, 41);
    verifySources();
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    assert.match(sha, /^[a-f0-9]{40}$/);
    const evidence = { family: "hcm-action-center-ssr", testedCommit: sha, sourcePins: SOURCE_PINS,
      fictionalPg16: true, populatedEmployers: all.length, independentHrSessions: 2,
      populatedHigherIdVictim: true, ownPages, foreignDenials, denialChecks: denials,
      anonymousLoginRedirects: 1, protectedTables: tables.length, snapshotChecks,
      immutableProtectedSql: true, activeSessionRevocationDenied: true,
      customPermissionRevocationDenied: true, privateHtmlAndEmbeddedRscChecked: true,
      clientBrowserInteractionsProven: false, sameParentLegalEntityProof: false,
      pageActionCredits: 0, apiMethodCredits: 0, independentlyAccepted: false,
      productionCertified: false, externalProviders: 0, realUsers: 0, moneyMoved: false };
    mkdirSync("artifacts/tenant-hcm-action-center", { recursive: true });
    writeFileSync("artifacts/tenant-hcm-action-center/evidence.json", JSON.stringify(evidence, null, 2) + "\n");
    console.log(JSON.stringify(evidence));
  } finally { await pool.end(); }
}
if (process.argv[1]?.replaceAll("\\", "/").endsWith("scripts/qa/tenant-hcm-action-center-http.mjs"))
  await proveActionCenter();
