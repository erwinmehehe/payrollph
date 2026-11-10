/**
 * Anonymous SSO provider discovery: real production Next HTTP + disposable PG16.
 * Two independent fictional employers, a later real higher-ID victim, verified
 * own-domain positives, mismatched (cross-tenant) FK negative and immutable SQL.
 * Zero tenant-private whole-method coverage credit; never call an identity
 * provider, create a payment or touch a customer/remote database.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  requireDisposableSsoDiscovery, assertFound, assertUnavailable, assertNoStore,
} from "./tenant-sso-discovery-proof.mjs";

export async function verifySsoDiscoveryHttp() {
  requireDisposableSsoDiscovery(); // before ANY app or DB import
  const [{ db, pool }, s, { asc, eq }, fixture] = await Promise.all([
    import("../../src/db/index.ts"), import("../../src/db/schema.ts"),
    import("drizzle-orm"), import("./tenant-table-http.mjs"),
  ]);
  try {
    for (const [name, table] of [
      ["organizations", s.organizations], ["identityProviders", s.identityProviders],
      ["identityDomains", s.identityDomains], ["users", s.users],
      ["auditEvents", s.auditEvents],
    ]) assert.equal((await db.select().from(table).limit(1)).length, 0,
      "SSO_DISCOVERY_REFUSED: database must start empty: " + name);

    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
    const a = await fixture.seedEmployer("SSOA", nonce, fixture.standaloneMakeSession);
    const b = await fixture.seedEmployer("SSOB", nonce, fixture.standaloneMakeSession);
    const victim = await fixture.seedEmployer("SSO_VICTIM", nonce, fixture.standaloneMakeSession);
    assert.ok(victim.org.id > Math.max(a.org.id, b.org.id));
    assert.ok(victim.owner.id > Math.max(a.owner.id, b.owner.id));

    async function addProvider(actor, label, protocol = "oidc") {
      const [provider] = await db.insert(s.identityProviders).values({
        organizationId: actor.org.id,
        name: actor.marker + " PRIVATE PROVIDER " + label,
        protocol, enabled: true,
        clientId: "fictional-client-" + nonce,
        authorizationEndpoint: "https://idp.example.invalid/authorize",
      }).returning();
      return provider;
    }
    async function addDomain(actor, provider, prefix, verified = true) {
      const domain = prefix + "-" + nonce + ".example.invalid";
      const [row] = await db.insert(s.identityDomains).values({
        organizationId: actor.org.id, providerId: provider.id, domain,
        verificationTokenHash: "fictional-token-not-secret-" + nonce + prefix,
        verified, verifiedAt: verified ? new Date() : null,
      }).returning();
      return row;
    }

    const providerA = await addProvider(a, "A");
    const providerB = await addProvider(b, "B");
    const providerV = await addProvider(victim, "V");
    assert.ok(providerV.id > Math.max(providerA.id, providerB.id),
      "real victim provider ID must be greater than both attacker provider IDs");
    const domainA = await addDomain(a, providerA, "a");
    const domainB = await addDomain(b, providerB, "b");
    const domainV = await addDomain(victim, providerV, "v");
    const samlProvider = await addProvider(victim, "DISABLED_RUNTIME_SAML", "saml");
    const samlDomain = await addDomain(victim, samlProvider, "saml");
    const unverifiedDomain = await addDomain(victim, providerV, "unverified", false);

    const providers = [providerA, providerB, providerV, samlProvider];
    const forbidden = providers.map(p => p.name);
    const url = process.env.SECURITY_SMOKE_URL + "/api/auth/sso/resolve";

    async function post(body, options = {}) {
      const res = await fetch(url, {
        method: "POST", redirect: "manual", cache: "no-store",
        headers: {
          origin: "https://payroll.example.test", "sec-fetch-site": "same-origin",
          "content-type": "application/json",
          ...(options.headers ?? {}),
        },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* invalid response caught by assertions */ }
      return { status: res.status, text, json, headers: res.headers };
    }
    async function snapshot() {
      const data = {};
      for (const [name, table] of [
        ["organizations", s.organizations], ["providers", s.identityProviders],
        ["domains", s.identityDomains], ["users", s.users],
        ["memberships", s.userOrganizations], ["sessions", s.sessions],
        ["employees", s.employees], ["payrollRuns", s.payrollRuns],
        ["oidcLoginStates", s.oidcLoginStates], ["auditEvents", s.auditEvents],
      ]) data[name] = await db.select().from(table).orderBy(asc(table.id));
      return data;
    }
    const before = await snapshot();
    const actors = [
      { domain: domainA, provider: providerA, cookie: a.cookie },
      { domain: domainB, provider: providerB, cookie: b.cookie },
      { domain: domainV, provider: providerV, cookie: victim.cookie },
    ];
    for (const actor of actors) {
      const email = "analyst+" + nonce + "@" + actor.domain.domain;
      const own = await post({ email });
      assertFound(own, actor.provider, email, forbidden.filter(v => v !== actor.provider.name));
      const withForgedIds = await post({
        email, organizationId: victim.org.id, providerId: providerV.id,
        tenantId: victim.org.id, employeeId: victim.worker.id,
      }, { headers: { cookie: a.cookie, "x-organization-id": String(victim.org.id) } });
      assertFound(withForgedIds, actor.provider, email,
        forbidden.filter(v => v !== actor.provider.name));
      assert.deepEqual(await snapshot(), before, "SSO discovery must not mutate tenant tables");
    }

    for (const email of [
      "unknown@" + nonce + ".example.invalid",
      "analyst@" + samlDomain.domain,
      "analyst@" + unverifiedDomain.domain,
    ]) {
      assertUnavailable(await post({ email }), forbidden);
      assert.deepEqual(await snapshot(), before, "negative SSO discovery left SQL changed");
    }

    // Manufacture an inconsistent foreign provider FK on the isolated fixture.
    // Without the new organization-to-organization SQL join, this lookup would
    // return the higher-ID victim provider for A's verified email domain.
    await db.update(s.identityDomains).set({ providerId: providerV.id })
      .where(eq(s.identityDomains.id, domainA.id));
    const mismatched = await snapshot();
    assertUnavailable(await post({ email: "analyst@" + domainA.domain }), forbidden);
    assert.deepEqual(await snapshot(), mismatched, "mismatched tenant lookup must read only");
    assertFound(await post({ email: "analyst@" + domainV.domain }),
      providerV, "analyst@" + domainV.domain, forbidden.filter(v => v !== providerV.name));
    assert.deepEqual(await snapshot(), mismatched, "victim provider must remain unchanged");

    for (const bad of [null, {}, { email: ["analyst@" + domainB.domain] },
      { email: "analyst@@"+domainB.domain }, { email: "analyst@" + domainB.domain + "/redirect" },
    ]) {
      assertUnavailable(await post(bad), forbidden);
      assert.deepEqual(await snapshot(), mismatched, "malformed discovery mutated employer state");
    }
    const crossSite = await post({ email: "analyst@" + domainV.domain },
      { headers: { origin: "https://other.example.invalid", "sec-fetch-site": "cross-site" } });
    assert.equal(crossSite.status, 403, "cross-site anonymous POST must be denied");
    assert.deepEqual(await snapshot(), mismatched, "denied cross-site POST changed tenant SQL");

    // Restore fixture only; this is never a production write.
    await db.update(s.identityDomains).set({ providerId: providerA.id })
      .where(eq(s.identityDomains.id, domainA.id));
    assert.deepEqual(await snapshot(), before);
    const again = await post({ email: "analyst@" + domainA.domain });
    assertFound(again, providerA, "analyst@" + domainA.domain,
      forbidden.filter(v => v !== providerA.name));
    assertNoStore(again.headers);
    assert.deepEqual(await snapshot(), before);

    console.log(JSON.stringify({
      family: "SSO_DISCOVERY_DOMAIN_PROVIDER_TENANT_BOUNDARY",
      test: "fictional-PG16-production-mode-real-HTTP",
      twoIndependentEmployers: true, realHigherIdVictim: true,
      eachOwnVerifiedProviderPositive: true,
      forgedTenantSelectorsDoNotChangeLookup: true,
      crossEmployerDomainProviderJoinDenied: true,
      samlAndUnverifiedDomainsDenied: true,
      malformedAndCrossSiteDenied: true, unchangedEmployerProviderAuditAndSessionSql: true,
      completeMethodCredits: 0, independentSecurityReview: "PENDING",
      productionCertified: false,
    }));
  } finally {
    await pool.end();
  }
}
if (process.argv[1]?.replaceAll("\\", "/").endsWith("/tenant-sso-discovery-http.mjs")) {
  verifySsoDiscoveryHttp().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
