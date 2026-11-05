/**
 * Zero-credit SAML metadata proof against disposable PG16 and production Next.
 * This is not a tenant-private COVERED receipt or independent security review.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  requireIsolatedSamlProof, assertMetadata, assertSameMetadata, assertMissingMetadata,
} from "./tenant-saml-metadata-public-contract.mjs";

export async function verifySamlPublicHttp() {
  requireIsolatedSamlProof(); // MUST precede all application and database imports.
  const [{ db, pool }, s, { asc }, fixture] = await Promise.all([
    import("../../src/db/index.ts"), import("../../src/db/schema.ts"),
    import("drizzle-orm"), import("./tenant-table-http.mjs"),
  ]);
  try {
    for (const [name, table] of [
      ["organizations", s.organizations], ["identityProviders", s.identityProviders],
      ["users", s.users], ["auditEvents", s.auditEvents],
    ]) {
      assert.equal((await db.select().from(table).limit(1)).length, 0,
        "SAML_PROOF_REFUSED: disposable DB must start empty of " + name);
    }
    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
    const a = await fixture.seedEmployer("SAML_A", nonce, fixture.standaloneMakeSession);
    const b = await fixture.seedEmployer("SAML_B", nonce, fixture.standaloneMakeSession);
    const victim = await fixture.seedEmployer("SAML_VICTIM", nonce, fixture.standaloneMakeSession);
    const actors = [a, b, victim];
    assert.ok(victim.org.id > Math.max(a.org.id, b.org.id));
    assert.ok(victim.worker.id > Math.max(a.worker.id, b.worker.id));

    async function addProvider(actor, protocol) {
      const [provider] = await db.insert(s.identityProviders).values({
        organizationId: actor.org.id,
        name: actor.marker + " PRIVATE PROVIDER " + protocol,
        protocol, enabled: protocol === "oidc",
        clientId: "PRIVATE_CLIENT_" + actor.marker,
        clientSecretEncrypted: "PRIVATE_SECRET_" + actor.marker,
        samlEntityId: "PRIVATE_IDP_ENTITY_" + actor.marker,
        samlSsoUrl: "https://idp.example.invalid/" + actor.marker,
      }).returning({ id: s.identityProviders.id, enabled: s.identityProviders.enabled });
      return provider;
    }
    const providers = [];
    for (const actor of actors) providers.push(await addProvider(actor, "saml"));
    const oidc = await addProvider(victim, "oidc");
    assert.ok(providers[2].id > Math.max(providers[0].id, providers[1].id));
    assert.ok(providers.every(p => p.enabled === false),
      "Fictional SAML providers must be disabled to expose the pending public-policy decision");
    assert.equal(oidc.enabled, true, "OIDC negative control remains enabled");
    const forbidden = actors.flatMap(actor => [
      actor.marker, actor.owner.email, actor.org.name,
      "PRIVATE_CLIENT_" + actor.marker, "PRIVATE_SECRET_" + actor.marker,
      "PRIVATE_IDP_ENTITY_" + actor.marker,
    ]);
    async function snapshot() {
      const values = {};
      for (const [name, table] of [
        ["organizations", s.organizations], ["providers", s.identityProviders],
        ["users", s.users], ["memberships", s.userOrganizations],
        ["sessions", s.sessions], ["employees", s.employees],
        ["payrollRuns", s.payrollRuns], ["audits", s.auditEvents],
      ]) values[name] = await db.select().from(table).orderBy(asc(table.id));
      return values;
    }
    const before = await snapshot();
    async function get(path, headers = {}) {
      const result = await fetch(new URL(path, process.env.SECURITY_SMOKE_URL), {
        headers, redirect: "manual", cache: "no-store",
      });
      return {
        status: result.status, text: await result.text(), headers: result.headers,
      };
    }

    for (const provider of providers) {
      const path = "/api/auth/saml/metadata/" + provider.id;
      const anonymous = await get(path);
      assertMetadata(anonymous, provider.id, forbidden);
      for (const [label, cookie] of [
        ["anonymous", null], ["employer A", a.cookie],
        ["employer B", b.cookie], ["higher-ID victim", victim.cookie],
      ]) {
        const params = new URLSearchParams({
          organizationId: String(victim.org.id),
          employeeId: String(victim.worker.id),
          legalEntityId: String(victim.entity.id),
          providerId: String(oidc.id),
        });
        const headers = {
          "x-organization-id": String(victim.org.id),
          "x-tenant-id": String(victim.org.id),
          authorization: "Bearer fake-not-a-real-provider-token",
        };
        if (cookie) headers.cookie = cookie;
        const actual = await get(path + "?" + params.toString(), headers);
        assertMetadata(actual, provider.id, forbidden);
        assertSameMetadata(anonymous, actual);
        assert.deepEqual(await snapshot(), before,
          label + ": SAML metadata cannot mutate tenant, session, payroll or audit SQL");
      }
    }
    for (const path of [
      "/api/auth/saml/metadata/" + oidc.id,
      "/api/auth/saml/metadata/" + (oidc.id + 10000),
      "/api/auth/saml/metadata/not-an-id",
    ]) {
      assertMissingMetadata(await get(path), forbidden);
      assert.deepEqual(await snapshot(), before,
        "non-SAML, missing or malformed provider cannot change tenant SQL");
    }
    console.log(JSON.stringify({
      target: "GET /api/auth/saml/metadata/[providerId]",
      test: "disposable-postgresql16-production-next-real-http",
      attackers: 2, higherIdRealVictim: true, signedInSessions: 3,
      anonymousXml200: true, forgedSelectorsIdentical: true,
      disabledSamlProviderMetadataIsAnonymous200: true,
      disabledProviderPublicPolicy: "PENDING_IDENTITY_SECURITY_OWNER_DECISION",
      noTenantOrProviderSecrets: true, unchangedDb: true,
      classificationCandidate: "PUBLIC-BY-DESIGN",
      currentStatus: "GAP", coverageCredits: 0,
      independentlyAccepted: false, productionCertified: false,
    }));
  } finally {
    await pool.end();
  }
}
if (process.argv[1]?.replaceAll("\\", "/").endsWith("/tenant-saml-metadata-public-http.mjs")) {
  verifySamlPublicHttp().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
