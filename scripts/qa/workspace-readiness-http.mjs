/**
 * Run only from the guarded, disposable PostgreSQL 16 security HTTP harness.
 * The authorized own employer is intentionally 503, not a fake 200/readiness
 * success. An unrelated authenticated tenant must receive 403.
 */
import assert from "node:assert/strict";

export async function verifyWorkspaceReadinessIsolation(f, { request, expectStatus }) {
  if (process.env.CI !== "true" ||
      process.env.TENANT_SECOND_PASS_MODE !== "isolated-ci-only" ||
      !/^(postgresql:\/\/)([^/]+@)(127\.0\.0\.1|localhost):5432\/app_db$/.test(process.env.DATABASE_URL ?? "")) {
    throw new Error("Workspace readiness proof requires disposable PostgreSQL.");
  }
  const victim = f.orgs[0];
  const victimOwner = f.ownerSessions[0].cookie;
  const verifiedVictimDenial = expectStatus(await request("/api/readiness/workspace?organizationId=" + victim.id,
    { cookie: victimOwner }), 503, "Authorized employer receives fail-closed readiness unavailable");
  assert.equal(verifiedVictimDenial.json?.code, "WORKSPACE_READINESS_UNAVAILABLE");
  for (const field of ["gates","counts","status","ready","pilot","users","emails","invoices"]) {
    assert.equal(Object.hasOwn(verifiedVictimDenial.json ?? {}, field), false,
      "Readiness refusal must not contain platform-wide " + field);
  }
  for (const idx of [1, 2]) {
    const org = f.orgs[idx];
    const cookie = f.ownerSessions[idx].cookie;
    const ownReadinessUnavailable = expectStatus(await request("/api/readiness/workspace?organizationId=" +
      org.id, { cookie }), 503, "Own authenticated employer cannot read unscoped readiness");
    assert.equal(ownReadinessUnavailable.json?.code, "WORKSPACE_READINESS_UNAVAILABLE");
    assert.equal(ownReadinessUnavailable.headers.get("cache-control"), "no-store");
    expectStatus(await request("/api/readiness/workspace?organizationId=" + victim.id,
      { cookie }), 403, "Foreign employer's readiness must be denied, not a platform aggregate");
  }
}
