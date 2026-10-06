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


export const WORKED_TIME_PREMIUM_EVENT = "worked_time_premium";

export type AppliedWorkedTimePremiumRule = {
  ruleId: number;
  ruleKey: string;
  eventType: typeof WORKED_TIME_PREMIUM_EVENT;
  policyId: number;
  policyCode: string;
  policyName: string;
  policyVersion: string;
  policyKind: string;
  policyScopeType: PayPolicyScope;
  workDate: string;
  minutes: number;
  hourlyRate: number;
  shiftCode: string | null;
  worksiteId: number | null;
  premiumPercent: number;
  premiumAmountPerHour: number;
  amount: number;
  label: string;
  taxable: boolean;
  includeInSssBase: boolean;
  includeInPagIbigBase: boolean;
};

type JsonObject = Record<string, unknown>;

function asObject(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value as JsonObject;
}

function assertOnlyKeys(value: JsonObject, allowed: string[], label: string) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new Error(`${label} contains unsupported field(s): ${unknown.sort().join(", ")}.`);
  }
}

function positiveFiniteNumber(value: unknown, label: string, max: number) {
  if (value == null) return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > max) {
    throw new Error(`${label} must be between 0 and ${max}.`);
  }
  return parsed;
}

function requiredBoolean(value: unknown, label: string) {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be explicitly true or false.`);
  }
  return value;
}

function normalizeShiftCode(value: string) {
  return value.trim().toUpperCase();
}

function ruleMatchesWorkedTimePremium(
  rule: PayPolicyRuleRecord,
  context: {
    shiftCode: string | null;
    worksiteId: number | null;
  },
) {
  const conditions = asObject(rule.conditions, `Pay rule ${rule.ruleKey} conditions`);
  assertOnlyKeys(conditions, ["shiftCodes", "worksiteIds"], `Pay rule ${rule.ruleKey} conditions`);

  if (conditions.shiftCodes != null) {
    if (!Array.isArray(conditions.shiftCodes) || conditions.shiftCodes.length === 0) {
      throw new Error(`Pay rule ${rule.ruleKey} shiftCodes must be a non-empty array when supplied.`);
    }
    const shiftCodes = conditions.shiftCodes.map((item) => {
      if (typeof item !== "string" || !item.trim()) {
        throw new Error(`Pay rule ${rule.ruleKey} shiftCodes must contain non-empty strings.`);
      }
      return normalizeShiftCode(item);
    });
    if (!context.shiftCode) {
      throw new Error(
        `Pay rule ${rule.ruleKey} requires shift-code evidence, but payroll could not resolve a shift code.`,
      );
    }
    if (!shiftCodes.includes(normalizeShiftCode(context.shiftCode))) {
      return false;
    }
  }

  if (conditions.worksiteIds != null) {
    if (!Array.isArray(conditions.worksiteIds) || conditions.worksiteIds.length === 0) {
      throw new Error(`Pay rule ${rule.ruleKey} worksiteIds must be a non-empty array when supplied.`);
    }
    const worksiteIds = conditions.worksiteIds.map((item) => {
      const id = Number(item);
      if (!Number.isInteger(id) || id <= 0) {
        throw new Error(`Pay rule ${rule.ruleKey} worksiteIds must contain positive integer IDs.`);
      }
      return id;
    });
    if (context.worksiteId == null) {
      throw new Error(
        `Pay rule ${rule.ruleKey} requires worksite evidence, but payroll could not resolve a worksite.`,
      );
    }
    if (!worksiteIds.includes(context.worksiteId)) {
      return false;
    }
  }

  return true;
}

function parseWorkedTimePremiumOutcome(rule: PayPolicyRuleRecord) {
  const outcome = asObject(rule.outcome, `Pay rule ${rule.ruleKey} outcome`);
  assertOnlyKeys(
    outcome,
    [
      "label",
      "premiumPercent",
      "premiumAmountPerHour",
      "taxable",
      "includeInSssBase",
      "includeInPagIbigBase",
    ],
    `Pay rule ${rule.ruleKey} outcome`,
  );

  const premiumPercent = positiveFiniteNumber(
    outcome.premiumPercent,
    `Pay rule ${rule.ruleKey} premiumPercent`,
    500,
  );
  const premiumAmountPerHour = positiveFiniteNumber(
    outcome.premiumAmountPerHour,
    `Pay rule ${rule.ruleKey} premiumAmountPerHour`,
    100_000,
  );
  if (premiumPercent <= 0 && premiumAmountPerHour <= 0) {
    throw new Error(
      `Pay rule ${rule.ruleKey} must add a positive premiumPercent or premiumAmountPerHour.`,
    );
  }

  const label = typeof outcome.label === "string" && outcome.label.trim()
    ? outcome.label.trim().slice(0, 160)
    : rule.ruleKey;

  return {
    label,
    premiumPercent,
    premiumAmountPerHour,
    taxable: requiredBoolean(outcome.taxable, `Pay rule ${rule.ruleKey} taxable`),
    includeInSssBase: requiredBoolean(
      outcome.includeInSssBase,
      `Pay rule ${rule.ruleKey} includeInSssBase`,
    ),
    includeInPagIbigBase: requiredBoolean(
      outcome.includeInPagIbigBase,
      `Pay rule ${rule.ruleKey} includeInPagIbigBase`,
    ),
  };
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Executes the first migrated configurable pay-rule family.
 *
 * worked_time_premium rules are additive only. They may add a percentage of
 * the employee's base hourly rate and/or a fixed hourly premium for validated
 * worked minutes. They never replace or reduce statutory OT, holiday/rest-day,
 * or night-differential calculations.
 *
 * Conditions are intentionally limited to shiftCodes/worksiteIds in v1. Legal
 * premium families remain on the statutory engine until independently migrated.
 */
export function resolveWorkedTimePremium(input: {
  organizationId: number;
  employeeId: number;
  orgUnitIds?: number[];
  workDate: string;
  minutes: number;
  hourlyRate: number;
  shiftCode: string | null;
  worksiteId: number | null;
  policies: PayPolicyRecord[];
  rules: PayPolicyRuleRecord[];
}) {
  const minutes = Math.max(0, Math.trunc(input.minutes));
  const hourlyRate = Number(input.hourlyRate);
  if (!Number.isFinite(hourlyRate) || hourlyRate < 0) {
    throw new Error("Worked-time premium hourlyRate must be a non-negative finite number.");
  }

  const policies = resolveApplicablePayPolicies({
    organizationId: input.organizationId,
    employeeId: input.employeeId,
    orgUnitIds: input.orgUnitIds,
    asOf: input.workDate,
    policies: input.policies,
  });
  const policyById = new Map(policies.map((policy) => [policy.id, policy]));
  const ordered = orderedPayPolicyRules({ policies, rules: input.rules })
    .filter((rule) => rule.eventType === WORKED_TIME_PREMIUM_EVENT);

  const claimedRuleKeys = new Set<string>();
  const applied: AppliedWorkedTimePremiumRule[] = [];

  for (const rule of ordered) {
    if (!rule.statutoryFloorProtected) {
      throw new Error(
        `Executable pay rule ${rule.ruleKey} must keep statutoryFloorProtected=true.`,
      );
    }

    const matches = ruleMatchesWorkedTimePremium(rule, {
      shiftCode: input.shiftCode,
      worksiteId: input.worksiteId,
    });
    if (!matches) continue;

    // Higher-precedence matching policy/rule wins for the same logical rule key.
    if (claimedRuleKeys.has(rule.ruleKey)) continue;
    claimedRuleKeys.add(rule.ruleKey);

    const policy = policyById.get(rule.policyId);
    if (!policy) continue;
    const outcome = parseWorkedTimePremiumOutcome(rule);
    const hourlyPremium =
      hourlyRate * (outcome.premiumPercent / 100)
      + outcome.premiumAmountPerHour;
    const amount = roundMoney((minutes / 60) * hourlyPremium);
    if (amount <= 0 || minutes <= 0) continue;

    applied.push({
      ruleId: rule.id,
      ruleKey: rule.ruleKey,
      eventType: WORKED_TIME_PREMIUM_EVENT,
      policyId: policy.id,
      policyCode: policy.code,
      policyName: policy.name,
      policyVersion: policy.version,
      policyKind: policy.policyKind,
      policyScopeType: policy.scopeType,
      workDate: input.workDate,
      minutes,
      hourlyRate,
      shiftCode: input.shiftCode,
      worksiteId: input.worksiteId,
      premiumPercent: outcome.premiumPercent,
      premiumAmountPerHour: outcome.premiumAmountPerHour,
      amount,
      label: outcome.label,
      taxable: outcome.taxable,
      includeInSssBase: outcome.includeInSssBase,
      includeInPagIbigBase: outcome.includeInPagIbigBase,
    });
  }

  return {
    version: "worked-time-premium-v1" as const,
    statutoryFloorMode: "additive-only" as const,
    policies: payPolicyTrace(policies),
    amount: roundMoney(applied.reduce((sum, item) => sum + item.amount, 0)),
    taxableAmount: roundMoney(
      applied.reduce((sum, item) => sum + (item.taxable ? item.amount : 0), 0),
    ),
    sssIncludedAmount: roundMoney(
      applied.reduce((sum, item) => sum + (item.includeInSssBase ? item.amount : 0), 0),
    ),
    pagIbigIncludedAmount: roundMoney(
      applied.reduce((sum, item) => sum + (item.includeInPagIbigBase ? item.amount : 0), 0),
    ),
    applied,
  };
}


export const HOLIDAY_REST_DAY_PREMIUM_EVENT = "holiday_rest_day_premium";

export type PayPolicyHolidayType = "ordinary" | "special" | "regular" | "double";

export type AppliedHolidayRestDayPremiumRule = {
  ruleId: number;
  ruleKey: string;
  eventType: typeof HOLIDAY_REST_DAY_PREMIUM_EVENT;
  policyId: number;
  policyCode: string;
  policyName: string;
  policyVersion: string;
  policyKind: string;
  policyScopeType: PayPolicyScope;
  workDate: string;
  minutes: number;
  hourlyRate: number;
  holidayType: PayPolicyHolidayType;
  restDay: boolean;
  shiftCode: string | null;
  worksiteId: number | null;
  statutoryMultiplier: number;
  additionalPremiumPercent: number;
  amount: number;
  label: string;
  taxable: boolean;
  includeInSssBase: boolean;
  includeInPagIbigBase: boolean;
};

const PAY_POLICY_HOLIDAY_TYPES = new Set<PayPolicyHolidayType>([
  "ordinary",
  "special",
  "regular",
  "double",
]);

function ruleMatchesHolidayRestDayPremium(
  rule: PayPolicyRuleRecord,
  context: {
    holidayType: PayPolicyHolidayType;
    restDay: boolean;
    shiftCode: string | null;
    worksiteId: number | null;
  },
) {
  const conditions = asObject(rule.conditions, `Pay rule ${rule.ruleKey} conditions`);
  assertOnlyKeys(
    conditions,
    ["holidayTypes", "restDay", "shiftCodes", "worksiteIds"],
    `Pay rule ${rule.ruleKey} conditions`,
  );

  let holidayTypes: PayPolicyHolidayType[] | null = null;
  if (conditions.holidayTypes != null) {
    if (!Array.isArray(conditions.holidayTypes) || conditions.holidayTypes.length === 0) {
      throw new Error(
        `Pay rule ${rule.ruleKey} holidayTypes must be a non-empty array when supplied.`,
      );
    }
    holidayTypes = conditions.holidayTypes.map((item) => {
      if (typeof item !== "string" || !PAY_POLICY_HOLIDAY_TYPES.has(item as PayPolicyHolidayType)) {
        throw new Error(
          `Pay rule ${rule.ruleKey} holidayTypes must contain only ordinary, special, regular, or double.`,
        );
      }
      return item as PayPolicyHolidayType;
    });
  }

  if (conditions.restDay != null && typeof conditions.restDay !== "boolean") {
    throw new Error(`Pay rule ${rule.ruleKey} restDay must be true or false when supplied.`);
  }

  const targetsPremiumDay =
    conditions.restDay === true
    || Boolean(holidayTypes?.some((item) => item !== "ordinary"));
  if (!targetsPremiumDay) {
    throw new Error(
      `Pay rule ${rule.ruleKey} must target a holiday and/or rest day; ordinary non-rest-day premiums belong in ${WORKED_TIME_PREMIUM_EVENT}.`,
    );
  }

  if (holidayTypes && !holidayTypes.includes(context.holidayType)) {
    return false;
  }
  if (
    typeof conditions.restDay === "boolean"
    && conditions.restDay !== context.restDay
  ) {
    return false;
  }

  if (conditions.shiftCodes != null) {
    if (!Array.isArray(conditions.shiftCodes) || conditions.shiftCodes.length === 0) {
      throw new Error(`Pay rule ${rule.ruleKey} shiftCodes must be a non-empty array when supplied.`);
    }
    const shiftCodes = conditions.shiftCodes.map((item) => {
      if (typeof item !== "string" || !item.trim()) {
        throw new Error(`Pay rule ${rule.ruleKey} shiftCodes must contain non-empty strings.`);
      }
      return normalizeShiftCode(item);
    });
    if (!context.shiftCode) {
      throw new Error(
        `Pay rule ${rule.ruleKey} requires shift-code evidence, but payroll could not resolve a shift code.`,
      );
    }
    if (!shiftCodes.includes(normalizeShiftCode(context.shiftCode))) {
      return false;
    }
  }

  if (conditions.worksiteIds != null) {
    if (!Array.isArray(conditions.worksiteIds) || conditions.worksiteIds.length === 0) {
      throw new Error(`Pay rule ${rule.ruleKey} worksiteIds must be a non-empty array when supplied.`);
    }
    const worksiteIds = conditions.worksiteIds.map((item) => {
      const id = Number(item);
      if (!Number.isInteger(id) || id <= 0) {
        throw new Error(`Pay rule ${rule.ruleKey} worksiteIds must contain positive integer IDs.`);
      }
      return id;
    });
    if (context.worksiteId == null) {
      throw new Error(
        `Pay rule ${rule.ruleKey} requires worksite evidence, but payroll could not resolve a worksite.`,
      );
    }
    if (!worksiteIds.includes(context.worksiteId)) {
      return false;
    }
  }

  return true;
}

function parseHolidayRestDayPremiumOutcome(rule: PayPolicyRuleRecord) {
  const outcome = asObject(rule.outcome, `Pay rule ${rule.ruleKey} outcome`);
  assertOnlyKeys(
    outcome,
    [
      "label",
      "additionalPremiumPercent",
      "taxable",
      "includeInSssBase",
      "includeInPagIbigBase",
    ],
    `Pay rule ${rule.ruleKey} outcome`,
  );

  const additionalPremiumPercent = positiveFiniteNumber(
    outcome.additionalPremiumPercent,
    `Pay rule ${rule.ruleKey} additionalPremiumPercent`,
    500,
  );
  if (additionalPremiumPercent <= 0) {
    throw new Error(
      `Pay rule ${rule.ruleKey} additionalPremiumPercent must be greater than zero.`,
    );
  }

  const label = typeof outcome.label === "string" && outcome.label.trim()
    ? outcome.label.trim().slice(0, 160)
    : rule.ruleKey;

  return {
    label,
    additionalPremiumPercent,
    taxable: requiredBoolean(outcome.taxable, `Pay rule ${rule.ruleKey} taxable`),
    includeInSssBase: requiredBoolean(
      outcome.includeInSssBase,
      `Pay rule ${rule.ruleKey} includeInSssBase`,
    ),
    includeInPagIbigBase: requiredBoolean(
      outcome.includeInPagIbigBase,
      `Pay rule ${rule.ruleKey} includeInPagIbigBase`,
    ),
  };
}

/**
 * Executes configurable employer/CBA holiday and rest-day top-ups for regular
 * worked minutes only.
 *
 * The statutory holiday/rest-day multiplier remains authoritative and is never
 * replaced. Each matching rule adds an explicit percentage of base hourly pay
 * above that floor. Overtime and night-differential arithmetic stay on their
 * statutory engines until those rule families are migrated independently.
 *
 * Distinct rule keys stack intentionally. A higher-precedence matching policy
 * shadows a lower-precedence rule with the same rule key.
 */
export function resolveHolidayRestDayPremium(input: {
  organizationId: number;
  employeeId: number;
  orgUnitIds?: number[];
  workDate: string;
  minutes: number;
  hourlyRate: number;
  holidayType: PayPolicyHolidayType;
  restDay: boolean;
  statutoryMultiplier: number;
  shiftCode: string | null;
  worksiteId: number | null;
  policies: PayPolicyRecord[];
  rules: PayPolicyRuleRecord[];
}) {
  const minutes = Math.max(0, Math.trunc(input.minutes));
  const hourlyRate = Number(input.hourlyRate);
  const statutoryMultiplier = Number(input.statutoryMultiplier);
  if (!Number.isFinite(hourlyRate) || hourlyRate < 0) {
    throw new Error("Holiday/rest-day premium hourlyRate must be a non-negative finite number.");
  }
  if (
    !Number.isFinite(statutoryMultiplier)
    || statutoryMultiplier < 1
    || statutoryMultiplier > 10
  ) {
    throw new Error(
      "Holiday/rest-day premium statutoryMultiplier must be between 1 and 10.",
    );
  }
  if (!PAY_POLICY_HOLIDAY_TYPES.has(input.holidayType)) {
    throw new Error(`Unsupported holiday type "${input.holidayType}".`);
  }

  const policies = resolveApplicablePayPolicies({
    organizationId: input.organizationId,
    employeeId: input.employeeId,
    orgUnitIds: input.orgUnitIds,
    asOf: input.workDate,
    policies: input.policies,
  });
  const policyById = new Map(policies.map((policy) => [policy.id, policy]));
  const ordered = orderedPayPolicyRules({ policies, rules: input.rules })
    .filter((rule) => rule.eventType === HOLIDAY_REST_DAY_PREMIUM_EVENT);

  const claimedRuleKeys = new Set<string>();
  const applied: AppliedHolidayRestDayPremiumRule[] = [];

  for (const rule of ordered) {
    if (!rule.statutoryFloorProtected) {
      throw new Error(
        `Executable pay rule ${rule.ruleKey} must keep statutoryFloorProtected=true.`,
      );
    }

    const matches = ruleMatchesHolidayRestDayPremium(rule, {
      holidayType: input.holidayType,
      restDay: input.restDay,
      shiftCode: input.shiftCode,
      worksiteId: input.worksiteId,
    });
    if (!matches) continue;

    if (claimedRuleKeys.has(rule.ruleKey)) continue;
    claimedRuleKeys.add(rule.ruleKey);

    const policy = policyById.get(rule.policyId);
    if (!policy) continue;
    const outcome = parseHolidayRestDayPremiumOutcome(rule);
    const amount = roundMoney(
      (minutes / 60)
        * hourlyRate
        * (outcome.additionalPremiumPercent / 100),
    );
    if (amount <= 0 || minutes <= 0) continue;

    applied.push({
      ruleId: rule.id,
      ruleKey: rule.ruleKey,
      eventType: HOLIDAY_REST_DAY_PREMIUM_EVENT,
      policyId: policy.id,
      policyCode: policy.code,
      policyName: policy.name,
      policyVersion: policy.version,
      policyKind: policy.policyKind,
      policyScopeType: policy.scopeType,
      workDate: input.workDate,
      minutes,
      hourlyRate,
      holidayType: input.holidayType,
      restDay: input.restDay,
      shiftCode: input.shiftCode,
      worksiteId: input.worksiteId,
      statutoryMultiplier,
      additionalPremiumPercent: outcome.additionalPremiumPercent,
      amount,
      label: outcome.label,
      taxable: outcome.taxable,
      includeInSssBase: outcome.includeInSssBase,
      includeInPagIbigBase: outcome.includeInPagIbigBase,
    });
  }

  return {
    version: "holiday-rest-day-premium-v1" as const,
    statutoryFloorMode: "additive-only" as const,
    overtimeMode: "statutory-only" as const,
    nightDifferentialMode: "statutory-only" as const,
    policies: payPolicyTrace(policies),
    amount: roundMoney(applied.reduce((sum, item) => sum + item.amount, 0)),
    taxableAmount: roundMoney(
      applied.reduce((sum, item) => sum + (item.taxable ? item.amount : 0), 0),
    ),
    sssIncludedAmount: roundMoney(
      applied.reduce((sum, item) => sum + (item.includeInSssBase ? item.amount : 0), 0),
    ),
    pagIbigIncludedAmount: roundMoney(
      applied.reduce((sum, item) => sum + (item.includeInPagIbigBase ? item.amount : 0), 0),
    ),
    applied,
  };
}


export const OVERTIME_PREMIUM_EVENT = "overtime_premium";

export type AppliedOvertimePremiumRule = {
  ruleId: number;
  ruleKey: string;
  eventType: typeof OVERTIME_PREMIUM_EVENT;
  policyId: number;
  policyCode: string;
  policyName: string;
  policyVersion: string;
  policyKind: string;
  policyScopeType: PayPolicyScope;
  workDate: string;
  minutes: number;
  hourlyRate: number;
  holidayType: PayPolicyHolidayType;
  restDay: boolean;
  shiftCode: string | null;
  worksiteId: number | null;
  statutoryMultiplier: number;
  additionalPremiumPercent: number;
  amount: number;
  label: string;
  taxable: boolean;
  includeInSssBase: boolean;
  includeInPagIbigBase: boolean;
};

function ruleMatchesOvertimePremium(
  rule: PayPolicyRuleRecord,
  context: {
    holidayType: PayPolicyHolidayType;
    restDay: boolean;
    shiftCode: string | null;
    worksiteId: number | null;
  },
) {
  const conditions = asObject(rule.conditions, `Pay rule ${rule.ruleKey} conditions`);
  assertOnlyKeys(
    conditions,
    ["holidayTypes", "restDay", "shiftCodes", "worksiteIds"],
    `Pay rule ${rule.ruleKey} conditions`,
  );

  if (conditions.holidayTypes != null) {
    if (!Array.isArray(conditions.holidayTypes) || conditions.holidayTypes.length === 0) {
      throw new Error(
        `Pay rule ${rule.ruleKey} holidayTypes must be a non-empty array when supplied.`,
      );
    }
    const holidayTypes = conditions.holidayTypes.map((item) => {
      if (typeof item !== "string" || !PAY_POLICY_HOLIDAY_TYPES.has(item as PayPolicyHolidayType)) {
        throw new Error(
          `Pay rule ${rule.ruleKey} holidayTypes must contain only ordinary, special, regular, or double.`,
        );
      }
      return item as PayPolicyHolidayType;
    });
    if (!holidayTypes.includes(context.holidayType)) return false;
  }

  if (conditions.restDay != null) {
    if (typeof conditions.restDay !== "boolean") {
      throw new Error(`Pay rule ${rule.ruleKey} restDay must be true or false when supplied.`);
    }
    if (conditions.restDay !== context.restDay) return false;
  }

  if (conditions.shiftCodes != null) {
    if (!Array.isArray(conditions.shiftCodes) || conditions.shiftCodes.length === 0) {
      throw new Error(`Pay rule ${rule.ruleKey} shiftCodes must be a non-empty array when supplied.`);
    }
    const shiftCodes = conditions.shiftCodes.map((item) => {
      if (typeof item !== "string" || !item.trim()) {
        throw new Error(`Pay rule ${rule.ruleKey} shiftCodes must contain non-empty strings.`);
      }
      return normalizeShiftCode(item);
    });
    if (!context.shiftCode) {
      throw new Error(
        `Pay rule ${rule.ruleKey} requires shift-code evidence, but payroll could not resolve a shift code.`,
      );
    }
    if (!shiftCodes.includes(normalizeShiftCode(context.shiftCode))) return false;
  }

  if (conditions.worksiteIds != null) {
    if (!Array.isArray(conditions.worksiteIds) || conditions.worksiteIds.length === 0) {
      throw new Error(`Pay rule ${rule.ruleKey} worksiteIds must be a non-empty array when supplied.`);
    }
    const worksiteIds = conditions.worksiteIds.map((item) => {
      const id = Number(item);
      if (!Number.isInteger(id) || id <= 0) {
        throw new Error(`Pay rule ${rule.ruleKey} worksiteIds must contain positive integer IDs.`);
      }
      return id;
    });
    if (context.worksiteId == null) {
      throw new Error(
        `Pay rule ${rule.ruleKey} requires worksite evidence, but payroll could not resolve a worksite.`,
      );
    }
    if (!worksiteIds.includes(context.worksiteId)) return false;
  }

  return true;
}

function parseOvertimePremiumOutcome(rule: PayPolicyRuleRecord) {
  const outcome = asObject(rule.outcome, `Pay rule ${rule.ruleKey} outcome`);
  assertOnlyKeys(
    outcome,
    [
      "label",
      "additionalPremiumPercent",
      "taxable",
      "includeInSssBase",
      "includeInPagIbigBase",
    ],
    `Pay rule ${rule.ruleKey} outcome`,
  );

  const additionalPremiumPercent = positiveFiniteNumber(
    outcome.additionalPremiumPercent,
    `Pay rule ${rule.ruleKey} additionalPremiumPercent`,
    500,
  );
  if (additionalPremiumPercent <= 0) {
    throw new Error(
      `Pay rule ${rule.ruleKey} additionalPremiumPercent must be greater than zero.`,
    );
  }

  const label = typeof outcome.label === "string" && outcome.label.trim()
    ? outcome.label.trim().slice(0, 160)
    : rule.ruleKey;

  return {
    label,
    additionalPremiumPercent,
    taxable: requiredBoolean(outcome.taxable, `Pay rule ${rule.ruleKey} taxable`),
    includeInSssBase: requiredBoolean(
      outcome.includeInSssBase,
      `Pay rule ${rule.ruleKey} includeInSssBase`,
    ),
    includeInPagIbigBase: requiredBoolean(
      outcome.includeInPagIbigBase,
      `Pay rule ${rule.ruleKey} includeInPagIbigBase`,
    ),
  };
}

/**
 * Executes configurable employer/CBA overtime top-ups above the statutory OT
 * result. The statutory multiplier remains authoritative; this family only
 * adds a percentage of base hourly pay for validated overtime minutes.
 *
 * Authorization status is deliberately not a pay condition. Payroll continues
 * to preserve OT authorization as separate review evidence so a missing or
 * late approval cannot suppress statutory entitlement.
 */
export function resolveOvertimePremium(input: {
  organizationId: number;
  employeeId: number;
  orgUnitIds?: number[];
  workDate: string;
  minutes: number;
  hourlyRate: number;
  holidayType: PayPolicyHolidayType;
  restDay: boolean;
  statutoryMultiplier: number;
  shiftCode: string | null;
  worksiteId: number | null;
  policies: PayPolicyRecord[];
  rules: PayPolicyRuleRecord[];
}) {
  const minutes = Math.max(0, Math.trunc(input.minutes));
  const hourlyRate = Number(input.hourlyRate);
  const statutoryMultiplier = Number(input.statutoryMultiplier);

  if (!Number.isFinite(hourlyRate) || hourlyRate < 0) {
    throw new Error("Overtime premium hourlyRate must be a non-negative finite number.");
  }
  if (
    !Number.isFinite(statutoryMultiplier)
    || statutoryMultiplier < 1
    || statutoryMultiplier > 10
  ) {
    throw new Error("Overtime premium statutoryMultiplier must be between 1 and 10.");
  }
  if (!PAY_POLICY_HOLIDAY_TYPES.has(input.holidayType)) {
    throw new Error(`Unsupported holiday type "${input.holidayType}".`);
  }

  const policies = resolveApplicablePayPolicies({
    organizationId: input.organizationId,
    employeeId: input.employeeId,
    orgUnitIds: input.orgUnitIds,
    asOf: input.workDate,
    policies: input.policies,
  });
  const policyById = new Map(policies.map((policy) => [policy.id, policy]));
  const ordered = orderedPayPolicyRules({ policies, rules: input.rules })
    .filter((rule) => rule.eventType === OVERTIME_PREMIUM_EVENT);

  const claimedRuleKeys = new Set<string>();
  const applied: AppliedOvertimePremiumRule[] = [];

  for (const rule of ordered) {
    if (!rule.statutoryFloorProtected) {
      throw new Error(
        `Executable pay rule ${rule.ruleKey} must keep statutoryFloorProtected=true.`,
      );
    }

    const matches = ruleMatchesOvertimePremium(rule, {
      holidayType: input.holidayType,
      restDay: input.restDay,
      shiftCode: input.shiftCode,
      worksiteId: input.worksiteId,
    });
    if (!matches) continue;

    if (claimedRuleKeys.has(rule.ruleKey)) continue;
    claimedRuleKeys.add(rule.ruleKey);

    const policy = policyById.get(rule.policyId);
    if (!policy) continue;
    const outcome = parseOvertimePremiumOutcome(rule);
    const amount = roundMoney(
      (minutes / 60)
        * hourlyRate
        * (outcome.additionalPremiumPercent / 100),
    );
    if (amount <= 0 || minutes <= 0) continue;

    applied.push({
      ruleId: rule.id,
      ruleKey: rule.ruleKey,
      eventType: OVERTIME_PREMIUM_EVENT,
      policyId: policy.id,
      policyCode: policy.code,
      policyName: policy.name,
      policyVersion: policy.version,
      policyKind: policy.policyKind,
      policyScopeType: policy.scopeType,
      workDate: input.workDate,
      minutes,
      hourlyRate,
      holidayType: input.holidayType,
      restDay: input.restDay,
      shiftCode: input.shiftCode,
      worksiteId: input.worksiteId,
      statutoryMultiplier,
      additionalPremiumPercent: outcome.additionalPremiumPercent,
      amount,
      label: outcome.label,
      taxable: outcome.taxable,
      includeInSssBase: outcome.includeInSssBase,
      includeInPagIbigBase: outcome.includeInPagIbigBase,
    });
  }

  return {
    version: "overtime-premium-v1" as const,
    statutoryFloorMode: "additive-only" as const,
    authorizationMode: "evidence-only" as const,
    nightDifferentialMode: "statutory-only" as const,
    policies: payPolicyTrace(policies),
    amount: roundMoney(applied.reduce((sum, item) => sum + item.amount, 0)),
    taxableAmount: roundMoney(
      applied.reduce((sum, item) => sum + (item.taxable ? item.amount : 0), 0),
    ),
    sssIncludedAmount: roundMoney(
      applied.reduce((sum, item) => sum + (item.includeInSssBase ? item.amount : 0), 0),
    ),
    pagIbigIncludedAmount: roundMoney(
      applied.reduce((sum, item) => sum + (item.includeInPagIbigBase ? item.amount : 0), 0),
    ),
    applied,
  };
}


export const NIGHT_DIFFERENTIAL_PREMIUM_EVENT = "night_differential_premium";

export type AppliedNightDifferentialPremiumRule = {
  ruleId: number;
  ruleKey: string;
  eventType: typeof NIGHT_DIFFERENTIAL_PREMIUM_EVENT;
  policyId: number;
  policyCode: string;
  policyName: string;
  policyVersion: string;
  policyKind: string;
  policyScopeType: PayPolicyScope;
  workDate: string;
  minutes: number;
  hourlyRate: number;
  holidayType: PayPolicyHolidayType;
  restDay: boolean;
  overtime: boolean;
  shiftCode: string | null;
  worksiteId: number | null;
  statutoryMultiplier: number;
  statutoryDifferentialPercent: number;
  additionalDifferentialPercent: number;
  amount: number;
  label: string;
  taxable: boolean;
  includeInSssBase: boolean;
  includeInPagIbigBase: boolean;
};

function ruleMatchesNightDifferentialPremium(
  rule: PayPolicyRuleRecord,
  context: {
    holidayType: PayPolicyHolidayType;
    restDay: boolean;
    overtime: boolean;
    shiftCode: string | null;
    worksiteId: number | null;
  },
) {
  const conditions = asObject(rule.conditions, `Pay rule ${rule.ruleKey} conditions`);
  assertOnlyKeys(
    conditions,
    ["holidayTypes", "restDay", "overtime", "shiftCodes", "worksiteIds"],
    `Pay rule ${rule.ruleKey} conditions`,
  );

  if (conditions.holidayTypes != null) {
    if (!Array.isArray(conditions.holidayTypes) || conditions.holidayTypes.length === 0) {
      throw new Error(
        `Pay rule ${rule.ruleKey} holidayTypes must be a non-empty array when supplied.`,
      );
    }
    const holidayTypes = conditions.holidayTypes.map((item) => {
      if (typeof item !== "string" || !PAY_POLICY_HOLIDAY_TYPES.has(item as PayPolicyHolidayType)) {
        throw new Error(
          `Pay rule ${rule.ruleKey} holidayTypes must contain only ordinary, special, regular, or double.`,
        );
      }
      return item as PayPolicyHolidayType;
    });
    if (!holidayTypes.includes(context.holidayType)) return false;
  }

  if (conditions.restDay != null) {
    if (typeof conditions.restDay !== "boolean") {
      throw new Error(`Pay rule ${rule.ruleKey} restDay must be true or false when supplied.`);
    }
    if (conditions.restDay !== context.restDay) return false;
  }

  if (conditions.overtime != null) {
    if (typeof conditions.overtime !== "boolean") {
      throw new Error(`Pay rule ${rule.ruleKey} overtime must be true or false when supplied.`);
    }
    if (conditions.overtime !== context.overtime) return false;
  }

  if (conditions.shiftCodes != null) {
    if (!Array.isArray(conditions.shiftCodes) || conditions.shiftCodes.length === 0) {
      throw new Error(`Pay rule ${rule.ruleKey} shiftCodes must be a non-empty array when supplied.`);
    }
    const shiftCodes = conditions.shiftCodes.map((item) => {
      if (typeof item !== "string" || !item.trim()) {
        throw new Error(`Pay rule ${rule.ruleKey} shiftCodes must contain non-empty strings.`);
      }
      return normalizeShiftCode(item);
    });
    if (!context.shiftCode) {
      throw new Error(
        `Pay rule ${rule.ruleKey} requires shift-code evidence, but payroll could not resolve a shift code.`,
      );
    }
    if (!shiftCodes.includes(normalizeShiftCode(context.shiftCode))) return false;
  }

  if (conditions.worksiteIds != null) {
    if (!Array.isArray(conditions.worksiteIds) || conditions.worksiteIds.length === 0) {
      throw new Error(`Pay rule ${rule.ruleKey} worksiteIds must be a non-empty array when supplied.`);
    }
    const worksiteIds = conditions.worksiteIds.map((item) => {
      const id = Number(item);
      if (!Number.isInteger(id) || id <= 0) {
        throw new Error(`Pay rule ${rule.ruleKey} worksiteIds must contain positive integer IDs.`);
      }
      return id;
    });
    if (context.worksiteId == null) {
      throw new Error(
        `Pay rule ${rule.ruleKey} requires worksite evidence, but payroll could not resolve a worksite.`,
      );
    }
    if (!worksiteIds.includes(context.worksiteId)) return false;
  }

  return true;
}

function parseNightDifferentialPremiumOutcome(rule: PayPolicyRuleRecord) {
  const outcome = asObject(rule.outcome, `Pay rule ${rule.ruleKey} outcome`);
  assertOnlyKeys(
    outcome,
    [
      "label",
      "additionalDifferentialPercent",
      "taxable",
      "includeInSssBase",
      "includeInPagIbigBase",
    ],
    `Pay rule ${rule.ruleKey} outcome`,
  );

  const additionalDifferentialPercent = positiveFiniteNumber(
    outcome.additionalDifferentialPercent,
    `Pay rule ${rule.ruleKey} additionalDifferentialPercent`,
    500,
  );
  if (additionalDifferentialPercent <= 0) {
    throw new Error(
      `Pay rule ${rule.ruleKey} additionalDifferentialPercent must be greater than zero.`,
    );
  }

  const label = typeof outcome.label === "string" && outcome.label.trim()
    ? outcome.label.trim().slice(0, 160)
    : rule.ruleKey;

  return {
    label,
    additionalDifferentialPercent,
    taxable: requiredBoolean(outcome.taxable, `Pay rule ${rule.ruleKey} taxable`),
    includeInSssBase: requiredBoolean(
      outcome.includeInSssBase,
      `Pay rule ${rule.ruleKey} includeInSssBase`,
    ),
    includeInPagIbigBase: requiredBoolean(
      outcome.includeInPagIbigBase,
      `Pay rule ${rule.ruleKey} includeInPagIbigBase`,
    ),
  };
}

/**
 * Executes employer/CBA night-differential top-ups only for payable minutes
 * already classified inside the statutory 10 PM–6 AM night window.
 *
 * The statutory 10% differential remains authoritative and is calculated
 * separately by payroll. This family can only add an additional percentage of
 * the same holiday/rest-day/overtime-adjusted hourly base.
 */
export function resolveNightDifferentialPremium(input: {
  organizationId: number;
  employeeId: number;
  orgUnitIds?: number[];
  workDate: string;
  minutes: number;
  hourlyRate: number;
  holidayType: PayPolicyHolidayType;
  restDay: boolean;
  overtime: boolean;
  statutoryMultiplier: number;
  shiftCode: string | null;
  worksiteId: number | null;
  policies: PayPolicyRecord[];
  rules: PayPolicyRuleRecord[];
}) {
  const minutes = Math.max(0, Math.trunc(input.minutes));
  const hourlyRate = Number(input.hourlyRate);
  const statutoryMultiplier = Number(input.statutoryMultiplier);
  if (!Number.isFinite(hourlyRate) || hourlyRate < 0) {
    throw new Error("Night-differential premium hourlyRate must be a non-negative finite number.");
  }
  if (!Number.isFinite(statutoryMultiplier) || statutoryMultiplier < 1 || statutoryMultiplier > 10) {
    throw new Error("Night-differential premium statutoryMultiplier must be between 1 and 10.");
  }
  if (!PAY_POLICY_HOLIDAY_TYPES.has(input.holidayType)) {
    throw new Error(`Unsupported holiday type "${input.holidayType}".`);
  }

  const policies = resolveApplicablePayPolicies({
    organizationId: input.organizationId,
    employeeId: input.employeeId,
    orgUnitIds: input.orgUnitIds,
    asOf: input.workDate,
    policies: input.policies,
  });
  const policyById = new Map(policies.map((policy) => [policy.id, policy]));
  const ordered = orderedPayPolicyRules({ policies, rules: input.rules })
    .filter((rule) => rule.eventType === NIGHT_DIFFERENTIAL_PREMIUM_EVENT);

  const claimedRuleKeys = new Set<string>();
  const applied: AppliedNightDifferentialPremiumRule[] = [];

  for (const rule of ordered) {
    if (!rule.statutoryFloorProtected) {
      throw new Error(
        `Executable pay rule ${rule.ruleKey} must keep statutoryFloorProtected=true.`,
      );
    }

    const matches = ruleMatchesNightDifferentialPremium(rule, {
      holidayType: input.holidayType,
      restDay: input.restDay,
      overtime: input.overtime,
      shiftCode: input.shiftCode,
      worksiteId: input.worksiteId,
    });
    if (!matches) continue;
    if (claimedRuleKeys.has(rule.ruleKey)) continue;
    claimedRuleKeys.add(rule.ruleKey);

    const policy = policyById.get(rule.policyId);
    if (!policy) continue;
    const outcome = parseNightDifferentialPremiumOutcome(rule);
    const amount = roundMoney(
      (minutes / 60)
        * hourlyRate
        * statutoryMultiplier
        * (outcome.additionalDifferentialPercent / 100),
    );
    if (amount <= 0 || minutes <= 0) continue;

    applied.push({
      ruleId: rule.id,
      ruleKey: rule.ruleKey,
      eventType: NIGHT_DIFFERENTIAL_PREMIUM_EVENT,
      policyId: policy.id,
      policyCode: policy.code,
      policyName: policy.name,
      policyVersion: policy.version,
      policyKind: policy.policyKind,
      policyScopeType: policy.scopeType,
      workDate: input.workDate,
      minutes,
      hourlyRate,
      holidayType: input.holidayType,
      restDay: input.restDay,
      overtime: input.overtime,
      shiftCode: input.shiftCode,
      worksiteId: input.worksiteId,
      statutoryMultiplier,
      statutoryDifferentialPercent: 10,
      additionalDifferentialPercent: outcome.additionalDifferentialPercent,
      amount,
      label: outcome.label,
      taxable: outcome.taxable,
      includeInSssBase: outcome.includeInSssBase,
      includeInPagIbigBase: outcome.includeInPagIbigBase,
    });
  }

  return {
    version: "night-differential-premium-v1" as const,
    statutoryFloorMode: "additive-only" as const,
    statutoryDifferentialPercent: 10 as const,
    policies: payPolicyTrace(policies),
    amount: roundMoney(applied.reduce((sum, item) => sum + item.amount, 0)),
    taxableAmount: roundMoney(
      applied.reduce((sum, item) => sum + (item.taxable ? item.amount : 0), 0),
    ),
    sssIncludedAmount: roundMoney(
      applied.reduce((sum, item) => sum + (item.includeInSssBase ? item.amount : 0), 0),
    ),
    pagIbigIncludedAmount: roundMoney(
      applied.reduce((sum, item) => sum + (item.includeInPagIbigBase ? item.amount : 0), 0),
    ),
    applied,
  };
}
