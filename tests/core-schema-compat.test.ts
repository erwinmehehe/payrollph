import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("core schema compatibility upgrades fields used by production demo and dashboard", () => {
  const source = read("src/lib/core-schema-compat.ts");

  for (const fragment of [
    "ADD COLUMN IF NOT EXISTS bir_tin",
    "ADD COLUMN IF NOT EXISTS middle_name",
    "ADD COLUMN IF NOT EXISTS nationality",
    "ADD COLUMN IF NOT EXISTS period_start",
    "ADD COLUMN IF NOT EXISTS period_end",
    "ADD COLUMN IF NOT EXISTS scope_org_unit_id",
    "ADD COLUMN IF NOT EXISTS source_system",
    "ADD COLUMN IF NOT EXISTS import_kind",
    "CREATE TABLE IF NOT EXISTS historical_payroll_entries",
  ]) {
    assert.ok(source.includes(fragment), `missing compatibility migration fragment: ${fragment}`);
  }

  assert.ok(source.includes("COALESCE(period_start, pay_date)"), "legacy payroll runs must get a non-null period start");
  assert.ok(source.includes("COALESCE(period_end, pay_date)"), "legacy payroll runs must get a non-null period end");
});

test("demo launch and authenticated dashboard apply core compatibility before Drizzle selects", () => {
  const demo = read("src/app/api/auth/demo-switch/route.ts");
  const dashboard = read("src/lib/dashboard-data.ts");

  assert.ok(demo.includes("await ensureCoreCompatibilitySchema()"), "demo launch must upgrade schema before provisioning");
  assert.ok(
    demo.indexOf("await ensureCoreCompatibilitySchema()") < demo.indexOf("await ensurePublicDemoTenant()"),
    "compatibility upgrade must happen before public demo tenant provisioning",
  );
  assert.ok(
    dashboard.indexOf("await ensureCoreCompatibilitySchema()") < dashboard.indexOf("await ensureSeedData()"),
    "dashboard must upgrade schema before selecting current organization fields",
  );
});
