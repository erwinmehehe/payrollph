export const DYNAMIC_WORKER_GROUP_OPERATORS = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
  "in",
  "exists",
] as const;

export type DynamicWorkerGroupOperator = (typeof DYNAMIC_WORKER_GROUP_OPERATORS)[number];

export type DynamicWorkerGroupConditionClause = {
  field: string;
  operator: DynamicWorkerGroupOperator;
  value?: unknown;
};

export type DynamicWorkerGroupConditions = {
  version?: 1;
  all?: DynamicWorkerGroupConditionClause[];
  any?: DynamicWorkerGroupConditionClause[];
};

export const DYNAMIC_WORKER_GROUP_FIELDS = [
  { value: "orgUnitId", label: "Org unit ID", kind: "number" },
  { value: "department", label: "Department / org unit", kind: "string" },
  { value: "location", label: "Location / region", kind: "string" },
  { value: "employmentType", label: "Employment type", kind: "string" },
  { value: "title", label: "Job title", kind: "string" },
  { value: "role", label: "Role / job profile", kind: "string" },
  { value: "jobFamily", label: "Job family", kind: "string" },
  { value: "jobLevel", label: "Job level", kind: "string" },
  { value: "grade", label: "Grade", kind: "string" },
  { value: "salary", label: "Monthly-equivalent salary", kind: "number" },
  { value: "tenureDays", label: "Tenure (days)", kind: "number" },
  { value: "tenureYears", label: "Tenure (years)", kind: "number" },
  { value: "employeeStatus", label: "Employee status", kind: "string" },
  { value: "legalEntityId", label: "Legal employer ID", kind: "number" },
  { value: "positionCode", label: "Position code", kind: "string" },
  { value: "verifiedSkillCodes", label: "Verified skill code", kind: "string_array" },
  { value: "validCredentialCodes", label: "Valid credential code", kind: "string_array" },
] as const;

const FIELD_SET = new Set<string>(DYNAMIC_WORKER_GROUP_FIELDS.map((field) => field.value));

function scalar(value: unknown) {
  return ["string", "number", "boolean"].includes(typeof value) || value === null;
}

function validClause(value: unknown): value is DynamicWorkerGroupConditionClause {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const field = String(row.field ?? "").trim();
  const operator = String(row.operator ?? "") as DynamicWorkerGroupOperator;
  if (!FIELD_SET.has(field)) return false;
  if (!(DYNAMIC_WORKER_GROUP_OPERATORS as readonly string[]).includes(operator)) return false;
  if (operator === "exists") {
    return row.value === undefined || typeof row.value === "boolean";
  }
  if (operator === "in") {
    return Array.isArray(row.value)
      && row.value.length > 0
      && row.value.length <= 50
      && row.value.every(scalar);
  }
  return scalar(row.value);
}

export function validDynamicWorkerGroupConditions(value: unknown): value is DynamicWorkerGroupConditions {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const keys = Object.keys(row);
  if (keys.some((key) => !["version", "all", "any"].includes(key))) return false;
  if (row.version !== undefined && row.version !== 1) return false;
  const all = row.all === undefined ? [] : row.all;
  const any = row.any === undefined ? [] : row.any;
  if (!Array.isArray(all) || !Array.isArray(any)) return false;
  if (all.length + any.length < 1 || all.length + any.length > 20) return false;
  return all.every(validClause) && any.every(validClause);
}

function valueAtPath(context: Record<string, unknown>, path: string) {
  let value: unknown = context;
  for (const part of path.split(".")) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

export function dynamicGroupClauseMatches(
  clause: DynamicWorkerGroupConditionClause,
  context: Record<string, unknown>,
) {
  const actual = valueAtPath(context, clause.field);
  const expected = clause.value;

  if (clause.operator === "exists") {
    const exists = actual !== undefined
      && actual !== null
      && actual !== ""
      && (!Array.isArray(actual) || actual.length > 0);
    return expected === false ? !exists : exists;
  }

  if (clause.operator === "contains") {
    const needle = String(expected ?? "").toLowerCase();
    if (Array.isArray(actual)) {
      return actual.some((item) => String(item ?? "").toLowerCase().includes(needle));
    }
    return String(actual ?? "").toLowerCase().includes(needle);
  }

  if (clause.operator === "in") {
    if (!Array.isArray(expected)) return false;
    if (Array.isArray(actual)) {
      return actual.some((actualItem) =>
        expected.some((item) => actualItem === item || String(actualItem ?? "") === String(item ?? "")),
      );
    }
    return expected.some((item) => actual === item || String(actual ?? "") === String(item ?? ""));
  }

  if (clause.operator === "eq") {
    return actual === expected || String(actual ?? "") === String(expected ?? "");
  }
  if (clause.operator === "neq") {
    return !(actual === expected || String(actual ?? "") === String(expected ?? ""));
  }

  const left = Number(actual);
  const right = Number(expected);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  if (clause.operator === "gt") return left > right;
  if (clause.operator === "gte") return left >= right;
  if (clause.operator === "lt") return left < right;
  if (clause.operator === "lte") return left <= right;
  return false;
}

export function workerMatchesDynamicGroup(
  conditions: DynamicWorkerGroupConditions,
  context: Record<string, unknown>,
) {
  const all = conditions.all ?? [];
  const any = conditions.any ?? [];
  if (!all.every((clause) => dynamicGroupClauseMatches(clause, context))) return false;
  if (any.length > 0 && !any.some((clause) => dynamicGroupClauseMatches(clause, context))) return false;
  return true;
}

export function normalizeDynamicGroupCode(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
