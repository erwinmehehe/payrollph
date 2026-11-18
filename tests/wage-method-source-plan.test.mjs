import assert from "node:assert/strict";
import test from "node:test";
import { comparePlannedSources } from "../scripts/qa/wage-method-source-plan.mjs";
import { historicalReceiptInputs, literalJobInputs, reviewedTableInputs } from "../scripts/qa/wage-method-job-inputs.mjs";

const plan = {
  globalPins: { "src/proxy.ts": "common" },
  methods: [
    { key: "GET a", sourcePins: { "src/app/api/a/route.ts": "a", "src/lib/payroll-engine.ts": "engine" } },
    { key: "GET b", sourcePins: { "src/app/api/b/route.ts": "b" } },
  ],
};

test("route and transitive source drift select only methods whose planned pins include it", () => {
  for (const changed of ["src/app/api/a/route.ts", "src/lib/payroll-engine.ts"]) {
    assert.deepEqual(comparePlannedSources(plan, [changed, "README.md"]), {
      commonChanges: [],
      affected: [{ key: "GET a", methodChanges: [changed] }],
    });
  }
});

test("shared inputs and newly added database files select every method", () => {
  for (const changed of ["src/proxy.ts", "src/db/new-schema.ts", "drizzle/new.sql"]) {
    assert.deepEqual(comparePlannedSources(plan, [changed, changed]), {
      commonChanges: [changed],
      affected: [{ key: "GET a", methodChanges: [] }, { key: "GET b", methodChanges: [] }],
    });
  }
});

test("workflow inputs include literal SQL and package script lifecycle hooks", () => {
  const tracked = new Set(["scripts/pre.mjs", "scripts/setup.mjs", "scripts/post.mjs", "docs/sql/baseline.sql"]);
  const scripts = {
    precheck: "node ./scripts/pre.mjs",
    check: "npm run setup",
    setup: "node scripts/setup.mjs",
    postcheck: "node scripts/post.mjs",
  };
  assert.deepEqual(literalJobInputs(["npm run check", "psql -f docs/sql/baseline.sql"], scripts, tracked),
    [...tracked].sort());
});

test("nested receipts supply tracked paths without trusting old hashes or looping", () => {
  const records = {
    "receipts/a.json": { receiptFile: "receipts/b.json", sourcePins: { "src/a.ts": "old-sha" } },
    "receipts/b.json": { receiptFile: "receipts/a.json", file: "fixtures/b.json" },
  };
  const tracked = new Set([...Object.keys(records), "src/a.ts", "fixtures/b.json"]);
  const read = (file) => JSON.stringify(records[file]);
  assert.deepEqual(historicalReceiptInputs("receipts/a.json", read, tracked), [...tracked].sort());
  assert.throws(() => historicalReceiptInputs("receipts/missing.json", read, tracked), /Untracked historical receipt/);
});

test("computed catalog inputs match the full tracked directory membership", () => {
  const tracked = new Set([
    "scripts/qa/tenant-table-rows/read/example.mjs",
    "scripts/qa/tenant-table-rows/write/example.mjs",
  ]);
  const consumers = ["scripts/qa/tenant-table-catalog.mjs"];
  assert.deepEqual(reviewedTableInputs(consumers, tracked, () => ["example.mjs"]), [...tracked]);
  assert.throws(() => reviewedTableInputs(consumers, tracked, () => ["example.mjs", "extra.mjs"]),
    /must match tracked inputs/);
  assert.deepEqual(reviewedTableInputs(["src/app/api/example/route.ts"], tracked, () => {
    throw new Error("Unrelated methods should not read the catalog");
  }), []);
});
