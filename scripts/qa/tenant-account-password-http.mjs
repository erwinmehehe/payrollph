/**
 * Dedicated POST /api/account/password proof. The route is bound to the signed-in user: it accepts no user, employer or
 * session identifier, so the isolation claim is that one account's change can touch only that account.
 *
 * Two independent attacker accounts and a higher-ID victim account (three fictional employers) on disposable PG16 behind
 * production-mode localhost HTTP. Each attacker proves: an own change succeeds (200, the new password verifies and the old
 * one no longer does, the caller's other session is revoked, a replacement session works, exactly one "Password changed"
 * audit row lands in the caller's own employer) while forged userId/email/organizationId body fields are ignored; and
 * refusals: anonymous (401), the VICTIM's real current password supplied as the "current password" (422), a wrong
 * password (422), a mismatched confirmation (422) and a weak new password (422), each changing nothing. The victim's user
 * row, hash, sessions and audit rows are compared before and after, and the victim's old password and old session still work.
 * Fictional data only; no provider, worker or payout is enabled.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  ACCOUNT_PASSWORD_METHOD, ACCOUNT_PASSWORD_TITLE, ROUTE_PATH,
  assertOwnPasswordChange, assertPasswordRefusal, assertRowsUnchanged, replacementCookie,
  requireDisposableAccountPassword,
} from "./tenant-account-password-contract.mjs";

export async function verifyAccountPasswordTenantIsolation() {
  // No database or application import may run before this guard.
  requireDisposableAccountPassword();
  const [{ db, pool }, schema, { and, eq }, fixture, crypto] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
    import("../../src/lib/crypto.ts"),
  ]);
  const { auditEvents, sessions, users } = schema;
  const { seedEmployer, standaloneMakeSession, standaloneRequest } = fixture;
  const { hashPassword, verifyPassword } = crypto;

  try {
    assert.equal((await db.select().from(users).limit(1)).length, 0,
      "ACCOUNT_PASSWORD_PROOF_REFUSED: genuinely empty disposable users required");
    const nonce = randomUUID().replaceAll("-", "").slice(0, 8);
    const a = await seedEmployer("ATTA", nonce, standaloneMakeSession);
    const b = await seedEmployer("ATTB", nonce, standaloneMakeSession);
    // Filler accounts consume low IDs so the victim's user, employer and session IDs exceed both attackers' and six.
    for (let i = 0; i < 7; i++) {
      await db.insert(users).values({ email: "pw-fill-" + i + "-" + nonce + "@example.invalid", name: "Filler " + i, passwordHash: "x", role: "owner" });
    }
    const victim = await seedEmployer("VICTIM", nonce, standaloneMakeSession);
    assert.ok(victim.owner.id > Math.max(a.owner.id, b.owner.id, 6) && victim.org.id > Math.max(a.org.id, b.org.id));

    const password = (label) => "Fict-" + label + "-" + nonce + "-Aa1";
    const oldPassword = { a: password("A-old"), b: password("B-old"), v: password("V-old") };
    const newPassword = { a: password("A-new"), b: password("B-new") };
    for (const [employer, key] of [[a, "a"], [b, "b"], [victim, "v"]]) {
      await db.update(users).set({ passwordHash: hashPassword(oldPassword[key]), failedLoginAttempts: 0, lockedUntil: null }).where(eq(users.id, employer.owner.id));
    }
    // A second device for each account: a change must revoke the caller's own other session and nobody else's.
    const second = {};
    for (const [employer, key] of [[a, "a"], [b, "b"], [victim, "v"]]) second[key] = (await standaloneMakeSession(employer.owner.id)).cookie;

    // The route allows 5 attempts per minute per IP; this proof is about isolation, not throttling, so each call starts a fresh window.
    const clearRateLimit = () => pool.query("DELETE FROM rate_limit_hits WHERE bucket_key LIKE 'pwchange:%'");
    const request = async (cookie, body) => { await clearRateLimit(); return standaloneRequest(ROUTE_PATH, { method: "POST", cookie, body }); };
    const account = (cookie) => standaloneRequest("/api/account", { cookie });
    const userRow = async (id) => (await db.select().from(users).where(eq(users.id, id)))[0];
    const sessionRows = async (id) => (await db.select().from(sessions).where(eq(sessions.userId, id))).sort((x, y) => x.id - y.id);
    const auditRows = async (orgId) => (await db.select().from(auditEvents).where(eq(auditEvents.organizationId, orgId))).sort((x, y) => x.id - y.id);
    const snapshot = async (employer) => ({
      user: await userRow(employer.owner.id), sessions: await sessionRows(employer.owner.id), audits: await auditRows(employer.org.id),
    });
    const forbidden = [victim.marker, victim.owner.email, ...Object.values(oldPassword), ...Object.values(newPassword),
      victim.cookie.split("=")[1], second.v.split("=")[1]];
    const forged = (target) => ({ userId: target.owner.id, email: target.owner.email, organizationId: target.org.id, role: "owner", id: target.owner.id });

    // The victim's own control works first, proving the route is reachable and the victim's credentials are real.
    assert.ok(verifyPassword(oldPassword.v, (await userRow(victim.owner.id)).passwordHash));
    assert.equal((await account(victim.cookie)).status, 200, "victim session is valid before any attacker request");
    assert.equal((await account(second.v)).status, 200, "victim second session is valid before any attacker request");
    const victimBefore = await snapshot(victim);

    // Refusals: each attacker, each changing nothing anywhere.
    for (const [attacker, key] of [[a, "a"], [b, "b"]]) {
      const own = await snapshot(attacker);
      const peer = await snapshot(key === "a" ? b : a);
      await clearRateLimit();
      assertPasswordRefusal(await request(undefined, { currentPassword: oldPassword[key], newPassword: newPassword[key], confirmPassword: newPassword[key] }), 401, forbidden);
      // The attacker supplies the VICTIM'S real password plus a forged victim principal: it must fail against the attacker's own hash.
      const stolen = assertPasswordRefusal(await request(attacker.cookie, {
        ...forged(victim), currentPassword: oldPassword.v, newPassword: newPassword[key], confirmPassword: newPassword[key],
      }), 422, forbidden);
      assert.ok(stolen.problems.includes("Your current password is not correct."), "the victim's password is not the attacker's current password");
      assertPasswordRefusal(await request(attacker.cookie, { currentPassword: "Wrong-" + nonce + "-Aa1", newPassword: newPassword[key], confirmPassword: newPassword[key] }), 422, forbidden);
      assertPasswordRefusal(await request(attacker.cookie, { currentPassword: oldPassword[key], newPassword: newPassword[key], confirmPassword: newPassword[key] + "x" }), 422, forbidden);
      assertPasswordRefusal(await request(attacker.cookie, { currentPassword: oldPassword[key], newPassword: "short1A", confirmPassword: "short1A" }), 422, forbidden);
      assertPasswordRefusal(await request(attacker.cookie, { currentPassword: oldPassword[key], newPassword: oldPassword[key], confirmPassword: oldPassword[key] }), 422, forbidden);
      assertRowsUnchanged(own, await snapshot(attacker), attacker.label + " after every refusal");
      assertRowsUnchanged(peer, await snapshot(key === "a" ? b : a), "the other attacker after " + attacker.label + " refusals");
      assertRowsUnchanged(victimBefore, await snapshot(victim), "victim after " + attacker.label + " refusals");
      await clearRateLimit();
    }

    // Own changes. Forged principals in the body are ignored.
    const journeys = {};
    for (const [attacker, key, other] of [[a, "a", b], [b, "b", a]]) {
      const otherBefore = await snapshot(other);
      const beforeAudits = (await auditRows(attacker.org.id)).length;
      const response = await request(attacker.cookie, {
        ...forged(victim), currentPassword: oldPassword[key], newPassword: newPassword[key], confirmPassword: newPassword[key],
      });
      assertOwnPasswordChange(response, { otherSessionsRevoked: 1 });
      const fresh = replacementCookie(response.headers);
      journeys[key] = { fresh, response };
      const row = await userRow(attacker.owner.id);
      assert.ok(verifyPassword(newPassword[key], row.passwordHash), "the new password verifies");
      assert.ok(!verifyPassword(oldPassword[key], row.passwordHash), "the old password no longer verifies");
      assert.equal(row.email, attacker.owner.email, "forged email field was ignored");
      assert.equal(row.id, attacker.owner.id);
      const own = await sessionRows(attacker.owner.id);
      assert.equal(own.filter((s) => !s.revokedAt).length, 1, "exactly the replacement session is live");
      assert.equal((await account(attacker.cookie)).status, 401, "the pre-change session is revoked");
      assert.equal((await account(second[key])).status, 401, "the caller's other device is revoked");
      assert.equal((await account(fresh)).status, 200, "the replacement session works");
      const audits = (await auditRows(attacker.org.id)).slice(beforeAudits);
      const changed = audits.filter((event) => event.action === "Password changed");
      assert.equal(changed.length, 1, "exactly one own audit row");
      assert.equal(changed[0].organizationId, attacker.org.id);
      assert.equal(changed[0].resource, attacker.owner.email);
      assert.equal(changed[0].metadata?.sessionsRevoked, 2);
      assert.ok(!JSON.stringify(changed[0]).includes(newPassword[key]) && !JSON.stringify(changed[0]).includes("scrypt$"), "the audit row holds no password material");
      assertRowsUnchanged(otherBefore, await snapshot(other), "the other attacker after " + attacker.label + "'s change");
      assertRowsUnchanged(victimBefore, await snapshot(victim), "victim after " + attacker.label + "'s change");
      await clearRateLimit();
    }
    assert.notEqual((await userRow(a.owner.id)).passwordHash, (await userRow(b.owner.id)).passwordHash);
    const aHash = (await userRow(a.owner.id)).passwordHash;
    assert.throws(() => assert.ok(verifyPassword(newPassword.b, aHash)), "A's change must not satisfy B's own-object proof");

    // The victim, after both complete attacker journeys: byte-identical, old password and both old sessions still work.
    assertRowsUnchanged(victimBefore, await snapshot(victim), "victim after both complete attacker journeys");
    assert.ok(verifyPassword(oldPassword.v, (await userRow(victim.owner.id)).passwordHash));
    assert.equal((await account(victim.cookie)).status, 200);
    assert.equal((await account(second.v)).status, 200);

    console.log(JSON.stringify({
      kind: ACCOUNT_PASSWORD_TITLE, method: ACCOUNT_PASSWORD_METHOD, independentAttackers: 2, higherIdVictim: true,
      own: ["new password verifies", "old password rejected", "own other device revoked", "replacement session works", "one own audit row"],
      refusals: ["anonymous 401", "victim password as current 422", "wrong current 422", "mismatch 422", "weak 422", "reuse 422"],
      forgedPrincipalIgnored: true, victimByteIdentical: true, productionTested: false, coverageCredits: 0, independentlyAccepted: false,
    }));
    return { method: ACCOUNT_PASSWORD_METHOD, credited: 0 };
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("scripts/qa/tenant-account-password-http.mjs")) {
  verifyAccountPasswordTenantIsolation().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : "Account password isolation proof failed");
    process.exitCode = 1;
  });
}
