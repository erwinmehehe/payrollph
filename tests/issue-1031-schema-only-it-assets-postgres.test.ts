import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Client } from "pg";
import { generateSchemaManifest } from "../scripts/lib/issue-1031-schema-manifest";
import { fullSchemaCatalogSql } from "../scripts/check-issue-1031-full-schema-diff";
import { diffSchema, type CatalogRow } from "../src/lib/issue-1031-full-schema-diff";

// This is an independent CI-only database test. Never run against a real DB.
// Source-only npm test skips it; the dedicated workflow uses postgres:16/18.
const mode = process.env.ISSUE_1031_IT_REHEARSAL === "isolated-ci-only"
  && process.env.CI === "true" && process.env.GITHUB_ACTIONS === "true";
const names = ["it_applications", "it_managed_devices", "it_access_grants", "it_device_events"];
const reverse = ["it_device_events", "it_access_grants", "it_managed_devices", "it_applications"];
const targetSet = new Set(names);
const sql = readFileSync("docs/sql/issue-1031-schema-only-it-assets-review.sql", "utf8");

// The complete 24-table dependency classification comes from the existing
// AST/Drizzle manifest; it is not inferred from current production presence.
test("#1031 source-only: classify every FK for all 24 schema-only gaps", () => {
  const all24 = new Set([
    "applicant_privacy_evidence", "email_change_tokens", "employee_entity_bank_accounts",
    "employee_hr_case_messages", "employee_hr_cases", "engagement_survey_participants",
    "engagement_surveys", "expense_category_policies", "expense_claim_evidence",
    "expense_report_items", "expense_reports", "hcm_document_expiry_notices",
    "it_access_grants", "it_applications", "it_device_events", "it_managed_devices",
    "legal_entity_profile_change_requests", "legal_entity_statutory_registrations",
    "legal_entity_transfer_liability_evidence", "offline_punch_claims",
    "saved_report_definitions", "separation_clearance_waivers",
    "spend_card_transactions", "spend_cards",
  ]);
  const previouslyObservedPresent = new Set([
    "organizations", "users", "employees", "job_applicants", "documents",
    "expense_claims", "assets", "legal_entities", "separation_records",
  ]);
  const otherNumberedMissing = new Set([
    "hcm_employee_document_compliance", "entity_transfer_requests",
  ]);
  const subset = generateSchemaManifest().tables.filter(t => all24.has(t.name));
  assert.equal(subset.length, 24);
  const prereqs = new Map(subset.map(t => [t.name,
    [...new Set(t.foreignKeys.map(fk => fk.refTable))]]));
  const blocked: string[] = [];
  for (const [name, targets] of prereqs) {
    for (const target of targets) {
      const category = all24.has(target) ? "S" :
        previouslyObservedPresent.has(target) ? "P" :
        otherNumberedMissing.has(target) ? "M" : null;
      assert.ok(category, "unclassified FK prerequisite " + name + " -> " + target);
      if (category === "M") blocked.push(name + " -> " + target);
    }
  }
  assert.deepEqual(blocked.sort(), [
    "hcm_document_expiry_notices -> hcm_employee_document_compliance",
    "legal_entity_transfer_liability_evidence -> entity_transfer_requests",
  ]);
  const created = new Set<string>();
  const unblocked = new Set([...all24].filter(name => !blocked.some(b => b.startsWith(name + " -> "))));
  while (true) {
    const ready = [...unblocked].filter(name => !created.has(name) &&
      prereqs.get(name)!.filter(dep => unblocked.has(dep)).every(dep => created.has(dep)));
    if (!ready.length) break;
    for (const name of ready) created.add(name);
  }
  assert.equal(created.size, 22, "a cycle or unexpected missing target blocks a source group");
});

test("#1031 IT group: exact Drizzle source, catalog restoration, negative type/retry in disposable PG", {
  skip: !mode, timeout: 180000,
}, async () => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol)
    && ["127.0.0.1", "localhost"].includes(url.hostname)
    && url.port === "5432" && url.pathname === "/app_db"
    && url.username === "postgres" && !url.search && !url.hash,
  "ISSUE1031_IT_DISPOSABLE_POSTGRES_ONLY");
  const manifest = generateSchemaManifest(); // TypeScript AST + Drizzle metadata.
  const selected = manifest.tables.filter(t => targetSet.has(t.name));
  assert.equal(selected.length, 4, "source schema must have exactly four IT targets");
  const subset = { ...manifest, tables: selected };
  // Fail if another app table now has an incoming FK into this group: do not
  // use CASCADE to silently damage the full pushed fixture.
  const unexpectedIncoming = manifest.tables.filter(t => !targetSet.has(t.name))
    .flatMap(t => t.foreignKeys.filter(f => targetSet.has(f.refTable)).map(f => t.name + "." + f.name));
  assert.deepEqual(unexpectedIncoming, [], "outside FK dependents block this candidate");
  const dependencies = new Map(selected.map(t => [t.name, [...new Set(t.foreignKeys.map(f => f.refTable))]]));
  assert.deepEqual((dependencies.get("it_access_grants") ?? []).filter(t => targetSet.has(t)), ["it_applications"]);
  assert.deepEqual((dependencies.get("it_device_events") ?? []).filter(t => targetSet.has(t)), ["it_managed_devices"]);
  for (const table of selected) for (const fk of table.foreignKeys) {
    assert.ok(["organizations", "employees", "users", "assets", ...names].includes(fk.refTable),
      "unexpected missing external prerequisite: " + fk.refTable);
  }

  const client = new Client({ connectionString:url.toString(), connectionTimeoutMillis:5000,
    query_timeout:150000 });
  await client.connect();
  try {
    const snapshot = async (): Promise<CatalogRow[]> => {
      const rows = (await client.query<{
        table_name:string;kind:string;object_name:string;details:Record<string,unknown>;
      }>(fullSchemaCatalogSql)).rows;
      return rows.filter(r => targetSet.has(r.table_name)).map(r =>
        ({ table_name:r.table_name,kind:r.kind,object_name:r.object_name,...r.details }) as CatalogRow);
    };
    const dropTargets = async () => {
      for (const name of reverse) await client.query('DROP TABLE IF EXISTS public."' + name + '"');
      const found = (await client.query(
        "SELECT count(*)::integer AS n FROM pg_catalog.pg_class c " +
        "JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace " +
        "WHERE n.nspname='public' AND c.relkind='r' AND c.relname=ANY($1::text[])", [names]
      )).rows[0].n;
      assert.equal(found, 0, "only the four intended tables may be removed");
    };
    const before = await snapshot();  // Full current schema came from guarded db:push.
    assert.ok(before.length > 35, "the four tables must already have full source objects");
    await dropTargets();

    // A controlled text-only negative substitutes a deliberately nonexistent
    // base in the preflight. Never DROP or modify the actual base tables.
    const missingDependencySql = sql.replace("to_regclass('public.assets') IS NULL",
      "to_regclass('public.issue1031_absent_base') IS NULL");
    assert.notEqual(missingDependencySql, sql);
    await assert.rejects(() => client.query(missingDependencySql), (error:unknown) =>
      (error as {code?:string;message?:string}).code==="P0001" &&
      (error as {message?:string}).message?.includes("ISSUE1031_IT_BASE_DEPENDENCY_MISSING")===true);
    await client.query("ROLLBACK");
    assert.deepEqual(await snapshot(), [], "missing-base guard may not create any target");
    console.log("MISSING_BASE_GUARD=PASS");

    // Intentionally corrupt ONE source column type, and prove exact real
    // pg_attribute/catalog evidence detects it, not just source assertions.
    const wrong = sql.replace('"mdm_provider" varchar(100)', '"mdm_provider" varchar(101)');
    assert.notEqual(wrong, sql, "negative test must change the proposal");
    await client.query(wrong);
    const corrupted = await snapshot();
    assert.notDeepEqual(corrupted, before, "wrong type must not pass canonical catalog equality");
    const diff = diffSchema(subset, corrupted);
    assert.equal(diff.find(r => r.table==="it_managed_devices" && r.kind==="column"
      && r.object==="mdm_provider")?.status, "DRIFT", "type mutation must fail manifest comparison");
    console.log("PG_CATALOG_NEGATIVE_TYPE_DRIFT=PASS");

    // Only an application table exists: fail before touching another target.
    for (const name of reverse.slice(0,3)) await client.query('DROP TABLE public."' + name + '"');
    await assert.rejects(() => client.query(sql), (error:unknown) =>
      (error as {code?:string;message?:string}).code==="P0001" &&
      (error as {message?:string}).message?.includes("ISSUE1031_IT_TARGET_ALREADY_PRESENT")===true);
    await client.query("ROLLBACK");
    const remaining = (await client.query(
      "SELECT to_regclass('public.it_applications') IS NOT NULL AS exists"
    )).rows[0].exists;
    assert.equal(remaining, true, "failed guard must leave the existing target untouched");
    console.log("PARTIAL_EXISTENCE_GUARD=PASS");

    await client.query('DROP TABLE public."it_applications"');
    await client.query(sql); // One BEGIN/COMMIT in the exact candidate source.
    const restored = await snapshot();
    assert.deepEqual(restored, before,
      "pg_attribute, pg_constraint, pg_indexes and defaults must exactly match drizzle-kit push");
    assert.equal(restored.filter(r => r.kind==="table").length, 4);
    const {rows:counts} = await client.query(
      "SELECT relname, n_live_tup FROM pg_stat_user_tables WHERE schemaname='public' AND relname=ANY($1::text[])", [names]
    );
    assert.ok(counts.every(r => Number(r.n_live_tup)===0), "no test rows may be synthesized");

    await assert.rejects(() => client.query(sql), (error:unknown) =>
      (error as {code?:string;message?:string}).code==="P0001" &&
      (error as {message?:string}).message?.includes("ISSUE1031_IT_TARGET_ALREADY_PRESENT")===true);
    await client.query("ROLLBACK");
    assert.deepEqual(await snapshot(), before, "second-run guard must not mutate tables");
    console.log("RECONSTRUCTED_TABLES=4");
    console.log("COLUMN_FK_CHECK_INDEX_DEFAULT_CATALOG_MATCH=PASS");
    console.log("SECOND_APPLICATION_REJECTED=PASS");
    console.log("SOURCE_ONLY_NOT_PRODUCTION_APPLICATION=TRUE");
  } finally {
    await client.end();
  }
});
