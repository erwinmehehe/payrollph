import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const api = readFileSync("src/app/api/self/payslips/route.ts", "utf8");
const home = readFileSync("src/components/employee-home-dashboard.tsx", "utf8");
const portal = readFileSync("src/components/self-service-portal.tsx", "utf8");
const language = readFileSync("src/lib/ess-language.ts", "utf8");

test("ESS payslip response is released-run evidence, not verified disbursement", () => {
  assert.match(api, /const released = rows\.filter\(\(row\) => row\.run\.status === "Released"\)/);
  assert.match(api, /payslips: released\.map/);
  assert.match(api, /payDate: row\.run\.payDate/);
});

test("ESS Home never claims money was paid merely because a payslip was released", () => {
  assert.match(home, /t\("Payslip released · Scheduled pay date"\)/);
  assert.match(home, /t\("Scheduled pay date"\)/);
  assert.doesNotMatch(home, /t\("Payslip available · Net pay · Paid"\)/);
  assert.doesNotMatch(home, /t\("Paid"\)/);
  assert.match(home, /dashboardDate\(latest\.payDate\)/);
  assert.match(home, /dashboardDate\(slip\.payDate\)/);
});

test("ESS My Pay and contract copy avoid unsupported payment-completed claims", () => {
  assert.match(portal, /t\("Net pay · released · Scheduled pay date"\)/);
  assert.doesNotMatch(portal, /t\("Net pay · paid"\)/);
  assert.match(portal, /My pay · What payroll has been released\?/);
  assert.doesNotMatch(portal, /My pay · What did I get paid/);
});

test("English and Taglish distinguish Released from Scheduled without changing stored status", () => {
  for (const key of [
    "Payslip released · Scheduled pay date",
    "Scheduled pay date",
    "Net pay · released · Scheduled pay date",
  ]) assert.ok(language.includes(JSON.stringify(key) + ":"), key);
});
