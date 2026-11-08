import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { requireDisposableDbTarget, assertPrivateDenial,
  assertRuntimeEvidence, assertImmutableSnapshots } from "./tenant-runtime-db-target-contract.mjs";

// Enforce CI/localhost/PG16 intention before any DB import or request.
requireDisposableDbTarget(process.env);
const { pool } = await import("../../src/db/index.ts");
const { seedEmployer, standaloneMakeSession } = await import("./tenant-table-http.mjs");

const plain = value => JSON.parse(JSON.stringify(value));
const tables = Object.freeze({
  organization: ["organizations", "id"],
  employees: ["employees", "organization_id"],
  memberships: ["user_organizations", "organization_id"],
  payProfiles: ["employee_pay_profiles", "organization_id"],
  payrollRuns: ["payroll_runs", "organization_id"],
  audit: ["audit_events", "organization_id"],
  outbox: ["outbox", "organization_id"],
});
async function snapshot(organizationId) {
  const result = {};
  for (const [key, [table, column]] of Object.entries(tables)) {
    const { rows } = await pool.query(
      "SELECT * FROM " + table + " WHERE " + column + " = $1 ORDER BY id",
      [organizationId],
    );
    result[key] = plain(rows);
  }
  return result;
}

async function catalogCount(names) {
  const result = await pool.query(
    "SELECT count(*)::int AS total FROM pg_catalog.pg_class c " +
    "JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace " +
    "WHERE n.nspname='public' AND c.relkind IN ('r','p') " +
    "AND c.relname::text=ANY($1::text[])", [names],
  );
  return result.rows[0].total;
}

async function expectedDatabaseProof() {
  const result = await pool.query(
    "SELECT current_database()::text AS \"databaseName\", " +
    "current_setting('server_version_num')::int AS \"version\", " +
    "current_setting('neon.project_id',true)::text AS \"projectId\", " +
    "current_setting('neon.branch_id',true)::text AS \"branchId\", " +
    "current_setting('neon.endpoint_id',true)::text AS \"endpointId\", " +
    "current_user::text AS \"roleName\", " +
    "pg_is_in_recovery() AS \"inRecovery\"",
  );
  const { version, ...database } = result.rows[0];
  assert.equal(database.databaseName, "app_db", "new local PG database only");
  assert.equal(Math.floor(version / 10000), 16, "disposable PG16 required");
  assert.deepEqual([database.projectId, database.branchId, database.endpointId], [
    "ci-fictional-project", "br-fictional-branch", "ep-fictional-endpoint",
  ], "only fixed fictional PostgreSQL GUC metadata");
  assert.equal(database.roleName, "postgres");
  assert.equal(database.inRecovery, false);
  return {
    database,
    schemaPresence: {
      compensationTablesPresent: await catalogCount([
        "compensation_bands", "compensation_cycles", "compensation_proposals",
        "compensation_components", "employee_compensation_components",
        "compensation_events",
      ]),
      compensationTablesExpected: 6,
      migrationLedgerTablesPresent: await catalogCount([
        "payrollph_release_migration_receipts", "payrollph_migration_cutover",
        "payrollph_schema_migrations",
      ]),
      migrationLedgerTablesExpected: 3,
      evidenceScope: "CATALOG_TABLE_PRESENCE_ONLY_NOT_MIGRATION_APPROVAL",
    },
  };
}

async function request(token, cookie, query = "") {
  const headers = {};
  if (token !== undefined) headers["x-readiness-token"] = token;
  if (cookie !== undefined) headers.cookie = cookie;
  const response = await fetch(process.env.SECURITY_SMOKE_URL +
    "/api/readiness/database-target" + query, {
    method: "GET", headers, cache: "no-store", redirect: "manual",
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* the assertions reject wrong payloads */ }
  return { status: response.status, headers: response.headers, text, json };
}
let complete = false;
try {
  const expected = await expectedDatabaseProof();
  const empty = await pool.query("SELECT count(*)::int AS n FROM organizations");
  assert.equal(empty.rows[0].n, 0, "initial employer table must be empty");

  const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
  const a = await seedEmployer("ATTA", nonce, standaloneMakeSession);
  const b = await seedEmployer("ATTB", nonce, standaloneMakeSession);
  const victim = await seedEmployer("VICTIM", nonce, standaloneMakeSession);
  assert.ok(victim.org.id > a.org.id && victim.org.id > b.org.id,
    "real persisted higher-ID victim required");

  const employers = [a, b, victim];
  const before = await Promise.all(employers.map(e => snapshot(e.org.id)));
  assert.ok(before.every(x => x.employees.length > 0 && x.payProfiles.length > 0),
    "nonempty and distinct synthetic tenant records required");
  const forbidden = [
    ...employers.flatMap(e => [e.marker, e.owner.email, e.owner.name]),
    process.env.READINESS_TOKEN, process.env.DATABASE_URL,
    "postgres:postgres", "127.0.0.1",
  ];

  const anonymous = await request(undefined);
  assertPrivateDenial(anonymous, forbidden);
  const sessionWithoutToken = await request(undefined, a.cookie);
  assertPrivateDenial(sessionWithoutToken, forbidden);
  const invalid = await request("incorrect-" + "0".repeat(40), b.cookie);
  assertPrivateDenial(invalid, forbidden);
  const mismatched = await request("f".repeat(64), victim.cookie,
    "?organizationId=" + victim.org.id);
  assertPrivateDenial(mismatched, forbidden);
  assert.equal(anonymous.text, sessionWithoutToken.text,
    "signed-in tenant cookie must not replace operational authorization");
  assert.equal(anonymous.text, invalid.text,
    "bad token must not expose different information");

  const operationalToken = process.env.READINESS_TOKEN;
  const authorized = await request(operationalToken);
  assertRuntimeEvidence(authorized, expected, forbidden);
  const withActorCookie = await request(operationalToken, a.cookie);
  assertRuntimeEvidence(withActorCookie, expected, forbidden);
  const withVictimSelector = await request(operationalToken, b.cookie,
    "?organizationId=" + victim.org.id);
  assertRuntimeEvidence(withVictimSelector, expected, forbidden);
  // Operational diagnostic must never reveal tenant-selected results.
  const comparable = value => {
    const { generatedAt, ...rest } = value.json;
    return rest;
  };
  assert.deepEqual(comparable(authorized), comparable(withActorCookie));
  assert.deepEqual(comparable(authorized), comparable(withVictimSelector));

  const after = await Promise.all(employers.map(e => snapshot(e.org.id)));
  for (let i = 0; i < employers.length; i++) {
    assertImmutableSnapshots(before[i], after[i]);
  }

  const receipt = {
    kind: "tenant-runtime-db-target-fictional-pg16-v1",
    method: "GET /api/readiness/database-target",
    postgresMajor: 16,
    independentSyntheticEmployerSets: employers.length,
    higherIdVictimPresent: true,
    invalidTokenDenials: 4,
    authenticatedMetadataPositives: 3,
    crossTenantIdentityLeak: false,
    crossTenantMutation: false,
    fabricatedNeonSessionMetadata: true,
    verifiedActualNeon: false,
    realDataUsed: false,
    coverageCredits: 0,
    independentlyAccepted: false,
    productionTested: false,
  };
  mkdirSync("outputs", { recursive: true });
  writeFileSync("outputs/tenant-runtime-db-target.json",
    JSON.stringify(receipt, null, 2) + "\n");
  console.log(JSON.stringify(receipt));
  complete = true;
} finally {
  await pool.end();
}
assert.ok(complete, "end-to-end real HTTP and PG16 proof must complete");
