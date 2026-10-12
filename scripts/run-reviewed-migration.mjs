#!/usr/bin/env node
/**
 * Explicit release job; never imported by app startup or request handlers.
 * --manifest does not connect. --plan uses a PostgreSQL READ ONLY transaction.
 * --apply requires a protected exact-main workflow and DBA credentials.
 */
import { inventoryMigrationSources } from "./lib/migration-receipt-audit.mjs";
import { cutoverSourceManifest, runReviewedMigrationOnClient } from "./lib/reviewed-migration-runner.mjs";
import {
  requirePinnedNeonMigrationTarget, requireProtectedMainForMigrationApply,
} from "./lib/migration-neon-target.mjs";

function argumentsFrom(argv) {
  const options = {};
  const allowed = new Set(["--manifest", "--through", "--plan", "--apply", "--file", "--sha256"]);
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!allowed.has(key) || Object.hasOwn(options, key)) throw new Error("REVIEWED_MIGRATION_ARGUMENTS_INVALID");
    if (["--manifest", "--plan", "--apply"].includes(key)) {
      options[key] = true;
    } else {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error("REVIEWED_MIGRATION_ARGUMENTS_INVALID");
      options[key] = value;
    }
  }
  return options;
}

function authorizedEnvironment(mode, options, env) {
  if (env.GITHUB_ACTIONS !== "true" || env.GITHUB_REF !== "refs/heads/main" ||
      !/^[0-9a-f]{40}$/.test(env.GITHUB_SHA ?? "") ||
      env.REVIEWED_SHA !== env.GITHUB_SHA ||
      !/^[A-Za-z0-9_]{1,63}$/.test(env.EXPECTED_PRODUCTION_DATABASE_NAME ?? "") ||
      !/^drizzle\/[0-9]{4}_[a-z0-9][a-z0-9_-]*\.sql$/.test(options["--file"] ?? "") ||
      !/^[0-9a-f]{64}$/.test(options["--sha256"] ?? "") ||
      !env.MIGRATION_TARGET_DATABASE_URL) {
    throw new Error("REVIEWED_MIGRATION_PROTECTED_EXACT_SHA_REQUIRED");
  }
  if (mode === "apply" &&
      (env.MIGRATION_APPLY_CONFIRMATION !== "APPLY_APPROVED_SCHEMA_MIGRATION" ||
      !/^[A-Za-z0-9][A-Za-z0-9_.:/-]{7,120}$/.test(env.MIGRATION_APPROVAL_REF ?? "") ||
      !/^[A-Za-z0-9-]{8,64}$/.test(env.GITHUB_ACTOR ?? ""))) {
    throw new Error("REVIEWED_MIGRATION_APPLY_AUTHORIZATION_MISSING");
  }
}

async function main() {
  const options = argumentsFrom(process.argv.slice(2));
  const inventory = inventoryMigrationSources();
  if (options["--manifest"] === true && Object.keys(options).sort().join(",") === "--manifest,--through") {
    if (!/^[0-9]{4}$/.test(options["--through"] ?? "")) throw new Error("REVIEWED_MIGRATION_THROUGH_INVALID");
    const summary = cutoverSourceManifest(inventory, Number(options["--through"]));
    console.log(JSON.stringify({
      mode: "historical-source-manifest-only",
      historicalThroughPrefix: summary.throughPrefix,
      historicalFileCount: summary.files.length,
      historicalManifestSha256: summary.digest,
      legacyDuplicatePrefixGroups: summary.duplicatePrefixes.length,
      databaseConnected: false,
      productionReleaseApproved: false,
    }, null, 2));
    return;
  }
  const plan = options["--plan"] === true && options["--apply"] !== true;
  const apply = options["--apply"] === true && options["--plan"] !== true;
  if ((!plan && !apply) ||
      Object.keys(options).length !== 3 ||
      !Object.hasOwn(options, "--file") || !Object.hasOwn(options, "--sha256")) {
    throw new Error("REVIEWED_MIGRATION_MODE_OR_ARGS_INVALID");
  }
  const mode = plan ? "plan" : "apply";
  // Fail before creating a database client, including on non-main PR commits.
  authorizedEnvironment(mode, options, process.env);
  requireProtectedMainForMigrationApply(process.env, mode);
  const expectedNeonIdentity = requirePinnedNeonMigrationTarget(process.env);
  const { default: pg } = await import("pg");
  const client = new pg.Client({
    connectionString: process.env.MIGRATION_TARGET_DATABASE_URL,
    connectionTimeoutMillis: 8000,
    query_timeout: 100000,
  });
  let connected = false;
  try {
    await client.connect();
    connected = true;
    const result = await runReviewedMigrationOnClient({
      client, inventory, mode,
      requestedPath: options["--file"],
      expectedSha256: options["--sha256"],
      expectedDatabaseName: process.env.EXPECTED_PRODUCTION_DATABASE_NAME,
      expectedNeonIdentity,
      operator: mode === "apply" ? process.env.GITHUB_ACTOR : "",
      approvalRef: mode === "apply" ? process.env.MIGRATION_APPROVAL_REF : "",
    });
    console.log(JSON.stringify({
      ...result,
      sourceSha: process.env.GITHUB_SHA,
      // The reviewed SQL itself may read or alter business data; this tool
      // never claims content inspection or payroll correctness.
      migrationSqlExecuted: result.sqlApplied,
      productionReleaseApproved: false,
    }, null, 2));
  } finally {
    if (connected) {
      try { await client.end(); } catch { /* disconnected */ }
    }
  }
}

main().catch(error => {
  // Never echo PostgreSQL errors, SQL text, credentials, or connection URLs.
  const code = error instanceof Error && /^REVIEWED_MIGRATION_[A-Z_]+$/.test(error.message)
    ? error.message : "REVIEWED_MIGRATION_EXECUTION_FAILED";
  console.error(code + ". Database rollout remains unapproved.");
  process.exitCode = 1;
});
