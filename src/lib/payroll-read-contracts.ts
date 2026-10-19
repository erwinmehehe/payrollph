import type { AssuranceFinding, EmployeeVariance, PayrollAssurance } from "./payroll-assurance";

/**
 * A successful HTTP status does not prove that a payroll-read response is
 * complete, current, or owned by the selected legal employer. These pure
 * validators deliberately cannot grant server-side authorization.
 */
export type PayrollReadScope = Readonly<{
  organizationId: number;
  legalEntityId: number | null;
  runId: number;
}>;

export type VerifiedReleaseChecklistItem = {
  key: "inputs" | "attendance" | "calculation" | "exceptions" | "statutory" | "approval" | "bank" | "connected";
  label: string;
  passed: boolean;
  blocking: boolean;
  acknowledgeable?: boolean;
  detail: string;
};

export type VerifiedReleaseChecklist = PayrollReadScope & {
  ready: boolean;
  approvalStatus: string;
  items: VerifiedReleaseChecklistItem[];
  assuranceSummary: PayrollAssurance["summary"] | null;
  assuranceFindings: Array<AssuranceFinding & { employeeId: number | null; blocking: boolean }>;
};

export type VerifiedAssuranceRead = PayrollReadScope & PayrollAssurance & {
  previousRun: {
    id: number;
    periodLabel: string;
    payDate: string;
    netPay: string;
    grossPay: string;
  } | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const positiveId = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const count = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const optionalFinite = (value: unknown) =>
  value === undefined || value === null || finite(value);
const nullableFinite = (value: unknown) => value === null || finite(value);
const nonempty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

function hasScope(value: Record<string, unknown>, expected: PayrollReadScope) {
  return positiveId(expected.organizationId) && positiveId(expected.runId) &&
    (expected.legalEntityId === null || positiveId(expected.legalEntityId)) &&
    value.organizationId === expected.organizationId &&
    Object.hasOwn(value, "legalEntityId") &&
    value.legalEntityId === expected.legalEntityId &&
    value.runId === expected.runId;
}

const requiredChecklistKeys = [
  "inputs", "attendance", "calculation", "exceptions", "statutory", "approval", "bank",
] as const;
const allChecklistKeys = new Set<string>([...requiredChecklistKeys, "connected"]);

function isChecklistItem(value: unknown): value is VerifiedReleaseChecklistItem {
  return isRecord(value) &&
    typeof value.key === "string" && allChecklistKeys.has(value.key) &&
    nonempty(value.label) && nonempty(value.detail) &&
    typeof value.passed === "boolean" && typeof value.blocking === "boolean" &&
    value.blocking === true &&
    (value.acknowledgeable === undefined || typeof value.acknowledgeable === "boolean");
}

function validSummary(value: unknown): value is PayrollAssurance["summary"] {
  return isRecord(value) &&
    count(value.high) && count(value.medium) && count(value.info) &&
    count(value.blocking) && count(value.materialChanges) &&
    count(value.comparedEmployees);
}

function validFinding(value: unknown): value is AssuranceFinding {
  return isRecord(value) &&
    nonempty(value.code) && nonempty(value.title) && nonempty(value.detail) &&
    (value.severity === "high" || value.severity === "medium" || value.severity === "info") &&
    (value.blocking === undefined || typeof value.blocking === "boolean") &&
    (value.employeeId === undefined || value.employeeId === null || positiveId(value.employeeId)) &&
    ["current", "previous", "delta", "percent"].every((field) => optionalFinite(value[field]));
}

export function isVerifiedReleaseChecklist(
  value: unknown,
  expected: PayrollReadScope,
): value is VerifiedReleaseChecklist {
  if (!isRecord(value) || !hasScope(value, expected) ||
      typeof value.ready !== "boolean" || !nonempty(value.approvalStatus) ||
      !Array.isArray(value.items) || !value.items.every(isChecklistItem) ||
      !Array.isArray(value.assuranceFindings) || value.assuranceFindings.length > 100 ||
      !value.assuranceFindings.every((finding: unknown) => isRecord(finding) &&
        validFinding(finding) &&
        typeof finding.blocking === "boolean" &&
        (finding.employeeId === null || positiveId(finding.employeeId))) ||
      (value.assuranceSummary !== null && !validSummary(value.assuranceSummary))) {
    return false;
  }

  if (value.ready && value.assuranceSummary === null) return false;
  if (value.assuranceSummary === null && value.assuranceFindings.length > 0) return false;

  const items: VerifiedReleaseChecklistItem[] = value.items;
  const keys = items.map((item) => item.key);
  if (keys.length !== new Set(keys).size || keys.length < requiredChecklistKeys.length ||
      keys.length > requiredChecklistKeys.length + 1 ||
      !requiredChecklistKeys.every((key) => keys.includes(key)) ||
      value.ready !== items.every((item) => !item.blocking || item.passed)) {
    return false;
  }

  // A truncated findings preview is allowed (server caps it at 100), but a
  // summary must never report fewer blockers than those actually displayed.
  if (value.assuranceSummary !== null) {
    const summary = value.assuranceSummary;
    const findings: AssuranceFinding[] = value.assuranceFindings;
    if (summary.blocking < findings.filter((finding) => finding.blocking).length ||
        summary.high < findings.filter((finding) => finding.severity === "high").length ||
        summary.medium < findings.filter((finding) => finding.severity === "medium").length ||
        summary.info < findings.filter((finding) => finding.severity === "info").length) {
      return false;
    }
  }
  return true;
}

function validBreakdown(value: unknown) {
  return isRecord(value) &&
    ["gross", "sss", "philHealth", "pagIbig", "withholdingTax", "otherDeductions", "net"]
      .every((key) => finite(value[key]));
}

function validLineChange(value: unknown) {
  return isRecord(value) && nonempty(value.code) && nonempty(value.label) &&
    finite(value.current) && finite(value.previous) && finite(value.delta);
}

function validComparison(value: unknown): value is EmployeeVariance {
  if (!isRecord(value) || !positiveId(value.employeeId) ||
      !finite(value.currentGross) || !finite(value.currentNet) ||
      !finite(value.currentDeductions) ||
      !["previousGross", "grossDelta", "previousNet", "netDelta",
        "netPercent", "previousDeductions"].every((field) =>
        Object.hasOwn(value, field) && nullableFinite(value[field])) ||
      !validBreakdown(value.currentComponents) ||
      (value.previousComponents !== null && !validBreakdown(value.previousComponents)) ||
      !Array.isArray(value.lineChanges) || !value.lineChanges.every(validLineChange) ||
      new Set(value.lineChanges.map((item: { code: string }) => item.code)).size !== value.lineChanges.length ||
      typeof value.hasMaterialChange !== "boolean") {
    return false;
  }
  return true;
}

export function isVerifiedAssuranceRead(
  value: unknown,
  expected: PayrollReadScope,
): value is VerifiedAssuranceRead {
  if (!isRecord(value) || !hasScope(value, expected) ||
      !validSummary(value.summary) ||
      !Array.isArray(value.findings) || !value.findings.every(validFinding) ||
      !Array.isArray(value.comparisons) || !value.comparisons.every(validComparison)) {
    return false;
  }

  const previous = value.previousRun;
  if (previous !== null && (!isRecord(previous) || !positiveId(previous.id) ||
      !nonempty(previous.periodLabel) || !nonempty(previous.payDate) ||
      !nonempty(previous.netPay) || !nonempty(previous.grossPay))) {
    return false;
  }

  const findings: AssuranceFinding[] = value.findings;
  const comparisons: EmployeeVariance[] = value.comparisons;
  const summary = value.summary;
  if (new Set(comparisons.map((item) => item.employeeId)).size !== comparisons.length ||
      summary.high !== findings.filter((finding) => finding.severity === "high").length ||
      summary.medium !== findings.filter((finding) => finding.severity === "medium").length ||
      summary.info !== findings.filter((finding) => finding.severity === "info").length ||
      summary.blocking !== findings.filter((finding) => finding.blocking).length ||
      summary.materialChanges !== comparisons.filter((comparison) => comparison.hasMaterialChange).length ||
      summary.comparedEmployees !== comparisons.filter((comparison) => comparison.previousNet !== null).length) {
    return false;
  }
  return true;
}
