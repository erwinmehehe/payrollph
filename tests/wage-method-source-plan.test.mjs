import assert from "node:assert/strict";
import test from "node:test";
import { comparePlannedSources } from "../scripts/qa/wage-method-source-plan.mjs";

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
