/**
 * Strict read-only boundary for the employer-scoped HCM governance inventory.
 * A 200 response is not proof of a complete, current-employer report.
 * Never turn missing categories/counts into an empty or "all clear" snapshot.
 */
export type HcmGovernanceReport = {
  organizationId: number;
  asOf: string;
  status: "manual_review_required" | "inventory_only";
  summary: {
    employeeCount: number;
    currentWorkers: number;
    highPriorityCategories: number;
    reviewCategories: number;
    inProgressBusinessProcesses: number;
    pendingHcmSteps: number;
    overdueHcmSteps: number;
  };
  findings: Array<{
    code: string;
    severity: "high" | "review";
    affected: number;
    title: string;
    nextAction: string;
  }>;
  processes: Array<{
    processType: string;
    configuredDefinitions: number;
    currentActiveDefinitions: number;
    scopedDefinitions: number;
    policyState: string;
  }>;
  limitations: string[];
};

const FINDING_SEVERITY: Record<string, "high" | "review"> = {
  HCM_APPROVAL_TASK_MISMATCH: "high",
  HCM_PROCESS_NO_ACTIVE_STEP: "high",
  HCM_OVERDUE_WORK_ITEMS: "review",
  UNKNOWN_WAGE_REGION: "high",
  DUPLICATE_EMPLOYEE_NUMBERS: "high",
  FINAL_PAY_CLEARANCE_MISMATCH: "high",
  FINAL_PAY_EMPLOYEE_STATUS_MISMATCH: "high",
  FINAL_PAY_REFERENCE_MISSING: "high",
  SEPARATED_WITH_ACTIVE_POSITION: "review",
  FUTURE_EMPLOYMENT_START_DATE: "review",
  PAY_PROFILE_MISSING: "review",
  REST_DAY_NOT_CONFIGURED: "review",
};

const PROCESS_TYPES = [
  "hire", "change_job", "promotion", "transfer",
  "compensation_change", "termination", "create_position", "close_position",
] as const;
const POLICY_STATES = new Set([
  "system_default_or_not_configured",
  "active_definition_exists",
  "configured_without_current_active_definition",
]);

function invalid(): never {
  throw new Error("HCM governance response was incomplete or inconsistent. Refresh to verify the employer's records.");
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}

function text(value: unknown, maxLength = 1000): string {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) return invalid();
  return value.trim();
}

function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return invalid();
  return value;
}

function entries(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) return invalid();
  return value;
}

/** Includes status handling for direct, unit-testable 401/403/404/5xx responses. */
export function parseHcmGovernanceReadinessResponse(
  statusCode: number,
  raw: unknown,
  expectedOrganizationId: number,
): HcmGovernanceReport {
  if (statusCode === 401) throw new Error("Sign in again to view HCM governance records.");
  if (statusCode === 403) throw new Error("Company-wide People administrator access is required for this report.");
  if (statusCode === 404) throw new Error("HCM governance inventory is not enabled or available for this employer.");
  if (statusCode !== 200) throw new Error("HCM governance records could not be loaded. Retry the request.");
  if (!Number.isSafeInteger(expectedOrganizationId) || expectedOrganizationId <= 0) return invalid();

  const payload = record(raw);
  if (payload.organizationId !== expectedOrganizationId) {
    throw new Error("HCM governance response did not match the selected employer. Refresh before reviewing evidence.");
  }
  const asOf = text(payload.asOf, 10);
  const isoDay = asOf + "T00:00:00Z";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) ||
      !Number.isFinite(Date.parse(isoDay)) ||
      new Date(isoDay).toISOString().slice(0, 10) !== asOf) return invalid();
  const status = payload.status;
  if (status !== "manual_review_required" && status !== "inventory_only") return invalid();

  const totals = record(payload.summary);
  const summary = {
    employeeCount: count(totals.employeeCount),
    currentWorkers: count(totals.currentWorkers),
    highPriorityCategories: count(totals.highPriorityCategories),
    reviewCategories: count(totals.reviewCategories),
    inProgressBusinessProcesses: count(totals.inProgressBusinessProcesses),
    pendingHcmSteps: count(totals.pendingHcmSteps),
    overdueHcmSteps: count(totals.overdueHcmSteps),
  };
  if (summary.currentWorkers > summary.employeeCount ||
      summary.overdueHcmSteps > summary.pendingHcmSteps) return invalid();

  const seenFindings = new Set<string>();
  const findings = entries(payload.findings, Object.keys(FINDING_SEVERITY).length).map(item => {
    const row = record(item);
    const code = text(row.code, 80);
    const severity = FINDING_SEVERITY[code];
    if (!severity || row.severity !== severity || seenFindings.has(code)) return invalid();
    seenFindings.add(code);
    const affected = count(row.affected);
    if (!affected) return invalid();
    return {
      code, severity, affected,
      title: text(row.title, 250),
      nextAction: text(row.nextAction, 1000),
    };
  });
  if (summary.highPriorityCategories !== findings.filter(row => row.severity === "high").length ||
      summary.reviewCategories !== findings.filter(row => row.severity === "review").length ||
      (status === "inventory_only") !== (findings.length === 0)) return invalid();

  const seenProcesses = new Set<string>();
  const processes = entries(payload.processes, PROCESS_TYPES.length).map(item => {
    const row = record(item);
    const processType = text(row.processType, 80);
    if (!(PROCESS_TYPES as readonly string[]).includes(processType) || seenProcesses.has(processType)) return invalid();
    seenProcesses.add(processType);
    const configuredDefinitions = count(row.configuredDefinitions);
    const currentActiveDefinitions = count(row.currentActiveDefinitions);
    const scopedDefinitions = count(row.scopedDefinitions);
    const policyState = text(row.policyState, 80);
    if (currentActiveDefinitions > configuredDefinitions || scopedDefinitions > configuredDefinitions ||
        !POLICY_STATES.has(policyState) ||
        (configuredDefinitions === 0 && policyState !== "system_default_or_not_configured") ||
        (configuredDefinitions > 0 && currentActiveDefinitions === 0 &&
          policyState !== "configured_without_current_active_definition") ||
        (currentActiveDefinitions > 0 && policyState !== "active_definition_exists")) return invalid();
    return { processType, configuredDefinitions, currentActiveDefinitions, scopedDefinitions, policyState };
  });
  if (seenProcesses.size !== PROCESS_TYPES.length) return invalid();

  const limitations = entries(payload.limitations, 20).map(item => text(item, 1000));
  if (!limitations.length) return invalid();

  // Project only known aggregate fields; never pass unexpected server keys to UI/clipboard.
  return { organizationId: expectedOrganizationId, asOf, status, summary, findings, processes, limitations };
}
