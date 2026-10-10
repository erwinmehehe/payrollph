import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("Compensation makes both investigation stages available only through their guarded components", () => {
  const page = read("src/components/compensation-panel.tsx");
  assert.ok(page.includes("PayrollOverpaymentWorkbench organizationId={organizationId}"));
  assert.ok(page.includes("PayrollOverpaymentPreviewPanel organizationId={organizationId}"));
  assert.ok(read("src/components/payroll-overpayment-workbench.tsx").includes("if (!choices) return null"));
  assert.ok(read("src/components/payroll-overpayment-preview-panel.tsx").includes("if (!available || !options) return null"));
});

test("overpayment evidence and gross/net comparison have separate default-off flags and cannot change money", () => {
  const investigation = read("src/app/api/payroll/overpayment-preflight/route.ts");
  const comparison = read("src/app/api/payroll-overpayment-preview/route.ts");
  assert.ok(investigation.includes('process.env.PAYROLL_OVERPAYMENT_REVIEW_ENABLED !== "true"'));
  assert.ok(comparison.includes('process.env.HCM_OVERPAYMENT_PREVIEW_ENABLED === "true"'));
  for (const route of [investigation, comparison]) {
    assert.ok(route.includes("requireSensitiveActionMfa"));
    assert.ok(route.includes("getAccess"));
    assert.ok(!/\b(?:db|tx)\.(?:insert|update|delete)\s*\(/.test(route),
      "Read-only investigation/preview must not mutate payroll or employee records.");
  }
});
