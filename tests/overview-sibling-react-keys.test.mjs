import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Owner Overview sibling cards have distinct tenant-scoped React keys", () => {
  const source = readFileSync("src/components/linaw-workspace.tsx", "utf8");
  // Using the raw numeric org ID twice in the same fragment caused a real
  // React duplicate-key error during six-persona Chromium acceptance.
  assert.ok(source.includes('key={`hris-home:${data.selectedOrganization.id}`}'),
    "Everyday HR shortcut card needs its own tenant-scoped component identity");
  assert.ok(source.includes('key={`first-payroll-readiness:${data.selectedOrganization.id}`}'),
    "First-payroll readiness card must not collide with the HR card");
  const ownerOverview = source.slice(
    source.indexOf('{page === "Overview" && ('),
    source.indexOf('{page === "Payroll" && ('),
  );
  assert.ok(ownerOverview.includes("HrisHomeShortcuts") &&
    ownerOverview.includes("FirstPayrollReadinessCard"),
    "Both conditional cards must remain in the Owner Overview fragment");
  assert.doesNotMatch(ownerOverview,
    /<(?:HrisHomeShortcuts|FirstPayrollReadinessCard)\s+key=\{data\.selectedOrganization\.id\}/,
    "Two sibling cards must never reuse the identical numeric organization key");
});
