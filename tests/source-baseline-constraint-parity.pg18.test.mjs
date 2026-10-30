import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import {
  assertSourceBaselineParity,
  assertSourceBaselineConstraintParity,
} from "../scripts/lib/source-baseline-parity.mjs";
import { readSourceBaselineCatalog } from "../scripts/qa/check-source-baseline-parity.mjs";
import { assertDisposablePG18Environment } from "../scripts/qa/fresh-pg18-development-schema.mjs";

const URL = "postgresql://postgres:postgres@127.0.0.1:5432/app_db";
// The generic CI and post-cutover suites also set CI/GITHUB_ACTIONS, but do
// not authorize this separate disposable PG18 source-parity database. Skip
// fixtures there; when explicitly selected, withFixture still runs the full
// fail-closed target, secret, flag and server-identity assertions.
const disposableCI = process.env.CI === "true" &&
  process.env.GITHUB_ACTIONS === "true" &&
  process.env.FRESH_PG18_DEV_REHEARSAL === "disposable-ci-only";

/**
 * Real PG18 catalog fixtures, NOT mocked query responses.
 * Every DDL mutation is confined to a single transaction and rolled back.
 * The CI guard prevents connections to a non-disposable target.
 * Outside the explicitly guarded CI service, tests are skipped, never faked.
 */
async function withFixture(label, run) {
  assertDisposablePG18Environment(process.env);
  assert.equal(process.env.PRODUCTION_DATABASE_URL, undefined, "NO_PRODUCTION_CREDENTIALS");
  const client = new pg.Client({
    connectionString: URL, connectionTimeoutMillis: 5000, query_timeout: 15000,
  });
  await client.connect();
  const parent = "ParityParent_" + label;
  const child = "ParityChild_" + label;
  try {
    const id = (await client.query(
      "SELECT current_database() AS db, current_user AS role, " +
      "current_setting('server_version_num')::integer AS version"
    )).rows[0];
    assert.equal(id.db, "app_db");
    assert.equal(id.role, "postgres");
    assert.ok(id.version >= 180000 && id.version < 190000, "PG18_REQUIRED");
    await client.query("BEGIN");
    await client.query(
      'CREATE TABLE public."' + parent + '" ("Key" integer NOT NULL, ' +
      'CONSTRAINT "' + parent + '_pkey" PRIMARY KEY ("Key"))'
    );
    await client.query(
      'CREATE TABLE public."' + child + '" (' +
      '"Id" integer NOT NULL, "ParentKey" integer NOT NULL, ' +
      '"Amount" numeric(12,2), "Status" text NOT NULL DEFAULT ' +
      "'new'::text, " +
      'CONSTRAINT "' + child + '_pkey" PRIMARY KEY ("Id"), ' +
      'CONSTRAINT "' + child + '_parent_fk" FOREIGN KEY ("ParentKey") ' +
      'REFERENCES public."' + parent + '" ("Key") ON DELETE CASCADE, ' +
      'CONSTRAINT "' + child + '_parent_unique" UNIQUE ("ParentKey"), ' +
      'CONSTRAINT "' + child + '_status_check" CHECK ("Id" > 0))'
    );
    await client.query(
      'CREATE INDEX "' + child + '_amount_idx" ON public."' + child +
      '" USING btree ("Amount")'
    );
    const before = await readSourceBaselineCatalog(client);
    const fixtureConstraints = before.objects.filter((row) =>
      [parent, child].includes(row.table_name) &&
      ["primary_key", "foreign_key", "unique_constraint", "check"].includes(row.kind)
    );
    assert.ok(fixtureConstraints.length >= 5);
    for (const constraint of fixtureConstraints) {
      assert.ok(Array.isArray(constraint.columns),
        "PG18 constraint catalog keys must be decoded as text[]: " + constraint.object_name);
      assert.ok(Array.isArray(constraint.ref_columns),
        "PG18 reference columns must be decoded as text[]: " + constraint.object_name);
    }
    const source = fixtureManifest(before.objects, [parent, child]);
    const childSource = source.find((t) => t.name === child);
    assert.equal(childSource.columns.find((c) => c.name === "Amount").type, "numeric(12,2)");
    assert.ok(childSource.foreignKeys.some((fk) => fk.name === child + "_parent_fk"));
    assert.ok(childSource.uniqueConstraints.some((key) => key.name === child + "_parent_unique"));
    assert.ok(childSource.checks.some((key) => key.name === child + "_status_check"));
    assert.ok(childSource.indexes.some((idx) => idx.name === child + "_amount_idx"));
    await run({ client, parent, child, source, before });
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.end().catch(() => {});
  }
}

/** Project the initial real PG catalog into the same shape Drizzle's
 * generateSchemaManifest() emits. Subsequent ALTER/DROP commands mutate the
 * database, not the frozen source expectations.
 */
function fixtureManifest(objects, names) {
  return names.map((name) => {
    const entries = objects.filter((row) => row.table_name === name);
    const byKind = (kind) => entries.filter((row) => row.kind === kind);
    return {
      name,
      columns: byKind("column").map((row) => ({
        name: row.object_name, type: row.type, nullable: row.nullable,
        default: row.default, identity: row.identity,
      })),
      primaryKeys: byKind("primary_key").map((row) =>
        ({ name: row.object_name, columns: row.columns })),
      foreignKeys: byKind("foreign_key").map((row) => ({
        name: row.object_name, columns: row.columns, refTable: row.ref_table,
        refColumns: row.ref_columns, onDelete: row.on_delete, onUpdate: row.on_update,
      })),
      uniqueConstraints: byKind("unique_constraint").map((row) => ({
        name: row.object_name, columns: row.columns,
        nullsNotDistinct: row.nulls_not_distinct,
      })),
      checks: byKind("check").map((row) =>
        ({ name: row.object_name, expression: row.expression })),
      indexes: byKind("index").map((row) => ({
        name: row.object_name, unique: row.unique, method: row.method,
        keys: row.keys, predicate: row.predicate,
      })),
    };
  });
}

function expectDrift(source, objects) {
  let failure;
  try { assertSourceBaselineConstraintParity(source, objects); }
  catch (error) { failure = error; }
  assert.ok(failure instanceof Error, "changed physical PG18 DDL must fail");
  assert.match(failure.message, /^SOURCE_BASELINE_CONSTRAINT_DRIFT /);
  return JSON.parse(failure.message.slice("SOURCE_BASELINE_CONSTRAINT_DRIFT ".length));
}

test("real disposable PG18: clean source presence, types, keys, checks and index definitions pass",
  { skip: !disposableCI }, async () => withFixture("clean", async ({ source, before }) => {
    const present = assertSourceBaselineParity(source, before.columns);
    const structure = assertSourceBaselineConstraintParity(source, before.objects);
    assert.equal(present.sourceTables, 2);
    assert.equal(structure.sourceTables, 2);
    assert.ok(structure.sourceConstraints >= 5);
    assert.ok(structure.sourceIndexes >= 1);
    assert.equal(structure.productionCertified, false);
  }));

test("real disposable PG18: ALTER COLUMN type is detected",
  { skip: !disposableCI }, async () => withFixture("type", async ({ client, child, source }) => {
    await client.query('ALTER TABLE public."' + child +
      '" ALTER COLUMN "Amount" TYPE bigint USING "Amount"::bigint');
    const report = expectDrift(source, (await readSourceBaselineCatalog(client)).objects);
    assert.deepEqual(report.driftedColumns.map((x) => [x.table, x.name]), [[child, "Amount"]]);
    assert.equal(report.driftedColumns[0].expected.type, "numeric(12,2)");
    assert.equal(report.driftedColumns[0].actual.type, "bigint");
  }));

test("real disposable PG18: dropping a CHECK constraint is detected",
  { skip: !disposableCI }, async () => withFixture("check", async ({ client, child, source }) => {
    await client.query('ALTER TABLE public."' + child +
      '" DROP CONSTRAINT "' + child + '_status_check"');
    const report = expectDrift(source, (await readSourceBaselineCatalog(client)).objects);
    assert.deepEqual(report.missingChecks, [{ table: child, name: child + "_status_check" }]);
  }));

test("real disposable PG18: dropping a foreign key is detected",
  { skip: !disposableCI }, async () => withFixture("fk", async ({ client, child, source }) => {
    await client.query('ALTER TABLE public."' + child +
      '" DROP CONSTRAINT "' + child + '_parent_fk"');
    const report = expectDrift(source, (await readSourceBaselineCatalog(client)).objects);
    assert.deepEqual(report.missingForeignKeys, [{ table: child, name: child + "_parent_fk" }]);
  }));

test("real disposable PG18: dropping a unique constraint is detected",
  { skip: !disposableCI }, async () => withFixture("unique", async ({ client, child, source }) => {
    await client.query('ALTER TABLE public."' + child +
      '" DROP CONSTRAINT "' + child + '_parent_unique"');
    const report = expectDrift(source, (await readSourceBaselineCatalog(client)).objects);
    assert.deepEqual(report.missingUniqueConstraints,
      [{ table: child, name: child + "_parent_unique" }]);
  }));

test("real disposable PG18: dropping a declared index is detected",
  { skip: !disposableCI }, async () => withFixture("index", async ({ client, child, source }) => {
    await client.query('DROP INDEX public."' + child + '_amount_idx"');
    const report = expectDrift(source, (await readSourceBaselineCatalog(client)).objects);
    assert.deepEqual(report.missingIndexes, [{ table: child, name: child + "_amount_idx" }]);
  }));

test("real disposable PG18: changing an index definition is detected",
  { skip: !disposableCI }, async () => withFixture("idxdef", async ({ client, child, source }) => {
    await client.query('DROP INDEX public."' + child + '_amount_idx"');
    await client.query('CREATE INDEX "' + child + '_amount_idx" ON public."' +
      child + '" USING btree ("Id")');
    const report = expectDrift(source, (await readSourceBaselineCatalog(client)).objects);
    assert.deepEqual(report.driftedIndexes.map((x) => x.name), [child + "_amount_idx"]);
  }));

test("real disposable PG18: a changed index INCLUDE definition is detected",
  { skip: !disposableCI }, async () => withFixture("include", async ({ client, child, source }) => {
    await client.query('DROP INDEX public."' + child + '_amount_idx"');
    await client.query('CREATE INDEX "' + child + '_amount_idx" ON public."' +
      child + '" USING btree ("Amount") INCLUDE ("Status")');
    const report = expectDrift(source, (await readSourceBaselineCatalog(client)).objects);
    assert.deepEqual(report.driftedIndexes.map((x) => x.name), [child + "_amount_idx"]);
  }));

test("real disposable PG18: index storage-option drift is detected",
  { skip: !disposableCI }, async () => withFixture("options", async ({ client, child, source }) => {
    await client.query('ALTER INDEX public."' + child + '_amount_idx" SET (fillfactor = 80)');
    const report = expectDrift(source, (await readSourceBaselineCatalog(client)).objects);
    assert.deepEqual(report.driftedIndexes.map((x) => x.name), [child + "_amount_idx"]);
  }));

test("real disposable PG18: a DESC index with different NULLS order is drift",
  { skip: !disposableCI }, async () => withFixture("desc", async ({ client, child, source, before }) => {
    const beforeIndex = before.objects.find((x) =>
      x.kind === "index" && x.object_name === child + "_amount_idx");
    assert.deepEqual(beforeIndex.key_desc, [false]);
    assert.deepEqual(beforeIndex.key_nulls_first, [false]);
    await client.query('DROP INDEX public."' + child + '_amount_idx"');
    await client.query('CREATE INDEX "' + child + '_amount_idx" ON public."' +
      child + '" USING btree ("Amount" DESC NULLS FIRST)');
    const changed = (await readSourceBaselineCatalog(client)).objects;
    const actualIndex = changed.find((x) =>
      x.kind === "index" && x.object_name === child + "_amount_idx");
    assert.deepEqual(actualIndex.key_desc, [true]);
    assert.deepEqual(actualIndex.key_nulls_first, [true]);
    const report = expectDrift(source, changed);
    assert.deepEqual(report.driftedIndexes.map((x) => x.name), [child + "_amount_idx"]);
  }));

test("real disposable PG18: Drizzle-qualified CHECK SQL matches deparsed catalog",
  { skip: !disposableCI }, async () => withFixture("qualified", async ({ child, source, before }) => {
    const check = source.find((table) => table.name === child)
      .checks.find((x) => x.name === child + "_status_check");
    check.expression = '"' + child + '"."Id" > 0';
    assert.equal(assertSourceBaselineConstraintParity(source, before.objects).driftedChecks.length, 0);
  }));

test("real disposable PG18: default and nullability changes are detected",
  { skip: !disposableCI }, async () => withFixture("defaults", async ({ client, child, source }) => {
    await client.query('ALTER TABLE public."' + child +
      '" ALTER COLUMN "Status" SET DEFAULT ' + "'changed'::text");
    await client.query('ALTER TABLE public."' + child +
      '" ALTER COLUMN "Status" DROP NOT NULL');
    const report = expectDrift(source, (await readSourceBaselineCatalog(client)).objects);
    assert.deepEqual(report.driftedColumns.map((x) => x.name), ["Status"]);
    assert.equal(report.driftedColumns[0].expected.nullable, false);
    assert.equal(report.driftedColumns[0].actual.nullable, true);
    assert.notEqual(report.driftedColumns[0].expected.default,
      report.driftedColumns[0].actual.default);
  }));


test("real disposable PG18: extra migration-only columns, constraints and indexes stay informational",
  { skip: !disposableCI }, async () => withFixture("unmodeled", async ({ client, child, source }) => {
    // Extend only the throwaway catalog: never mutate the frozen Drizzle/source
    // expectation. This is the existing presence ratchet's unmodeledColumns policy.
    await client.query('ALTER TABLE public."' + child +
      '" ADD COLUMN "SupplementOnly" boolean NOT NULL DEFAULT true');
    await client.query('ALTER TABLE public."' + child +
      '" ADD CONSTRAINT "' + child + '_supplement_check" CHECK ("SupplementOnly" OR "Id" > 0)');
    await client.query('ALTER TABLE public."' + child +
      '" ADD CONSTRAINT "' + child + '_supplement_unique" UNIQUE ("SupplementOnly", "Id")');
    await client.query('CREATE INDEX "' + child + '_supplement_idx" ON public."' +
      child + '" USING btree ("SupplementOnly")');

    const after = await readSourceBaselineCatalog(client);
    const presence = assertSourceBaselineParity(source, after.columns);
    const structure = assertSourceBaselineConstraintParity(source, after.objects);
    assert.deepEqual(presence.unmodeledColumns, [child + ".SupplementOnly"]);
    assert.deepEqual(structure.unmodeledColumns, [{ table: child, name: "SupplementOnly" }]);
    assert.deepEqual(structure.unmodeledChecks,
      [{ table: child, name: child + "_supplement_check" }]);
    assert.deepEqual(structure.unmodeledUniqueConstraints,
      [{ table: child, name: child + "_supplement_unique" }]);
    assert.deepEqual(structure.unmodeledIndexes,
      [{ table: child, name: child + "_supplement_idx" }]);
    // The UNIQUE backing index must not be counted twice as an independent index.
    assert.equal(structure.unmodeledIndexes.length, 1);
    for (const field of [
      "missingTables", "missingColumns", "driftedColumns",
      "missingPrimaryKeys", "driftedPrimaryKeys",
      "missingForeignKeys", "driftedForeignKeys",
      "missingUniqueConstraints", "driftedUniqueConstraints",
      "missingChecks", "driftedChecks",
      "missingIndexes", "driftedIndexes",
    ]) {
      assert.deepEqual(structure[field], [], field + ": source declarations remain intact");
    }
    assert.equal(structure.productionCertified, false);
    assert.match(structure.scope, /disposable PG18/);
    assert.match(structure.scope, /not applied migration, receipt, production, or Neon certification/);
  }));

test("real disposable PG18: unmodeled replacements cannot conceal missing modeled check or index",
  { skip: !disposableCI }, async () => withFixture("extrasmask", async ({ client, child, source }) => {
    await client.query('ALTER TABLE public."' + child +
      '" DROP CONSTRAINT "' + child + '_status_check"');
    await client.query('ALTER TABLE public."' + child +
      '" ADD CONSTRAINT "' + child + '_replacement_check" CHECK ("Id" > 0)');
    await client.query('DROP INDEX public."' + child + '_amount_idx"');
    await client.query('CREATE INDEX "' + child + '_replacement_idx" ON public."' +
      child + '" USING btree ("Amount")');

    // The replacement objects intentionally have IDENTICAL definitions with
    // DIFFERENT physical names. They cannot mask missing source-named objects.
    const report = expectDrift(source, (await readSourceBaselineCatalog(client)).objects);
    assert.deepEqual(report.missingChecks,
      [{ table: child, name: child + "_status_check" }]);
    assert.deepEqual(report.unmodeledChecks,
      [{ table: child, name: child + "_replacement_check" }]);
    assert.deepEqual(report.missingIndexes,
      [{ table: child, name: child + "_amount_idx" }]);
    assert.deepEqual(report.unmodeledIndexes,
      [{ table: child, name: child + "_replacement_idx" }]);
  }));
