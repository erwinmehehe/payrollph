import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { GET } from "../src/app/api/readiness/database-target/route";
import { normalizeRuntimeDatabaseIdentity, normalizeRuntimeCompensationTableEvidence } from "../src/lib/runtime-database-identity";

const URL = "https://payroll.example/api/readiness/database-target";
const TOKEN = "synthetic-private-readiness-database-identity-2026";

test("#1015 live database target probe is private and cannot query DB anonymously", async () => {
  const original = process.env.READINESS_TOKEN;
  process.env.READINESS_TOKEN = TOKEN;
  try {
    const denied = await GET(new Request(URL));
    assert.equal(denied.status, 404);
    assert.equal(denied.headers.get("Cache-Control"), "no-store");
    assert.ok(!JSON.stringify(await denied.json()).includes("branchId"));

    const forged = await GET(new Request(URL, {
      headers: { "x-readiness-token": "invalid-synthetic-value" },
    }));
    assert.equal(forged.status, 404);
    assert.ok(!JSON.stringify(await forged.json()).includes("endpointId"));
  } finally {
    if (original === undefined) delete process.env.READINESS_TOKEN;
    else process.env.READINESS_TOKEN = original;
  }
});

test("#1015 malformed readiness secret rejects probe without database access", async () => {
  const original = process.env.READINESS_TOKEN;
  process.env.READINESS_TOKEN = "weak";
  try {
    const response = await GET(new Request(URL, {
      headers: { "x-readiness-token": "weak" },
    }));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.ok(!JSON.stringify(await response.json()).includes("databaseName"));
  } finally {
    if (original === undefined) delete process.env.READINESS_TOKEN;
    else process.env.READINESS_TOKEN = original;
  }
});

test("#1015 normalizer allows only an explicit, nonsecret Neon identity", () => {
  const raw = {
    databaseName: "neondb", projectId: "calm-wave-70219564",
    branchId: "br-lucky-sound-b79i56jw", endpointId: "ep-cool-hat-b7e7gpoo",
    roleName: "neondb_owner", inRecovery: false,
  };
  assert.deepEqual(normalizeRuntimeDatabaseIdentity(raw), raw);
  assert.throws(() => normalizeRuntimeDatabaseIdentity({ ...raw, roleName: "../leak" }));
  assert.throws(() => normalizeRuntimeDatabaseIdentity({ ...raw, branchId: null }));
  assert.throws(() => normalizeRuntimeDatabaseIdentity({ ...raw, inRecovery: "false" }));
  assert.throws(() => normalizeRuntimeDatabaseIdentity(null));
});

test("#1015 runtime target source is static metadata-only and queries after auth", () => {
  const code = readFileSync("src/app/api/readiness/database-target/route.ts", "utf8");
  const authAt = code.indexOf("constantTimeSecretEqual(request.headers.get");
  const dbAt = code.indexOf('await import("@/db")');
  assert.ok(authAt >= 0 && dbAt > authAt);
  assert.match(code, /pg_catalog\.current_database\(\)/);
  assert.match(code, /pg_catalog\.current_setting\('neon\.branch_id', true\)/);
  assert.doesNotMatch(code, /\b(?:INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)\s+(?:TABLE|INTO|FROM|public\.)\b/i);
  assert.doesNotMatch(code, /console\.(?:log|error)/);
  assert.match(code, /PRIVATE_RUNTIME_SESSION_IDENTITY_ONLY_NOT_MIGRATION_APPROVAL/);
});

test("#1061 private catalog presence counters cannot be forged into green evidence", () => {
  const result = normalizeRuntimeCompensationTableEvidence({
    compensationTablesPresent: 0, migrationLedgerTablesPresent: 0,
  });
  assert.deepEqual(result, {
    compensationTablesPresent: 0, compensationTablesExpected: 6,
    migrationLedgerTablesPresent: 0, migrationLedgerTablesExpected: 3,
    evidenceScope: "CATALOG_TABLE_PRESENCE_ONLY_NOT_MIGRATION_APPROVAL",
  });
  assert.throws(() => normalizeRuntimeCompensationTableEvidence({
    compensationTablesPresent: "6", migrationLedgerTablesPresent: 3,
  }));
  assert.throws(() => normalizeRuntimeCompensationTableEvidence({
    compensationTablesPresent: 7, migrationLedgerTablesPresent: 3,
  }));
  assert.throws(() => normalizeRuntimeCompensationTableEvidence({
    compensationTablesPresent: 6, migrationLedgerTablesPresent: null,
  }));
});

test("#1061 readiness SQL only counts fixed pg_catalog objects after private auth", () => {
  const source = readFileSync("src/app/api/readiness/database-target/route.ts", "utf8");
  const authorizedAt = source.indexOf('constantTimeSecretEqual(request.headers.get');
  const sqlAt = source.indexOf('await pool.query(');
  assert.ok(authorizedAt >= 0 && sqlAt > authorizedAt);
  assert.match(source, /pg_catalog\.pg_class/);
  for (const name of [
    "compensation_bands", "compensation_cycles", "compensation_proposals",
    "compensation_components", "employee_compensation_components", "compensation_events",
    "payrollph_release_migration_receipts", "payrollph_migration_cutover",
    "payrollph_schema_migrations",
  ]) assert.ok(source.includes(name), "missing required catalog name: " + name);
  assert.match(source, /schemaPresence: normalizeRuntimeCompensationTableEvidence/);
  assert.doesNotMatch(source, /console\.(?:log|warn|error)/);
});
