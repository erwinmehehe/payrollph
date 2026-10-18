import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import { generateShapeAudit, HEADERS, normalizeDefault, reconstructPinnedSchemaText, HISTORICAL_SCHEMA_SHA256 } from "../scripts/issue-1031-source-shape-audit.mjs";

// This is a source-only snapshot comparison. A later main index change
// must not rewrite the Oct 17/18 evidence or invent migration receipts.
function assertHistoricalShapeMatchesPinnedEvidence(report, snapshotPath) {
  const frozen = readFileSync(new URL(snapshotPath, import.meta.url), "utf8");
  assert.ok(report.rows.length > 0);
  assert.ok(report.rows.every(row => row.source_schema_sha256 === HISTORICAL_SCHEMA_SHA256));
  assert.equal(report.csv, frozen, "historical CSV must be byte-for-byte immutable");
}

test("only two reviewed marketing index edits can be projected to pinned schema bytes", () => {
  const current = readFileSync(new URL("../src/db/schema.ts", import.meta.url), "utf8");
  const historical = reconstructPinnedSchemaText(current);
  assert.equal(createHash("sha256").update(historical.text).digest("hex"), HISTORICAL_SCHEMA_SHA256);
  assert.equal(historical.projected, true);
  assert.equal(reconstructPinnedSchemaText(historical.text).projected, false);
  assert.throws(() => reconstructPinnedSchemaText(current + "\\n// unexpected source drift"),
    /HISTORICAL_1031_UNREVIEWED_SCHEMA_DIFFERENCE/);
  assert.throws(() => reconstructPinnedSchemaText(current.replace(
    "table.createdAt.desc().nullsFirst()", "table.createdAt.desc().nullsLast()")),
    /HISTORICAL_1031_UNREVIEWED_SCHEMA_DIFFERENCE/);
});

test("source-only 100-row evidence is reproducible and receipts stay completely blank", () => {
  const report = generateShapeAudit();
  assert.equal(report.sourceOnly, true);
  assert.equal(report.productionQueried, false);
  assert.equal(report.releaseApproved, false);
  assert.equal(report.historical113Attested, false);
  assert.equal(report.tag, "CATALOG_ONLY_NOT_MIGRATION_RECEIPT_OR_RELEASE_APPROVAL");
  assert.equal(report.rows.length, 100);
  assert.equal(new Set(report.rows.map(r => r.table_name)).size, 100);
  assert.ok(report.rows.every(r => /^src\/db\/schema\.ts:\d+$/.test(r.schema_ts_line_references)));
  assert.ok(report.rows.every(r =>
    ["MATCH","DRIFT","UNPARSEABLE","MIGRATION_ORDER_RISK"].includes(r.classification)));
  assert.ok(report.rows.every(r => [
    "receipt_found","receipt_source","applied_at","applied_by",
    "checksum_matches_receipt","disposition",
  ].every(k => r[k] === "")));
  assert.equal(report.csv.split("\n").length, 102);
  // A later forward-only repair MUST NOT rewrite the pinned 0132-era
  // evidence simply because the live source worksheet grows to 0134.
  assertHistoricalShapeMatchesPinnedEvidence(
    report, "../docs/engineering/issue-1031-20261017-named-shape-analysis-partial.csv",
  );
  assert.deepEqual(HEADERS.slice(-6), [
    "receipt_found","receipt_source","applied_at","applied_by",
    "checksum_matches_receipt","disposition",
  ]);
  const target=report.rows.find(r=>r.table_name==="automation_event_log");
  assert.ok(target, "dated named cohort retains the known index direction issue");
  assert.notEqual(target.classification,"MATCH",
    "SQL DESC and Drizzle ASC may never be silently certified MATCH");
  console.log("ISSUE1031_OFFLINE_CLASS_COUNTS "+JSON.stringify(report.counts));
  console.log("ISSUE1031_AUTOMATION_DRIFT "+JSON.stringify({
    classification:target.classification,differences:target.differences,reason:target.unparseable_or_incomplete_reason,
  }));
  const examples=report.rows.filter(r=>r.classification==="MATCH").slice(0,12).map(r=>r.table_name);
  console.log("ISSUE1031_MATCH_CANDIDATES "+JSON.stringify(examples));
});

test("new 0134 recovery candidates never pollute the pinned historical 0132 analysis", () => {
  const report = generateShapeAudit("dated_named");
  for (const name of [
    "workforce_demand_import_batches", "workforce_demand_observation_revisions",
    "workforce_demand_forecast_issues", "workforce_demand_forecast_scores",
    "workforce_demand_staffing_policies", "workforce_demand_staffing_policy_events",
  ]) {
    const row = report.rows.find(x => x.table_name === name);
    assert.ok(row, "the dated October 17 absence set must still contain " + name);
    assert.doesNotMatch(row.migration_file_paths, /drizzle\/013[34]_/,
      "historical creator metadata cannot inherit later forward-repair SQL");
  }
  const all = generateShapeAudit("all_numbered");
  assertHistoricalShapeMatchesPinnedEvidence(
    all, "../docs/engineering/issue-1031-all-numbered-creator-shape-analysis.csv",
  );
});

test("ten manually reviewed static creators retain exact requested functional shape", () => {
  const rows = new Map(generateShapeAudit().rows.map(x => [x.table_name,x]));
  const checked = [
    "treasury_control_policies",
    "treasury_operator_assignments",
    "hcm_skills",
    "compensation_automation_intents",
    "integration_connectors",
    "external_identities",
    "identity_domains",
    "worksite_geofence_boundaries",
    "payroll_underpayment_requests",
    "performance_cycle_templates",
  ];
  for(const name of checked){
    const row = rows.get(name);
    assert.equal(row?.classification,"MATCH",
      name + ": raw creating SQL and full pgTable shape require renewed hand review on drift");
    assert.equal(row?.differences,"");
    assert.equal(row?.unparseable_or_incomplete_reason,"");
  }
});
test("composite employee tenant-FKs remain flagged as real drift (never relaxed)", () => {
  const rows = new Map(generateShapeAudit().rows.map(x => [x.table_name,x]));
  for(const name of ["workforce_punch_photo_consents","workforce_punch_photo_evidence","workforce_punch_submissions"]){
    const row=rows.get(name);
    assert.equal(row?.classification,"DRIFT",name);
    assert.match(row?.differences??"",/FK ref table\/columns\/update\/delete actions differ/);
  }
});
test("numeric typed defaults compare value rather than quoted SQL spelling", () => {
  const row=generateShapeAudit().rows.find(x=>x.table_name==="performance_calibration_policies");
  assert.equal(row?.classification,"MATCH",
    "same numeric default in unquoted SQL and Drizzle string declaration");
});

test("empty JSONB defaults normalize only equivalent exact values", () => {
  assert.equal(normalizeDefault("'{}'","jsonb","x"),normalizeDefault("'{}'::jsonb","jsonb","x"));
  assert.equal(normalizeDefault("'[]'","jsonb","x"),normalizeDefault("'[]'::jsonb","jsonb","x"));
  assert.notEqual(normalizeDefault("'[]'::jsonb","jsonb","x"),normalizeDefault("'{}'","jsonb","x"));
  assert.notEqual(normalizeDefault("'{}'::jsonb","text","x"),normalizeDefault("'{}'","text","x"));
  assert.notEqual(normalizeDefault("'{}'::json","jsonb","x"),normalizeDefault("'{}'","jsonb","x"));
  const row = generateShapeAudit("all_numbered").rows.find(
    r => r.table_name === "first_payroll_journey_progress");
  assert.ok(row, "numbered creator superset must include the first payroll journey table");
  assert.doesNotMatch(row.differences,/column data default/,
    "untyped SQL '{}' and Drizzle '{}'::jsonb do not prove a value mismatch");
});

test("all-numbered source-only cohort includes dated 100 without inventing 113 names", () => {
  const all = generateShapeAudit("all_numbered");
  const dated = generateShapeAudit("dated_named");
  assert.ok(all.rows.length >= 187 && all.rows.length <= 271);
  const allNames = new Set(all.rows.map(row => row.table_name));
  assert.equal(allNames.size, all.rows.length);
  for(const row of dated.rows)assert.ok(allNames.has(row.table_name),row.table_name);
  assert.equal(all.historical113Attested,false);
  assert.equal(all.productionQueried,false);
  assert.equal(all.releaseApproved,false);
  assert.ok(all.rows.every(row => row.evidence_scope ===
    "CATALOG_ONLY_NOT_MIGRATION_RECEIPT_OR_RELEASE_APPROVAL"));
  assert.ok(all.rows.every(row => [
    "receipt_found","receipt_source","applied_at","applied_by",
    "checksum_matches_receipt","disposition",
  ].every(field => row[field] === "")));
});
