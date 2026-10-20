import assert from "node:assert/strict";
import test from "node:test";
import { verifiedExitPayrollTrace } from "../src/lib/approved-exit-payroll";

test("final-pay crossing evidence binds one exact engine version, separation and end date", () => {
  const inputs = ["approvedExitProration=v1", "employmentEnd=2026-10-09", "approvedSeparationId=42"];
  assert.equal(verifiedExitPayrollTrace({ inputs }, "2026-10-09", 42), true);
  assert.equal(verifiedExitPayrollTrace({ inputs }, "2026-10-10", 42), false);
  assert.equal(verifiedExitPayrollTrace({ inputs }, "2026-10-09", 43), false);
  for (const invalid of [null, {}, { inputs: [] }, { inputs: inputs.slice(1) },
    { inputs: [...inputs, inputs[0]] }, { inputs: [...inputs, "employmentEnd=2026-10-15"] },
    { inputs: [...inputs, "approvedSeparationId=43"] }, { inputs: [...inputs, "approvedExitProration=v2"] }]) {
    assert.equal(verifiedExitPayrollTrace(invalid, "2026-10-09", 42), false);
  }
  assert.equal(verifiedExitPayrollTrace({ inputs }, "2026-10-09", -42), false);
});
