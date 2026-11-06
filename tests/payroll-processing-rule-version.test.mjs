import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("processing audit records calculated payroll rule version, not a stale constant", () => {
  const source = readFileSync(
    "src/app/api/payroll-runs/[id]/process/route.ts", "utf8",
  );
  assert.match(source, /ruleVersion:\s*fresh\?\.ruleVersion\s*\?\?\s*run\.ruleVersion/);
  assert.doesNotMatch(source, /ruleVersion:\s*["']PH-2026\.01["']/);
});
