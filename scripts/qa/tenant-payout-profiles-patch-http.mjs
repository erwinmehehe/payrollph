/**
 * One-family PATCH /api/payout-profiles real localhost HTTP against fictional
 * PostgreSQL 16: two distinct employer owners, a higher-ID victim, and an
 * injected audit failure proving profile + audit atomic rollback.
 *
 * No production DB, provider credentials, payout attempts or live money.
 * Source proof candidate only. Method remains GAP until independent review.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

const BASE = "http://127.0.0.1:3000";
function requireDisposable() {
  for (const [k, v] of [
    ["GITHUB_ACTIONS", "true"], ["CI", "true"],
    ["TENANT_SECOND_PASS_MODE", "isolated-ci-only"],
    ["DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:5432/app_db"],
    ["PAYMONGO_DISBURSEMENTS_ENABLED", "false"],
    ["XENDIT_PAYOUTS_ENABLED", "false"],
    ["WORKER_ENABLED", "false"],
    ["CENTRAL_SCHEDULER_ENABLED", "false"],
  ]) assert.equal(process.env[k], v, k + " must be disposable");
  assert.equal(process.env.OPENAI_API_KEY ?? "", "");
  assert.ok(!process.env.PAYMONGO_SECRET_KEY && !process.env.XENDIT_SECRET_KEY);
}
requireDisposable();

const [{ db }, schema, orm, http] = await Promise.all([
  import("../../src/db/index.ts"), import("../../src/db/schema.ts"),
  import("drizzle-orm"), import("./tenant-table-http.mjs"),
]);
const { and, eq } = orm;
const pgClient = new pg.Client({ connectionString: process.env.DATABASE_URL });
const nonce = randomUUID().slice(0, 8);
let assertions = 0;
function check(condition, label) { assert.ok(condition, label); assertions++; }
function exact(response, expected, label) {
  assert.equal(response.status, expected,
    label + " HTTP " + response.status + " " + (response.json?.error ?? "").slice(0, 180));
  assertions++;
  return response;
}
async function profileSnapshot(orgId) {
  return db.select().from(schema.payoutProfiles)
    .where(eq(schema.payoutProfiles.organizationId, orgId))
    .orderBy(schema.payoutProfiles.id);
}
async function auditSnapshot(orgId) {
  return db.select().from(schema.auditEvents)
    .where(eq(schema.auditEvents.organizationId, orgId))
    .orderBy(schema.auditEvents.id);
}
async function payrollSnapshot(orgId) {
  return db.select().from(schema.payrollRuns)
    .where(eq(schema.payrollRuns.organizationId, orgId))
    .orderBy(schema.payrollRuns.id);
}
function body(org, product) {
  return {
    organizationId: org.org.id, legalEntityId: org.entity.id,
    defaultMethod: "manual", active: false, bankProduct: product,
    maxRowsPerFile: 25,
  };
}
async function patch(org, requestBody, cookie = org.cookie) {
  return http.standaloneRequest("/api/payout-profiles", {
    method: "PATCH", cookie, body: requestBody,
  });
}

try {
  await pgClient.connect();
  const a = await http.seedEmployer("ATTA", nonce, http.standaloneMakeSession);
  const b = await http.seedEmployer("ATTB", nonce, http.standaloneMakeSession);
  const victim = await http.seedEmployer("VICTIM", nonce, http.standaloneMakeSession);
  check(victim.org.id > b.org.id && victim.entity.id > b.entity.id &&
    victim.worker.id > b.worker.id,
    "Victim is a real populated, higher-ID employer, entity and employee");
  const victimBefore = {
    profiles: await profileSnapshot(victim.org.id),
    audit: await auditSnapshot(victim.org.id),
    payroll: await payrollSnapshot(victim.org.id),
  };
  for (const actor of [a, b]) {
    const own = exact(await patch(actor, body(actor, actor.marker + " manual profile")), 200,
      "Own owner can save a tenant-specific inactive manual payout profile");
    check(own.json?.profile?.organizationId === actor.org.id &&
      own.json?.profile?.legalEntityId === actor.entity.id,
      "The success receipt must refer to the same employer and legal entity");
    const profiles = await profileSnapshot(actor.org.id);
    check(profiles.length === 1 && profiles[0].bankProduct === actor.marker + " manual profile",
      "Actual payout profile must persist for own employer");
    const audits = await auditSnapshot(actor.org.id);
    check(audits.some(event => event.action === "Company payout profile updated" &&
      event.organizationId === actor.org.id),
      "Owned successful write must have a genuine employer-scoped audit receipt");

    exact(await patch(actor, {
      ...body(victim, "forged foreign employer"), organizationId: victim.org.id,
    }), 403, "True foreign employer selector is forbidden");
    exact(await patch(actor, {
      ...body(actor, "forged victim legal entity"), legalEntityId: victim.entity.id,
    }), 404, "A real foreign legal entity forged into an own org is not found");
    exact(await patch(actor, {
      ...body(b, "forged peer legal entity"), legalEntityId: (actor === a ? b : a).entity.id,
    }), 404, "Another attacker entity forged into own employer is not found");
  }
  assert.deepEqual(await profileSnapshot(victim.org.id), victimBefore.profiles,
    "Foreign writes cannot mutate the populated victim profile state");
  assert.deepEqual(await auditSnapshot(victim.org.id), victimBefore.audit,
    "Foreign writes cannot create victim audit rows");
  assert.deepEqual(await payrollSnapshot(victim.org.id), victimBefore.payroll,
    "Payout profile API cannot affect victim payroll");

  // Disposable trigger deliberately rejects only this fictional audit action.
  // The profile update must roll back with its audit. No production DDL.
  const originalProfiles = await profileSnapshot(a.org.id);
  const originalAudits = await auditSnapshot(a.org.id);
  await pgClient.query(
    "CREATE FUNCTION public.ci_reject_payout_profile_audit() RETURNS trigger LANGUAGE plpgsql AS $$ " +
    "BEGIN IF NEW.action = 'Company payout profile updated' THEN " +
    "RAISE EXCEPTION 'CI_ONLY_INJECTED_AUDIT_FAILURE'; END IF; RETURN NEW; END $$");
  await pgClient.query(
    "CREATE TRIGGER ci_reject_payout_profile_audit BEFORE INSERT ON public.audit_events " +
    "FOR EACH ROW EXECUTE FUNCTION public.ci_reject_payout_profile_audit()");
  try {
    const fault = exact(await patch(a, body(a, "should roll back with audit")), 500,
      "Injected audit failure cannot leave a successful profile update");
    check(fault.json?.error === "Company payout profile could not be saved.",
      "Database exception is a fixed generic error, not a SQL or tenant leak");
    check(!fault.text.includes("CI_ONLY_INJECTED_AUDIT_FAILURE"),
      "Injected SQL error details must not appear in HTTP");
    assert.deepEqual(await profileSnapshot(a.org.id), originalProfiles,
      "Failed audit insert must roll back the payout profile update atomically");
    assert.deepEqual(await auditSnapshot(a.org.id), originalAudits,
      "Failed audit insert must not leave any partial event");
  } finally {
    await pgClient.query("DROP TRIGGER IF EXISTS ci_reject_payout_profile_audit ON public.audit_events");
    await pgClient.query("DROP FUNCTION IF EXISTS public.ci_reject_payout_profile_audit()");
  }

  console.log(JSON.stringify({
    kind: "payout-profile-patch-tenant-audit-atomic-PG16",
    method: "PATCH /api/payout-profiles",
    ownPersistedAndAudited: 2, twoAttackersForeignDenied: true,
    forgedLegalEntityDenied: true, injectedAuditFailureRolledBack: true,
    victimProfilesAuditPayrollUnchanged: true,
    methodCredits: 0, independentSecurityReview: "PENDING",
    assertions,
  }));
} finally {
  await pgClient.end().catch(() => {});
}
