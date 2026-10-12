import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { importFixtureCsv } from "./fixtures/employee-import-500";

let isolated = false;
try {
  const url = new URL(process.env.DATABASE_URL ?? "");
  isolated = process.env.CI === "true" && process.env.GITHUB_ACTIONS === "true" && ["127.0.0.1", "localhost"].includes(url.hostname) && url.pathname === "/app_db";
} catch { /* Only disposable GitHub Actions PostgreSQL is permitted. */ }

test("PostgreSQL: 500-row preview has 20 errors; failed audit rolls back the complete batch", { skip: !isolated }, async () => {
  const { db: realDb } = await import("../src/db");
  const { and, eq, sql } = await import("drizzle-orm");
  const { organizations, users, orgUnits, employees, employeePayProfiles, importBatches, legalEntities } = await import("../src/db/schema");
  const { handleEmployeeImportPreview } = await import("../src/lib/employee-import-request");
  await assert.rejects(realDb.transaction(async transaction => {
    const db = transaction as unknown as typeof realDb;
    const handle = (input: Parameters<typeof handleEmployeeImportPreview>[0]) => handleEmployeeImportPreview(input, db);
    const suffix = randomUUID().replaceAll("-", "");
    const [tenant, foreign] = await db.insert(organizations).values([{ name: "Synthetic Import " + suffix, legalName: "Synthetic Import" }, { name: "Foreign Import " + suffix, legalName: "Foreign Import" }]).returning();
    const [actor] = await db.insert(users).values({ name: "Synthetic HR Import", email: `import-${suffix}@example.test`, role: "hr", passwordHash: "never-login" }).returning();
    const functionName = `import_failure_${suffix}`;
    await db.insert(orgUnits).values([{ organizationId: tenant.id, name: "Operations", code: "OPS", type: "Department" }, { organizationId: foreign.id, name: "Foreign", code: "FOREIGN-DEPARTMENT", type: "Department" }]);
    await db.insert(employees).values({ organizationId: foreign.id, employeeNo: "EMP-0001", firstName: "Foreign", lastName: "Worker", title: "Staff", avatarInitials: "FW", basicRate: "30000", startDate: "2026-10-01" });
    const csv = importFixtureCsv();
    const input = { organizationId: tenant.id, csv, fileName: "500-synthetic.csv", user: { id: actor.id, name: actor.name, sessionToken: "synthetic-session" }, seatLimit: null };
    const previewResponse = await handle({ ...input, body: { action: "preview" } });
    const preview = await previewResponse.json();
    assert.equal(preview.rows.length, 500);
    assert.equal(preview.errorCount, 20);
    assert.equal(preview.errorCsv.split("\n").length, 21);
    const count = async () => ({ employees: (await db.select().from(employees).where(eq(employees.organizationId, tenant.id))).length, profiles: (await db.select().from(employeePayProfiles).where(eq(employeePayProfiles.organizationId, tenant.id))).length, batches: (await db.select().from(importBatches).where(eq(importBatches.organizationId, tenant.id))).length, entities: (await db.select().from(legalEntities).where(eq(legalEntities.organizationId, tenant.id))).length });
    const empty = { employees: 0, profiles: 0, batches: 0, entities: 0 };
    assert.deepEqual(await count(), empty);
    const rejected = await handle({ ...input, body: { action: "commit", previewToken: preview.previewToken } });
    assert.equal(rejected.status, 422);
    assert.deepEqual(await count(), empty);
    const skipLines = preview.rows.filter((r: { status: string }) => r.status === "error").map((r: { line: number }) => r.line);
    const tampered = await handle({ ...input, body: { action: "commit", skipLines, previewToken: preview.previewToken } });
    assert.equal(tampered.status, 409);
    const selected = await (await handle({ ...input, body: { action: "preview", skipLines } })).json();
    assert.equal(selected.blockingErrorCount, 0);
    await db.execute(sql.raw(`CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.organization_id = ${tenant.id} THEN RAISE EXCEPTION 'Synthetic import audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER ${functionName} BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION ${functionName}();`));
    const rolledBack = await handle({ ...input, body: { action: "commit", skipLines, previewToken: selected.previewToken } });
    assert.equal(rolledBack.status, 500);
    assert.deepEqual(await count(), empty);
    assert.match((await rolledBack.json()).errorCsv, /rolled back/);
    await db.execute(sql.raw(`DROP TRIGGER ${functionName} ON audit_events; DROP FUNCTION ${functionName}();`));
    const committed = await handle({ ...input, body: { action: "commit", skipLines, previewToken: selected.previewToken } });
    assert.equal(committed.status, 200);
    assert.equal((await committed.json()).createdCount, 480);
    assert.equal((await count()).employees, 480);
    assert.equal((await count()).profiles, 480);
    const [first] = await db.select().from(employees).where(and(eq(employees.organizationId, tenant.id), eq(employees.employeeNo, "EMP-0001")));
    assert.equal(first.startDate, "2026-10-15");
    assert.ok(first.legalEntityId && first.orgUnitId);
    throw new Error("ROLLBACK_SYNTHETIC_IMPORT_FIXTURE");
  }), /ROLLBACK_SYNTHETIC_IMPORT_FIXTURE/);
});

test("PostgreSQL migration preserves legacy navigation and defaults only new tenants to core", { skip: !isolated }, async () => {
  const { db } = await import("../src/db");
  const { sql } = await import("drizzle-orm");
  const schema = `modules_${randomUUID().replaceAll("-", "")}`;
  const migration = readFileSync("drizzle/0116_tenant_module_disclosure.sql", "utf8");
  await db.transaction(async tx => {
    await tx.execute(sql.raw(`CREATE SCHEMA ${schema}; SET LOCAL search_path TO ${schema}, public; CREATE TABLE organizations (id serial PRIMARY KEY, name text NOT NULL); INSERT INTO organizations (name) VALUES ('Existing tenant');`));
    await tx.execute(sql.raw(migration));
    await tx.execute(sql.raw("INSERT INTO organizations (name) VALUES ('New tenant');"));
    const result = await tx.execute(sql.raw("SELECT name, module_navigation_mode FROM organizations ORDER BY id"));
    assert.deepEqual(result.rows, [{ name: "Existing tenant", module_navigation_mode: "all" }, { name: "New tenant", module_navigation_mode: "core" }]);
    await tx.execute(sql.raw(`DROP SCHEMA ${schema} CASCADE`));
  });
});
