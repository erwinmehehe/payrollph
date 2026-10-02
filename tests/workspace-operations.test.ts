import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("primary workspace navigation stays focused while specialist tools remain available", () => {
  const nav = readFileSync("src/components/workspace/nav.ts", "utf8");
  const shell = readFileSync("src/components/workspace/shell.tsx", "utf8");

  for (const page of [
    "Overview",
    "People",
    "Payroll",
    "Time & attendance",
    "Approvals",
    "Operations",
    "Settings",
  ]) {
    assert.ok(nav.includes(`"${page}"`), `${page} must remain in the focused primary navigation contract`);
  }

  assert.ok(nav.includes("PRIMARY_NAV_ORDER"));
  assert.ok(nav.includes("PRIMARY_NAV_NAMES"));
  assert.ok(shell.includes("More tools"), "secondary modules must remain reachable without crowding the primary sidebar");
  assert.ok(shell.includes("secondaryGroups"), "the sidebar must preserve secondary navigation");
  assert.ok(shell.includes("PRIMARY_NAV_ORDER"));
});

test("operations center consolidates real recovery signals and direct actions", () => {
  const source = readFileSync("src/components/workspace/operations.tsx", "utf8");
  const workspace = readFileSync("src/components/linaw-workspace.tsx", "utf8");

  for (const signal of [
    "payrollJobs",
    "payrollExceptions",
    "pendingApprovals",
    "missingBank",
    "missingGovernmentIds",
    "attendanceIssues",
    "leavePolicyGaps",
  ]) {
    assert.ok(source.includes(signal), `operations center must include ${signal}`);
  }

  assert.ok(source.includes("/api/outbox?organizationId="), "delivery state must come from the real outbox");
  assert.ok(source.includes("/api/compliance/filing-validations?organizationId="), "government evidence must come from persisted filing validation records");
  assert.ok(source.includes('mode: "retry-failed-payslips"'), "failed payslip notices need a direct recovery action");
  assert.ok(source.includes('onPage("Exports")'), "specialist filing/export tools remain directly reachable");
  assert.ok(workspace.includes('page === "Operations"'), "the operations center must be wired into the workspace router");
});

test("admin delivery notifications route into the operations queue", () => {
  const source = readFileSync("src/components/workspace/shell.tsx", "utf8");
  assert.ok(source.includes('["owner", "admin", "bookkeeper"].includes(effectiveRole ?? "") ? "Operations" : "Exports"'));
});


test("overview styling cannot hide focused primary navigation destinations", () => {
  const styles = readFileSync("src/app/workspace-theme.css", "utf8");
  for (const page of ["Time & attendance", "Operations"]) {
    assert.ok(
      !styles.includes(`.app-shell[data-workspace-page="Overview"] .nav-item[data-nav-name="${page}"]`),
      `Overview CSS must not hide primary destination ${page}`,
    );
  }
});
