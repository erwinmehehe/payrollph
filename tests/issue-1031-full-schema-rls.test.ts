import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { summarizeRlsPolicyCoverage, RLS_UNMODELED, type RlsCatalogRow } from "../src/lib/issue-1031-rls-catalog";

const empty = (name: string): RlsCatalogRow => ({
  table_name: name, rls_enabled: false, rls_forced: false,
  policy_name: null, policy_command: null, policy_permissive: null,
  policy_roles: null, using_expression: null, with_check_expression: null,
});
const policy = (overrides: Partial<RlsCatalogRow> = {}): RlsCatalogRow => ({
  table_name: "employees", rls_enabled: true, rls_forced: true,
  policy_name: "tenant_read", policy_command: "r", policy_permissive: true,
  policy_roles: ["PUBLIC"], using_expression: "organization_id = 5",
  with_check_expression: null, ...overrides,
});

test("#1031 RLS OFF and no policy is unmodeled, never full schema/security PASS", () => {
  const result = summarizeRlsPolicyCoverage(["employees", "payroll_runs"], [
    empty("employees"), empty("payroll_runs"),
  ]);
  assert.equal(result.rlsCoverage, RLS_UNMODELED);
  assert.equal(result.policyParityVerified, false);
  assert.equal(result.approvedForDeployment, false);
  assert.equal(result.missingSourceTables, 0);
  assert.equal(result.tables.length, 2);
  assert.equal(result.tables[0].coverage, RLS_UNMODELED);
  assert.equal(result.tables[0].policyCount, 0);
});

test("#1031 independent FORCE, USING, WITH CHECK, role, command, permissive drift changes digest", () => {
  const prior = summarizeRlsPolicyCoverage(["employees"], [policy()]);
  const originalDigest = prior.tables[0].policyDigest;
  assert.equal(typeof originalDigest, "string");
  for (const override of [
    { rls_forced: false }, { rls_enabled: false },
    { using_expression: "organization_id = 6" }, { with_check_expression: "true" },
    { policy_roles: ["payroll_role"] }, { policy_command: "w" }, { policy_permissive: false },
  ] satisfies Partial<RlsCatalogRow>[]) {
    const next = summarizeRlsPolicyCoverage(["employees"], [policy(override)]);
    if ("rls_enabled" in override || "rls_forced" in override) {
      assert.notEqual(next.tables[0].rlsEnabled + ":" + next.tables[0].rlsForced,
        prior.tables[0].rlsEnabled + ":" + prior.tables[0].rlsForced);
    } else {
      assert.notEqual(next.tables[0].policyDigest, originalDigest);
    }
    assert.equal(next.policyParityVerified, false);
  }
});

test("#1031 missing and extra catalog tables stay explicitly unverified", () => {
  const result = summarizeRlsPolicyCoverage(["employees", "absent"], [empty("employees"), empty("extra")]);
  assert.equal(result.missingSourceTables, 1);
  assert.equal(result.extraCatalogTables, 1);
  assert.equal(result.tables.find((t) => t.table === "absent")?.coverage, "MISSING_TABLE");
  assert.equal(result.tables.find((t) => t.table === "extra")?.sourceDeclared, false);
  assert.equal(result.approvedForDeployment, false);
});

test("#1031 malformed, duplicate and cross-table contradictory catalog metadata fail closed", () => {
  for (const rows of [
    [empty("employees"), empty("employees")],
    [policy(), policy()],
    [policy(), policy({ rls_enabled: false, policy_name: "other" })],
    [policy({ policy_command: "invalid" })],
    [policy({ policy_roles: ["unsafe role"] })],
    [policy({ using_expression: 1 as unknown as string })],
    [empty("employees"), policy()],
  ]) {
    assert.throws(() => summarizeRlsPolicyCoverage(["employees"], rows),
      /ISSUE1031_INVALID_RLS_CATALOG_EVIDENCE/);
  }
});

test("#1031 protected catalog-only report does not expose policy SQL or authorize release", () => {
  const r = summarizeRlsPolicyCoverage(["employees"], [policy()]);
  const text = JSON.stringify(r);
  assert.doesNotMatch(text, /organization_id = 5|payroll_role|USING |WITH CHECK /);
  assert.match(r.tables[0].policyDigest ?? "", /^[0-9a-f]{64}$/);
  const script = readFileSync("scripts/check-issue-1031-full-schema-diff.ts", "utf8");
  assert.match(script, /summarizeRlsPolicyCoverage\(/);
  assert.match(script, /pg_catalog\.pg_policy/);
  assert.match(script, /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY/);
  assert.match(script, /policyParityVerified:false/);
});
