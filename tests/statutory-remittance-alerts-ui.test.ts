import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/compliance/statutory-remittances/route.ts", "utf8");
const state = readFileSync("src/lib/statutory-remittance-state.ts", "utf8");
const overview = readFileSync("src/components/workspace/role-overview-v2.tsx", "utf8");
const watch = readFileSync("src/components/workspace/statutory-remittance-watch.tsx", "utf8");

test("remittance API returns deadline-aware alert data", () => {
  assert.ok(route.includes("loadStatutoryRemittanceState"));
  assert.ok(state.includes("buildStatutoryRemittanceAlerts"));
  assert.ok(state.includes("coverageGaps"));
  assert.ok(state.includes("effectiveRemittanceDueDate"));
  assert.ok(route.includes("alerts: state.alerts"));
  assert.ok(route.includes("today: state.today"));
});

test("payroll dashboard surfaces remittance watch while owner Home stays payroll-first", () => {
  const matches = overview.match(/<StatutoryRemittanceWatch/g) ?? [];
  assert.equal(matches.length, 1);
  assert.ok(overview.includes('onOpen={() => onPage("Payroll")}'));
});

test("dashboard watch never silently treats an API failure as compliant", () => {
  assert.ok(watch.includes("Remittance status could not be checked"));
  assert.ok(watch.includes("Compliance status unavailable"));
  assert.ok(watch.includes("Statutory remittances need attention"));
  assert.ok(watch.includes("Statutory remittances are on track"));
  assert.ok(watch.includes("data-statutory-remittance-watch"));
  assert.ok(!watch.includes("DashboardAlertBanner"));
  assert.ok(!watch.includes('className="dashboard-alert-banner"'));
});


test("remittance watch stays off owner Home and secondary to the payroll workflow banner", () => {
  const ownerStart = overview.indexOf("function OwnerWorkspace");
  const payrollStart = overview.indexOf("function PayrollWorkspace");
  const checkerStart = overview.indexOf("function CheckerWorkspace");

  const ownerBlock = overview.slice(ownerStart, payrollStart);
  const payrollBlock = overview.slice(payrollStart, checkerStart);

  assert.ok(ownerBlock.includes("mockup-owner-release dashboard-alert-banner"));
  assert.equal(ownerBlock.includes("<StatutoryRemittanceWatch"), false);
  assert.ok(payrollBlock.indexOf("mockup-progress-block dashboard-alert-banner") < payrollBlock.indexOf("<StatutoryRemittanceWatch"));
});
