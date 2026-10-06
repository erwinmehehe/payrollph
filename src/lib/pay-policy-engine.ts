export type PayPolicyScope = "organization" | "org_unit" | "employee";

export type PayPolicyRecord = {
  id: number;
  organizationId: number;
  code: string;
  name: string;
  policyKind: string;
  version: string;
  scopeType: PayPolicyScope;
  scopeOrgUnitId: number | null;
  scopeEmployeeId: number | null;
  priority: number;
  effectiveFrom: string;
  effectiveUntil: string | null;
  active: boolean;
  approvedAt: Date | string | null;
};

export type PayPolicyRuleRecord = {
  id: number;
  policyId: number;
  ruleKey: string;
  eventType: string;
  conditions: unknown;
  outcome: unknown;
  priority: number;
  statutoryFloorProtected: boolean;
  enabled: boolean;
};

function scopeRank(scope: PayPolicyScope) {
  if (scope === "employee") return 3;
  if (scope === "org_unit") return 2;
  return 1;
}

function effective(policy: PayPolicyRecord, asOf: string) {
  return policy.effectiveFrom <= asOf
    && (!policy.effectiveUntil || asOf <= policy.effectiveUntil);
}

function scopeMatches(
  policy: PayPolicyRecord,
  employeeId: number,
  orgUnitIds: number[],
) {
  if (policy.scopeType === "employee") {
    return policy.scopeEmployeeId === employeeId;
  }
  if (policy.scopeType === "org_unit") {
    return policy.scopeOrgUnitId != null && orgUnitIds.includes(policy.scopeOrgUnitId);
  }
  return policy.scopeOrgUnitId == null && policy.scopeEmployeeId == null;
}

/**
 * Returns the approved/effective policy stack that may participate in a future
 * configurable pay calculation.
 *
 * This does not execute pay arithmetic. Current statutory payroll logic remains
 * authoritative until each rule family is independently migrated and reconciled.
 */
export function resolveApplicablePayPolicies(input: {
  organizationId: number;
  employeeId: number;
  orgUnitIds?: number[];
  asOf: string;
  policies: PayPolicyRecord[];
}) {
  const applicable = input.policies
    .filter((policy) =>
      policy.organizationId === input.organizationId
      && policy.active
      && Boolean(policy.approvedAt)
      && effective(policy, input.asOf)
      && scopeMatches(policy, input.employeeId, input.orgUnitIds ?? []),
    );

  const versionsByScope = new Map<string, PayPolicyRecord[]>();
  for (const policy of applicable) {
    const scopeKey = policy.scopeType === "organization"
      ? `${policy.code}|organization`
      : policy.scopeType === "employee"
        ? `${policy.code}|employee|${policy.scopeEmployeeId}`
        : `${policy.code}|org_unit`;
    versionsByScope.set(scopeKey, [...(versionsByScope.get(scopeKey) ?? []), policy]);
  }
  for (const [scopeKey, versions] of versionsByScope) {
    if (versions.length > 1) {
      throw new Error(
        `Ambiguous effective pay policy versions for ${scopeKey} on ${input.asOf}: ${versions.map((item) => item.version).sort().join(", ")}.`,
      );
    }
  }

  return applicable.sort((a, b) =>
    scopeRank(b.scopeType) - scopeRank(a.scopeType)
    || b.priority - a.priority
    || String(b.effectiveFrom).localeCompare(String(a.effectiveFrom))
    || a.id - b.id,
  );
}

export function orderedPayPolicyRules(input: {
  policies: PayPolicyRecord[];
  rules: PayPolicyRuleRecord[];
}) {
  const order = new Map(input.policies.map((policy, index) => [policy.id, index]));
  return input.rules
    .filter((rule) => rule.enabled && order.has(rule.policyId))
    .sort((a, b) =>
      (order.get(a.policyId) ?? Number.MAX_SAFE_INTEGER)
        - (order.get(b.policyId) ?? Number.MAX_SAFE_INTEGER)
      || b.priority - a.priority
      || a.id - b.id,
    );
}

export function payPolicyTrace(policies: PayPolicyRecord[]) {
  return policies.map((policy) => ({
    policyId: policy.id,
    code: policy.code,
    name: policy.name,
    policyKind: policy.policyKind,
    version: policy.version,
    scopeType: policy.scopeType,
    scopeOrgUnitId: policy.scopeOrgUnitId,
    scopeEmployeeId: policy.scopeEmployeeId,
    priority: policy.priority,
    effectiveFrom: policy.effectiveFrom,
    effectiveUntil: policy.effectiveUntil,
  }));
}
