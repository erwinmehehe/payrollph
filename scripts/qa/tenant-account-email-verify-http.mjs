/**
 * Draft-only, non-credit tenant email verification proof.
 * This route authenticates with a one-use token, not a session cookie.
 * Two independent fictional employee tokens must not mutate a later,
 * higher-ID employer's worker through an invalid users.employeeId link.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { requireDisposableIdentityAccount } from "./tenant-identity-account-proof.mjs";

const sha256 = value => createHash("sha256").update(value).digest("hex");

async function ready(server, logs) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (server.exitCode !== null) throw new Error("Local Next exited: " + logs());
    try {
      const response = await fetch("http://127.0.0.1:3000/login", { redirect: "manual", cache: "no-store" });
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

export async function verifyAccountEmailTenantHttp() {
  // This must be the first executable statement, before database imports.
  requireDisposableIdentityAccount();
  const [{ db, pool }, schema, shared, orm] = await Promise.all([
    import("../../src/db/index.ts"), import("../../src/db/schema.ts"),
    import("./tenant-table-http.mjs"), import("drizzle-orm"),
  ]);
  const { organizations, users, employees, sessions, userOrganizations, emailChangeTokens, auditEvents } = schema;
  const { eq, inArray } = orm;
  const { seedEmployer, standaloneMakeSession, standaloneRequest } = shared;
  assert.equal((await db.select({ id: organizations.id }).from(organizations).limit(1)).length, 0,
    "EMAIL_VERIFY_REFUSED: disposable PG16 must be empty");

  const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
  const a = await seedEmployer("ATTA", nonce, standaloneMakeSession);
  const b = await seedEmployer("ATTB", nonce, standaloneMakeSession);
  const v = await seedEmployer("VICTIM", nonce, standaloneMakeSession);
  assert.ok(v.org.id > a.org.id && v.org.id > b.org.id);
  assert.ok(v.worker.id > a.worker.id && v.worker.id > b.worker.id);

  async function makeEss(label, employer, accountEmployeeId, grantedWorkerId) {
    const [account] = await db.insert(users).values({
      email: label + "-" + nonce + "@example.invalid",
      name: "Fictional ESS " + label + " " + nonce,
      passwordHash: "synthetic-no-password-login",
      role: "employee", employeeId: accountEmployeeId, active: true,
    }).returning();
    const [membership] = await db.insert(userOrganizations).values({
      userId: account.id, organizationId: employer.org.id, role: "employee",
      workerEmployeeId: grantedWorkerId, active: true,
    }).returning();
    return { account, membership, employer };
  }
  const attackerA = await makeEss("attacker-a", a, v.worker.id, a.worker.id);
  const attackerB = await makeEss("attacker-b", b, v.worker.id, b.worker.id);
  const victim = await makeEss("victim", v, v.worker.id, v.worker.id);
  const victimSession = await standaloneMakeSession(victim.account.id);

  async function tokenFor(userId, emailPrefix) {
    const token = randomBytes(24).toString("hex");
    const [row] = await db.insert(emailChangeTokens).values({
      userId,
      newEmail: emailPrefix + "-" + nonce + "@example.invalid",
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + 20 * 60_000),
    }).returning();
    return { raw: token, id: row.id, newEmail: row.newEmail };
  }

  const accountIds = [attackerA.account.id, attackerB.account.id, victim.account.id];
  const orgIds = [a.org.id, b.org.id, v.org.id];
  async function snapshot() {
    const [accountRows, workerRows, grants, tokens, audits, sessionRows] = await Promise.all([
      db.select({ id: users.id, email: users.email, employeeId: users.employeeId })
        .from(users).where(inArray(users.id, accountIds)).orderBy(users.id),
      db.select({ id: employees.id, organizationId: employees.organizationId, email: employees.email })
        .from(employees).where(inArray(employees.organizationId, orgIds)).orderBy(employees.id),
      db.select({ id: userOrganizations.id, userId: userOrganizations.userId,
        organizationId: userOrganizations.organizationId, workerEmployeeId: userOrganizations.workerEmployeeId,
        active: userOrganizations.active, role: userOrganizations.role })
        .from(userOrganizations).where(inArray(userOrganizations.userId, accountIds)).orderBy(userOrganizations.id),
      db.select({ id: emailChangeTokens.id, userId: emailChangeTokens.userId,
        newEmail: emailChangeTokens.newEmail, usedAt: emailChangeTokens.usedAt })
        .from(emailChangeTokens).where(inArray(emailChangeTokens.userId, accountIds)).orderBy(emailChangeTokens.id),
      db.select({ id: auditEvents.id, organizationId: auditEvents.organizationId, action: auditEvents.action })
        .from(auditEvents).where(inArray(auditEvents.organizationId, orgIds)).orderBy(auditEvents.id),
      db.select({ id: sessions.id, userId: sessions.userId, revokedAt: sessions.revokedAt })
        .from(sessions).where(inArray(sessions.userId, accountIds)).orderBy(sessions.id),
    ]);
    return { accountRows, workerRows, grants, tokens, audits, sessionRows };
  }

  let server;
  try {
    server = spawn(process.execPath, [
      "node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", "3000",
    ], { env: { ...process.env, DEMO_MODE: "false" }, stdio: ["ignore", "pipe", "pipe"] });
    let logs = "";
    const capture = data => { logs = (logs + String(data)).slice(-2500); };
    server.stdout.on("data", capture);
    server.stderr.on("data", capture);
    await ready(server, () => logs);

    async function verify(link, expectedStatus, label) {
      const response = await standaloneRequest("/api/account/email/verify", {
        method: "POST", body: { token: link.raw },
      });
      assert.equal(response.status, expectedStatus,
        label + " expected " + expectedStatus + ", received " + response.status + ": " + response.text.slice(0, 200));
      assert.ok(!response.text.includes(link.raw), label + ": never echo verification token");
      return response;
    }

    for (const [attacker, name] of [[attackerA, "ATTA"], [attackerB, "ATTB"]]) {
      const token = await tokenFor(attacker.account.id, "foreign-" + name.toLowerCase());
      const before = await snapshot();
      const response = await verify(token, 409, name + " invalid foreign worker link");
      assert.equal(response.json?.ok, undefined, "denial must not advertise email verification success");
      assert.deepEqual(await snapshot(), before, name + " denied token changed account, worker or audit state");
    }

    const ownToken = await tokenFor(victim.account.id, "victim-own");
    const accepted = await verify(ownToken, 200, "victim valid same-employer employee link");
    assert.equal(accepted.json?.ok, true);
    const [ownAccount] = await db.select({ email: users.email }).from(users).where(eq(users.id, victim.account.id));
    const [ownWorker] = await db.select({ email: employees.email })
      .from(employees).where(eq(employees.id, v.worker.id));
    const [consumed] = await db.select({ usedAt: emailChangeTokens.usedAt })
      .from(emailChangeTokens).where(eq(emailChangeTokens.id, ownToken.id));
    const [revoked] = await db.select({ revokedAt: sessions.revokedAt })
      .from(sessions).where(eq(sessions.id, victimSession.id));
    assert.equal(ownAccount.email, ownToken.newEmail, "own verified account login updates");
    assert.equal(ownWorker.email, ownToken.newEmail, "own worker contact updates in the same employer");
    assert.ok(consumed.usedAt instanceof Date, "single-use token consumed");
    assert.ok(revoked.revokedAt instanceof Date, "credential change revokes sessions");

    const afterOwn = await snapshot();
    await verify(ownToken, 400, "spent token replay");
    assert.deepEqual(await snapshot(), afterOwn, "reused token must not write any business rows");

    await db.update(userOrganizations).set({ active: false })
      .where(eq(userOrganizations.id, victim.membership.id));
    const revokedToken = await tokenFor(victim.account.id, "victim-revoked");
    const beforeRevoked = await snapshot();
    await verify(revokedToken, 409, "revoked employee membership");
    assert.deepEqual(await snapshot(), beforeRevoked, "revoked worker grant must roll back account and token");

    await db.update(userOrganizations).set({ active: true, workerEmployeeId: a.worker.id })
      .where(eq(userOrganizations.id, victim.membership.id));
    const mismatchedToken = await tokenFor(victim.account.id, "victim-mismatch");
    const beforeMismatch = await snapshot();
    await verify(mismatchedToken, 409, "wrong employee pointer under victim membership");
    assert.deepEqual(await snapshot(), beforeMismatch, "wrong employee pointer must roll back every write");

    // The legacy ESS account.employeeId pointer is still valid with a null
    // member workerEmployeeId only when the employer and employee role match.
    await db.update(userOrganizations).set({ workerEmployeeId: null })
      .where(eq(userOrganizations.id, victim.membership.id));
    const legacyToken = await tokenFor(victim.account.id, "victim-legacy");
    const legacy = await verify(legacyToken, 200, "same-employer legacy nullable worker grant");
    assert.equal(legacy.json?.ok, true);
    const [legacyWorker] = await db.select({ email: employees.email }).from(employees)
      .where(eq(employees.id, v.worker.id));
    assert.equal(legacyWorker.email, legacyToken.newEmail);

    console.log(JSON.stringify({
      kind: "tenant-account-email-verify", method: "POST /api/account/email/verify",
      fictionalEmployers: 3, independentTokenHoldersWithForeignPointers: 2,
      realHigherIdVictim: true, ownHttpSuccess: true, foreignWritesDenied: true,
      revokedMembershipDenied: true, workerGrantMismatchDenied: true,
      legacySameEmployerSuccess: true, spentTokenDenied: true,
      deniedDatabaseSnapshotsUnchanged: true, noExternalEmailDelivery: true,
      providerOrMoneyWrites: false, credits: 0, independentReviewPending: true,
    }));
  } finally {
    await stop(server);
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("scripts/qa/tenant-account-email-verify-http.mjs")) {
  verifyAccountEmailTenantHttp().catch(error => {
    console.error(error instanceof Error ? error.message : "Tenant account email proof failed");
    process.exitCode = 1;
  });
}
