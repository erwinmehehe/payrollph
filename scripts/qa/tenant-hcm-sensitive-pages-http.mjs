/**
 * Two private HCM SSR page isolation proofs using real localhost HTTP +
 * disposable PostgreSQL 16. Never run against deployed or customer data.
 * Zero page/method credits and zero production/security acceptance.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  ORIGIN, MONITOR_PATH, HIRE_PATH, requireFictionalHcmEnv,
  verifyHcmPageSources, assertNoTenantLeak, assertOwnMonitor,
  assertOwnHireReview, assertDeniedPage, assertSqlUnchanged,
} from "./tenant-hcm-sensitive-pages-contract.mjs";

const plain = value => JSON.parse(JSON.stringify(value));
const monitorUrl = (org, extra = "") =>
  MONITOR_PATH + "?organizationId=" + org + extra;
const hireUrl = (org, worker, extra = "") =>
  HIRE_PATH + "?organizationId=" + org + "&employeeId=" + worker + extra;

async function httpGet(path, cookie) {
  assert.ok(path === "/api/account" ||
    path.startsWith(MONITOR_PATH + "?") || path.startsWith(HIRE_PATH + "?"),
  "HCM_SSR_REFUSED: HTTP target outside reviewed page scope");
  const res = await fetch(ORIGIN + path, {
    method: "GET", redirect: "manual", cache: "no-store",
    headers: cookie ? { cookie } : {},
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* Next SSR/denials can be HTML */ }
  return { status: res.status, text, headers: res.headers, json };
}

export async function proveSensitiveHcmSsrIsolation() {
  // ALL gates precede loading database, schema and seed helpers.
  requireFictionalHcmEnv();
  verifyHcmPageSources();
  const [{ db, pool }, s, { and, asc, eq }, fixture] = await Promise.all([
    import("../../src/db/index.ts"), import("../../src/db/schema.ts"),
    import("drizzle-orm"), import("./tenant-table-http.mjs"),
  ]);
  const tables = [
    "organizations", "legalEntities", "orgUnits", "userOrganizations",
    "employees", "employeePayProfiles", "provisioningTasks",
    "hcmBusinessProcessInstances", "hcmBusinessProcessInstanceSteps",
    "auditEvents", "payrollRuns", "payoutBatches",
  ];
  const snapshot = async orgId => {
    const state = {};
    for (const name of tables) {
      const table = s[name];
      assert.ok(table?.id && (name === "organizations" || table.organizationId),
        "Missing protected SQL table or employer column: " + name);
      state[name] = plain(await db.select().from(table)
        .where(eq(name === "organizations" ? table.id : table.organizationId, orgId))
        .orderBy(asc(table.id)));
    }
    return state;
  };

  let monitorPositives = 0, hirePositives = 0;
  let foreignDenials = 0, negativeChecks = 0;
  try {
    const pg = Number((await pool.query("SHOW server_version_num"))
      .rows[0].server_version_num);
    assert.ok(pg >= 160000 && pg < 170000,
      "HCM_SSR_REFUSED: a real PostgreSQL 16 engine is required");
    assert.equal((await db.select().from(s.organizations).limit(1)).length, 0,
      "HCM_SSR_REFUSED: existing employer rows, not disposable");
    assert.equal((await db.select().from(s.users).limit(1)).length, 0,
      "HCM_SSR_REFUSED: existing user rows, not disposable");

    const nonce = randomUUID().replaceAll("-", "").slice(0, 12);
    const actors = [];
    async function seed(label) {
      const actor = {
        ...(await fixture.seedEmployer(label, nonce, fixture.standaloneMakeSession)),
        label, processes: [],
      };
      actor.secondWorker = await fixture.addWorker(actor, "SECOND");
      actor.secrets = [
        "PRIVATE-BANK-" + label + "-" + nonce,
        "PRIVATE-TAX-" + label + "-" + nonce,
        "PRIVATE-PROCESS-" + label + "-" + nonce,
        "PRIVATE-STEP-" + label + "-" + nonce,
      ];
      await db.update(s.employees).set({
        bankAccount: actor.secrets[0], tin: actor.secrets[1],
      }).where(eq(s.employees.id, actor.worker.id));
      for (const [index, status] of ["in_progress", "approved"].entries()) {
        const [process] = await db.insert(s.hcmBusinessProcessInstances).values({
          organizationId: actor.org.id,
          definitionCode: "qa-hcm-isolation", definitionVersion: 1,
          processType: "hire", sourceType: "qa-only",
          sourceKey: actor.marker + "-process-" + index,
          definitionSnapshot: { privateNote: actor.secrets[2] },
          employeeId: actor.worker.id, supervisoryOrgUnitId: actor.unit.id,
          effectiveDate: "2026-11-10", status,
          currentStepIndex: 0, initiatedByUserId: actor.owner.id,
          initiatedByName: actor.owner.name,
        }).returning();
        await db.insert(s.hcmBusinessProcessInstanceSteps).values({
          organizationId: actor.org.id, instanceId: process.id,
          stepIndex: 0, stepType: "review",
          label: actor.secrets[3], assignee: "role:hr",
          status: "pending", dueAt: new Date("2026-12-01T01:00:00.000Z"),
        });
        actor.processes.push(process);
      }
      return actor;
    }

    // Seven populated filler employers force all real test objects above six.
    const fillers = [];
    for (let i = 1; i <= 7; i++) fillers.push(await seed("FILL" + i));
    for (const label of ["ATTA", "ATTB", "VICTIM"]) actors.push(await seed(label));
    const [a, b, victim] = actors;
    const everyone = [...fillers, ...actors];
    assert.deepEqual(actors.map(x => x.org.id), [8, 9, 10],
      "Fictional test allowlist must match the actual seeded employer IDs");
    assert.equal(new Set(actors.map(x => x.cookie)).size, 3,
      "Three distinct authenticated owner sessions required");
    for (const key of ["org", "entity", "unit", "worker", "secondWorker", "owner"]) {
      assert.ok(victim[key].id > Math.max(a[key].id, b[key].id, 6),
        "Real higher-ID victim must be seeded for " + key);
    }
    assert.ok(victim.processes.every(row =>
      row.id > Math.max(...a.processes.map(x => x.id),
        ...b.processes.map(x => x.id), 6)),
      "Real persisted higher-ID victim workflow records are required");

    async function roleUser(role, orgUnitId) {
      const [user] = await db.insert(s.users).values({
        email: "hcm-sensitive-" + role + "-" + nonce + "@example.invalid",
        name: "Fictional " + role + " SSR reader",
        passwordHash: "fictional-only", role: "owner", totpEnabled: true,
      }).returning();
      await db.insert(s.userOrganizations).values({
        organizationId: a.org.id, userId: user.id,
        role, orgUnitId, active: true,
      });
      const session = await fixture.standaloneMakeSession(user.id);
      await db.update(s.sessions).set({ mfaVerifiedAt: new Date() })
        .where(eq(s.sessions.id, session.id));
      return { user, cookie: session.cookie };
    }
    const companyHr = await roleUser("hr", null);
    const unitHr = await roleUser("hr", a.unit.id);
    const bookkeeper = await roleUser("bookkeeper", null);

    const baselines = new Map();
    for (const actor of everyone)
      baselines.set(actor.org.id, await snapshot(actor.org.id));

    const unchanged = async label => {
      for (const actor of everyone)
        assertSqlUnchanged(baselines.get(actor.org.id),
          await snapshot(actor.org.id), label + " / " + actor.label);
    };
    async function deny(path, cookie, label, foreign = false) {
      const response = await httpGet(path, cookie);
      assertDeniedPage(response, everyone, label);
      negativeChecks++;
      if (foreign) foreignDenials++;
      return response;
    }
    async function ownMonitor(actor, cookie, process, extra = "") {
      const response = await httpGet(monitorUrl(
        actor.org.id, "&processId=" + process.id + extra), cookie);
      assertOwnMonitor(response, actor, process, everyone);
      monitorPositives++;
    }
    async function ownHire(actor, cookie, worker) {
      const response = await httpGet(hireUrl(actor.org.id, worker.id), cookie);
      assertOwnHireReview(response, actor, worker, everyone);
      hirePositives++;
    }

    for (const actor of [a, b]) {
      const loggedIn = await httpGet("/api/account", actor.cookie);
      assert.equal(loggedIn.status, 200, "Signed-in owner must be real");
      assert.equal(loggedIn.json?.profile?.id, actor.owner.id);
      await ownMonitor(actor, actor.cookie, actor.processes[0]);
      await ownMonitor(actor, actor.cookie, actor.processes[1],
        "&status=approved");
      await ownHire(actor, actor.cookie, actor.worker);
      await ownHire(actor, actor.cookie, actor.secondWorker);
      await unchanged("owner data reads " + actor.label);

      for (const foreign of actors.filter(x => x !== actor)) {
        await deny(monitorUrl(foreign.org.id, "&processId=" + foreign.processes[0].id),
          actor.cookie, actor.label + " foreign monitor " + foreign.label, true);
        await deny(hireUrl(foreign.org.id, foreign.worker.id),
          actor.cookie, actor.label + " foreign hire " + foreign.label, true);
        await deny(monitorUrl(actor.org.id, "&processId=" + foreign.processes[0].id),
          actor.cookie, actor.label + " forged workflow ID " + foreign.label, true);
        await deny(hireUrl(actor.org.id, foreign.worker.id),
          actor.cookie, actor.label + " forged worker ID " + foreign.label, true);
      }
      for (const raw of ["0", "01", "1e0", "-1", "bad"]) {
        await deny(monitorUrl(raw), actor.cookie,
          actor.label + " malformed monitor employer " + raw);
        await deny(hireUrl(raw, actor.worker.id), actor.cookie,
          actor.label + " malformed hire employer " + raw);
        await deny(monitorUrl(actor.org.id, "&processId=" + raw),
          actor.cookie, actor.label + " malformed workflow " + raw);
        await deny(hireUrl(actor.org.id, raw), actor.cookie,
          actor.label + " malformed worker " + raw);
      }
      await deny(monitorUrl(actor.org.id, "&organizationId=" + victim.org.id),
        actor.cookie, actor.label + " duplicate monitor org");
      await deny(hireUrl(actor.org.id, actor.worker.id,
        "&organizationId=" + victim.org.id),
        actor.cookie, actor.label + " duplicate hire org");
      await deny(monitorUrl(actor.org.id,
        "&processId=" + actor.processes[0].id +
        "&processId=" + victim.processes[0].id),
        actor.cookie, actor.label + " duplicate process");
      await deny(hireUrl(actor.org.id, actor.worker.id,
        "&employeeId=" + victim.worker.id),
        actor.cookie, actor.label + " duplicate worker");
      for (const extra of ["&status=unknown", "&status=approved&status=failed",
        "&cursor=-1", "&cursor=01", "&cursor=1&cursor=2"]) {
        await deny(monitorUrl(actor.org.id, extra),
          actor.cookie, actor.label + " invalid monitor filter/cursor " + extra);
      }
      await unchanged("denied reads " + actor.label);
    }

    await ownMonitor(a, companyHr.cookie, a.processes[0]);
    await ownHire(a, companyHr.cookie, a.worker);
    for (const [label, person] of [
      ["unit-scoped HR", unitHr], ["bookkeeper", bookkeeper],
    ]) {
      await deny(monitorUrl(a.org.id, "&processId=" + a.processes[0].id),
        person.cookie, label + " monitor denied");
      await deny(hireUrl(a.org.id, a.worker.id),
        person.cookie, label + " hire denied");
    }

    for (const page of [
      monitorUrl(a.org.id, "&processId=" + a.processes[0].id),
      hireUrl(a.org.id, a.worker.id),
    ]) {
      const anonymous = await httpGet(page);
      assert.ok([307, 308].includes(anonymous.status),
        "Anonymous private HCM SSR must redirect to login");
      assert.ok(anonymous.headers.get("location")?.includes("/login"));
      assertNoTenantLeak(anonymous, everyone, "anonymous HCM SSR");
      negativeChecks++;
    }
    await unchanged("anonymous and role denial reads");

    // Membership changes occur in fixture SQL only; retain the same cookie
    // and prove every subsequent request reauthorizes current membership.
    const [revoked] = await db.update(s.userOrganizations)
      .set({ active: false })
      .where(and(eq(s.userOrganizations.userId, a.owner.id),
        eq(s.userOrganizations.organizationId, a.org.id))).returning();
    assert.equal(revoked?.userId, a.owner.id);
    baselines.set(a.org.id, await snapshot(a.org.id));
    const stillSignedIn = await httpGet("/api/account", a.cookie);
    assert.equal(stillSignedIn.status, 200);
    assert.equal(stillSignedIn.json?.profile?.id, a.owner.id);
    await deny(monitorUrl(a.org.id, "&processId=" + a.processes[0].id),
      a.cookie, "revoked owner monitor");
    await deny(hireUrl(a.org.id, a.worker.id),
      a.cookie, "revoked owner hire");
    await unchanged("final revoked read-only SQL");
    assert.equal(monitorPositives, 5,
      "Two owners require both statuses plus one genuine company-wide HR read");
    assert.equal(hirePositives, 5,
      "Both workers of each owner and one company-wide HR read are required");
    assert.equal(foreignDenials, 16,
      "Two attackers must deny real other-owner and higher-ID victim objects");
    assert.ok(negativeChecks >= 75, "Do not reduce adversarial SSR coverage");

    console.log(JSON.stringify({
      family: "tenant-hcm-monitor-and-hire-ssr", postgresMajor: 16,
      employers: everyone.length, independentOwners: 2, highIdVictim: true,
      monitorPositives, hirePositives, foreignDenials, negativeChecks,
      protectedTables: tables.length, sqlAndAuditUnchanged: true,
      crossTenantSelectionDenied: true, workerAndProcessBindingChecked: true,
      revokedMembershipDeniedWithValidSession: true,
      sourceConfidentialityChecked: true,
      methodCredits: 0, pageActionCredits: 0,
      realEmployerDataUsed: false, providerCalls: 0,
      independentlyAccepted: false, productionCertified: false,
    }));
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/")
    .endsWith("scripts/qa/tenant-hcm-sensitive-pages-http.mjs"))
  await proveSensitiveHcmSsrIsolation();
