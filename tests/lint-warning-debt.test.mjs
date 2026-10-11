import assert from "node:assert/strict";
import test from "node:test";
import { warningDebt } from "../scripts/check-lint-warning-debt.mjs";

const result = (file, rules) => ({ filePath: `/repo/${file}`, messages: rules.map(ruleId => ({ ruleId, severity: 1 })) });
const baseline = { "src/existing.tsx": { "react-hooks/exhaustive-deps": 1 } };

test("existing warning debt is bounded per file and rule", () => {
  assert.deepEqual(warningDebt([result("src/existing.tsx", ["react-hooks/exhaustive-deps"])], baseline, "/repo"), []);
  assert.equal(warningDebt([result("src/existing.tsx", ["react-hooks/exhaustive-deps", "react-hooks/exhaustive-deps"])], baseline, "/repo").length, 1);
});
test("moving a warning or swapping its rule cannot reuse another allowance", () => {
  assert.equal(warningDebt([result("src/new.tsx", ["react-hooks/exhaustive-deps"])], baseline, "/repo").length, 1);
  assert.equal(warningDebt([result("src/existing.tsx", ["other-rule"])], baseline, "/repo").length, 1);
});
test("removing a warning passes without changing lint rule configuration", () => {
  assert.deepEqual(warningDebt([result("src/existing.tsx", [])], baseline, "/repo"), []);
});
