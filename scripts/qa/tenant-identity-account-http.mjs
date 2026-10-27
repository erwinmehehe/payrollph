/**
 * Standalone authenticated GET auth/me and GET account tenant/peer isolation.
 * Two real employer owners, a later persisted higher-ID victim owner and one
 * independent same-employer peer. Genuine localhost Next + fictional PG16 only.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { requireDisposableIdentityAccount, requireIdentityNoStore, proveMe, proveAccount } from "./tenant-identity-account-proof.mjs";

async function ready(server, logs) {
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw new Error("Local Next exited: " + logs());
    try {
      const r = await fetch("http://127.0.0.1:3000/login", { redirect: "manual", cache: "no-store" });
      if (r.ok) return;
    } catch { /* local startup */ }
    await delay(1000);
  }
  throw new Error("Local Next unavailable: " + logs());
}
async function stop(server) {
  if (!server || server.exitCode !== null) return;
  server.kill("SIGTERM");
  await Promise.race([new Promise(done => server.once("exit", done)), delay(4000)]);
  if (server.exitCode === null) server.kill("SIGKILL");
}
export async function verifyTenantIdentityAccountHttp() {
  requireDisposableIdentityAccount(); // before any DB/app import
  const [{ db, pool }, schema, shared, { eq }] = await Promise.all([
    import("../../src/db/index.ts"), import("../../src/db/schema.ts"),
    import("./tenant-table-http.mjs"), import("drizzle-orm"),
  ]);
  const { organizations, users, sessions, userOrganizations, auditEvents } = schema;
  const { seedEmployer, standaloneMakeSession, standaloneRequest } = shared;
  assert.equal((await db.select({ id: organizations.id }).from(organizations).limit(1)).length, 0,
    "IDENTITY_PROOF_REFUSED: DB must be freshly empty and fictional");
  const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
  const attackerA = await seedEmployer("ATTA", nonce, standaloneMakeSession);
  const attackerB = await seedEmployer("ATTB", nonce, standaloneMakeSession);
  const victim = await seedEmployer("VICTIM", nonce, standaloneMakeSession);
  assert.ok(victim.org.id > attackerA.org.id && victim.org.id > attackerB.org.id);
  assert.ok(victim.owner.id > attackerA.owner.id && victim.owner.id > attackerB.owner.id);
  // Different *user* in A's employer: prove same-tenant peer privacy.
  const [peerUser] = await db.insert(users).values({
    email: "peer-" + nonce + "@example.invalid", name: "Fictional Peer " + nonce,
    passwordHash: "synthetic-not-for-login", role: "owner", totpEnabled: true, active: true,
  }).returning();
  await db.insert(userOrganizations).values({
    userId: peerUser.id, organizationId: attackerA.org.id, role: "owner", active: true,
  });
  const peerSession = await standaloneMakeSession(peerUser.id);
  await db.update(sessions).set({ mfaVerifiedAt: new Date() }).where(eq(sessions.id, peerSession.id));

  async function actor(e) {
    const ids = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, e.owner.id));
    assert.equal(ids.length, 1, "owner requires exactly one persisted session");
    return { user: e.owner, cookie: e.cookie, sessionId: ids[0].id, marker: e.marker };
  }
  const a = await actor(attackerA), b = await actor(attackerB), v = await actor(victim);
  const peer = { user: peerUser, cookie: peerSession.cookie, sessionId: peerSession.id, marker: peerUser.name };
  const identity = e => ({
    id: e.user.id, name: e.user.name, email: e.user.email, role: e.user.role,
    totpEnabled: e.user.totpEnabled, employeeId: e.user.employeeId ?? null, sessionId: e.sessionId,
  });
  const all = [a, b, v, peer];
  const bearerTokens = all.map(e => e.cookie.split("=")[1]);
  const foreignMarkers = [a.marker, b.marker, v.marker, peer.user.name, peer.user.email];
  const excluded = e => foreignMarkers.filter(marker => marker !== e.marker && marker !== e.user.email);

  async function snapshot(userId, orgId) {
    return Promise.all([
      db.select().from(users).where(eq(users.id, userId)),
      db.select({ id: sessions.id, userId: sessions.userId, tokenHash: sessions.tokenHash,
        revokedAt: sessions.revokedAt, expiresAt: sessions.expiresAt })
        .from(sessions).where(eq(sessions.userId, userId)).orderBy(sessions.id),
      db.select().from(userOrganizations).where(eq(userOrganizations.userId, userId)),
      db.select().from(auditEvents).where(eq(auditEvents.organizationId, orgId)).orderBy(auditEvents.id),
    ]);
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
    async function get(path, cookie, status, label) {
      const reply = await standaloneRequest(path, { cookie });
      assert.equal(reply.status, status, label + " returned wrong HTTP status");
      if (cookie && status === 200) requireIdentityNoStore(reply.headers);
      for (const token of bearerTokens) {
        assert.ok(!reply.text.includes(token), "session bearer leaked in response");
      }
      return reply;
    }
    assert.deepEqual((await get("/api/auth/me", undefined, 200, "anonymous identity")).json, { user: null });
    await get("/api/account", undefined, 401, "anonymous account");
    const bad = "__Host-linaw_session=" + "f".repeat(64);
    assert.deepEqual((await get("/api/auth/me", bad, 200, "invalid bearer")).json, { user: null });
    await get("/api/account", bad, 401, "invalid bearer account");

    // Real victim and same-employer peer have distinct, readable identities.
    for (const e of [v, peer]) {
      proveMe((await get("/api/auth/me", e.cookie, 200, "victim or peer identity")).json, identity(e), excluded(e));
      proveAccount((await get("/api/account", e.cookie, 200, "victim or peer account")).json, identity(e), excluded(e));
    }
    const victimBefore = await snapshot(v.user.id, victim.org.id);
    const peerBefore = await snapshot(peer.user.id, attackerA.org.id);

    for (const e of [a, b]) {
      const me = await get("/api/auth/me", e.cookie, 200, "own identity");
      proveMe(me.json, identity(e), excluded(e));
      const account = await get("/api/account", e.cookie, 200, "own account");
      proveAccount(account.json, identity(e), excluded(e));
      const other = e === a ? b : a;
      assert.throws(() => proveMe(me.json, identity(other)), "same reply must not prove other employer");
      assert.throws(() => proveAccount(account.json, identity(other)), "same account must not prove other employer");
      for (const target of [
        { org: victim.org.id, user: v.user.id, session: v.sessionId },
        { org: attackerA.org.id, user: peer.user.id, session: peer.sessionId },
      ]) {
        const params = "?organizationId=" + target.org + "&userId=" + target.user + "&sessionId=" + target.session;
        const forgedMe = await get("/api/auth/me" + params, e.cookie, 200, "forged foreign principal");
        proveMe(forgedMe.json, identity(e), excluded(e));
        const forgedAccount = await get("/api/account" + params, e.cookie, 200, "forged account principal");
        proveAccount(forgedAccount.json, identity(e), excluded(e));
      }
    }
    const victimAfter = await snapshot(v.user.id, victim.org.id);
    const peerAfter = await snapshot(peer.user.id, attackerA.org.id);
    assert.deepEqual(victimAfter, victimBefore, "victim user, tokens, memberships and audit unchanged");
    assert.deepEqual(peerAfter, peerBefore, "same-tenant peer user, tokens, memberships and audit unchanged");
    console.log(JSON.stringify({
      kind: "tenant-session-identity-account", methods: ["GET auth/me", "GET account"],
      fictionalEmployers: 3, independentOwnerAttackers: 2,
      higherIdVictim: true, sameEmployerPeer: true,
      ownNonemptySuccess: true, forgedSelectorsCannotSwitchPrincipal: true,
      victimAndPeerIdentityUnchanged: true, bearerTokensNeverExposed: true,
      providerOrPayrollWrites: false, credited: 0, accepted: false,
    }));
  } finally {
    await stop(server);
    await pool.end();
  }
}
if (process.argv[1]?.replaceAll("\\", "/").endsWith("scripts/qa/tenant-identity-account-http.mjs")) {
  verifyTenantIdentityAccountHttp().catch(error => {
    console.error(error instanceof Error ? error.message : "Identity proof failed");
    process.exitCode = 1;
  });
}
