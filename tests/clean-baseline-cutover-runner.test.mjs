import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { load } from "js-yaml";
import { cutoverEnvironment } from "../scripts/run-clean-baseline-cutover.mjs";
import { FORBIDDEN_TARGET_BRANCHES, prepareSchemaDump } from "../scripts/lib/clean-baseline-cutover.mjs";

const SHA = "a".repeat(40);
const production = {
  CUTOVER_TARGET_DATABASE_URL: "postgresql://owner:x@ep-new-target-123456.neon.tech/neondb",
  GITHUB_ACTIONS: "true", GITHUB_REF: "refs/heads/main", GITHUB_SHA: SHA, REVIEWED_SHA: SHA,
  EXPECTED_NEON_PROJECT_ID: "calm-wave-70219564", EXPECTED_NEON_BRANCH_ID: "br-new-clean-baseline",
  EXPECTED_NEON_ENDPOINT_ID: "ep-new-target-123456", EXPECTED_DATABASE_NAME: "neondb",
};

test("production runs require the protected exact reviewed SHA on main and a pinned Neon identity", () => {
  assert.equal(cutoverEnvironment(production, "dry-run").branchId, "br-new-clean-baseline");
  assert.throws(() => cutoverEnvironment({ ...production, REVIEWED_SHA: "b".repeat(40) }, "dry-run"), /PROTECTED_EXACT_SHA_REQUIRED/);
  assert.throws(() => cutoverEnvironment({ ...production, GITHUB_REF: "refs/heads/feature" }, "dry-run"), /PROTECTED_EXACT_SHA_REQUIRED/);
  assert.throws(() => cutoverEnvironment({ ...production, EXPECTED_NEON_ENDPOINT_ID: "" }, "dry-run"), /NEON_PIN_REQUIRED/);
  assert.throws(() => cutoverEnvironment({ ...production, EXPECTED_DATABASE_NAME: "x;drop" }, "dry-run"), /DATABASE_NAME_REQUIRED/);
});

test("the original production and QA branches can never be the target", () => {
  for (const branch of FORBIDDEN_TARGET_BRANCHES) {
    assert.throws(() => cutoverEnvironment({ ...production, EXPECTED_NEON_BRANCH_ID: branch }, "dry-run"), /FORBIDDEN_TARGET_BRANCH/);
  }
  assert.ok(FORBIDDEN_TARGET_BRANCHES.includes("br-lucky-sound-b79i56jw"));
});

test("apply needs the explicit confirmation and an approval reference; dry-run does not", () => {
  assert.throws(() => cutoverEnvironment(production, "apply"), /APPLY_CONFIRMATION_REQUIRED/);
  assert.throws(() => cutoverEnvironment({ ...production, CUTOVER_APPLY_CONFIRMATION: "yes", CUTOVER_APPROVAL_REF: "owner-approval-2026-10-18" }, "apply"), /APPLY_CONFIRMATION_REQUIRED/);
  const ok = cutoverEnvironment({ ...production, CUTOVER_APPLY_CONFIRMATION: "APPLY_CLEAN_BASELINE_CUTOVER", CUTOVER_APPROVAL_REF: "owner-approval-2026-10-18" }, "apply");
  assert.equal(ok.approvalRef, "owner-approval-2026-10-18");
});

test("the isolated test mode is only available to local CI", () => {
  const local = { CUTOVER_TARGET_DATABASE_URL: "postgresql://o:x@127.0.0.1:5432/neondb", CUTOVER_ISOLATED_TEST: "true",
    CI: "true", GITHUB_ACTIONS: "true", EXPECTED_DATABASE_NAME: "neondb" };
  assert.equal(cutoverEnvironment(local, "apply").isolated, true);
  assert.throws(() => cutoverEnvironment({ ...local, CUTOVER_TARGET_DATABASE_URL: production.CUTOVER_TARGET_DATABASE_URL }, "apply"), /ISOLATED_TEST_REQUIRES_LOCAL_CI/);
  assert.throws(() => cutoverEnvironment({ ...local, CI: "false" }, "apply"), /ISOLATED_TEST_REQUIRES_LOCAL_CI/);
});

test("schema dump preparation removes only statements a non-superuser owner cannot run", () => {
  const dump = [
    "\\restrict abc123", "SET statement_timeout = 0;", "CREATE SCHEMA public;",
    "COMMENT ON SCHEMA public IS 'standard public schema';",
    "CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;",
    "COMMENT ON EXTENSION btree_gist IS 'support for indexing common datatypes in GiST';",
    "CREATE TABLE public.t (id integer);", "\\unrestrict abc123",
  ].join("\n");
  const out = prepareSchemaDump(dump);
  assert.doesNotMatch(out, /\\restrict|\\unrestrict|COMMENT ON|CREATE SCHEMA public/);
  assert.match(out, /CREATE EXTENSION IF NOT EXISTS btree_gist/);
  assert.match(out, /CREATE TABLE public\.t/);
});

test("the protected workflow wires the runner, the verifier and the no-write probe to the production environment", () => {
  const workflow = readFileSync(".github/workflows/clean-baseline-cutover.yml", "utf8");
  assert.match(workflow, /^ {4}environment: production$/m);
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^ {2}(push|pull_request):/m, "never runs automatically");
  assert.match(workflow, /secrets\.PRODUCTION_CUTOVER_OWNER_DATABASE_URL/);
  assert.match(workflow, /secrets\.PRODUCTION_MIGRATION_AUDIT_DATABASE_URL/);
  assert.match(workflow, /secrets\.PRODUCTION_CUTOVER_APP_DATABASE_URL/);
  assert.match(workflow, /br-lucky-sound-b79i56jw\|br-green-hat-b77qj8fs/);
  const order = ["Reject wrong release target", "npm ci", "pg_dump", "run-clean-baseline-cutover.mjs", "verify-clean-baseline-cutover.mjs", "probe-runtime-ddl-as-app-role.ts"]
    .map((s) => workflow.indexOf(s));
  assert.deepEqual([...order].sort((a, b) => a - b), order, "guard, install, artifact, cutover, then verification");
});

test("the runner installs btree_gist itself, before the schema dump (pg_dump --schema=public carries no CREATE EXTENSION)", async () => {
  const { REQUIRED_EXTENSIONS } = await import("../scripts/lib/clean-baseline-cutover.mjs");
  assert.deepEqual([...REQUIRED_EXTENSIONS], ["btree_gist"]);
  const runner = readFileSync("scripts/run-clean-baseline-cutover.mjs", "utf8");
  const extensions = runner.indexOf('step("required extensions"');
  const schema = runner.indexOf('step("source schema (push + 0109 + supplement)"');
  assert.ok(extensions > 0 && extensions < schema, "extensions come before the schema statements that need them");
  const workflow = readFileSync(".github/workflows/clean-baseline-cutover.yml", "utf8");
  assert.match(workflow, /--no-security-labels/);
});

test("the v2 audit guard companion is bound to the verified target database name, not the pinned 'neondb'", async () => {
  const { installV2AuditGuards } = await import("../scripts/lib/clean-baseline-cutover.mjs");
  const source = readFileSync("docs/sql/issue908-audit-trigger-boundary-REVIEW_ONLY.sql", "utf8");
  assert.equal(source.split("current_database() IS DISTINCT FROM 'neondb'").length, 2, "the reviewed file stays unchanged and pins one name");
  const sent = [];
  await installV2AuditGuards(async (sql) => { sent.push(sql); return { rows: [] }; }, { branchId: "br-young-leaf-b7ae1g8v", databaseName: "payrollph_clean_baseline" });
  assert.equal(sent.length, 1);
  assert.match(sent[0], /current_database\(\) IS DISTINCT FROM 'payrollph_clean_baseline'/);
  assert.doesNotMatch(sent[0], /DISTINCT FROM 'neondb'/);
  assert.match(sent[0], /neon\.branch_id',true\) IS DISTINCT FROM 'br-young-leaf-b7ae1g8v'/);
  assert.match(sent[0], /IN \('br-lucky-sound-b79i56jw','br-green-hat-b77qj8fs'\)/, "the forbidden-branch guard is kept");
  await assert.rejects(installV2AuditGuards(async () => ({ rows: [] }), { branchId: "br-young-leaf-b7ae1g8v", databaseName: "x'; DROP" }), /CUTOVER_DATABASE_NAME_INVALID/);
});

test("CI provisions and exercises each explicit database from the two-name matrix", () => {
  const workflow = load(readFileSync(".github/workflows/clean-baseline-cutover-rehearsal.yml", "utf8"));
  const job = workflow.jobs["production-runner"];
  assert.deepEqual(job.strategy.matrix.database, ["neondb", "payrollph_clean_baseline"]);
  assert.equal(job.env.EXPECTED_DATABASE_NAME, "${{ matrix.database }}");
  const execution = job.steps.find((step) => step.name === "Dry-run commits nothing; apply commits; a second apply is refused");
  assert.equal(Object.hasOwn(execution.env, "EXPECTED_DATABASE_NAME"), false, "the step cannot override the matrix target");
});
