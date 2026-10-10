import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { checkerReleaseSeparationError, treasuryReleaseSeparationError } from "../src/lib/treasury-controls";

const read = (path: string) => readFileSync(path, "utf8");

test("the checker who approved a payroll cannot release it, regardless of treasury policy", () => {
  const approval = (id: number, deciderUserId: number | null, actor = "Casey", taskId = 7, payrollRunId = 42) => ({
    id,
    action: "Approval approved",
    actor,
    metadata: { taskId, payrollRunId, deciderUserId },
  });
  const base = { approvalTaskId: 7, payrollRunId: 42 };

  assert.match(
    checkerReleaseSeparationError({ ...base, events: [approval(1, 11)], userId: 11, userName: "Casey" }) ?? "",
    /cannot also release/,
  );
  assert.equal(checkerReleaseSeparationError({ ...base, events: [approval(1, 11)], userId: 12, userName: "Owner" }), null);
  // A different task or run never blocks.
  assert.equal(checkerReleaseSeparationError({ ...base, events: [approval(1, 11, "Casey", 8)], userId: 11, userName: "Casey" }), null);
  assert.equal(checkerReleaseSeparationError({ ...base, events: [approval(1, 11, "Casey", 7, 43)], userId: 11, userName: "Casey" }), null);
  // Legacy decisions without a stable id compare by actor name.
  assert.match(
    checkerReleaseSeparationError({ ...base, events: [approval(1, null, "Casey")], userId: 99, userName: " casey " }) ?? "",
    /cannot also release/,
  );
  // Delegated approvals count; the latest decision wins.
  assert.match(
    checkerReleaseSeparationError({
      ...base,
      events: [approval(1, 12), { ...approval(2, 11), action: "Approval approved by delegate" }],
      userId: 11,
      userName: "Casey",
    }) ?? "",
    /cannot also release/,
  );
});

test("stable release identity blocks the same user and allows a distinct treasury user", () => {
  const base = {
    policyEnabledAt: new Date("2026-10-01T00:00:00Z"),
    releaseCreatedAt: new Date("2026-10-07T00:00:00Z"),
    releaseActor: "Alex",
    userName: "Alex",
  };
  assert.match(treasuryReleaseSeparationError({
    ...base,
    releasedByUserId: 7,
    userId: 7,
  }) ?? "", /cannot also submit or confirm/);
  assert.equal(treasuryReleaseSeparationError({
    ...base,
    releasedByUserId: 7,
    userId: 8,
  }), null, "stable IDs take precedence over duplicate display names");
});

test("post-enable payroll release fails closed when stable release-user evidence is missing", () => {
  const error = treasuryReleaseSeparationError({
    policyEnabledAt: new Date("2026-10-01T00:00:00Z"),
    releaseCreatedAt: new Date("2026-10-07T00:00:00Z"),
    releaseActor: "Release Admin",
    releasedByUserId: null,
    userId: 9,
    userName: "Treasury User",
  });
  assert.match(error ?? "", /Stable release-user evidence is missing/);
});

test("legacy payrolls use actor-name separation without inventing a stable identity", () => {
  const policyEnabledAt = new Date("2026-10-07T00:00:00Z");
  const releaseCreatedAt = new Date("2026-09-15T00:00:00Z");
  assert.match(treasuryReleaseSeparationError({
    policyEnabledAt,
    releaseCreatedAt,
    releaseActor: "Legacy Owner",
    releasedByUserId: null,
    userId: 3,
    userName: "legacy owner",
  }) ?? "", /legacy release evidence/);
  assert.equal(treasuryReleaseSeparationError({
    policyEnabledAt,
    releaseCreatedAt,
    releaseActor: "Legacy Owner",
    releasedByUserId: null,
    userId: 4,
    userName: "Treasury Operator",
  }), null);
});

test("0072 adds opt-in treasury policy and stable-user operator assignments", () => {
  const migration = read("drizzle/0072_treasury_separation.sql");
  const schema = read("src/db/schema.ts");
  const baseline = read("drizzle/baseline.sql");
  for (const source of [migration, schema, baseline]) {
    assert.ok(source.includes("treasury_control_policies"));
    assert.ok(source.includes("treasury_operator_assignments"));
    assert.ok(source.includes("require_release_submitter_separation"));
  }
  assert.ok(migration.includes("treasury_operator_assignments_org_user_unique"));
  assert.ok(schema.includes("treasuryOperatorAssignments"));
});

test("treasury policy configuration is owner-only, MFA protected, audited and demo-safe", () => {
  const api = read("src/app/api/treasury-controls/route.ts");
  assert.ok(api.includes('TREASURY_POLICY_ADMIN_ROLES = ["owner"]'));
  assert.ok(api.includes("requireSensitiveActionMfa"));
  assert.ok(api.includes("enforceSensitiveActionRateLimit"));
  assert.ok(api.includes("enforceSameOriginMutation"));
  assert.ok(api.includes("publicDemoMutationDenied"));
  assert.ok(api.includes("recordAuditEvent"));
  assert.ok(api.includes("two distinct company-wide users"));
  assert.ok(api.includes("RELEASE_CAPABLE_ROLES"));
});

test("treasury policy-off preserves legacy authorization while policy-on requires assignment", () => {
  const engine = read("src/lib/treasury-controls.ts");
  assert.ok(engine.includes("input.legacyAllowedRoles ?? PAYROLL_DISBURSEMENT_ROLES"));
  assert.ok(engine.includes("treasuryOperatorAssigned"));
  assert.ok(engine.includes("roleGateAllowed(input.userId, input.organizationId, \"payroll.disburse\")"));
  assert.ok(engine.includes("company-wide workspace access"));
});

test("payroll release persists stable releaser identity inside authoritative release evidence", () => {
  const release = read("src/app/api/payroll-runs/[id]/release/route.ts");
  assert.ok(release.includes("releasedByUserId: user.id"));
  assert.ok(release.includes("settlePayrollRun"));
});

test("final bank files and live payout submission use treasury separation", () => {
  const exportsRoute = read("src/app/api/payroll-runs/[id]/exports/route.ts");
  assert.ok(exportsRoute.includes("authorizeTreasuryOperation"));
  assert.ok(exportsRoute.includes("legacyAllowedRoles: PAYROLL_OPERATOR_ROLES"));
  assert.ok(exportsRoute.includes("finalBankTreasuryEvidence"));
  assert.ok(exportsRoute.includes("treasury: treasuryEvidence"));
  assert.ok(exportsRoute.includes("completionRecordedByUserId: user.id"));
});

test("failed payout retry enforces release separation while read-only reconciliation does not", () => {
  const route = read("src/app/api/payroll-runs/[id]/payout-reconciliation/route.ts");
  assert.ok(route.includes('requireReleaseSeparation: action === "retry-failed"'));
  assert.ok(route.includes("requireReleaseSeparation: false"));
  assert.ok(route.includes("treasury: treasury.evidence"));
});

test("enterprise and payout UIs expose treasury separation without blocking dry-run preflight", () => {
  const enterprise = read("src/components/enterprise-controls-panel.tsx");
  const treasury = read("src/components/treasury-controls-panel.tsx");
  const exportsUi = read("src/components/workspace/exports.tsx");
  assert.ok(enterprise.includes("TreasuryControlsPanel"));
  assert.ok(treasury.includes("Separate payroll release from money movement"));
  assert.ok(treasury.includes("operatorUserIds"));
  assert.ok(exportsUi.includes("data-treasury-separation-active"));
  assert.ok(exportsUi.includes("canGenerateLiveBankFile"));
  assert.ok(exportsUi.includes("Run PayMongo preflight"));
});
