import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { verifiedPublicDemoDatabaseIdentity } from "../src/lib/public-demo-database-identity";

const env = {
  PUBLIC_DEMO_DATABASE_ATTESTED: "true",
  PUBLIC_DEMO_NEON_PROJECT_ID: "project-isolated-qa",
  PUBLIC_DEMO_NEON_BRANCH_ID: "branch-isolated-qa",
  PUBLIC_DEMO_NEON_ENDPOINT_ID: "endpoint-isolated-qa",
  PUBLIC_DEMO_DATABASE_NAME: "fictional_demo",
  PUBLIC_DEMO_DATABASE_ROLE: "fictional_demo_owner",
};
const identity = {
  projectId: env.PUBLIC_DEMO_NEON_PROJECT_ID,
  branchId: env.PUBLIC_DEMO_NEON_BRANCH_ID,
  endpointId: env.PUBLIC_DEMO_NEON_ENDPOINT_ID,
  databaseName: env.PUBLIC_DEMO_DATABASE_NAME,
  roleName: env.PUBLIC_DEMO_DATABASE_ROLE,
  inRecovery: false,
};

test("production demo requires explicit operator attestation of actual PostgreSQL runtime identity", () => {
  assert.equal(verifiedPublicDemoDatabaseIdentity(identity, env), true);
  assert.equal(verifiedPublicDemoDatabaseIdentity(identity, {}), false);
  assert.equal(verifiedPublicDemoDatabaseIdentity(identity, { ...env, PUBLIC_DEMO_DATABASE_ATTESTED: "false" }), false);
  assert.equal(verifiedPublicDemoDatabaseIdentity(null, env), false);
  for (const field of ["projectId", "branchId", "endpointId", "databaseName", "roleName"] as const) {
    assert.equal(verifiedPublicDemoDatabaseIdentity({ ...identity, [field]: "customer-production" }, env), false,
      "Even exact-name-matching customer employers must fail against an unapproved DB connection");
  }
  for (const key of ["PUBLIC_DEMO_NEON_PROJECT_ID", "PUBLIC_DEMO_NEON_BRANCH_ID",
    "PUBLIC_DEMO_NEON_ENDPOINT_ID", "PUBLIC_DEMO_DATABASE_NAME", "PUBLIC_DEMO_DATABASE_ROLE"] as const) {
    assert.equal(verifiedPublicDemoDatabaseIdentity(identity, { ...env, [key]: undefined }), false);
  }
  assert.equal(verifiedPublicDemoDatabaseIdentity({ ...identity, inRecovery: true }, env), false);
  assert.equal(verifiedPublicDemoDatabaseIdentity({ ...identity, branchId: null }, env), false);
});

test("source guard AND transaction recheck the same session branch/role identity before any demo mutation", () => {
  const guard = readFileSync("src/lib/demo-provisioning-boundary.ts", "utf8");
  const seed = readFileSync("src/db/public-demo.ts", "utf8");
  const identityQuery = readFileSync("src/lib/public-demo-database-identity.ts", "utf8");
  assert.match(identityQuery, /current_setting\('neon\.branch_id', true\)/);
  assert.match(identityQuery, /pg_is_in_recovery\(\)/);
  assert.match(guard, /verifiedPublicDemoDatabaseIdentity\(session\.rows\[0\]\)/);
  assert.match(guard, /candidates\.length > 1/);
  assert.match(seed, /LOCK TABLE organizations IN SHARE ROW EXCLUSIVE MODE/);
  assert.match(seed, /verifiedPublicDemoDatabaseIdentity\(session\.rows\[0\]\)/);
  assert.match(seed, /nameCandidates\.length > 1/);
  const seedMethod = seed.slice(seed.indexOf("export async function ensurePublicDemoTenant()"));
  const firstWrite = seedMethod.indexOf(".insert(organizations)");
  const identityGate = seedMethod.indexOf("verifiedPublicDemoDatabaseIdentity");
  const labelGate = seedMethod.indexOf("nameCandidates.length > 1");
  assert.ok(firstWrite >= 0 && identityGate >= 0 && identityGate < firstWrite,
    "A missing or mismatched production DB identity must prevent fixture inserts");
  assert.ok(labelGate >= 0 && labelGate < firstWrite,
    "Duplicate reserved labels must be denied before any fictional employer writes");
  assert.match(seedMethod.slice(0, firstWrite), /requireProductionDemoFixtureInTransaction\\(tx\\)/,
    "The fixture organization ID must also be attested inside the write transaction");
});
