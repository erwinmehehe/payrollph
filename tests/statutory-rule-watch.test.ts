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

test("loaded Region VII ROVII-27 is scheduled before effectivity, never falsely overdue afterward", () => {
  const before = buildStatutoryRuleWatch("2026-10-10").find((row) => row.sourceDocument === "WO-ROVII-27");
  assert.equal(before?.status, "change-upcoming");
  assert.match(before?.detail ?? "", /in 4 days/);
  assert.match(before?.detail ?? "", /verified and loaded/);
  assert.match(before?.detail ?? "", /Class A: ₱582\/day; Class B: ₱542\/day/);
  assert.equal(buildStatutoryRuleWatch("2026-10-14").find((row) => row.sourceDocument === "WO-ROVII-27"), undefined,
    "on effective day the installed rule is active, not overdue");
  assert.equal(buildStatutoryRuleWatch("2026-08-01").find((row) => row.sourceDocument === "WO-ROVII-27"), undefined,
    "only show the scheduled reminder inside the 30-day window");
  assert.ok(!buildStatutoryRuleWatch("2026-10-15").some((row) => row.status === "update-overdue" && row.sourceDocument === "WO-ROVII-27"));
});

test("wage-order verification becomes review-due after 90 days", () => {
  assert.equal(buildStatutoryRuleWatch("2027-01-15").find((row) => row.family === "wage-orders" && row.currentVersion)?.status, "review-due");
});

test("loaded ROVII-27 no longer appears among missing statutory rule changes", () => {
  assert.ok(!KNOWN_PENDING_RULE_CHANGES.some((change) => change.reference === "WO-ROVII-27"));
  assert.equal(WAGE_ORDERS.length, 17, "current regional baseline remains intact");
  assert.equal(buildStatutoryRuleWatch("2026-10-10").find((row) => row.sourceDocument === "WO-ROVII-27")?.currentVersion,
    "scheduled WO-ROVII-27");
});
