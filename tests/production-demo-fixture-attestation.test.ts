import assert from "node:assert/strict";
import test from "node:test";
import { isAttestedProductionDemoFixture, attestedProductionDemoOrganizationId } from "../src/lib/demo-provisioning-boundary";
import type { RuntimeDatabaseIdentity } from "../src/lib/runtime-database-identity";

const hostname = "ep-fixture-only-qa.eu-central-1.aws.neon.tech";
const env: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  PUBLIC_DEMO_DATABASE_ATTESTED: "true",
  PUBLIC_DEMO_NEON_PROJECT_ID: "fixture-only-project-qa",
  PUBLIC_DEMO_NEON_BRANCH_ID: "br-fixture-qa-001",
  PUBLIC_DEMO_NEON_ENDPOINT_ID: "ep-fixture-only-qa",
  PUBLIC_DEMO_DATABASE_NAME: "fictional_demo",
  PUBLIC_DEMO_DATABASE_ROLE: "fixture_role",
  PUBLIC_DEMO_DATABASE_HOST: hostname,
  PUBLIC_DEMO_ORGANIZATION_ID: "7",
  DATABASE_URL: "postgresql://fixture_role:nonsecret-placeholder@" + hostname + "/fictional_demo",
};
const target: RuntimeDatabaseIdentity = {
  projectId: "fixture-only-project-qa",
  branchId: "br-fixture-qa-001",
  endpointId: "ep-fixture-only-qa",
  databaseName: "fictional_demo",
  roleName: "fixture_role",
  inRecovery: false,
};
const fixture = { id: 7, name: "Loom & Local", legalName: "Loom & Local Philippines Inc." };

test("only a specifically registered organization on a dedicated Neon project is demo-only", () => {
  assert.equal(attestedProductionDemoOrganizationId(env), 7);
  assert.equal(isAttestedProductionDemoFixture(target, [fixture], env), true);
  assert.equal(isAttestedProductionDemoFixture(target, [], env), false,
    "Public logins must not create a production demo organization before DBA attestation");
  assert.equal(isAttestedProductionDemoFixture(target, [fixture, fixture], env), false);
});

test("single and duplicate customers with the identical editable employer names are rejected", () => {
  const customer = { ...fixture, id: 123 };
  assert.equal(isAttestedProductionDemoFixture(target, [customer], env), false);
  assert.equal(isAttestedProductionDemoFixture(target, [customer, fixture], env), false);
  assert.equal(isAttestedProductionDemoFixture(target, [fixture, customer], env), false);
  assert.equal(isAttestedProductionDemoFixture(target, [{ ...fixture, legalName: "Customer Legal Inc." }], env), false);
});

test("customer production project, unpinned target, spoofed hostname, and missing or fake DB evidence deny", () => {
  assert.equal(isAttestedProductionDemoFixture(
    { ...target, projectId: "calm-wave-70219564" }, [fixture], env), false);
  assert.equal(isAttestedProductionDemoFixture(target, [fixture], {
    ...env, PUBLIC_DEMO_NEON_PROJECT_ID: "calm-wave-70219564",
  }), false, "A customer production project must never be approved for demo seeding");
  assert.equal(isAttestedProductionDemoFixture(target, [fixture], {
    ...env, PUBLIC_DEMO_NEON_BRANCH_ID: "br-lucky-sound-b79i56jw",
  }), false);
  assert.equal(isAttestedProductionDemoFixture(target, [fixture], {
    ...env, DATABASE_URL: "postgresql://fixture_role:placeholder@customer.example.com/fictional_demo",
  }), false);
  assert.equal(isAttestedProductionDemoFixture(target, [fixture], {
    ...env, PUBLIC_DEMO_DATABASE_ATTESTED: "false",
  }), false);
  assert.equal(isAttestedProductionDemoFixture({ ...target, inRecovery: true }, [fixture], env), false);
  assert.equal(isAttestedProductionDemoFixture(target, [fixture], {
    ...env, PUBLIC_DEMO_ORGANIZATION_ID: undefined,
  }), false);
});
