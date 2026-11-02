import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/webhooks/paymongo/transfers/route.ts", "utf8");

test("a signed PayMongo callback cannot tell a nonexistent run from another tenant's run", () => {
  assert.ok(!route.includes("unknown-payroll-run"), "the unknown-run response must not differ from the unmatched-transfer response");
  const unmatched = 'reason: "unmatched-payroll-transfer"';
  assert.equal(route.split(unmatched).length - 1, 2, "unknown run and unmatched transfer share one response");
  const lookup = route.indexOf("db.select().from(payrollRuns)");
  assert.ok(lookup > 0);
  assert.ok(route.indexOf('"Invalid provider event ID."') < lookup, "event id validation must not depend on the run lookup");
});

test("the signature check and test-mode refusal still precede the run lookup", () => {
  const lookup = route.indexOf("db.select().from(payrollRuns)");
  for (const earlier of ["verifyPaymongoWebhookSignature({", "Invalid webhook signature.", "test-mode-event"]) {
    assert.ok(route.indexOf(earlier) > 0 && route.indexOf(earlier) < lookup, earlier + " must come before any database read");
  }
});
