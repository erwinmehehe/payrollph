import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { generateSchemaManifest } from "../scripts/lib/issue-1031-schema-manifest";
import {
  planRecoveredSchema, RECOVERY_SOURCE_NAMES, ORIGINAL_RECOVERY_SOURCE_SHA,
  type CatalogInventory,
} from "../scripts/qa/recovered-schema-plan";

const baseline = JSON.parse(readFileSync(
  "qa/recovery/recovered-neon-20261017.catalog.json", "utf8"
)) as CatalogInventory;
const capture = JSON.parse(readFileSync(RECOVERY_SOURCE_NAMES, "utf8")) as {
  sourceSchemaGitBlobSha: string; declaredTableCount: number; tables: string[];
};
const source = generateSchemaManifest();
const currentBytes = readFileSync("src/db/schema.ts");
const currentSourceBlob = createHash("sha1")
  .update("blob " + currentBytes.byteLength + "\0")
  .update(currentBytes).digest("hex");
// Reviewed source tables added after the capture, each created by a numbered migration.
const ADDED_SINCE_CAPTURE = [
  "payroll_calculation_history", // drizzle/0137_immutable_payroll_calculation_history.sql (F-04, proposed)
  "salary_correction_case_runs", // drizzle/0135_salary_correction_cases.sql (#641)
  "salary_correction_cases", // drizzle/0135_salary_correction_cases.sql (#641)
];
const compareCurrent = (catalog: CatalogInventory = baseline,
  manifest = source) => planRecoveredSchema(catalog, manifest, "current-source-advisory");

test("the historical October capture is pinned, independent of current source", () => {
  assert.equal(baseline.sourceSchemaGitBlobSha, ORIGINAL_RECOVERY_SOURCE_SHA);
  assert.equal(capture.sourceSchemaGitBlobSha, ORIGINAL_RECOVERY_SOURCE_SHA);
  assert.equal(capture.declaredTableCount, 271);
  assert.equal(capture.tables.length, 271);
  const report = compareCurrent();
  assert.deepEqual(report.historicalCaptureSummary, {
    declared: 271, observed: 148, observedForeignKeys: 409,
    matchingSourceTableNames: 145, missingDeclaredTables: 126,
    extraLegacyTables: 3,
  });
  assert.equal(report.missingAtCaptureFromSource.length, 126);
  assert.deepEqual(report.extraAtCaptureAgainstSource,
    ["ess_employee_photos", "ess_identifier_requests", "ess_other_identifiers"]);
  assert.equal(report.sourceComparison.capturedSourceGitBlobSha, ORIGINAL_RECOVERY_SOURCE_SHA);
  assert.equal(report.sourceComparison.evaluatedCurrentSourceGitBlobSha, currentSourceBlob);
  assert.equal(report.sourceComparison.sourceChangedSinceCapture,
    currentSourceBlob !== ORIGINAL_RECOVERY_SOURCE_SHA);
  assert.equal(report.sourceComparison.mode, "current-source-advisory");
  assert.equal(report.sourceComparison.comparisonIsAdvisory, true);
  assert.equal(report.sourceComparison.historicalSourceTableNamesPinned, true);
  assert.equal(report.sourceComparison.historicalFullSchemaReplayed, false);
  assert.equal(report.sourceComparison.catalogRequeriedFromNeon, false);
  assert.equal(report.sourceComparison.independentReviewRequired, true);
  assert.equal(report.productionReleaseApproved, false);
  assert.equal(report.repairSqlApproved, false);
  assert.match(report.disposition, /^BLOCKED_/);
});

test("the advisory comparison counts current missing tables without mutating historical gaps", () => {
  const report = compareCurrent();
  const observed = new Set(baseline.tables);
  assert.equal(report.summary.declared, source.tables.length);
  assert.equal(report.summary.observed, observed.size);
  assert.equal(report.summary.missingDeclaredTables,
    source.tables.filter(t => !observed.has(t.name)).length);
  assert.equal(report.summary.extraLegacyTables,
    baseline.tables.filter(name => !source.tables.some(t => t.name === name)).length);
  for (const name of [
    "compensation_automation_intents", "email_change_tokens",
    "payout_batches", "attendance_exception_events",
  ]) assert.ok(report.missingDeclaredTables.includes(name));
  assert.equal(report.historicalCreatorCoverage.evidenceScope,
    "HISTORICAL_SQL_CREATE_TABLE_MENTION_NOT_APPLIED_RECEIPT");
  assert.equal(
    report.historicalCreatorCoverage.missingWithoutHistoricalCreator.length +
      report.historicalCreatorCoverage.missingWithHistoricalCreator.length,
    report.summary.missingDeclaredTables,
  );
  assert.ok(report.historicalCreatorCoverage.historicalFileCandidatesByTable[
    "compensation_automation_intents"]?.includes(
      "drizzle/0100_compensation_automation_intents.sql"));
  assert.equal(report.historicalCreatorCoverage.appliedMigrationsVerified, false);
  assert.deepEqual(report.sourceComparison.addedSourceTablesSinceCapture, ADDED_SINCE_CAPTURE);
  assert.deepEqual(report.sourceComparison.removedSourceTablesSinceCapture, []);
  const numberedCreators: Record<string, string> = {
    payroll_calculation_history: "drizzle/0137_immutable_payroll_calculation_history.sql",
    salary_correction_case_runs: "drizzle/0135_salary_correction_cases.sql",
    salary_correction_cases: "drizzle/0135_salary_correction_cases.sql",
  };
  for (const name of ADDED_SINCE_CAPTURE) {
    assert.ok(report.historicalCreatorCoverage.historicalFileCandidatesByTable[name]?.includes(
      numberedCreators[name]), name + ": added table needs exact numbered creator source, never an apply receipt");
  }
  assert.equal(report.historicalCreatorCoverage.appliedMigrationsVerified, false,
    "A SQL creator source is not evidence that a historical/production migration ran");
});

test("all missing source tables are ordered or explicitly unresolved", () => {
  const report = compareCurrent();
  assert.deepEqual([
    ...report.prerequisitePhases.flatMap(p => p.tables),
    ...report.cyclicalOrUnresolvedTables,
  ].sort(), report.missingDeclaredTables);
  const observed = new Set(baseline.tables);
  const planned = new Set<string>();
  const tables = new Map(source.tables.map(t => [t.name, t]));
  for (const phase of report.prerequisitePhases) {
    for (const name of phase.tables) {
      for (const fk of tables.get(name)!.foreignKeys) {
        if (fk.refTable !== name && !observed.has(fk.refTable)) {
          assert.ok(planned.has(fk.refTable),
            "Out of order FK: " + name + " -> " + fk.refTable);
        }
      }
    }
    for (const name of phase.tables) planned.add(name);
  }
});

test("strict mode rejects schema drift, advisory mode never masquerades as strict", () => {
  if (currentSourceBlob !== ORIGINAL_RECOVERY_SOURCE_SHA) {
    assert.throws(() => planRecoveredSchema(baseline, source),
      /SOURCE_SCHEMA_BLOB_DRIFT_REQUIRES_EXPLICIT_CURRENT_SOURCE_MODE/);
  } else {
    const strict = planRecoveredSchema(baseline, source);
    assert.equal(strict.sourceComparison.mode, "captured-source-strict");
    assert.equal(strict.sourceComparison.sourceChangedSinceCapture, false);
  }
});

test("advisory mode still fails closed on altered provenance, missing or deceptive evidence", () => {
  assert.throws(() => compareCurrent({
    ...baseline, sourceSchemaGitBlobSha: "0".repeat(40),
  }), /CAPTURE_SOURCE_BLOB_PROVENANCE_MISMATCH/);
  assert.throws(() => compareCurrent({
    ...baseline, publicTableCount: baseline.publicTableCount + 1,
  }), /INCOMPLETE_OR_STALE/);
  assert.throws(() => compareCurrent({
    ...baseline, tables: [baseline.tables[0]!, ...baseline.tables.slice(1, -1), baseline.tables[0]!],
  }), /DUPLICATED/);
  assert.throws(() => compareCurrent({
    ...baseline, fullSchemaEquivalenceVerified: true,
  } as unknown as CatalogInventory), /OVERCLAIMED/);
});

test("future source tables cannot rewrite historical source gap results", () => {
  const fake = { ...source.tables[0]!, name: "zz_future_source_relation", foreignKeys: [] };
  const report = compareCurrent(baseline, {
    ...source, tables: [...source.tables, fake],
  });
  assert.equal(report.historicalCaptureSummary.missingDeclaredTables, 126);
  assert.equal(report.summary.missingDeclaredTables,
    source.tables.filter(t => !baseline.tables.includes(t.name)).length + 1);
  assert.deepEqual(report.sourceComparison.addedSourceTablesSinceCapture,
    [...ADDED_SINCE_CAPTURE, "zz_future_source_relation"]);
  assert.ok(report.missingDeclaredTables.includes("zz_future_source_relation"));
  assert.equal(report.productionReleaseApproved, false);
});
