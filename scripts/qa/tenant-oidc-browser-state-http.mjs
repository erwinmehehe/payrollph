/**
 * Genuine localhost Next HTTP + disposable fictional PG16 proof for the
 * OIDC initiating-browser boundary. No real IdP, token exchange, session
 * creation, employee data, provider credentials, money, or API method credits.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  ORIGIN, verifyOidcBrowserSourcePins, requireDisposableOidcBrowserEnv,
  assertBrowserDenial, assertNoSessionOrAuditChanged,
} from "./tenant-oidc-browser-state-contract.mjs";

const plain = value => JSON.parse(JSON.stringify(value));
const hash = value => createHash("sha256").update(value).digest("hex");

async function http(path, cookie) {
  assert.ok(path.startsWith("/api/auth/sso/start?") ||
    path.startsWith("/api/auth/sso/callback?"), "OIDC_BROWSER_REFUSED: out-of-scope URL");
  const response = await fetch(ORIGIN + path, {
    method: "GET",
    redirect: "manual", cache: "no-store",
    headers: cookie ? {cookie} : {},
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* redirects are not JSON */ }
  return { status: response.status, text, json, headers: response.headers };
}

export async function proveOidcBrowserStateIsolation() {
  requireDisposableOidcBrowserEnv();
  verifyOidcBrowserSourcePins();
  const [{db, pool}, s, {asc, eq}, fixture] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
  ]);
  try {
    const pgVersion = Number((await pool.query("SHOW server_version_num")).rows[0].server_version_num);
    assert.ok(pgVersion >= 160000 && pgVersion < 170000, "OIDC_BROWSER_REFUSED: PG16 only");
    for (const name of ["organizations", "users", "identityProviders", "oidcLoginStates"]) {
      assert.equal((await db.select().from(s[name]).limit(1)).length, 0,
        "OIDC_BROWSER_REFUSED: database must start empty " + name);
    }
    const nonce = randomUUID().replaceAll("-", "").slice(0, 12);
    // Real populated filler employers force all attacker and victim IDs beyond
    // hand-picked 1/2/3 placeholders. Their sessions/employees are genuine PG rows.
    const fillers = [];
    for (let n = 0; n < 7; n++) {
      fillers.push(await fixture.seedEmployer("OIDCF" + n, nonce, fixture.standaloneMakeSession));
    }
    const a = await fixture.seedEmployer("OIDCA", nonce, fixture.standaloneMakeSession);
    const b = await fixture.seedEmployer("OIDCB", nonce, fixture.standaloneMakeSession);
    const victim = await fixture.seedEmployer("OIDCVICTIM", nonce, fixture.standaloneMakeSession);
    assert.ok(victim.org.id > Math.max(a.org.id, b.org.id, 6));
    assert.ok(victim.owner.id > Math.max(a.owner.id, b.owner.id, 6));

    async function providerFor(actor, label) {
      // The provider intentionally has NO token endpoint, issuer, JWKS, or
      // client secret: a correctly bound callback can only fail 409. No
      // external provider contact is possible in this fixture.
      const [provider] = await db.insert(s.identityProviders).values({
        organizationId: actor.org.id, name: actor.marker + " " + label,
        protocol: "oidc", enabled: true,
        clientId: "synthetic-client-" + nonce,
        authorizationEndpoint: "https://idp.example.invalid/authorize",
      }).returning();
      const domain = label.toLowerCase() + "-" + nonce + ".example.invalid";
      await db.insert(s.identityDomains).values({
        organizationId: actor.org.id, providerId: provider.id,
        domain, verificationTokenHash: "test-only-" + label + nonce,
        verified: true, verifiedAt: new Date(),
      });
      return {actor, provider, domain, label};
    }
    const A = await providerFor(a, "A");
    const B = await providerFor(b, "B");
    const V = await providerFor(victim, "VICTIM");
    assert.ok(V.provider.id > Math.max(A.provider.id, B.provider.id, 2));

    async function snapshot() {
      const out = {};
      for (const key of [
        "organizations", "users", "userOrganizations", "identityProviders",
        "identityDomains", "oidcLoginStates", "sessions",
        "externalIdentities", "auditEvents", "payrollRuns",
      ]) out[key] = plain(await db.select().from(s[key]).orderBy(asc(s[key].id)));
      return out;
    }
    const beforeStarts = await snapshot();
    let ownStarts = 0, deniedOtherBrowsers = 0, matchedClaims = 0;

    async function start(actor) {
      const email = "employee@" + actor.domain;
      const response = await http("/api/auth/sso/start?providerId=" +
        actor.provider.id + "&loginHint=" + encodeURIComponent(email));
      assert.equal(response.status, 302, actor.label + ": own verified SSO must start");
      assert.ok(response.headers.get("cache-control")?.includes("no-store"));
      const cookieHeader = response.headers.get("set-cookie") ?? "";
      const cookieMatch = cookieHeader.match(/(?:^|[;,]\s*)linaw_oidc_browser_state=([0-9a-f]{64})(?:;|$)/);
      assert.ok(cookieMatch, actor.label + ": no initiating-browser cookie");
      assert.match(cookieHeader.toLowerCase(), /httponly/);
      assert.match(cookieHeader.toLowerCase(), /samesite=lax/);
      assert.match(cookieHeader.toLowerCase(), /secure/);
      assert.match(cookieHeader.toLowerCase(), /path=\/api\/auth\/sso\/callback/);
      assert.match(cookieHeader.toLowerCase(), /max-age=600/);
      const url = new URL(response.headers.get("location"));
      assert.equal(url.origin, "https://idp.example.invalid");
      assert.equal(url.searchParams.get("client_id"), actor.provider.clientId);
      assert.equal(url.searchParams.get("login_hint"), email);
      const state = url.searchParams.get("state");
      assert.equal(state, cookieMatch[1], "cookie and provider state must match");
      const rows = await db.select().from(s.oidcLoginStates).where(
        eq(s.oidcLoginStates.stateHash, hash(state)));
      assert.equal(rows.length, 1);
      assert.equal(rows[0].providerId, actor.provider.id);
      assert.equal(rows[0].usedAt, null);
      ownStarts++;
      return {state, cookie: "linaw_oidc_browser_state=" + cookieMatch[1]};
    }

    const aLogin = await start(A);
    const bLogin = await start(B);
    assert.notEqual(aLogin.state, bLogin.state);
    const afterStarts = await snapshot();
    assertNoSessionOrAuditChanged(beforeStarts, afterStarts, "SSO start");
    assert.equal(afterStarts.oidcLoginStates.length, 2);

    const forgedStart = await http("/api/auth/sso/start?providerId=" +
      V.provider.id + "&loginHint=" + encodeURIComponent("employee@" + A.domain));
    assert.equal(forgedStart.status, 403, "foreign domain must not initiate another provider");
    assert.ok(!forgedStart.headers.get("set-cookie")?.includes("linaw_oidc_browser_state"));
    assert.deepEqual(await snapshot(), afterStarts, "foreign provider start wrote state");

    async function refused(label, state, cookie) {
      const original = await snapshot();
      const response = await http("/api/auth/sso/callback?state=" + state + "&code=fictional", cookie);
      assertBrowserDenial(response, label);
      assert.deepEqual(await snapshot(), original, label + ": denied callback consumed state");
      deniedOtherBrowsers++;
    }
    await refused("A missing browser cookie", aLogin.state);
    await refused("A state sent from B's browser", aLogin.state, bLogin.cookie);
    await refused("B missing browser cookie", bLogin.state);
    await refused("B state sent from A's browser", bLogin.state, aLogin.cookie);
    await refused("A forged cookie", aLogin.state,
      "linaw_oidc_browser_state=" + "0".repeat(64));
    await refused("B forged cookie", bLogin.state,
      "linaw_oidc_browser_state=" + "0".repeat(64));

    // Correct initiating-browser state must pass the new boundary and consume
    // only its own DB state. The intentionally incomplete provider refuses 409
    // BEFORE any network exchange; this is NOT a successful OIDC login.
    for (const [actor, login] of [[A, aLogin], [B, bLogin]]) {
      const before = await snapshot();
      const response = await http("/api/auth/sso/callback?state=" +
        login.state + "&code=fictional", login.cookie);
      assert.equal(response.status, 409, actor.label + ": bound state must reach provider configuration gate");
      assert.match(response.text, /OIDC provider configuration is incomplete/);
      const after = await snapshot();
      assertNoSessionOrAuditChanged(before, after, actor.label + " matched state");
      assert.equal(after.oidcLoginStates.length, 2);
      for (const row of after.oidcLoginStates) {
        const previous = before.oidcLoginStates.find(item => item.id === row.id);
        assert.ok(previous);
        if (row.stateHash === hash(login.state)) {
          assert.ok(row.usedAt, actor.label + ": matching browser state not consumed");
          assert.equal(previous.usedAt, null);
        } else assert.deepEqual(row, previous, "other employer login state was modified");
      }
      matchedClaims++;
    }
    const beforeReplay = await snapshot();
    const replay = await http("/api/auth/sso/callback?state=" +
      aLogin.state + "&code=fictional", aLogin.cookie);
    assert.equal(replay.status, 400, "consumed login state must remain non-replayable");
    assert.deepEqual(await snapshot(), beforeReplay, "replayed login mutated SQL");
    assert.equal((await db.select().from(s.externalIdentities).limit(1)).length, 0);

    assert.equal(ownStarts, 2);
    assert.equal(deniedOtherBrowsers, 6);
    assert.equal(matchedClaims, 2);
    console.log(JSON.stringify({
      family: "OIDC_START_CALLBACK_BROWSER_STATE_TENANT_BOUNDARY",
      proof: "fictional-PG16-real-localhost-HTTP",
      ownStartRedirects: ownStarts,
      otherBrowserDeniedUnconsumed: deniedOtherBrowsers,
      validBrowserStateConsumedWithoutExternalIdp: matchedClaims,
      differentEmployers: 2, realFillerEmployers: fillers.length, highIdPopulatedVictim: true,
      unchangedVictimAndSessionSql: true,
      noExternalIdpOrMoneyCalls: true,
      completeMethodCredits: 0, independentSecurityReview: "PENDING",
      productionCertified: false,
    }));
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/tenant-oidc-browser-state-http.mjs")) {
  proveOidcBrowserStateIsolation().catch(error => { console.error(error); process.exitCode = 1; });
}
