/**
 * Zero-credit SAML metadata privacy proof: disposable PG16 + production Next.
 * Fictional enabled records are metadata controls, not SAML sign-in activation.
 */
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import {execFileSync} from "node:child_process";
import {requireFreshSamlMetadataEnv,collectFreshSamlInputs,assertFreshSamlResult} from "./tenant-saml-metadata-fresh-inputs.mjs";
import {
  ROUTE, ROUTE_BLOB, assertMetadata,
  assertSameMetadata, assertMissingMetadata, assertHiddenMetadata,
} from "./tenant-saml-metadata-public-contract.mjs";

export async function verifySamlPublicHttp() {
  requireFreshSamlMetadataEnv(); // MUST precede all application and database imports.
  assert.equal(execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),process.env.SAML_PROOF_HEAD_SHA);
  const inputs=collectFreshSamlInputs();
  assert.match(process.env.SAML_PROOF_HEAD_SHA || "", /^[a-f0-9]{40}$/, "Exact proof head is required");
  const source = readFileSync(ROUTE);
  assert.equal(createHash("sha1").update("blob " + source.length + "\0")
    .update(source).digest("hex"), ROUTE_BLOB, "HTTP proof requires the repaired source");
  const [{ db, pool }, s, { asc, eq }, fixture] = await Promise.all([
    import("../../src/db/index.ts"), import("../../src/db/schema.ts"),
    import("drizzle-orm"), import("./tenant-table-http.mjs"),
  ]);
  try {
    const target=(await pool.query("SELECT current_database() AS db, current_user AS actor, current_setting('server_version_num') AS version")).rows[0];
    assert.equal(target.db,'app_db');assert.equal(target.actor,'postgres');
    assert.equal(Math.floor(Number(target.version)/10000),16,'Actual PostgreSQL 16 is required');
    for (const [name, table] of [
      ["organizations", s.organizations], ["identityProviders", s.identityProviders],
      ["users", s.users], ["auditEvents", s.auditEvents],
    ]) {
      assert.equal((await db.select().from(table).limit(1)).length, 0,
        "SAML_PROOF_REFUSED: disposable DB must start empty of " + name);
    }
    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
    for(let i=0;i<7;i++){
      const filler=await fixture.seedEmployer('SAML_FILLER_'+i,nonce,fixture.standaloneMakeSession);
      await db.insert(s.identityProviders).values({organizationId:filler.org.id,name:'Fictional filler '+i,protocol:'saml',enabled:false});
    }
    const a = await fixture.seedEmployer("SAML_A", nonce, fixture.standaloneMakeSession);
    const b = await fixture.seedEmployer("SAML_B", nonce, fixture.standaloneMakeSession);
    const victim = await fixture.seedEmployer("SAML_VICTIM", nonce, fixture.standaloneMakeSession);
    const actors = [a, b, victim];
    assert.ok(victim.org.id > Math.max(a.org.id, b.org.id));
    assert.ok(victim.worker.id > Math.max(a.worker.id, b.worker.id));

    async function addProvider(actor, protocol, enabled) {
      const [provider] = await db.insert(s.identityProviders).values({
        organizationId: actor.org.id,
        name: actor.marker + " PRIVATE PROVIDER " + protocol + " " + enabled,
        protocol, enabled,
        clientId: "PRIVATE_CLIENT_" + actor.marker,
        clientSecretEncrypted: "PRIVATE_SECRET_" + actor.marker,
        samlEntityId: "PRIVATE_IDP_ENTITY_" + actor.marker,
        samlSsoUrl: "https://idp.example.invalid/" + actor.marker,
      }).returning({ id: s.identityProviders.id, enabled: s.identityProviders.enabled });
      return provider;
    }
    const providers = [];
    const disabledProviders = [];
    for (const actor of actors) {
      providers.push(await addProvider(actor, "saml", true));
      disabledProviders.push(await addProvider(actor, "saml", false));
    }
    const oidc = await addProvider(victim, "oidc", true);
    assert.ok(providers[2].id > Math.max(providers[0].id, providers[1].id));
    assert.ok(disabledProviders[2].id > Math.max(disabledProviders[0].id, disabledProviders[1].id));
    assert.ok(providers.every(p => p.enabled === true), "Enabled SAML positive controls required");
    assert.ok(disabledProviders.every(p => p.enabled === false), "Disabled SAML privacy controls required");
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
      // Complete global organization-owned SQL, not only the tables the route reads.
      for(const table of protectedTables){
        assert.match(table,/^[a-z_][a-z0-9_]*$/);
        values['org:'+table]=(await pool.query('SELECT to_jsonb(t) AS row FROM "'+table+'" t ORDER BY to_jsonb(t)::text')).rows;
      }
      return values;
    }
    const protectedTables=(await pool.query("SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='organization_id' ORDER BY table_name")).rows.map(r=>r.table_name);
    assert.ok(protectedTables.length>100,'Real organization-owned schema required');
    assert.ok([a,b,victim].every(e=>[e.org.id,e.worker.id,e.owner.id,e.entity.id].every(id=>id>6)));
    assert.ok([...providers,...disabledProviders].every(p=>p.id>6));
    const before = await snapshot();
    let expectedState = before;
    let requests = 0;
    async function get(path, headers = {}) {
      const result = await fetch(new URL(path, process.env.SECURITY_SMOKE_URL), {
        headers, redirect: "manual", cache: "no-store",
      });
      const response = { status: result.status, text: await result.text(), headers: result.headers };
      requests++;
      assert.deepEqual(await snapshot(), expectedState,
        "Every metadata request must leave provider, tenant, session, payroll and audit SQL unchanged");
      return response;
    }
    const missingPath = "/api/auth/saml/metadata/" + (oidc.id + 10000);
    const missing = await get(missingPath);
    assertHiddenMetadata(missing, null, forbidden);
    const callers = [
      ["anonymous", null], ["employer A", a.cookie],
      ["employer B", b.cookie], ["higher-ID victim", victim.cookie],
    ];
    function forgedRequest(otherProviderId, cookie) {
      const params = new URLSearchParams({
        organizationId: String(victim.org.id), tenantId: String(victim.org.id),
        employeeId: String(victim.worker.id), legalEntityId: String(victim.entity.id),
        providerId: String(otherProviderId), enabled: "true",
      });
      const headers = {
        "x-organization-id": String(victim.org.id), "x-tenant-id": String(victim.org.id),
        "x-provider-id": String(otherProviderId), authorization: "Bearer fake-not-a-real-provider-token",
      };
      if (cookie) headers.cookie = cookie;
      return { suffix: "?" + params.toString(), headers };
    }
    for (const [index, provider] of providers.entries()) {
      const path = "/api/auth/saml/metadata/" + provider.id;
      const anonymous = await get(path);
      assertMetadata(anonymous, provider.id, forbidden);
      for (const [, cookie] of callers) {
        const forged = forgedRequest(providers[(index + 1) % providers.length].id, cookie);
        const actual = await get(path + forged.suffix, forged.headers);
        assertMetadata(actual, provider.id, forbidden);
        assertSameMetadata(anonymous, actual);
      }
    }
    for (const provider of [...disabledProviders, oidc]) {
      const path = "/api/auth/saml/metadata/" + provider.id;
      assertHiddenMetadata(await get(path), missing, forbidden);
      for (const [, cookie] of callers) {
        const forged = forgedRequest(providers[2].id, cookie);
        assertHiddenMetadata(await get(path + forged.suffix, forged.headers), missing, forbidden);
      }
    }
    for (const [, cookie] of callers) {
      const forged = forgedRequest(providers[0].id, cookie);
      assertHiddenMetadata(await get(missingPath + forged.suffix, forged.headers), missing, forbidden);
    }
    for (const id of ["not-an-id", "1.5"]) {
      assertMissingMetadata(await get("/api/auth/saml/metadata/" + id), forbidden, 400);
    }
    assert.deepEqual(await snapshot(), before, "All pre-transition HTTP requests leave SQL unchanged");

    // An intentional fixture-only toggle is separated from HTTP read-only assertions.
    // The same production process must stop serving a previously visible provider.
    const retiring = providers[2];
    await db.update(s.identityProviders).set({ enabled: false }).where(eq(s.identityProviders.id, retiring.id));
    expectedState = await snapshot();
    const expectedAfterToggle = structuredClone(before);
    expectedAfterToggle.providers.find(p => p.id === retiring.id).enabled = false;
    expectedAfterToggle['org:identity_providers'].find(p=>p.row.id===retiring.id).row.enabled=false;
    assert.deepEqual(expectedState, expectedAfterToggle, "Only the fictional provider enablement bit may change");
    const retiringPath = "/api/auth/saml/metadata/" + retiring.id;
    assertHiddenMetadata(await get(retiringPath), missing, forbidden);
    for (const [, cookie] of callers) {
      const forged = forgedRequest(providers[0].id, cookie);
      assertHiddenMetadata(await get(retiringPath + forged.suffix, forged.headers), missing, forbidden);
    }
    // An unrelated enabled provider must still succeed after the fixture toggle.
    assertMetadata(await get("/api/auth/saml/metadata/" + providers[0].id), providers[0].id, forbidden);
    assert.deepEqual(await snapshot(), expectedState, "All post-transition HTTP requests leave SQL unchanged");
    const result = {
      target: "GET /api/auth/saml/metadata/[providerId]",
      test: "disposable-postgresql16-production-next-real-http",
      proofHeadSha: process.env.SAML_PROOF_HEAD_SHA, routeBlobSha: ROUTE_BLOB,
      attackers: 2, higherIdRealVictim: true, allBusinessIdsOverSix:true, signedInSessions: 3, requests,
      anonymousXml200: true, enabledProviderPositiveControls: 3, disabledProviderControls: 3,
      forgedSelectorsIdentical: true, disabledAndMissingIdentical404: true,
      disabledProviderPublicPolicy: "CONCEAL_DISABLED_PROVIDERS",
      enabledThenDisabledConcealed: true, fixtureProviderDisableWrites: 1,
      noTenantOrProviderSecrets: true, unchangedDbDuringHttp: true,
      classificationCandidate: "PUBLIC-BY-DESIGN", currentStatus: "GAP", coverageCredits: 0,
      independentlyAccepted: false, productionCertified: false,
      allOrganizationTablesProtected:true,protectedOrganizationTables:protectedTables.length,
      evidenceLabel:'SOLO_VERIFIED_DEV_RECOVERY',resolveHeld:true,
      postgresMajor:16,
    };
    assertFreshSamlResult(result);
    assert.deepEqual(collectFreshSamlInputs(),inputs,'Execution source drifted during real HTTP proof');
    const receipt={schema:'saml-public-metadata-fresh-pg16-v1',sourceHead:process.env.SAML_PROOF_HEAD_SHA,
      runId:process.env.GITHUB_RUN_ID,inputs,result};
    mkdirSync('/tmp/payrollph-saml-metadata-public',{recursive:true});
    writeFileSync('/tmp/payrollph-saml-metadata-public/receipt.json',JSON.stringify(receipt,null,2)+'\n');
    console.log('SAML_METADATA_FRESH_HTTP_PASS '+JSON.stringify(receipt));
  } finally {
    await pool.end();
  }
}
if (process.argv[1]?.replaceAll("\\", "/").endsWith("/tenant-saml-metadata-fresh-http.mjs")) {
  verifySamlPublicHttp().catch(error => { console.error(error); process.exitCode = 1; });
}
