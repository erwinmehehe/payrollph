#!/usr/bin/env node
/**
 * Guard against a false Atlas no-op caused by inspecting zero/incomplete
 * tables under the restricted catalog-only role. Exact fixtures are synthetic.
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { generateSchemaManifest } from "./lib/issue-1031-schema-manifest.ts";

assert.equal(process.env.CI, "true");
assert.equal(process.env.GITHUB_ACTIONS, "true");
assert.equal(process.env.INDEPENDENT_SCHEMA_AUDIT_MODE, "isolated-local-pg16");
assert.equal(process.env.DATABASE_URL,
  "postgresql://postgres:postgres@127.0.0.1:5432/app_db");
assert.equal(process.env.PRODUCTION_DATABASE_URL, undefined);
assert.equal(process.env.DATABASE_URL_UNPOOLED, undefined);

const manifest = generateSchemaManifest();
const expected = new Set(manifest.tables.map(t => t.name));
assert.ok(expected.size >= 270, "Truncated Drizzle source manifest");
const directory = "qa-artifacts/independent-pg16/";

function readInspectedSchema(filename, label) {
  const raw = readFileSync(directory + filename, "utf8");
  if (!raw.trim()) throw new Error("Atlas returned no inspect JSON: " + label);
  const parsed = JSON.parse(raw);
  assert.ok(Array.isArray(parsed.schemas), "Invalid Atlas inspect schemas");
  const schema = parsed.schemas.find(s => s.name === "public");
  assert.ok(schema && Array.isArray(schema.tables), "Atlas did not inspect public tables");
  const actual = schema.tables.map(t => t.name);
  assert.ok(actual.every(x => typeof x === "string" && x.length > 0),
    "Atlas returned invalid table names");
  assert.equal(new Set(actual).size, actual.length, "Atlas returned duplicate tables");
  const missing = [...expected].filter(name => !actual.includes(name));
  assert.deepEqual(missing, [], label + " did not inspect all source models");
  return { database: label, atlasVisibleTables: actual.length, sourceModels: expected.size,
    everyModelVisible: true, readOnlyInspectionRole: "atlas_inspector" };
}

const results = {
  evidence: "SYNTHETIC_ONLY_NOT_PRODUCTION_PARITY",
  prHeadSha: process.env.PR_HEAD_SHA || null,
  workflowCommitSha: process.env.GITHUB_SHA || null,
  source: readInspectedSchema("atlas-source-inspect.json", "app_db"),
  candidate: readInspectedSchema("atlas-candidate-inspect.json", "atlas_candidate_db"),
  migrationReceiptCreated: false,
  approvedForDeployment: false,
};
writeFileSync(directory + "atlas-inspection-coverage.json", JSON.stringify(results, null, 2) + "\n");
console.log(JSON.stringify({ source: results.source, candidate: results.candidate }));
