import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// A path-filter regression can silently stop the connected employer checks.
// Verify both push and PR events, including the existing independent receipt guard.
const required = {
  ".github/workflows/nine-stage-connected-acceptance.yml": [
    "src/app/api/first-payroll/**",
    "src/app/api/legal-entities/**",
    "src/app/api/approvals/**",
    "src/app/api/provisioning/**",
    "src/components/workspace/first-payroll-inline-panel.tsx",
    "src/components/new-hire-modal.tsx",
    "src/components/workspace/first-payroll-readiness.tsx",
    "src/lib/first-payroll-*.ts",
    "scripts/qa/nine-stage-connected-acceptance.ts",
  ],
  ".github/workflows/hris-journey-browser-qa.yml": [
    "src/app/api/first-payroll/**",
    "src/app/api/legal-entities/**",
    "src/app/api/payroll-runs/**",
    "src/app/api/approvals/**",
    "src/app/api/provisioning/**",
    "src/components/workspace/first-payroll-inline-panel.tsx",
    "src/components/new-hire-modal.tsx",
    "src/components/workspace/first-payroll-readiness.tsx",
    "src/lib/first-payroll-*.ts",
  ],
};
for (const [path, paths] of Object.entries(required)) {
  test(path + " triggers on relevant first-payroll changes in both push and PR", () => {
    const source = readFileSync(path, "utf8");
    const push = source.indexOf("  push:");
    const pull = source.indexOf("  pull_request:");
    const dispatch = source.indexOf("  workflow_dispatch:");
    assert.ok(push >= 0 && pull > push && dispatch > pull, "Unexpected GitHub Actions event structure");
    const sections = [source.slice(push, pull), source.slice(pull, dispatch)];
    for (const [index, section] of sections.entries()) {
      for (const watched of paths) {
        const literal = JSON.stringify(watched);
        assert.ok(section.includes("- " + literal),
          (index ? "pull_request" : "push") + " missing watched path " + watched);
      }
    }
    assert.match(source, /PAYMONGO_DISBURSEMENTS_ENABLED: "false"/);
    assert.match(source, /XENDIT_PAYOUTS_ENABLED: "false"/);
    assert.match(source, /127\.0\.0\.1:5432\/app_db/);
  });
}
