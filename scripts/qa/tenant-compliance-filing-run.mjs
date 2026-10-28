/**
 * Strict executable gate for the focused Compliance filing write-row.
 * REFUSE before any PostgreSQL import unless inside isolated GitHub CI.
 * A fresh, empty PostgreSQL 16 is mandatory. Then invoke the existing
 * real signed-in HTTP write-table runner filtered to compliance-filing.
 *
 * Node: node --import tsx scripts/qa/tenant-compliance-filing-run.mjs
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { requireDisposableFilingEnvironment } from "./tenant-compliance-filing-contract.mjs";

export async function runIsolatedComplianceFiling() {
  requireDisposableFilingEnvironment();
  assert.equal(process.env.TENANT_TABLE_PROFILE, "default",
    "COMPLIANCE_FILING_REFUSED: default isolated profile required");

  const [database, schema] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
  ]);
  const { db, pool } = database;
  try {
    const version = await pool.query("SHOW server_version_num");
    const number = Number(version.rows?.[0]?.server_version_num);
    assert.equal(Math.floor(number / 10000), 16,
      "COMPLIANCE_FILING_REFUSED: PostgreSQL 16 only");

    for (const [label, table] of [
      ["organizations", schema.organizations],
      ["filings", schema.governmentFilingValidations],
      ["payroll runs", schema.payrollRuns],
      ["audit events", schema.auditEvents],
    ]) {
      const rows = await db.select({ id: table.id }).from(table).limit(1);
      assert.equal(rows.length, 0,
        "COMPLIANCE_FILING_REFUSED: fresh empty disposable " + label + " required");
    }
  } finally {
    await pool.end();
  }

  const child = spawnSync(process.execPath, [
    "--import", "tsx", "scripts/qa/tenant-write-table-http.mjs",
  ], {
    cwd: process.cwd(),
    stdio: "inherit",
    env: {
      ...process.env,
      TENANT_TABLE_PROFILE: "default",
      TENANT_TABLE_FAMILY: "compliance-filing",
    },
    timeout: 20 * 60_000,
  });
  if (child.error) throw child.error;
  assert.equal(child.signal, null,
    "COMPLIANCE_FILING_REFUSED: isolated runner timed out or was killed");
  assert.equal(child.status, 0,
    "COMPLIANCE_FILING_REFUSED: tenant proof did not pass");
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/tenant-compliance-filing-run.mjs")) {
  runIsolatedComplianceFiling().then(() => process.exit(0), error => {
    console.error(error);
    process.exit(1);
  });
}
