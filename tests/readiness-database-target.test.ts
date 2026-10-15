import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { GET } from "../src/app/api/readiness/database-target/route";
import { normalizeRuntimeDatabaseIdentity } from "../src/lib/runtime-database-identity";

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
