import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { verifyProductionCompensationPreflight } from "../scripts/qa/verify-production-compensation-preflight.mjs";

const expected = {
  sha: "a".repeat(40), projectId: "calm-wave-70219564",
  branchId: "br-lucky-sound-b79i56jw", endpointId: "ep-cool-hat-b7e7gpoo",
  databaseName: "neondb",
};
const successful = () => ({
  deploymentSha: expected.sha,
  deploymentEnvironment: "production",
  evidenceScope: "PRIVATE_RUNTIME_SESSION_IDENTITY_ONLY_NOT_MIGRATION_APPROVAL",
  database: {
    projectId: expected.projectId, branchId: expected.branchId,
    endpointId: expected.endpointId, databaseName: expected.databaseName,
    roleName: "app_role", inRecovery: false,
  },
  schemaPresence: {
    compensationTablesPresent: 6, compensationTablesExpected: 6,
    migrationLedgerTablesPresent: 3, migrationLedgerTablesExpected: 3,
    evidenceScope: "CATALOG_TABLE_PRESENCE_ONLY_NOT_MIGRATION_APPROVAL",
  },
});

test("#1061 private exact SHA and catalog-only target succeeds after approved migrations", () => {
  assert.equal(verifyProductionCompensationPreflight(successful(), expected), true);
});
test("#1061 incomplete 0/6 compensation tables fail before fictional HR fixture", () => {
  const p = successful();
  p.schemaPresence.compensationTablesPresent = 0;
  assert.throws(() => verifyProductionCompensationPreflight(p, expected),
    /MISSING_COMPENSATION_TABLES_USE_DBA_MIGRATION/);
});
test("#1015 missing migration receipts block even when compensation tables exist", () => {
  const p = successful();
  p.schemaPresence.migrationLedgerTablesPresent = 0;
  assert.throws(() => verifyProductionCompensationPreflight(p, expected),
    /MISSING_MIGRATION_LEDGER_STOP/);
});
test("#1015 fail-closed for wrong branch, replica, SHA, role, or forged counts", () => {
  for (const change of [
    (p) => { p.database.branchId = "br-wrong-branch"; },
    (p) => { p.database.inRecovery = true; },
    (p) => { p.deploymentSha = "b".repeat(40); },
    (p) => { p.database.roleName = "unsafe/role"; },
    (p) => { p.schemaPresence.compensationTablesPresent = "6"; },
    (p) => { p.schemaPresence.compensationTablesPresent = 7; },
    (p) => { p.schemaPresence.evidenceScope = "migration-approved"; },
  ]) {
    const p = successful();
    change(p);
    assert.throws(() => verifyProductionCompensationPreflight(p, expected));
  }
});
test("#1061 protected live smoke keeps the private preflight before HR fixture", () => {
  const workflow = readFileSync(".github/workflows/live-rbac-sandbox-smoke.yml", "utf8");
  assert.ok(workflow.includes("scripts/qa/verify-production-compensation-preflight.mjs"));
  const deployed = workflow.indexOf("Wait for exact production deployment");
  const preflight = workflow.indexOf("Verify private compensation database readiness");
  const boundary = workflow.indexOf("Read protected demo provisioning boundary");
  const guardedPost = workflow.indexOf("Verify guarded demo login 404");
  const liveRoles = workflow.indexOf("Verify all six RBAC personas");
  const privacy = workflow.indexOf("Verify deployed fictional HR compensation privacy");
  assert.ok(deployed >= 0 && deployed < preflight &&
            preflight < boundary && boundary < guardedPost &&
            guardedPost < liveRoles && liveRoles < privacy,
    "Read-only target/schema attestation must precede any production demo POST or HR write");
  const preflightStep = workflow.slice(preflight, boundary);
  assert.doesNotMatch(preflightStep, /^\s*if:\s*steps\.demo_boundary/m,
    "Production DB identity attestation cannot be skipped when public demo login is blocked");
  assert.match(workflow, /secrets\.PRODUCTION_READINESS_TOKEN/);
  assert.match(workflow, /\/api\/readiness\/database-target/);
});
