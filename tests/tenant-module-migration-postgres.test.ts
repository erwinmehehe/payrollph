import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { loadTenantModulePreferences } from "../src/lib/tenant-modules";

let isolated = false;
try {
  const url = new URL(process.env.DATABASE_URL ?? "");
  isolated = process.env.CI === "true" && process.env.GITHUB_ACTIONS === "true" && ["127.0.0.1", "localhost"].includes(url.hostname) && url.pathname === "/app_db";
} catch { /* Only disposable GitHub Actions PostgreSQL is permitted. */ }

test("flag-off organization queries work before optional navigation columns exist", { skip: !isolated }, async () => {
  const { db } = await import("../src/db");
  const { organizations } = await import("../src/db/schema");
  const { sql } = await import("drizzle-orm");
  const schema = `modules_legacy_${randomUUID().replaceAll("-", "")}`;
  await db.transaction(async tx => {
    await tx.execute(sql.raw(`CREATE SCHEMA ${schema}; CREATE TABLE ${schema}.organizations (LIKE public.organizations INCLUDING DEFAULTS); SET LOCAL search_path TO ${schema}, public; ALTER TABLE organizations DROP COLUMN IF EXISTS module_navigation_mode; ALTER TABLE organizations DROP COLUMN IF EXISTS enabled_modules;`));
    assert.deepEqual(await tx.select().from(organizations).limit(1), []);
    const disabled = await loadTenantModulePreferences([1], async () => {
      throw new Error("Optional columns must never be requested when disabled");
    }, {});
    assert.equal(disabled.size, 0);
    await tx.execute(sql.raw(`DROP SCHEMA ${schema} CASCADE`));
  });
});

test("PostgreSQL migration preserves legacy navigation and defaults only new tenants to core", { skip: !isolated }, async () => {
  const { db } = await import("../src/db");
  const { sql } = await import("drizzle-orm");
  const schema = `modules_${randomUUID().replaceAll("-", "")}`;
  const migration = readFileSync("drizzle/0122_tenant_module_disclosure.sql", "utf8");
  await db.transaction(async tx => {
    await tx.execute(sql.raw(`CREATE SCHEMA ${schema}; SET LOCAL search_path TO ${schema}, public; CREATE TABLE organizations (id serial PRIMARY KEY, name text NOT NULL); INSERT INTO organizations (name) VALUES ('Existing tenant');`));
    await tx.execute(sql.raw(migration));
    await tx.execute(sql.raw("INSERT INTO organizations (name) VALUES ('New tenant');"));
    const result = await tx.execute(sql.raw("SELECT name, module_navigation_mode FROM organizations ORDER BY id"));
    assert.deepEqual(result.rows, [{ name: "Existing tenant", module_navigation_mode: "all" }, { name: "New tenant", module_navigation_mode: "core" }]);
    await tx.execute(sql.raw(`DROP SCHEMA ${schema} CASCADE`));
  });
});
