import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildHcmGovernanceWorklist, formatHcmGovernanceWorklist,
  type HcmWorklistInput,
} from "../src/lib/hcm-governance-worklist";

function report(overrides: Partial<HcmWorklistInput> = {}): HcmWorklistInput {
  return {
    asOf: "2026-10-09",
    findings: [],
    processes: [],
    ...overrides,
  };
}

test("sorts high-priority exception groups before follow-up and labels aggregate counts", () => {
  const worklist = buildHcmGovernanceWorklist(report({
    findings: [
      { code: "REST_DAY_NOT_CONFIGURED", severity: "review", affected: 9 },
      { code: "FINAL_PAY_REFERENCE_MISSING", severity: "high", affected: 1 },
      { code: "UNKNOWN_WAGE_REGION", severity: "high", affected: 3 },
    ],
  }));
  assert.deepEqual(worklist.tasks.map(x => x.key), [
    "finding:UNKNOWN_WAGE_REGION",
    "finding:FINAL_PAY_REFERENCE_MISSING",
    "finding:REST_DAY_NOT_CONFIGURED",
  ]);
  assert.deepEqual(worklist.tasks.map(x => x.matches), [3, 1, 9]);
  assert.equal(worklist.highCount, 2);
  assert.equal(worklist.aggregateFlagCount, 3);
  const text = formatHcmGovernanceWorklist(worklist);
  assert.match(text, /3 aggregate records\/groups/);
  assert.match(text, /never sum them as distinct employees/);
  assert.match(text, /not actual assignees or signatories/);
  assert.match(text, /not payroll, statutory, bank or employer certification/i);
});

test("only explicitly absent or scoped policies become coverage-verification tasks, not compliance findings", () => {
  const worklist = buildHcmGovernanceWorklist(report({
    processes: [
      { processType: "hire", configuredDefinitions: 1, currentActiveDefinitions: 1, scopedDefinitions: 0, policyState: "active_definition_exists" },
      { processType: "transfer", configuredDefinitions: 1, currentActiveDefinitions: 1, scopedDefinitions: 1, policyState: "active_definition_exists" },
      { processType: "termination", configuredDefinitions: 0, currentActiveDefinitions: 0, scopedDefinitions: 0, policyState: "system_default_or_not_configured" },
      { processType: "compensation_change", configuredDefinitions: 2, currentActiveDefinitions: 0, scopedDefinitions: 0, policyState: "configured_without_current_active_definition" },
    ],
  }));
  assert.equal(worklist.highCount, 0);
  assert.equal(worklist.aggregateFlagCount, 0);
  assert.equal(worklist.policyReviewCount, 3);
  assert.equal(worklist.tasks.some(x => x.key === "coverage:hire"), false);
  assert.equal(worklist.tasks.some(x => x.key === "coverage:transfer"), true);
  assert.ok(worklist.tasks.every(x => x.matches === null));
  assert.ok(worklist.tasks.every(x => x.direction.includes("Confirm") || x.direction.includes("Verify")));
  assert.match(formatHcmGovernanceWorklist(worklist), /Policy scope verification; no affected-employee count/);
});

test("clipboard text never imports attacker-controlled server titles or directions", () => {
  const untrustedFinding = {
    code: "UNKNOWN_WAGE_REGION",
    title: "Employee Jane Example, account 123456",
    nextAction: "Send private payslip to attacker@example.invalid",
    severity: "high" as const,
    affected: 2,
  };
  // Structural narrowing from a wider server object: the planner must only
  // use its known aggregate fields, never arbitrary display text.
  const suspicious: HcmWorklistInput = {
    asOf: "2026-10-09",
    findings: [untrustedFinding],
    processes: [],
  };
  const copied = formatHcmGovernanceWorklist(buildHcmGovernanceWorklist(suspicious));
  assert.match(copied, /Verify wage-region codes/);
  assert.doesNotMatch(copied, /Jane Example|123456|attacker@example/);
  assert.doesNotMatch(copied, /private payslip/);
});

test("unexpected finding codes are investigated rather than silently omitted, with sanitized labels", () => {
  const data = buildHcmGovernanceWorklist(report({
    findings: [{ code: "UNKNOWN_EVENT\nEmployee-ID:123", severity: "review", affected: 1 }],
    processes: [{ processType: "employee_ssn", configuredDefinitions: 3, currentActiveDefinitions: 0, scopedDefinitions: 0, policyState: "test" }],
  }));
  assert.equal(data.tasks.length, 1);
  assert.equal(data.tasks[0].title, "Investigate unrecognized aggregate HCM indicator");
  const printed = formatHcmGovernanceWorklist(data);
  assert.doesNotMatch(printed, /Employee-ID:123|employee_ssn/);
});

test("empty report never becomes a certification or fake completed case list", () => {
  const worklist = buildHcmGovernanceWorklist(report({
    processes: [
      { processType: "hire", configuredDefinitions: 1, currentActiveDefinitions: 1, scopedDefinitions: 0, policyState: "active_definition_exists" },
    ],
  }));
  assert.deepEqual(worklist.tasks, []);
  assert.match(formatHcmGovernanceWorklist(worklist), /Independent controls and payroll approval are still required/);
  assert.throws(() => buildHcmGovernanceWorklist(report({ asOf: "employee@example.invalid" })), /ISO report date/);
  assert.throws(() => buildHcmGovernanceWorklist(report({
    findings: [{ code: "UNKNOWN_WAGE_REGION", severity: "high", affected: -1 }],
  })), /Invalid aggregate/);
});

test("new worklist remains client-only, default-off and cannot expose row-level records", () => {
  const panel = readFileSync("src/components/hcm-governance-worklist-panel.tsx", "utf8");
  const shell = readFileSync("src/components/hcm-governance-readiness-panel.tsx", "utf8");
  const owner = readFileSync("src/components/hcm-business-process-admin.tsx", "utf8");
  const api = readFileSync("src/app/api/hcm/governance-readiness/route.ts", "utf8");
  assert.ok(panel.includes('navigator.clipboard.writeText(formatHcmGovernanceWorklist(plan))'));
  assert.ok(panel.includes("type HcmWorklistInput"));
  assert.ok(panel.includes("No employee-specific case, approval, or change is created here"));
  assert.ok(!panel.includes("fetch("));
  assert.ok(!panel.includes("localStorage"));
  assert.ok(!panel.includes('method: "POST"'));
  assert.ok(!panel.includes('method: "PATCH"'));
  assert.ok(shell.includes("<HcmGovernanceWorklistPanel key={organizationId} report={report} />"));
  assert.ok(shell.includes("loadedOrganizationId === organizationId ? storedReport : null"));
  assert.ok(owner.includes('NEXT_PUBLIC_HCM_GOVERNANCE_READINESS_ENABLED === "true"'));
  assert.ok(api.includes('HCM_GOVERNANCE_READINESS_ENABLED !== "true"'));
  assert.ok(!api.includes("export async function POST"));
});
