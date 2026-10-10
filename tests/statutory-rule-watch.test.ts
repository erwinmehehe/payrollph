import assert from "node:assert/strict";
import test from "node:test";
import { KNOWN_PENDING_RULE_CHANGES, buildStatutoryRuleWatch } from "../src/lib/statutory-rule-watch";
import { WAGE_ORDERS } from "../src/lib/wage-orders";

test("every statutory family has coverage today and unrecorded verification is flagged, not assumed", () => {
  const items = buildStatutoryRuleWatch("2026-10-10");
  for (const family of ["sss", "philhealth", "pagibig", "bir-withholding"] as const) {
    const item = items.find((row) => row.family === family && row.currentVersion);
    assert.ok(item, `${family} must resolve a current pack`);
    assert.notEqual(item.status, "no-coverage");
    assert.equal(item.status, "verification-unrecorded");
  }
  assert.equal(items.find((row) => row.family === "wage-orders" && row.currentVersion)?.status, "current");
});

test("the published Region VII order surfaces before it takes effect and escalates once it is live", () => {
  const before = buildStatutoryRuleWatch("2026-10-10").find((row) => row.sourceDocument === "WO-ROVII-27");
  assert.equal(before?.status, "change-upcoming");
  assert.match(before?.detail ?? "", /in 4 days/);
  assert.equal(buildStatutoryRuleWatch("2026-10-14").find((row) => row.sourceDocument === "WO-ROVII-27")?.status, "update-overdue");
  assert.equal(buildStatutoryRuleWatch("2026-08-01").find((row) => row.sourceDocument === "WO-ROVII-27"), undefined, "outside the 30-day window");
  assert.equal(buildStatutoryRuleWatch("2026-10-14")[0].status, "update-overdue", "most severe items sort first");
});

test("wage-order verification becomes review-due after 90 days", () => {
  assert.equal(buildStatutoryRuleWatch("2027-01-05").find((row) => row.family === "wage-orders" && row.currentVersion)?.status, "review-due");
});

test("a pending change is removed once the registry carries that order", () => {
  for (const change of KNOWN_PENDING_RULE_CHANGES.filter((row) => row.family === "wage-orders")) {
    assert.ok(
      !WAGE_ORDERS.some((order) => order.wageOrder === change.reference),
      `${change.reference} is loaded in WAGE_ORDERS; delete it from KNOWN_PENDING_RULE_CHANGES`,
    );
  }
});
