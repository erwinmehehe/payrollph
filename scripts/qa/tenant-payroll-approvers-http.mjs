/**
 * Two independent attackers and a real higher-ID victim.
 * Real Next HTTP against empty fictional PostgreSQL 16 only. Zero credit
 * until independently reviewed. No employer/customer/provider connections.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import {
  requireDisposableIdentityAccount, requireIdentityNoStore,
} from "./tenant-identity-account-proof.mjs";

export function requireDisposablePayrollApprovers(env = process.env) {
  try { requireDisposableIdentityAccount(env); }
  catch { throw new Error("PAYROLL_APPROVERS_PROOF_REFUSED: disposable local PG16 required"); }
  const required = {
    GITHUB_ACTIONS: "true", CI: "true", NODE_ENV: "production",
    WORKER_ENABLED: "false", CENTRAL_SCHEDULER_ENABLED: "false",
    XENDIT_BILLING_ENABLED: "false", DEMO_MODE: "false",
    TENANT_SECOND_PASS_MODE: "isolated-ci-only",
  };
  for (const [name, value] of Object.entries(required)) {
    assert.equal(env[name], value, "PAYROLL_APPROVERS_PROOF_REFUSED: " + name);
  }
  for (const name of [
    "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "RESEND_API_KEY",
    "POSTMARK_SERVER_TOKEN", "STRIPE_SECRET_KEY", "SMTP_URL",
  ]) {
    assert.ok(!env[name], "PAYROLL_APPROVERS_PROOF_REFUSED: external secret " + name);
  }
  return true;
}

async function ready(server, logs) {
  for (let tries = 0; tries < 60; tries++) {
    if (server.exitCode !== null) throw new Error("Local Next exited: " + logs());
    try {
      const response = await fetch("http://127.0.0.1:3000/login", {
        redirect: "manual", cache: "no-store",
      });
      if (response.ok) return;
    } catch { /* localhost startup */ }
    await delay(1000);
  }
  throw new Error("Local Next unavailable: " + logs());
}
async function stop(server) {
  if (!server || server.exitCode !== null) return;
  server.kill("SIGTERM");
  await Promise.race([new Promise(resolve => server.once("exit", resolve)), delay(4000)]);
  if (server.exitCode === null) server.kill("SIGKILL");
}

function proveRows(body, expectedIds, unwantedMarkers = []) {
  assert.ok(body && typeof body === "object" && !Array.isArray(body));
  assert.deepEqual(Object.keys(body).sort(), ["approvers"]);
  assert.ok(Array.isArray(body.approvers), "authorized source must expose an actual array");
  assert.deepEqual(body.approvers.map(row => row.id).sort((a, b) => a - b),
    [...expectedIds].sort((a, b) => a - b), "only permitted persisted checkers");
  for (const row of body.approvers) {
    assert.deepEqual(Object.keys(row).sort(), ["email", "id", "name", "orgUnitId", "role"]);
    assert.ok(Number.isSafeInteger(row.id) && row.id > 0);
    assert.ok(["owner", "admin", "manager", "checker"].includes(row.role));
    assert.match(row.email, /@example\.invalid$/);
  }
  const names = body.approvers.map(row => row.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)),
    "checker picker remains alphabetically ordered");
  const response = JSON.stringify(body).toLowerCase();
  for (const marker of unwantedMarkers) {
    assert.ok(!response.includes(marker.toLowerCase()), "foreign/revoked identity disclosed");
  }
}

export async function verifyPayrollApproversHttp() {
  requireDisposablePayrollApprovers(); // BEFORE any DB or server module import.
  const [{ db, pool }, schema, shared, { eq }] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("./tenant-table-http.mjs"),
    import("drizzle-orm"),
  ]);
  const { organizations, users, sessions, userOrganizations, orgUnits, employees, auditEvents } = schema;
  const { seedEmployer, standaloneMakeSession, standaloneRequest } = shared;
  assert.equal((await db.select({ id: organizations.id }).from(organizations).limit(1)).length, 0,
    "PAYROLL_APPROVERS_PROOF_REFUSED: disposable database must contain zero employers");
  const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
  const a = await seedEmployer("ATTA", nonce, standaloneMakeSession);
  const b = await seedEmployer("ATTB", nonce, standaloneMakeSession);
  const victim = await seedEmployer("VICTIM", nonce, standaloneMakeSession);
  assert.ok(victim.org.id > a.org.id && victim.org.id > b.org.id);
  assert.ok(victim.owner.id > a.owner.id && victim.owner.id > b.owner.id);

  async function candidate(employer, suffix, role, orgUnitId, activeGrant = true, activeUser = true) {
    const [account] = await db.insert(users).values({
      email: (employer.label + "-" + suffix + "-" + nonce).toLowerCase() + "@example.invalid",
      name: employer.marker + " " + suffix, passwordHash: "fictional-only-not-for-login",
      role, totpEnabled: true, active: activeUser,
    }).returning();
    await db.insert(userOrganizations).values({
      userId: account.id, organizationId: employer.org.id,
      role, orgUnitId, active: activeGrant,
    });
    return account;
  }
  async function payrollUser(employer, orgUnitId, suffix) {
    const account = await candidate(employer, suffix, "payroll", orgUnitId);
    const session = await standaloneMakeSession(account.id);
    await db.update(sessions).set({ mfaVerifiedAt: new Date() })
      .where(eq(sessions.id, session.id));
    return { account, cookie: session.cookie };
  }

  const all = [a, b, victim];
  const fixtures = new Map();
  for (const employer of all) {
    const [anotherUnit] = await db.insert(orgUnits).values({
      organizationId: employer.org.id, legalEntityId: employer.entity.id,
      type: "department", code: (employer.marker + "-EXTRA").slice(0, 30),
      name: employer.marker + " second unit",
    }).returning();
    const companyChecker = await candidate(employer, "company-checker", "checker", null);
    const unitChecker = await candidate(employer, "unit-checker", "checker", employer.unit.id);
    const otherUnitChecker = await candidate(employer, "other-unit-checker", "checker", anotherUnit.id);
    const manager = await candidate(employer, "unit-manager", "manager", employer.unit.id);
    const revoked = await candidate(employer, "revoked-checker", "checker", employer.unit.id, false);
    const disabled = await candidate(employer, "disabled-checker", "checker", employer.unit.id, true, false);
    const nonChecker = await candidate(employer, "nonchecker-employee", "employee", employer.unit.id);
    const unitOperator = await payrollUser(employer, employer.unit.id, "unit-payroll");
    const revokedOperator = await candidate(employer, "revoked-payroll", "payroll", employer.unit.id, false);
    const revokedSession = await standaloneMakeSession(revokedOperator.id);
    await db.update(sessions).set({ mfaVerifiedAt: new Date() })
      .where(eq(sessions.id, revokedSession.id));
    fixtures.set(employer.org.id, {
      companyChecker, unitChecker, otherUnitChecker, manager,
      revoked, disabled, nonChecker, unitOperator, revokedCookie: revokedSession.cookie,
    });
  }

  async function snapshot() {
    return {
      users: await db.select().from(users).orderBy(users.id),
      grants: await db.select().from(userOrganizations).orderBy(userOrganizations.id),
      organizations: await db.select().from(organizations).orderBy(organizations.id),
      units: await db.select().from(orgUnits).orderBy(orgUnits.id),
      staff: await db.select().from(employees).orderBy(employees.id),
      audits: await db.select().from(auditEvents).orderBy(auditEvents.id),
    };
  }
  const before = await snapshot();
  let server;
  try {
    server = spawn(process.execPath, [
      "node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", "3000",
    ], {
      env: { ...process.env, DEMO_MODE: "false" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let logs = "";
    const capture = data => { logs = (logs + String(data)).slice(-3000); };
    server.stdout.on("data", capture);
    server.stderr.on("data", capture);
    await ready(server, () => logs);

    async function get(orgId, cookie, status, label, suffix = "") {
      const path = "/api/organizations/" + orgId + "/payroll-approvers" + suffix;
      const result = await standaloneRequest(path, { cookie });
      assert.equal(result.status, status,
        label + ": expected " + status + ", got " + result.status + " " + result.text.slice(0, 180));
      if (status === 200) requireIdentityNoStore(result.headers);
      return result;
    }
    await get(a.org.id, undefined, 401, "anonymous cannot enumerate payroll checkers");
    await get(0, a.cookie, 400, "zero organization ID rejected");
    await get(-1, a.cookie, 400, "negative organization ID rejected");
    await get("1e3", a.cookie, 400, "numeric notation rejected");

    for (const employer of all) {
      const v = fixtures.get(employer.org.id);
      const own = await get(employer.org.id, employer.cookie, 200, "own company-wide picker");
      proveRows(own.json, [
        v.companyChecker.id, v.unitChecker.id, v.otherUnitChecker.id, v.manager.id,
      ], [
        v.revoked.name, v.revoked.email, v.disabled.name, v.disabled.email,
        v.nonChecker.name, v.nonChecker.email,
        ...all.filter(e => e !== employer).map(e => e.marker),
      ]);
      const unit = await get(employer.org.id, v.unitOperator.cookie, 200,
        "own unit-scoped payroll picker");
      proveRows(unit.json, [v.unitChecker.id, v.manager.id], [
        v.companyChecker.name, v.companyChecker.email,
        v.otherUnitChecker.name, v.otherUnitChecker.email,
        v.revoked.name, v.revoked.email,
        v.disabled.name, v.disabled.email,
      ]);
      const revoked = await get(employer.org.id, v.revokedCookie, 403,
        "revoked payroll operator must not enumerate members");
      assert.ok(!revoked.text.includes(v.companyChecker.email));
    }

    for (const attacker of [a, b]) {
      const other = attacker === a ? b : a;
      const otherFixture = fixtures.get(other.org.id);
      for (const foreign of [victim, other]) {
        const denial = await get(foreign.org.id, attacker.cookie, 403,
          "foreign employer role must be denied");
        assert.ok(!denial.text.includes(foreign.marker), "foreign employer PII leaked");
      }
      const forged = await get(attacker.org.id, attacker.cookie, 200,
        "query-string employer/user forging cannot change route-scoped picker",
        "?organizationId=" + victim.org.id +
        "&userId=" + fixtures.get(victim.org.id).companyChecker.id);
      const own = fixtures.get(attacker.org.id);
      proveRows(forged.json, [
        own.companyChecker.id, own.unitChecker.id, own.otherUnitChecker.id, own.manager.id,
      ], [
        victim.marker, other.marker, otherFixture.companyChecker.email,
      ]);
    }
    assert.deepEqual(await snapshot(), before,
      "all tenant users, memberships, units, employees and audit rows unchanged after GET probes");
    console.log(JSON.stringify({
      kind: "tenant-payroll-approvers-live-membership-pg16",
      fictionalEmployers: 3, independentOwnerAttackers: 2, higherIdVictim: true,
      ownPopulatedCompanyAndUnitReads: true, revokedAndDisabledAccountsExcluded: true,
      roleAndUnitScopeEnforcedBeforePIIProjection: true,
      forgedQueryCannotSwitchEmployer: true, crossEmployerDenials: 4,
      revocationDenials: 3, allBusinessAndAuditRowsUnchanged: true,
      providerOrPayrollWrites: false, methodCredits: 0, independentAcceptance: false,
    }));
  } finally {
    await stop(server);
    await pool.end();
  }
}
if (process.argv[1]?.replaceAll("\\", "/").endsWith(
  "scripts/qa/tenant-payroll-approvers-http.mjs"
)) {
  verifyPayrollApproversHttp().catch(error => {
    console.error(error instanceof Error ? error.message : "Payroll approver proof failed");
    process.exitCode = 1;
  });
}
