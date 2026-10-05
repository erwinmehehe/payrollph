import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resourceWave16 } from "../src/lib/seo-content-wave16";
import { SEO_INTENT_OWNERS } from "../src/lib/seo-intent-ownership";
import { resourceSitemapEntries } from "../src/lib/sitemap-data";

const read = (path: string) => readFileSync(path, "utf8");

test("Wave 16 adds only distinct employee-loan and retro-pay knowledge pages", () => {
  assert.deepEqual(resourceWave16.map((page) => page.slug), [
    "employee-loans-payroll",
    "retroactive-pay",
  ]);

  const source = read("src/lib/seo-content-wave16.ts");
  assert.ok(!source.includes('slug: "manual-payroll-vs-software"'));
});

test("manual payroll intent stays consolidated on the existing Excel comparison page", () => {
  const owner = SEO_INTENT_OWNERS.find((entry) => entry.ownerPath === "/resources/payroll-software-vs-excel");
  assert.ok(owner);
  assert.ok(owner?.supportingIntents?.includes("manual payroll vs software philippines"));
  assert.ok(owner?.supportingIntents?.includes("manual payroll vs payroll software philippines"));

  const source = read("src/lib/seo-content.ts");
  assert.ok(source.includes("Manual payroll often depends on Excel or similar spreadsheets."));
});

test("employee-loan guide claims match the implemented loan workflow", () => {
  const guide = read("src/lib/seo-content-wave16.ts");
  const loansRoute = read("src/app/api/loans/route.ts");
  const payrollEngine = read("src/lib/payroll-engine.ts");

  assert.ok(guide.includes("Employee loan ledger"));
  assert.ok(guide.includes("Pause and resume controls"));
  assert.ok(guide.includes("Manual payment recording"));

  assert.ok(loansRoute.includes("employeeLoans"));
  assert.ok(loansRoute.includes('action === "record_payment"'));
  assert.ok(loansRoute.includes('action === "pause" || action === "resume"'));
  assert.ok(loansRoute.includes("Payment cannot exceed the remaining loan balance."));
  assert.ok(loansRoute.includes('action: "Employee loan registered"'));

  assert.ok(payrollEngine.includes('eq(employeeLoans.status, "active")'));
  assert.ok(payrollEngine.includes("cutoffDeduction: Number(l.cutoffDeduction)"));
  assert.ok(payrollEngine.includes("requestedDeduction: Math.min(Number(loan.cutoffDeduction), Number(loan.remainingBalance))"));
});

test("retro-pay guide claims match effective-dated revision and settlement behavior", () => {
  const guide = read("src/lib/seo-content-wave16.ts");
  const employeesRoute = read("src/app/api/employees/route.ts");
  const payrollEngine = read("src/lib/payroll-engine.ts");

  assert.ok(guide.includes("Effective-dated pay revisions"));
  assert.ok(guide.includes("Source-period traceability"));
  assert.ok(guide.includes("Pending-to-settled lifecycle"));
  assert.ok(guide.includes("does not decide whether a particular employee is legally entitled to retroactive pay"));

  assert.ok(employeesRoute.includes("employeePayRevisions"));
  assert.ok(employeesRoute.includes("employeePayRetroAdjustments"));
  assert.ok(employeesRoute.includes("sourcePayrollRunId"));
  assert.ok(employeesRoute.includes("sourcePeriodLabel"));
  assert.ok(employeesRoute.includes("retroAdjustments"));
  assert.ok(employeesRoute.includes("retroTotal"));

  assert.ok(payrollEngine.includes('eq(employeePayRetroAdjustments.status, "pending")'));
  assert.ok(payrollEngine.includes('label: `Retro pay, ${retro.sourcePeriodLabel}`'));
  assert.ok(payrollEngine.includes("Effective-dated monthly pay correction from a previously released cutoff"));
  assert.ok(payrollEngine.includes("retroPay="));
});

test("Wave 16 resource routes are discoverable through hub and sitemap", () => {
  const route = read("src/app/resources/[slug]/page.tsx");
  const hub = read("src/app/resources/page.tsx");
  const sitemap = new Set(resourceSitemapEntries.map((entry) => entry.path));

  assert.ok(route.includes("resourceWave16"));
  assert.ok(hub.includes("resourceWave16"));
  assert.ok(hub.includes('"employee-loans-payroll"'));
  assert.ok(hub.includes('"retroactive-pay"'));
  assert.ok(sitemap.has("/resources/employee-loans-payroll"));
  assert.ok(sitemap.has("/resources/retroactive-pay"));
});

test("Wave 16 intent ownership is unique and differentiated", () => {
  const employeeLoan = SEO_INTENT_OWNERS.find((entry) => entry.ownerPath === "/resources/employee-loans-payroll");
  const retro = SEO_INTENT_OWNERS.find((entry) => entry.ownerPath === "/resources/retroactive-pay");

  assert.equal(employeeLoan?.primaryIntent, "employee loans payroll philippines");
  assert.equal(employeeLoan?.intentClass, "guide");
  assert.equal(retro?.primaryIntent, "retroactive pay philippines");
  assert.equal(retro?.intentClass, "guide");
  assert.ok(retro?.note?.includes("universal legal-entitlement"));
});

test("existing authority pages link contextually into Wave 16", () => {
  const core = read("src/lib/seo-content.ts");
  const wave3 = read("src/lib/seo-content-wave3.ts");
  const compare = read("src/app/compare/page.tsx");

  assert.ok(core.includes('href: "/resources/employee-loans-payroll"'));
  assert.ok(wave3.includes('href: "/resources/retroactive-pay"'));
  assert.ok(compare.includes("Manual / Excel payroll vs software"));
});
