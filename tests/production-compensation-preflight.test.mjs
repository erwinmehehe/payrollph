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
  assert.ok(workflow.indexOf("Verify all six RBAC personas") <
            workflow.indexOf("Verify private compensation database readiness"));
  assert.ok(workflow.indexOf("Verify private compensation database readiness") <
            workflow.indexOf("Verify deployed fictional HR compensation privacy"));
  assert.match(workflow, /secrets\.PRODUCTION_READINESS_TOKEN/);
  assert.match(workflow, /\/api\/readiness\/database-target/);
});
