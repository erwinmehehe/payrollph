import type { DemandMetric } from "./workforce-operational-demand-import";

// Browser-safe validation: no dependency on server crypto or payroll modules.
const DEMAND_METRICS = ["transactions","visits","orders","appointments","calls"] as const;
const validReceiptId = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 2147483647;
function receiptDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Invalid PH policy date");
  }
  const d = new Date(value + "T00:00:00Z");
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0,10) !== value) {
    throw new Error("Invalid PH policy date");
  }
  return value;
}

export type StaffingPolicyStatus = "draft" | "submitted" | "approved" | "rejected" | "superseded";
export type StaffingPolicySpec = {
  organizationId: number;
  worksiteId: number;
  jobProfileId: number | null;
  metricKind: DemandMetric;
  intervalMinutes: 15 | 30 | 60;
  effectiveFrom: string;
  effectiveUntil: string;
  productiveUnitsPerWorkerHour: number;
  serviceTargetCoveragePercent: number;
  rationale: string;
};
export type StaffingPolicyDraft = StaffingPolicySpec & { idempotencyKey: string };
export type StaffingPolicyTransition = {
  organizationId: number; policyId: number;
  action: "submit" | "approve" | "reject";
  decisionNote: string; acknowledged: true;
};
export type ApprovedStaffingPolicy = StaffingPolicySpec & {
  id: number; version: number;
  status: "approved";
  contentSha256: string; approvalReceiptSha256: string;
  approvedAt: string;
  approvalIntegrity: "matches_hash" | "source_review";
};
const IDEMPOTENT = /^[A-Za-z0-9_-]{12,64}$/;
const DATE_MS = 86_400_000;
const exact = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length &&
  keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
const plain = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const decimal = (n: unknown, min: number, max: number, precision: number) =>
  typeof n === "number" && Number.isFinite(n) && n >= min && n <= max &&
  // These figures are hashed before persistence and later read from fixed-scale
  // decimal DB columns. A tolerance would accept extra fractional digits,
  // then toFixed() would silently change the value and invalidate its hash.
  Number(n.toFixed(precision)) === n;
const isDate = (v: unknown): v is string => {
  if (typeof v !== "string") return false;
  try { return receiptDate(v) === v; } catch { return false; }
};
export function staffingPolicyPilotAllowed(
  organizationId: number, issuedEnabled: boolean,
  enabled = process.env.WFM_DEMAND_STAFFING_POLICIES_ENABLED,
  allowedIds = process.env.WFM_DEMAND_STAFFING_POLICIES_ALLOWED_ORGANIZATION_IDS,
): boolean {
  if (!issuedEnabled || enabled !== "true" || !validReceiptId(organizationId) ||
    !allowedIds || allowedIds.length > 240) return false;
  const ids = allowedIds.split(",").map(x => x.trim());
  return ids.length > 0 && ids.length <= 20 &&
    ids.every(x => /^[1-9][0-9]{0,9}$/.test(x) && validReceiptId(Number(x))) &&
    new Set(ids).size === ids.length && ids.includes(String(organizationId));
}

export function parseStaffingPolicyDraft(input: unknown): StaffingPolicyDraft {
  if (!plain(input) || !exact(input, [
    "organizationId", "worksiteId", "jobProfileId", "metricKind",
    "intervalMinutes", "effectiveFrom", "effectiveUntil",
    "productiveUnitsPerWorkerHour", "serviceTargetCoveragePercent",
    "rationale", "idempotencyKey",
  ]) || !validReceiptId(input.organizationId) || !validReceiptId(input.worksiteId) ||
    (input.jobProfileId !== null && !validReceiptId(input.jobProfileId)) ||
    !DEMAND_METRICS.includes(input.metricKind as DemandMetric) ||
    ![15,30,60].includes(input.intervalMinutes as number) ||
    !isDate(input.effectiveFrom) || !isDate(input.effectiveUntil) ||
    input.effectiveUntil < input.effectiveFrom ||
    (Date.parse(input.effectiveUntil + "T00:00:00Z") -
      Date.parse(input.effectiveFrom + "T00:00:00Z")) > 366 * DATE_MS ||
    !decimal(input.productiveUnitsPerWorkerHour, 0.01, 1_000_000, 4) ||
    !decimal(input.serviceTargetCoveragePercent, 0.01, 100, 2) ||
    typeof input.rationale !== "string" ||
    input.rationale.trim().length < 12 || input.rationale.length > 400 ||
    typeof input.idempotencyKey !== "string" || !IDEMPOTENT.test(input.idempotencyKey)) {
    throw new Error("Exact, finite and effective-dated staffing policy evidence is required.");
  }
  return input as StaffingPolicyDraft;
}

export function parseStaffingPolicyTransition(input: unknown): StaffingPolicyTransition {
  if (!plain(input) || !exact(input, [
    "organizationId", "policyId", "action", "decisionNote", "acknowledged",
  ]) || !validReceiptId(input.organizationId) || !validReceiptId(input.policyId) ||
    !["submit","approve","reject"].includes(input.action as string) ||
    input.acknowledged !== true || typeof input.decisionNote !== "string" ||
    input.decisionNote.length > 400 ||
    ((input.action === "approve" || input.action === "reject") &&
      input.decisionNote.trim().length < 12)) {
    throw new Error("A valid, acknowledged policy transition and decision reason are required.");
  }
  return input as StaffingPolicyTransition;
}

export function policySpec(input: StaffingPolicySpec): StaffingPolicySpec {
  return {
    organizationId: input.organizationId, worksiteId: input.worksiteId,
    jobProfileId: input.jobProfileId, metricKind: input.metricKind,
    intervalMinutes: input.intervalMinutes, effectiveFrom: input.effectiveFrom,
    effectiveUntil: input.effectiveUntil,
    productiveUnitsPerWorkerHour: input.productiveUnitsPerWorkerHour,
    serviceTargetCoveragePercent: input.serviceTargetCoveragePercent,
    rationale: input.rationale.trim(),
  };
}
export function samePolicyScope(a: StaffingPolicySpec, b: StaffingPolicySpec) {
  return a.organizationId === b.organizationId && a.worksiteId === b.worksiteId &&
    a.jobProfileId === b.jobProfileId && a.metricKind === b.metricKind &&
    a.intervalMinutes === b.intervalMinutes;
}
export function policyDatesOverlap(a: StaffingPolicySpec, b: StaffingPolicySpec) {
  return a.effectiveFrom <= b.effectiveUntil && b.effectiveFrom <= a.effectiveUntil;
}

/** Never infer a cross-role policy, partially covered period, or a default. */
export function resolveApprovedStaffingPolicy(input: {
  policies: readonly ApprovedStaffingPolicy[];
  organizationId: number; worksiteId: number;
  jobProfileId: number | null; metricKind: DemandMetric;
  intervalMinutes: 15 | 30 | 60;
  from: string; until: string;
}): { status: "approved" | "no_approved_policy" | "source_review";
  policy: ApprovedStaffingPolicy | null } {
  if (!isDate(input.from) || !isDate(input.until) || input.from > input.until ||
    !validReceiptId(input.organizationId) || !validReceiptId(input.worksiteId)) {
    return { status: "source_review", policy: null };
  }
  const matching = input.policies.filter(p =>
    p.status === "approved" && p.organizationId === input.organizationId &&
    p.worksiteId === input.worksiteId && p.jobProfileId === input.jobProfileId &&
    p.metricKind === input.metricKind && p.intervalMinutes === input.intervalMinutes &&
    p.effectiveFrom <= input.until && p.effectiveUntil >= input.from);
  if (matching.some(p => p.approvalIntegrity !== "matches_hash") || matching.length > 1) {
    return { status: "source_review", policy: null };
  }
  const first = matching[0];
  if (!first) return { status: "no_approved_policy", policy: null };
  if (first.effectiveFrom > input.from || first.effectiveUntil < input.until) {
    return { status: "source_review", policy: null };
  }
  return { status: "approved", policy: first };
}
