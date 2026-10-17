import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CANDIDATE_GROUPS, NEW_FOUR, EXISTING_NINETEEN } from "../scripts/lib/issue-1031-review-only-candidate-inventory.mjs";

const source = path => readFileSync(path, "utf8");
const tableCreates = sql => [...sql.replace(/^--.*$/gm, "").matchAll(
  /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?([a-z][a-z0-9_]*)"?/gi,
)].map(m => m[1]);

test("#1031 table source inventory has precisely 19 existing and four missing candidate creators", () => {
  assert.equal(new Set(EXISTING_NINETEEN).size, 19);
  assert.equal(new Set(NEW_FOUR).size, 4);
  assert.deepEqual(EXISTING_NINETEEN.filter(n => NEW_FOUR.includes(n)), []);
  assert.equal(new Set(CANDIDATE_GROUPS.map(x => x.id)).size, CANDIDATE_GROUPS.length);
  for (const kind of ["existing", "new"]) {
    const expected = kind === "existing" ? EXISTING_NINETEEN : NEW_FOUR;
    const actual = [...new Set(CANDIDATE_GROUPS.filter(x => x.kind === kind).flatMap(x => x.tables))].sort();
    assert.deepEqual(actual, [...expected].sort(), kind + " candidate table coverage drift");
  }
  const crosswalk = source("docs/engineering/issue-1031-source-table-crosswalk.csv");
  const withoutNumberedCreator = new Set([...crosswalk.matchAll(
    /^"([^"]+)","","(?:[^"]*)"/gm,
  )].map(m => m[1]));
  for (const table of [...EXISTING_NINETEEN, ...NEW_FOUR]) {
    assert.ok(withoutNumberedCreator.has(table), table + " has a new numbered creating source; reconcile before preserving review candidate");
  }
});

test("each mapped review-only source actually declares each covered table", () => {
  for (const group of CANDIDATE_GROUPS) {
    assert.ok(group.files.length && group.tables.length);
    const detected = [];
    for (const path of group.files) {
      assert.match(path, /^docs\//);
      const sql = source(path);
      detected.push(...tableCreates(sql));
    }
    assert.deepEqual([...new Set(detected)].sort(), [...group.tables].sort(),
      group.id + " candidate CREATE TABLE inventory drift");
  }
});

for (const name of NEW_FOUR) {
  const path = `docs/sql/issue-1031-${name.replaceAll("_", "-")}-additive-candidate.sql`;
  test(name + ": unnumbered single-DO additive source with fail-closed parent/target guards", () => {
    const sql = source(path);
    assert.match(sql, /REVIEW-ONLY, UNNUMBERED ADDITIVE SOURCE CANDIDATE/);
    assert.match(sql, /NOT a migration, execution receipt/);
    assert.match(sql, /protected PLAN\/APPLY/);
    assert.deepEqual(tableCreates(sql), [name]);
    assert.equal((sql.match(/^DO \$/gm) ?? []).length, 1, "one atomic DO block");
    assert.match(sql, new RegExp(name.toUpperCase() + "_PARENT_MISSING"));
    assert.match(sql, new RegExp(name.toUpperCase() + "_ALREADY_PRESENT_REVIEW_REQUIRED"));
    assert.match(sql, new RegExp(name.toUpperCase() + "_POSTFLIGHT_CATALOG_MISMATCH"));
    const withoutComments = sql.replace(/^--.*$/gm, "")
      .replace(/ON DELETE\s+(?:cascade|restrict|set null|no action)/gi, "");
    assert.doesNotMatch(withoutComments, /\b(?:DROP|DELETE|TRUNCATE|INSERT|UPDATE)\b/i);
    assert.doesNotMatch(withoutComments, /\bIF\s+NOT\s+EXISTS\b/i,
      "existing objects must fail closed, never silently skip DDL");
    assert.match(sql, /pg_catalog\.pg_constraint/);
    assert.match(sql, /pg_catalog\.pg_indexes/);
  });
}
