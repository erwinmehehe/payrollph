import test from "node:test";
import assert from "node:assert/strict";
import { SOURCE_EVIDENCE_TAG, sqlTokens, structuralStatements } from "../scripts/lib/issue-1031-ddl-shape-parser.mjs";

test("source shape parser is tagged catalog-only and has no database side effects", () => {
  assert.equal(SOURCE_EVIDENCE_TAG, "CATALOG_ONLY_NOT_MIGRATION_RECEIPT_OR_RELEASE_APPROVAL");
  assert.equal(typeof structuralStatements, "function");
});
test("parses column types/default/nullability and inline FK actions, keys and CHECK", () => {
  const sql = [
    "/* nested /* comment */ ok */",
    "CREATE TABLE IF NOT EXISTS \"ledger\" (",
    "  \"id\" serial PRIMARY KEY NOT NULL,",
    "  \"organization_id\" integer NOT NULL REFERENCES \"organizations\"(\"id\") ON DELETE CASCADE,",
    "  \"status\" varchar(24) NOT NULL DEFAULT 'pending',",
    "  \"amount\" numeric(12, 2) NOT NULL DEFAULT '0',",
    "  \"created_at\" timestamptz NOT NULL DEFAULT now(),",
    "  CONSTRAINT ledger_amount_check CHECK (\"amount\" >= 0)",
    ");",
  ].join("\n");
  const entries = structuralStatements(sql);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, "table");
  const table = entries[0].value;
  assert.equal(table.table, "ledger");
  assert.equal(table.columns.length, 5);
  assert.deepEqual(table.primary, [["id"]]);
  assert.equal(table.columns[0].type, "serial");
  assert.equal(table.columns[0].default, "__serial__");
  assert.equal(table.columns[1].nullable, false);
  assert.equal(table.columns[2].default, "'pending'");
  assert.equal(table.columns[3].type, "numeric(12,2)");
  assert.equal(table.columns[4].type, "timestamp with time zone");
  assert.equal(table.columns[4].default, "now()");
  assert.deepEqual(table.foreignKeys, [{
    columns: ["organization_id"], refTable: "organizations", refColumns: ["id"],
    onDelete: "cascade", onUpdate: "no action",
  }]);
  assert.equal(table.checks.length, 1);
  assert.deepEqual(table.checkNames, ["ledger_amount_check"]);
});
test("parses descending ordered and unique partial indexes without suppressing predicates", () => {
  const sql = "CREATE UNIQUE INDEX IF NOT EXISTS \"ledger_idx\" ON \"ledger\" (\"organization_id\", \"created_at\" DESC) WHERE \"status\" IN ('pending','posted');";
  const [stmt] = structuralStatements(sql);
  assert.equal(stmt.kind, "index");
  assert.equal(stmt.value.table, "ledger");
  assert.equal(stmt.value.index.unique, true);
  assert.equal(stmt.value.index.method, "btree");
  assert.deepEqual(stmt.value.index.keys, ['"organization_id"', '"created_at" desc']);
  assert.match(stmt.value.index.predicate, /pending/);
  assert.match(stmt.value.index.predicate, /posted/);
});
test("preserves unsupported ALTER and procedural SQL instead of certifying final state", () => {
  const sql = "ALTER TABLE foo ADD COLUMN a integer; DO $$ BEGIN EXECUTE 'ALTER TABLE foo DROP COLUMN a'; END $$;";
  const out = structuralStatements(sql);
  assert.deepEqual(out.map(x => x.kind), ["alter", "procedural"]);
  assert.equal(out[0].table, "foo");
  assert.match(out[1].raw, /alter table foo/i);
});
test("marks unparseable DDL and refuses unmatched dollar bodies", () => {
  const entries = structuralStatements("CREATE TABLE foo (id integer GENERATED ALWAYS AS IDENTITY);");
  assert.equal(entries[0].kind, "unparseable");
  assert.match(entries[0].reason, /UNSUPPORTED_COLUMN_GENERATION/);
  assert.throws(() => structuralStatements("DO $$ BEGIN SELECT 1; END $;"), /UNTERMINATED_DOLLAR_BODY/);
});
test("SQL tokens do not split semicolons within escaped quoted literals", () => {
  const pieces = structuralStatements("CREATE TABLE t (id text DEFAULT 'a;b''c'); CREATE INDEX t_idx ON t (id);");
  assert.equal(pieces.length, 2);
  assert.equal(pieces[0].kind, "table");
  assert.equal(pieces[0].value.columns[0].default, "'a;b''c'");
  assert.equal(pieces[1].kind, "index");
});


test("tracks index DDL that changes the final table shape without table names", () => {
  const changes = structuralStatements(
    "DROP INDEX IF EXISTS ledger_created_idx; ALTER INDEX ledger_other_idx RENAME TO ledger_new_idx;"
  );
  assert.deepEqual(changes.map(x => [x.kind, x.index]), [
    ["drop_index","ledger_created_idx"], ["alter_index","ledger_other_idx"],
  ]);
});

test("unvalidated and deferrable FKs never certify static parity", () => {
  for(const suffix of [
    "NOT VALID","DEFERRABLE INITIALLY DEFERRED",
    "MATCH FULL","ON DELETE CASCADE NOT VALID",
  ]){
    const out=structuralStatements(
      "CREATE TABLE child (parent_id integer REFERENCES parents(id) "+suffix+");");
    assert.equal(out[0].kind,"unparseable",suffix);
    assert.match(out[0].reason,/UNSUPPORTED_FK_MODIFIER/,suffix);
  }
});

test("unnamed inline CHECK does not become a fabricated constraint name", () => {
  const stmts=structuralStatements(
    "CREATE TABLE t (id integer CHECK (id > 0), CONSTRAINT t_id_check2 CHECK (id < 10));");
  assert.equal(stmts[0].kind,"table");
  assert.deepEqual(stmts[0].value.checkNames,[null,"t_id_check2"]);
});
