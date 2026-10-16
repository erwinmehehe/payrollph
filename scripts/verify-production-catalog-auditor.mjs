#!/usr/bin/env node
/**
 * Manual, protected, catalog-only credential check, BEFORE a production
 * schema inventory or full #1031 catalog diff uses the credential.
 * Fails closed and never outputs raw database errors, connection strings,
 * personal records, SQL values, or role-grant inventories.
 */
import {
  PINNED_NEON,
} from "./lib/historical-dba-evidence.mjs";
import { assertCatalogAuditorPrivilegeBoundary, catalogAuditorConnectionOptions } from "./lib/production-catalog-auditor-gate.mjs";

if (process.argv.length !== 3 || process.argv[2] !== "--verify") {
  console.error("Use --verify only from the reviewed, manual production workflow.");
  process.exitCode = 2;
} else {
  verify().catch(() => {
    console.error("P0_4_CATALOG_AUDITOR_NOT_LEAST_PRIVILEGED_OR_TARGET_UNVERIFIED");
    process.exitCode = 1;
  });
}

async function verify() {
  const e = process.env;
  if (e.GITHUB_ACTIONS !== "true" ||
      e.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
      e.GITHUB_REPOSITORY !== "erwinmehehe/payrollph" ||
      e.GITHUB_REF !== "refs/heads/main" ||
      !/^[a-f0-9]{40}$/.test(e.REVIEWED_SHA ?? "") ||
      e.REVIEWED_SHA !== e.GITHUB_SHA ||
      e.EXPECTED_PRODUCTION_DATABASE_NAME !== PINNED_NEON.database) {
    throw new Error("P0_4_CATALOG_AUDITOR_SOURCE_UNREVIEWED");
  }
  const options = catalogAuditorConnectionOptions(e.PRODUCTION_DATABASE_URL, e.EXPECTED_PRODUCTION_DATABASE_NAME);
  const { default: pg } = await import("pg");
  const client = new pg.Client(options);
  let connected = false, inTransaction = false;
  try {
    await client.connect();
    connected = true;
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    inTransaction = true;
    await client.query("SET LOCAL search_path = pg_catalog");
    await client.query("SET LOCAL statement_timeout = '7000ms'");
    await client.query("SET LOCAL lock_timeout = '2000ms'");
    await assertCatalogAuditorPrivilegeBoundary(client, {
      expectedDatabase: PINNED_NEON.database, requireJournals: false,
    });
    await client.query("ROLLBACK");
    inTransaction = false;
    console.log(JSON.stringify({
      kind: "p0-4-restricted-production-catalog-auditor-only",
      reviewedSha: e.GITHUB_SHA,
      restrictedRoleVerified: true, catalogOnly: true,
      applicationRowsQueried: false, migrationReceiptsVerified: false,
      changesApplied: false, productionReleaseApproved: false,
    }));
  } finally {
    if (inTransaction) await client.query("ROLLBACK").catch(() => {});
    if (connected) await client.end().catch(() => {});
  }
}
