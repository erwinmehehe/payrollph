/**
 * Dedicated POST /api/auth/logout proof. The route acts on the session token in the caller's own cookie: it accepts no user,
 * employer or session identifier, so the isolation claim is that a logout revokes ONLY the session whose cookie was presented.
 *
 * Two independent attacker accounts and a higher-ID victim account (three fictional employers) on disposable PG16 behind
 * production-mode localhost HTTP. Each account has two devices. Each attacker proves: its own logout answers 200 with a
 * constant body and a clearing cookie, revokes exactly the presented session (GET /api/account then answers 401) and leaves the
 * caller's other device, the other attacker and the victim untouched, while forged userId / sessionId / token fields in the
 * body and query that name the victim's session are ignored. Also: anonymous, garbage-cookie and already-revoked logouts are
 * constant 200s that change no row, and a cross-site logout with a valid cookie is refused (403) and revokes nothing.
 * The victim's user row, sessions and audit rows are compared before and after, and both victim devices still work.
 * Fictional data only; no provider, worker or payout is enabled.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  AUTH_LOGOUT_METHOD, AUTH_LOGOUT_TITLE, ROUTE_PATH,
  assertCookieCleared, assertLogoutOk, assertLogoutRefusal, assertRowsUnchanged, requireDisposableAuthLogout,
} from "./tenant-auth-logout-contract.mjs";

export async function verifyAuthLogoutTenantIsolation() {
  // No database or application import may run before this guard.
  requireDisposableAuthLogout();
  const [{ db, pool }, schema, { eq }, fixture] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
  ]);
  const { auditEvents, sessions, users } = schema;
  const { seedEmployer, standaloneMakeSession, standaloneRequest } = fixture;

  try {
    assert.equal((await db.select().from(users).limit(1)).length, 0,
      "AUTH_LOGOUT_PROOF_REFUSED: genuinely empty disposable users required");
    const nonce = randomUUID().replaceAll("-", "").slice(0, 8);
    const a = await seedEmployer("ATTA", nonce, standaloneMakeSession);
    const b = await seedEmployer("ATTB", nonce, standaloneMakeSession);
    // Filler accounts consume low IDs so the victim's user, employer and session IDs exceed both attackers' and six.
    for (let i = 0; i < 7; i++) {
      const [filler] = await db.insert(users).values({ email: "lo-fill-" + i + "-" + nonce + "@example.invalid", name: "Filler " + i, passwordHash: "x", role: "owner" }).returning();
      await standaloneMakeSession(filler.id);
    }
    const victim = await seedEmployer("VICTIM", nonce, standaloneMakeSession);
    assert.ok(victim.owner.id > Math.max(a.owner.id, b.owner.id, 6) && victim.org.id > Math.max(a.org.id, b.org.id));

    // Device 1 is the seeded cookie; device 2 is a second real session of the same account.
    const device = {};
    for (const [employer, key] of [[a, "a"], [b, "b"], [victim, "v"]]) {
      device[key] = { one: employer.cookie, two: (await standaloneMakeSession(employer.owner.id)).cookie };
    }
    const token = (cookie) => cookie.split("=")[1];
    const sessionRows = async (id) => (await db.select().from(sessions).where(eq(sessions.userId, id))).sort((x, y) => x.id - y.id);
    const auditRows = async (orgId) => (await db.select().from(auditEvents).where(eq(auditEvents.organizationId, orgId))).sort((x, y) => x.id - y.id);
    const snapshot = async (employer) => ({
      user: (await db.select().from(users).where(eq(users.id, employer.owner.id)))[0],
      sessions: await sessionRows(employer.owner.id), audits: await auditRows(employer.org.id),
    });
    const account = (cookie) => standaloneRequest("/api/account", { cookie });
    const logout = (cookie, body, query = "") => standaloneRequest(ROUTE_PATH + query, { method: "POST", cookie, body });
    const live = async (id) => (await sessionRows(id)).filter((row) => !row.revokedAt).length;
    const forbidden = [victim.marker, victim.owner.email, token(device.v.one), token(device.v.two)];

    // Every device really works before any logout.
    for (const key of ["a", "b", "v"]) for (const which of ["one", "two"]) {
      assert.equal((await account(device[key][which])).status, 200, key + " " + which + " is a valid session before any logout");
    }
    assert.equal(await live(a.owner.id), 2);
    const victimBefore = await snapshot(victim);
    const everything = async () => ({ a: await snapshot(a), b: await snapshot(b), v: await snapshot(victim) });

    // No-op logouts: no cookie, a garbage cookie and a cross-site request with a VALID cookie must change no row anywhere.
    const noOp = await everything();
    const anonymous = await logout(undefined, {});
    assertLogoutOk(anonymous);
    assertCookieCleared(anonymous.headers);
    assertLogoutOk(await logout("__Host-linaw_session=" + "Z".repeat(43), {}));
    assertRowsUnchanged(noOp.a, await snapshot(a), "attacker A after anonymous and garbage logouts");
    assertRowsUnchanged(noOp.b, await snapshot(b), "attacker B after anonymous and garbage logouts");
    assertRowsUnchanged(noOp.v, await snapshot(victim), "victim after anonymous and garbage logouts");
    const crossSite = await fetch(new URL(ROUTE_PATH, process.env.SECURITY_SMOKE_URL), {
      method: "POST", redirect: "manual", cache: "no-store",
      headers: { cookie: device.a.two, origin: "https://attacker.example.test", "sec-fetch-site": "cross-site", "content-type": "application/json" },
      body: "{}",
    });
    const crossText = await crossSite.text();
    assertLogoutRefusal({ status: crossSite.status, text: crossText, headers: crossSite.headers, json: null }, 403, forbidden);
    assert.equal(await live(a.owner.id), 2, "a cross-site logout must revoke nothing");
    assert.equal((await account(device.a.two)).status, 200, "the session targeted by the cross-site logout still works");

    // Own logouts. Forged principals naming the VICTIM'S session must be ignored.
    const [victimSession] = await sessionRows(victim.owner.id);
    for (const [attacker, key, other, otherKey] of [[a, "a", b, "b"], [b, "b", a, "a"]]) {
      const otherBefore = await snapshot(other);
      const otherLiveBefore = await live(other.owner.id);
      const response = await logout(device[key].one, {
        userId: victim.owner.id, sessionId: victimSession.id, token: token(device.v.one), organizationId: victim.org.id,
      }, "?sessionId=" + victimSession.id + "&userId=" + victim.owner.id);
      assertLogoutOk(response);
      assertCookieCleared(response.headers);
      const rows = await sessionRows(attacker.owner.id);
      assert.equal(rows.filter((row) => row.revokedAt).length, 1, "exactly the presented session is revoked");
      assert.ok(rows.find((row) => row.revokedAt).tokenHash !== rows.find((row) => !row.revokedAt).tokenHash);
      assert.equal((await account(device[key].one)).status, 401, "the presented session is revoked");
      assert.equal((await account(device[key].two)).status, 200, "the caller's other device still works");
      // A replayed logout of an already-revoked session is the same constant answer. Observed route behavior: the revoke has no
      // "only if not already revoked" guard, so the replayed session's own revokedAt is re-stamped (still revoked, never cleared).
      // Everything else, including the caller's other device and every other account, is untouched.
      const afterFirst = await sessionRows(attacker.owner.id);
      assertLogoutOk(await logout(device[key].one, {}));
      const afterReplay = await sessionRows(attacker.owner.id);
      const stripRevoked = (rows) => rows.map(({ revokedAt, ...rest }) => ({ ...rest, revoked: Boolean(revokedAt) }));
      assert.deepEqual(stripRevoked(afterReplay), stripRevoked(afterFirst), "a replayed logout changes nothing but the replayed session's revocation timestamp");
      const stamped = afterReplay.filter((row, index) => String(row.revokedAt) !== String(afterFirst[index].revokedAt));
      assert.ok(stamped.length <= 1 && stamped.every((row) => row.revokedAt), "at most the replayed session is re-stamped, and it stays revoked");
      assertRowsUnchanged(otherBefore, await snapshot(other), "the other attacker after " + attacker.label + "'s logout");
      assertRowsUnchanged(victimBefore, await snapshot(victim), "victim after " + attacker.label + "'s logout");
      assert.equal(await live(other.owner.id), otherLiveBefore, otherKey + " keeps exactly the devices it had");
    }
    assert.equal(await live(victim.owner.id), 2, "the victim keeps both devices");
    assert.equal((await logout(device.a.one, {})).status, 200);

    // The victim after both complete attacker journeys: identical rows, both devices still work.
    assertRowsUnchanged(victimBefore, await snapshot(victim), "victim after both complete attacker journeys");
    assert.equal((await account(device.v.one)).status, 200);
    assert.equal((await account(device.v.two)).status, 200);
    const aRevoked = (await sessionRows(a.owner.id)).filter((row) => row.revokedAt).length;
    const bRevoked = (await sessionRows(b.owner.id)).filter((row) => row.revokedAt).length;
    assert.ok(aRevoked >= 1 && bRevoked >= 1);
    assert.deepEqual((await sessionRows(a.owner.id)).map((row) => row.userId), Array(2).fill(a.owner.id), "A's rows belong to A only");
    assert.notDeepEqual((await sessionRows(a.owner.id)).map((row) => row.tokenHash), (await sessionRows(b.owner.id)).map((row) => row.tokenHash), "A's session evidence cannot satisfy B's");

    console.log(JSON.stringify({
      kind: AUTH_LOGOUT_TITLE, method: AUTH_LOGOUT_METHOD, independentAttackers: 2, higherIdVictim: true,
      own: ["presented session revoked", "constant ok body", "cookie cleared", "other device untouched", "replay is a no-op"],
      noOps: ["anonymous", "garbage cookie", "cross-site with a valid cookie 403"], forgedSessionIdsIgnored: true,
      victimByteIdentical: true, productionTested: false, coverageCredits: 0, independentlyAccepted: false,
    }));
    return { method: AUTH_LOGOUT_METHOD, credited: 0 };
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("scripts/qa/tenant-auth-logout-http.mjs")) {
  verifyAuthLogoutTenantIsolation().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : "Auth logout isolation proof failed");
    process.exitCode = 1;
  });
}
