import assert from "node:assert/strict";
import test from "node:test";
import { classifyFiles, tierForPath } from "../scripts/classify-pr-risk.mjs";

test("non-executable documents remain routine unless security-sensitive", () => {
  assert.equal(classifyFiles(["README.md", "docs/marketing/launch.md"]).tier, "T0");
  assert.equal(tierForPath("docs/security/recovery.md"), "T1");
});
test("ordinary UI changes receive standard code review", () => {
  assert.equal(tierForPath("src/components/navigation.tsx"), "T1");
});
test("WFM, payroll math and AI automation receive sensitive review", () => {
  for (const path of ["src/lib/payroll-engine.ts", "src/lib/workforce-payroll.ts",
    "src/app/api/automation-studio/route.ts", "src/lib/automation-language-draft.ts"]) {
    assert.equal(tierForPath(path), "T2", path);
  }
});
test("compensation, migration and money movement require the highest tier", () => {
  for (const path of ["src/lib/hcm-compensation.ts", "src/lib/compensation-automation-outbox.ts",
    "scripts/recover-compensation-automation-intent.ts", "drizzle/0100_compensation_automation_intents.sql",
    "src/app/api/payroll-runs/[id]/release/route.ts", "src/lib/paymongo.ts"]) {
    assert.equal(tierForPath(path), "T3", path);
  }
});
test("classification is conservative on mixed PRs, unknown paths and duplicates", () => {
  assert.deepEqual(classifyFiles(["README.md", "src/lib/workforce-payroll.ts", "README.md"]), {
    tier: "T2", counts: { T0: 1, T1: 0, T2: 1, T3: 0 }, fileCount: 2,
  });
  assert.equal(classifyFiles(["src/lib/payroll-engine.ts", "drizzle/0100_x.sql"]).tier, "T3");
  assert.equal(tierForPath("../unexpected"), "T2");
  assert.equal(tierForPath("unknown.js"), "T1");
});
