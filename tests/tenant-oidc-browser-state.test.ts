import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { randomToken } from "../src/lib/crypto";
import {
  OIDC_BROWSER_STATE_COOKIE, OIDC_BROWSER_STATE_MAX_AGE_SECONDS,
  OIDC_BROWSER_STATE_PATH, oidcBrowserStateMatches,
} from "../src/lib/oidc-browser-state";

const start = readFileSync("src/app/api/auth/sso/start/route.ts", "utf8");
const callback = readFileSync("src/app/api/auth/sso/callback/route.ts", "utf8");

test("OIDC state is accepted only with a matching same-browser cookie", () => {
  const browserA = randomToken(32);
  const browserB = randomToken(32);
  assert.equal(browserA.length, 64);
  assert.equal(browserB.length, 64);
  assert.notEqual(browserA, browserB);
  assert.equal(oidcBrowserStateMatches(browserA, browserA), true);
  assert.equal(oidcBrowserStateMatches(browserA, browserB), false,
    "a valid DB state from another browser must not authorize a callback");
  assert.equal(oidcBrowserStateMatches(browserB, browserA), false);
  assert.equal(oidcBrowserStateMatches(browserB, browserB), true);
  assert.equal(oidcBrowserStateMatches(browserA, browserA.slice(0, -2) + "ff"), 
    browserA.endsWith("ff"), "state cookies cannot be partially matched");
});

test("missing, forged and noncanonical callback state always fail closed", () => {
  const state = randomToken(32);
  for (const value of [
    undefined, null, "", 0, 1, {}, [], state.toUpperCase(),
    state + "x", state.slice(1), "0".repeat(64), "false",
  ]) {
    assert.equal(oidcBrowserStateMatches(state, value), false,
      "unexpected cookie accepted: " + String(value));
    assert.equal(oidcBrowserStateMatches(value, state), false,
      "unexpected URL state accepted: " + String(value));
  }
  assert.equal(oidcBrowserStateMatches("0".repeat(64), "0".repeat(64)), true,
    "pure comparison verifies binding; unpredictable generation and SQL hash are separate");
});

test("start sets a short-lived, callback-scoped HttpOnly Lax cookie on its redirect", () => {
  assert.equal(OIDC_BROWSER_STATE_MAX_AGE_SECONDS, 600);
  assert.equal(OIDC_BROWSER_STATE_PATH, "/api/auth/sso/callback");
  assert.equal(OIDC_BROWSER_STATE_COOKIE, "linaw_oidc_browser_state");
  assert.match(start, /response\.cookies\.set\(OIDC_BROWSER_STATE_COOKIE, state, \{/);
  assert.match(start, /httpOnly: true/);
  assert.match(start, /sameSite: "lax"/);
  assert.match(start, /secure: process\.env\.NODE_ENV === "production"/);
  assert.match(start, /path: OIDC_BROWSER_STATE_PATH/);
  assert.match(start, /maxAge: OIDC_BROWSER_STATE_MAX_AGE_SECONDS/);
  assert.match(start, /response\.headers\.set\("Cache-Control", "no-store"\)/);
  assert.ok(start.indexOf("await db.insert(oidcLoginStates)") <
    start.indexOf("response.cookies.set("),
    "do not put a usable cookie in the browser before the state is durably stored");
});

test("callback checks browser binding BEFORE reading or consuming shared state", () => {
  const gate = callback.indexOf("if (!oidcBrowserStateMatches(state");
  const lookup = callback.indexOf("db.select().from(oidcLoginStates)");
  const claim = callback.indexOf("db.update(oidcLoginStates)");
  const exchange = callback.indexOf("await exchangeOidcCode(");
  const session = callback.indexOf("await createSession(");
  assert.ok(gate >= 0 && lookup > gate && claim > lookup && exchange > claim && session > exchange,
    "a cross-browser callback must never query/consume shared state, contact IdP, or create a session");
  assert.match(callback, /status: 403, headers: \{ "Cache-Control": "no-store" \}/);
  assert.match(callback, /browserCookies\.get\(OIDC_BROWSER_STATE_COOKIE\)\?\.value/);
  assert.match(callback, /browserCookies\.set\(OIDC_BROWSER_STATE_COOKIE, "", \{/);
  assert.match(callback, /maxAge: 0/);
  assert.match(callback, /browserCookies\.set\(SESSION_COOKIE, session\.token/);
  assert.match(callback, /eq\(identityProviders\.protocol, "oidc"\)/);
});

test("OIDC linked identities must match the IdP employer before login or audit writes", () => {
  const lookup = callback.indexOf("const [existingIdentity]");
  const scopedOrg = callback.indexOf(
    "eq(externalIdentities.organizationId, provider.organizationId)", lookup);
  const scopedProvider = callback.indexOf("eq(externalIdentities.providerId, provider.id)", lookup);
  const scopedSubject = callback.indexOf("eq(externalIdentities.subject, identity.subject)", lookup);
  const userMembership = callback.indexOf("const [membership]");
  const policy = callback.indexOf("const effectivePolicy");
  const linkedUpdate = callback.indexOf("await db.update(externalIdentities)");
  const linkedInsert = callback.indexOf("await db.insert(externalIdentities)");
  const session = callback.indexOf("await createSession(");

  assert.ok(lookup >= 0 && scopedOrg > lookup && scopedProvider > scopedOrg &&
    scopedSubject > scopedProvider && userMembership > scopedSubject &&
    policy > userMembership && linkedUpdate > policy && linkedInsert > policy &&
    session > linkedUpdate && session > linkedInsert,
    "Foreign links, revoked membership and MFA failures must not write a login link or session");
  assert.match(callback, /eq\(externalIdentities\.id, existingIdentity\.id\)/);
  assert.match(callback, /eq\(externalIdentities\.organizationId, provider\.organizationId\)/);
  assert.match(callback, /eq\(externalIdentities\.providerId, provider\.id\)/);
  assert.match(callback, /eq\(externalIdentities\.subject, identity\.subject\)/);

  const runner = readFileSync("scripts/qa/tenant-oidc-browser-state-http.mjs", "utf8");
  for (const required of [
    "Negative control: provider+subject alone",
    "Foreign-employer identity must not be accepted",
    "Positive control: own-employer identity must still be found",
    "Cross-employer identity lookup may not change sessions",
    "crossEmployerLinkedIdentityRejected: true",
    "linkedIdentitySqlReadOnly: true",
  ]) assert.ok(runner.includes(required), "Missing fake PG16 identity negative: " + required);
});
