/**
 * Real production-mode Next GET /api/v1 over disposable PG16.
 * Three persisted, signed-in fictional employers are discriminators only:
 * public static metadata is not a tenant-scoped success/foreign-ID proof.
 * Never claim method COVERED or production security acceptance here.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  requireDisposableV1Catalog, assertV1PublicCatalog, assertV1CatalogEqual,
} from "./tenant-v1-public-contract.mjs";

export async function verifyV1PublicCatalogHttp() {
  requireDisposableV1Catalog(); // MUST precede all application/database imports
  const [{ db, pool }, s, { asc }, fixtures] = await Promise.all([
    import("../../src/db/index.ts"), import("../../src/db/schema.ts"),
    import("drizzle-orm"), import("./tenant-table-http.mjs"),
  ]);
  const { seedEmployer, standaloneMakeSession } = fixtures;
  try {
    for (const [name, table] of [
      ["organizations", s.organizations], ["users", s.users],
      ["audit_events", s.auditEvents],
    ]) {
      assert.equal((await db.select().from(table).limit(1)).length, 0,
        "V1_CATALOG_REFUSED: fresh fictional DB must have no " + name);
    }
    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
    const a = await seedEmployer("V1A", nonce, standaloneMakeSession);
    const b = await seedEmployer("V1B", nonce, standaloneMakeSession);
    const victim = await seedEmployer("V1VICTIM", nonce, standaloneMakeSession);
    assert.ok(victim.org.id > Math.max(a.org.id, b.org.id));
    assert.ok(victim.worker.id > Math.max(a.worker.id, b.worker.id));
    const actors = [a, b, victim];
    const forbidden = actors.flatMap(x => [x.marker, x.owner.email]);
    const snapshot = async () => {
      const out = {};
      for (const [name, table] of [
        ["organizations", s.organizations], ["users", s.users],
        ["memberships", s.userOrganizations], ["employees", s.employees],
        ["payrollRuns", s.payrollRuns], ["payrollEntries", s.payrollEntries],
        ["auditEvents", s.auditEvents], ["sessions", s.sessions],
      ]) {
        out[name] = await db.select().from(table).orderBy(asc(table.id));
      }
      return out;
    };
    const before = await snapshot();
    const BASE = process.env.SECURITY_SMOKE_URL;
    async function get(path, headers = {}) {
      const res = await fetch(new URL(path, BASE), {
        headers, cache: "no-store", redirect: "manual",
      });
      const text = await res.text();
      let json;
      try { json = JSON.parse(text); } catch { json = null; }
      return { status: res.status, text, json };
    }
    const initial = await get("/api/v1");
    assertV1PublicCatalog(initial, forbidden); // real anonymous 200 and nonempty catalog
    const scenarios = [
      ["anonymous forged victim", undefined],
      ["employer A authenticated", a.cookie],
      ["employer B authenticated", b.cookie],
      ["victim authenticated", victim.cookie],
      ["employer A forged victim", a.cookie],
      ["employer B forged victim", b.cookie],
    ];
    for (const [label, cookie] of scenarios) {
      const params = new URLSearchParams({
        organizationId: String(victim.org.id), employeeId: String(victim.worker.id),
        runId: "999999", legalEntityId: String(victim.entity.id),
        apiKeyId: "another-employer-key",
      });
      const headers = {
        "x-organization-id": String(victim.org.id),
        "x-tenant-id": String(victim.org.id),
        authorization: "Bearer sk_live_not-a-real-token",
      };
      if (cookie) headers.cookie = cookie;
      const res = await get("/api/v1?" + params.toString(), headers);
      assertV1PublicCatalog(res, forbidden);
      assertV1CatalogEqual(initial, res);
      assert.deepEqual(await snapshot(), before,
        label + ": public catalog GET must not touch tenant or audit SQL");
    }
    console.log(JSON.stringify({
      kind: "tenant-v1-static-public-catalog-pg16-http",
      method: "GET /api/v1", employerCount: actors.length,
      realOwnerSessions: true, anonymous200: true, forgedSelectorsIgnored: true,
      publicCatalogByteIdentical: true, postgresStateUnchanged: true,
      classification: "PUBLIC-BY-DESIGN", tenantScopedCoverageCredits: 0,
      independentReview: "PENDING", productionCertified: false,
    }));
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/tenant-v1-public-http.mjs")) {
  verifyV1PublicCatalogHttp().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
