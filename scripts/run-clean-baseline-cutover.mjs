#!/usr/bin/env node
/**
 * Protected clean-baseline cutover. Builds the source-first baseline on an EMPTY,
 * pinned Neon target in ONE transaction: schema (source push + 0109 + supplement,
 * as a schema-only dump), v2 audit guards, least-privilege ownership and grants,
 * migration-control ledgers with a baseline-included receipt per historical file,
 * and the single cutover row. --dry-run rolls everything back; --apply commits.
 *
 * Never imported by the app. Never creates or prints passwords: the operator
 * provisions the roles first. Refuses the original production and QA branches,
 * any non-empty target, and any identity that does not match the pinned variables.
 *
 * Usage (from .github/workflows/clean-baseline-cutover.yml only):
 *   node scripts/run-clean-baseline-cutover.mjs --dry-run|--apply --artifact <schema-only.sql>
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { missingMigrationObjects, objectKey } from "./lib/migration-only-objects.mjs";
import {
  FORBIDDEN_TARGET_BRANCHES, REQUIRED_EXTENSIONS, applyOwnershipAndGrants, assertCutoverRolesProvisioned, assertPublicSchemaEmpty,
  createLedgersAndCutover, grantSealerMembership, installRequiredExtensions, installV2AuditGuards, prepareSchemaDump,
} from "./lib/clean-baseline-cutover.mjs";

function refuse(code) { throw new Error("CLEAN_BASELINE_CUTOVER_" + code); }

function parseArgs(argv) {
  const mode = argv.includes("--apply") ? "apply" : argv.includes("--dry-run") ? "dry-run" : null;
  const artifact = argv[argv.indexOf("--artifact") + 1];
  if (!mode || (argv.includes("--apply") && argv.includes("--dry-run")) || argv.indexOf("--artifact") < 0 || !artifact) refuse("ARGUMENTS_INVALID");
  return { mode, artifact };
}

/** Production: protected exact-SHA main run with pinned identity. Test: localhost CI only. */
export function cutoverEnvironment(env, mode) {
  const url = env.CUTOVER_TARGET_DATABASE_URL;
  if (!url) refuse("TARGET_URL_MISSING");
  const isolated = env.CUTOVER_ISOLATED_TEST === "true";
  if (isolated) {
    const host = new URL(url).hostname;
    if (env.CI !== "true" || env.GITHUB_ACTIONS !== "true" || host !== "127.0.0.1") refuse("ISOLATED_TEST_REQUIRES_LOCAL_CI");
  } else {
    if (env.GITHUB_ACTIONS !== "true" || env.GITHUB_REF !== "refs/heads/main" ||
        !/^[0-9a-f]{40}$/.test(env.GITHUB_SHA ?? "") || env.REVIEWED_SHA !== env.GITHUB_SHA) refuse("PROTECTED_EXACT_SHA_REQUIRED");
    if (!/^[a-z0-9-]{1,60}$/.test(env.EXPECTED_NEON_PROJECT_ID ?? "") ||
        !/^br-[a-z0-9-]{6,60}$/.test(env.EXPECTED_NEON_BRANCH_ID ?? "") ||
        !/^ep-[a-z0-9-]{6,60}$/.test(env.EXPECTED_NEON_ENDPOINT_ID ?? "")) refuse("NEON_PIN_REQUIRED");
    if (mode === "apply" && (env.CUTOVER_APPLY_CONFIRMATION !== "APPLY_CLEAN_BASELINE_CUTOVER" ||
        !/^[A-Za-z0-9][A-Za-z0-9_.:/-]{7,120}$/.test(env.CUTOVER_APPROVAL_REF ?? ""))) refuse("APPLY_CONFIRMATION_REQUIRED");
  }
  if (!/^[A-Za-z0-9_]{1,63}$/.test(env.EXPECTED_DATABASE_NAME ?? "")) refuse("DATABASE_NAME_REQUIRED");
  const branchId = isolated ? (env.EXPECTED_NEON_BRANCH_ID || "br-isolated-cutover-test") : env.EXPECTED_NEON_BRANCH_ID;
  if (FORBIDDEN_TARGET_BRANCHES.includes(branchId)) refuse("FORBIDDEN_TARGET_BRANCH");
  return {
    url, isolated, databaseName: env.EXPECTED_DATABASE_NAME, branchId,
    projectId: isolated ? "calm-wave-70219564" : env.EXPECTED_NEON_PROJECT_ID,
    endpointId: env.EXPECTED_NEON_ENDPOINT_ID ?? null,
    approvalRef: env.CUTOVER_APPROVAL_REF || (isolated ? "isolated-ci-cutover-test" : "dry-run-no-approval"),
    sha: env.GITHUB_SHA ?? "local",
  };
}

async function main() {
  const { mode, artifact } = parseArgs(process.argv.slice(2));
  const target = cutoverEnvironment(process.env, mode);
  const dump = prepareSchemaDump(readFileSync(artifact, "utf8"));
  const artifactSha256 = createHash("sha256").update(readFileSync(artifact)).digest("hex");
  const evidence = [];
  const step = async (name, fn) => {
    const detail = await fn();
    evidence.push({ step: name, ok: true, ...(detail ? { detail } : {}) });
  };

  const client = new pg.Client({ connectionString: target.url, application_name: "payrollph-clean-baseline-cutover" });
  await client.connect();
  const q = (sql, params) => client.query(sql, params);
  let open = false;
  try {
    await step("target identity", async () => {
      const { rows: [id] } = await q(`SELECT current_database() AS db, current_user AS owner,
        current_setting('neon.project_id', true) AS project, current_setting('neon.branch_id', true) AS branch,
        current_setting('neon.endpoint_id', true) AS endpoint, pg_catalog.pg_is_in_recovery() AS replica,
        current_setting('server_version_num')::int AS version`);
      if (id.db !== target.databaseName) refuse("DATABASE_NAME_MISMATCH");
      if (id.replica) refuse("TARGET_IS_READ_REPLICA");
      if (!target.isolated && (id.project !== target.projectId || id.branch !== target.branchId || id.endpoint !== target.endpointId)) {
        refuse("NEON_IDENTITY_MISMATCH");
      }
      if (FORBIDDEN_TARGET_BRANCHES.includes(id.branch)) refuse("FORBIDDEN_TARGET_BRANCH");
      if (Math.floor(id.version / 10000) < 16) refuse("POSTGRES_16_OR_NEWER_REQUIRED");
      return { database: id.db, bootstrapOwner: id.owner, branch: target.isolated ? "isolated-test" : id.branch, postgresMajor: Math.floor(id.version / 10000) };
    });
    const bootstrapOwner = evidence[0].detail.bootstrapOwner;
    await step("preconditions: empty target, provisioned roles", async () => {
      await assertPublicSchemaEmpty(q);
      await assertCutoverRolesProvisioned(q);
    });

    await q("BEGIN");
    open = true;
    await q("SET LOCAL lock_timeout = '10s'");
    await q("SET LOCAL statement_timeout = '300s'");
    await step("required extensions", async () => { await installRequiredExtensions(q); return { extensions: [...REQUIRED_EXTENSIONS] }; });
    await step("source schema (push + 0109 + supplement)", async () => {
      await q(dump);
      await q("SET LOCAL search_path = public");
      const { rows: [n] } = await q("SELECT count(*)::int AS tables FROM pg_catalog.pg_tables WHERE schemaname = 'public'");
      return { tables: n.tables, artifactSha256 };
    });
    await step("v2 audit guards", async () => installV2AuditGuards(q, {
      branchId: target.branchId, databaseName: target.databaseName, isolatedTestIdentity: target.isolated ? { projectId: target.projectId } : null,
    }));
    await step("ownership and least-privilege grants", async () => applyOwnershipAndGrants(q, { databaseName: target.databaseName, bootstrapOwner }));
    await step("ledgers, receipts and cutover row", async () => {
      const detail = await createLedgersAndCutover(q, {
        evidenceRef: `clean-baseline ${target.sha.slice(0, 12)} ${target.approvalRef}`.slice(0, 240),
        reviewedBy: "clean-baseline cutover workflow (owner-approved)",
      });
      await grantSealerMembership(q);
      return detail;
    });
    await step("no migration-created object missing", async () => {
      const { scanned, missing } = await missingMigrationObjects(client);
      if (missing.length) refuse("MIGRATION_OBJECTS_MISSING: " + missing.map(objectKey).join(", ").slice(0, 400));
      return { checked: scanned };
    });
    await q(mode === "apply" ? "COMMIT" : "ROLLBACK");
    open = false;
    if (mode === "dry-run") {
      await step("dry-run left the target untouched", async () => assertPublicSchemaEmpty(q));
    }
    console.log(JSON.stringify({ kind: "clean-baseline-cutover", mode, committed: mode === "apply", evidence,
      credentialsPrinted: false, productionReleaseApproved: false }, null, 2));
  } catch (error) {
    if (open) { try { await q("ROLLBACK"); } catch { /* connection discarded */ } }
    // Never echo raw PostgreSQL errors: they can carry statement text.
    const message = String(error?.message ?? "").startsWith("CLEAN_BASELINE_CUTOVER_") || String(error?.message ?? "").startsWith("CUTOVER_")
      ? String(error.message).slice(0, 500)
      // Disposable test databases only: show the first line of the PostgreSQL error to debug the runner.
      : process.env.CUTOVER_ISOLATED_TEST === "true"
        ? `database error ${error?.code ?? "unknown"}: ${String(error?.message ?? "").split(/\r?\n/)[0].slice(0, 200)}`
        : `database error ${error?.code ?? "unknown"}`;
    console.log(JSON.stringify({ kind: "clean-baseline-cutover", mode, committed: false, evidence, failed: message }, null, 2));
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1].replaceAll("\\", "/")}` || process.argv[1]?.endsWith("run-clean-baseline-cutover.mjs")) {
  await main();
}
