import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateSchemaManifest } from "../scripts/lib/issue-1031-schema-manifest";
import { planRecoveredSchema, type CatalogInventory } from "../scripts/qa/recovered-schema-plan";

const baseline = JSON.parse(readFileSync(
  "qa/recovery/recovered-neon-20261017.catalog.json", "utf8"
)) as CatalogInventory;
const source = generateSchemaManifest();

test("observed inventory is incomplete and MUST NOT certify release", () => {
  const report = planRecoveredSchema(baseline, source);
  assert.deepEqual(report.summary, {
    declared: 271, observed: 148, observedForeignKeys: 409,
    matchingSourceTableNames: 145, missingDeclaredTables: 126,
    extraLegacyTables: 3,
  });
  assert.equal(report.missingCompensationAutomationIntents, true);
  for (const name of ["email_change_tokens", "payout_batches", "attendance_exception_events"]) {
    assert.ok(report.missingDeclaredTables.includes(name));
  }
  assert.deepEqual(report.extraLegacyTables,
    ["ess_employee_photos", "ess_identifier_requests", "ess_other_identifiers"]);
  assert.equal(report.recoveryTestedAgainstActualNeonDump, false);
  assert.equal(report.productionReleaseApproved, false);
  assert.equal(report.repairSqlApproved, false);
  assert.match(report.disposition, /^BLOCKED_/);
});

test("prerequisites never reference an as-yet-unplanned missing parent", () => {
  const report = planRecoveredSchema(baseline, source);
  const accountedFor = [
    ...report.prerequisitePhases.flatMap(phase => phase.tables),
    ...report.cyclicalOrUnresolvedTables,
  ].sort();
  assert.deepEqual(accountedFor, report.missingDeclaredTables);
  const observed = new Set(baseline.tables);
  const planned = new Set<string>();
  const tables = new Map(source.tables.map(table => [table.name, table]));
  for (const phase of report.prerequisitePhases) {
    for (const name of phase.tables) {
      for (const fk of tables.get(name)!.foreignKeys) {
        if (fk.refTable !== name && !observed.has(fk.refTable)) {
          assert.ok(planned.has(fk.refTable), "Missing dependency " + name + " -> " + fk.refTable);
        }
      }
    }
    for (const name of phase.tables) planned.add(name);
  }
});

test("fail closed on duplicate, incomplete or overclaimed catalog", () => {
  assert.throws(() => planRecoveredSchema({
    ...baseline, publicTableCount: baseline.publicTableCount + 1,
  }, source), /INCOMPLETE_OR_STALE/);
  assert.throws(() => planRecoveredSchema({
    ...baseline, tables: [baseline.tables[0]!, ...baseline.tables.slice(1, -1), baseline.tables[0]!],
  }, source), /DUPLICATED/);
  assert.throws(() => planRecoveredSchema({
    ...baseline, fullSchemaEquivalenceVerified: true,
  } as CatalogInventory, source), /OVERCLAIMED/);
});
