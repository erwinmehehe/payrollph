import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Client } from "pg";
import { generateSchemaManifest } from "../scripts/lib/issue-1031-schema-manifest";
import { fullSchemaCatalogSql } from "../scripts/check-issue-1031-full-schema-diff";
import { diffSchema, type CatalogRow, type SchemaManifest } from "../src/lib/issue-1031-full-schema-diff";
import { CANDIDATE_GROUPS, NEW_FOUR, EXISTING_NINETEEN } from
  "../scripts/lib/issue-1031-review-only-candidate-inventory.mjs";

// Intentionally no Neon, production, authenticated staging or developer laptop path.
// GitHub CI first pushes src/db/schema.ts to an empty disposable PG16/18 fixture.
// Each exact reviewed SQL candidate is then rehearsed under ROLLBACK only.
const enabled = process.env.ISSUE1031_CANDIDATE_PARITY === "isolated-ci-only"
  && process.env.CI === "true" && process.env.GITHUB_ACTIONS === "true";
const targets = new Set<string>([...NEW_FOUR, ...EXISTING_NINETEEN]);

function assertSafeDatabase(): string {
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(url.protocol, "postgresql:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "5432");
  assert.equal(url.pathname, "/app_db");
  assert.equal(url.username, "postgres");
  assert.equal(url.password, "postgres");
  assert.equal(url.search, "");
  assert.equal(url.hash, "");
  for (const key of ["PRODUCTION_DATABASE_URL", "NEON_DATABASE_URL",
    "MIGRATION_TARGET_DATABASE_URL", "PAYMONGO_SECRET_KEY",
    "XENDIT_SECRET_KEY", "XENDIT_PAYOUT_SECRET_KEY"]) {
    assert.equal(process.env[key] || "", "", "prohibited connection/provider " + key);
  }
  for (const key of ["PAYMONGO_DISBURSEMENTS_ENABLED", "XENDIT_PAYOUTS_ENABLED",
    "XENDIT_PAYOUTS_LIVE_APPROVED", "FINAL_PAY_MANUAL_RELEASE_ENABLED"]) {
    assert.equal(process.env[key], "false", "disabled money-movement flag required: " + key);
  }
  return url.toString();
}
const readSource = (path: string) => readFileSync(path, "utf8");
function rehearsalSql(path: string): string {
  const source = readSource(path);
  // Some pre-existing proposals include their own top-level BEGIN/COMMIT.
  // Remove ONLY those standalone wrappers to enforce a single ROLLBACK-only
  // rehearsal. Every SQL DDL and DO body is otherwise unchanged.
  const opens = (source.match(/^BEGIN;\s*$/gm) ?? []).length;
  const closes = (source.match(/^COMMIT;\s*$/gm) ?? []).length;
  assert.equal(opens, closes, path + " has an unsafe transaction wrapper");
  assert.ok(opens <= 1, path + " has multiple top-level transactions");
  return source.replace(/^BEGIN;\s*$/gm, "").replace(/^COMMIT;\s*$/gm, "");
}
function quoteTable(table: string) {
  assert.match(table, /^[a-z][a-z0-9_]*$/);
  return 'public."' + table + '"';
}
function dropOrder(names: readonly string[], manifest: SchemaManifest): string[] {
  const byName = new Map(manifest.tables.map(t => [t.name, t]));
  const pending = new Set(names);
  const result: string[] = [];
  while (pending.size) {
    const leaves = [...pending].filter(name => ![...pending].some(other =>
      other !== name && byName.get(other)?.foreignKeys.some(fk => fk.refTable === name)));
    assert.ok(leaves.length, "candidate has a circular internal FK dependency");
    result.push(...leaves);
    for (const name of leaves) pending.delete(name);
  }
  return result;
}
function meaningfulDrift(manifest: SchemaManifest, rows: CatalogRow[]): string[] {
  return diffSchema(manifest, rows).filter(row => row.status !== "PASS")
    .map(row => [row.table, row.kind, row.object, row.status,
      JSON.stringify(row.expected), JSON.stringify(row.actual)].join(" | "));
}

test("#1031 review candidates: exact fresh-push PostgreSQL catalog parity (19 legacy + four new)", {
  skip: !enabled, timeout: 270000,
}, async t => {
  const url = assertSafeDatabase();
  const manifest = generateSchemaManifest(); // TypeScript AST + Drizzle runtime metadata.
  const byName = new Map(manifest.tables.map(x => [x.name, x]));
  for (const name of targets) assert.ok(byName.has(name), name + " absent from schema.ts");
  assert.equal(targets.size, 23);
  const subset = (names: readonly string[]) => ({
    ...manifest, tables: names.map(name => {
      const table = byName.get(name);
      assert.ok(table, "missing current table " + name);
      return table;
    }),
  });
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 5000,
    query_timeout: 180000 });
  await client.connect();
  try {
    const identity = (await client.query(`SELECT current_database() AS db, current_user AS actor,
      current_setting('server_version_num')::integer AS version,
      (SELECT count(*)::integer FROM pg_catalog.pg_tables WHERE schemaname='public') AS tables`)).rows[0];
    assert.equal(identity.db, "app_db");
    assert.equal(identity.actor, "postgres");
    assert.ok([16, 18].includes(Math.floor(identity.version / 10000)));
    assert.ok(identity.tables >= 270, "full fresh Drizzle push not present");
    const snapshot = async (names: readonly string[]): Promise<CatalogRow[]> => {
      const selected = new Set(names);
      const { rows } = await client.query<{
        table_name: string; kind: string; object_name: string;
        details: Record<string, unknown>;
      }>(fullSchemaCatalogSql);
      return rows.filter(row => selected.has(row.table_name)).map(row => ({
        table_name: row.table_name, kind: row.kind,
        object_name: row.object_name, ...row.details,
      } as CatalogRow));
    };
    const baseline = await snapshot([...targets]);
    // The existing manifest comparator cannot yet normalize every equivalent
    // PostgreSQL deparser form (e.g. CHECK x > 0 vs x > (0)::numeric,
    // predicate parentheses/table qualifications). Treat its fresh-push
    // differences as *baseline diagnostics*, not candidate drift.
    // Candidate acceptance below requires the complete raw pg_catalog rows
    // to be byte-for-byte equivalent to this fresh push, which detects actual
    // changes in names, types, FK actions, defaults, checks and predicates.
    const baselineDiagnostics = meaningfulDrift(subset([...targets]), baseline);
    console.log("FRESH_PUSH_MANIFEST_DEPARSE_DIAGNOSTICS=" + baselineDiagnostics.length);
    const observedTableNames = new Set(baseline.filter(row => row.kind === "table")
      .map(row => row.table_name));
    assert.deepEqual([...observedTableNames].sort(), [...targets].sort(),
      "all 23 schema.ts source tables must be present in the first push");
    console.log("FRESH_PUSH_SOURCE_CATALOG_CAPTURED=PASS; TABLES=23; POSTGRES=" +
      Math.floor(identity.version / 10000));

    for (const group of CANDIDATE_GROUPS) {
      await t.test(group.id + " exact candidate catalog compared with current schema.ts", async () => {
        const scope = new Set(group.tables);
        // Refuse CASCADE: a new external FK makes isolated drop unsafe and
        // requires a new review plan instead of silently removing constraints.
        const incoming = manifest.tables.filter(tab => !scope.has(tab.name))
          .flatMap(tab => tab.foreignKeys.filter(fk => scope.has(fk.refTable))
            .map(fk => tab.name + "." + fk.name));
        assert.deepEqual(incoming, [], group.id + " unexpected external FK dependents");
        const before = baseline.filter(row => scope.has(row.table_name));
        await client.query("BEGIN");
        try {
          await client.query("SET LOCAL statement_timeout = '120s'");
          await client.query("SET LOCAL lock_timeout = '5s'");
          for (const name of dropOrder(group.tables, manifest)) {
            await client.query("DROP TABLE " + quoteTable(name)); // disposable, rolled back
          }
          assert.deepEqual(await snapshot(group.tables), [], "targets must be wholly absent");
          if (group.kind === "new") {
            // A missing immediate parent must reject BEFORE creating child data.
            const child = group.files[1]!;
            await client.query("SAVEPOINT absent_parent");
            await assert.rejects(() => client.query(rehearsalSql(child)),
              (e: unknown) => (e as { code?: string; message?: string }).code === "P0001" &&
              (e as { message?: string }).message?.includes("_PARENT_MISSING") === true);
            await client.query("ROLLBACK TO SAVEPOINT absent_parent");
            assert.deepEqual(await snapshot(group.tables), []);
          }
          if (group.id === "spend-cards-new") {
            // Prove the comparator catches a near-identical, invalid type.
            const original = rehearsalSql(group.files[0]!);
            const changed = original.replace('"issuer" varchar(100)', '"issuer" varchar(101)');
            assert.notEqual(changed, original);
            await client.query("SAVEPOINT wrong_type");
            await client.query(changed);
            const bad = meaningfulDrift(subset(group.tables), await snapshot(group.tables));
            assert.ok(bad.some(line => line.includes("spend_cards | column | issuer | DRIFT")),
              "wrong varchar length must trigger a true database catalog drift");
            await client.query("ROLLBACK TO SAVEPOINT wrong_type");
            assert.deepEqual(await snapshot(group.tables), []);
          }
          for (const file of group.files) await client.query(rehearsalSql(file));
          const actual = await snapshot(group.tables);
          // Compare the *actual* PostgreSQL catalogs from both sides of the
          // rehearsal. This is stricter than normalizing SQL text and avoids
          // mislabeling first-push formatting differences as candidate drift.
          assert.deepEqual(actual, before,
            group.id + " candidate differs from first-push schema.ts pg_catalog");
          if (group.kind === "new") {
            for (const file of group.files) {
              await client.query("SAVEPOINT repeat_candidate");
              await assert.rejects(() => client.query(rehearsalSql(file)),
                (e: unknown) => (e as { code?: string; message?: string }).code === "P0001" &&
                (e as { message?: string }).message?.includes("_ALREADY_PRESENT_REVIEW_REQUIRED") === true);
              await client.query("ROLLBACK TO SAVEPOINT repeat_candidate");
            }
          }
          for (const file of group.files) {
            const hash = createHash("sha256").update(readSource(file)).digest("hex");
            console.log("REVIEW_ONLY_CANDIDATE_PARITY=PASS group=" + group.id +
              " file=" + file + " sha256=" + hash);
          }
        } finally {
          await client.query("ROLLBACK"); // every candidate DDL must disappear
        }
        assert.deepEqual(await snapshot(group.tables), before,
          "ROLLBACK must restore fresh-push schema for " + group.id);
      });
    }
    console.log("SOURCE_ONLY_NOT_RELEASE_APPROVAL_NO_PRODUCTION_MIGRATION");
  } finally {
    await client.end();
  }
});
