import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Golden Phase 25 reproduces, in scripts/golden-payroll-phase25.ts, how the Separation API derives its year-to-date gross. This test
// pins the two source expressions that reproduction depends on. If it fails, the route changed: re-run Phase 25 against the new
// derivation and update certification/golden-payroll-phase25.json (and delete this pin once final pay exempts what the cutoff exempted).
const route = readFileSync("src/app/api/separation/route.ts", "utf8");

test("the Separation API still derives ordinary gross as gross pay minus 13th month paid, with no exempt-earnings term", () => {
  assert.ok(route.includes("ordinaryGrossYtd += Math.max(0, Number(row.grossPay) - parsed.thirteenthPaid);"),
    "released-row gross derivation changed: update Golden Phase 25");
  assert.ok(route.includes("ordinaryGrossYtd += Math.max(0, Number(row.grossPay) - Number(row.thirteenthMonth));"),
    "historical-row gross derivation changed: update Golden Phase 25");
  const passes = route.match(/grossCompensationYtd:\s*sources\.totals\.ordinaryGrossYtd/g) ?? [];
  assert.equal(passes.length, 1, "final pay no longer takes grossCompensationYtd from ordinaryGrossYtd: update Golden Phase 25");
});

test("final pay still receives no exempt-earnings input from the route", () => {
  const call = route.slice(route.indexOf("computeFinalPay({"), route.indexOf("const dueDate = finalPayDueDate"));
  assert.ok(call.length > 100);
  assert.doesNotMatch(call, /otherNonTaxable|nonTaxableEarning|exemptEarnings/i,
    "the route now passes an exempt-earnings input to computeFinalPay: Golden Phase 25's discrepancy may be fixed; re-run and update it");
});
