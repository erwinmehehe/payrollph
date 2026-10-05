import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/compliance/statutory-remittances/route.ts", "utf8");
const overview = readFileSync("src/components/workspace/role-overview-v2.tsx", "utf8");
const watch = readFileSync("src/components/workspace/statutory-remittance-watch.tsx", "utf8");

test("remittance API returns deadline-aware alert data", () => {
  assert.ok(route.includes("buildStatutoryRemittanceAlerts"));
  assert.ok(route.includes("coverageGaps"));
  assert.ok(route.includes("nominalRemittanceDueDate"));
  assert.ok(route.includes("alerts,"));
  assert.ok(route.includes("today,"));
});

test("owner and payroll dashboards both surface statutory remittance watch", () => {
  const matches = overview.match(/<StatutoryRemittanceWatch/g) ?? [];
  assert.equal(matches.length, 2);
  assert.ok(overview.includes('onOpen={() => onPage("Payroll")}'));
});

test("dashboard watch never silently treats an API failure as compliant", () => {
  assert.ok(watch.includes("Statutory remittance status could not be checked"));
  assert.ok(watch.includes("Compliance status unavailable"));
  assert.ok(watch.includes("Statutory remittances need attention"));
  assert.ok(watch.includes("Statutory remittances are on track"));
});
