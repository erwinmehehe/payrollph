/**
 * Bounded-shape read contracts for the private manager talent comparison.
 * These validate client response integrity, not server-side authorization.
 * The API must still enforce tenant, role, and unit scope independently.
 */
export type TalentEmployeeOption = { id: number; label: string };
export type TalentRequisitionOption = {
  id: number; title: string; roleCriteriaRecorded: boolean;
};
export type TalentDirectory = {
  organizationId: number;
  employees: TalentEmployeeOption[];
  requisitions: TalentRequisitionOption[];
  notice: string;
};

export type TalentEvidenceRow = {
  skillId: number;
  code: string;
  name: string;
  minimumProficiency: number;
  mandatory: boolean;
  source: string;
  status: "verified_meets" | "verified_below" | "unverified";
  verifiedProficiency: number | null;
  lastCompletedReviewScore: number | null;
  lastCompletedReviewDate: string | null;
  developmentPlan: {
    id: number; status: string; targetDate: string; targetProficiency: number;
  } | null;
};

export type TalentComparison = {
  version: "hcm-private-talent-continuity-v1";
  asOf: string;
  configured: boolean;
  target: {
    jobProfileId: number; profileTitle: string; capturedAt: string; fingerprint: string;
  };
  counts: {
    total: number; mandatory: number; verifiedMeeting: number;
    verifiedBelow: number; unverified: number; activeDevelopmentPlans: number;
  };
  rows: TalentEvidenceRow[];
  notice: string;
};

export type TalentEvidenceResponse = {
  organizationId: number;
  employee: { id: number; label: string };
  requisition: { id: number; title: string; positionId: number };
  comparison: TalentComparison;
};

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const text = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const date = (value: unknown): value is string =>
  text(value) && Number.isFinite(Date.parse(value));
const day = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && date(value);
const level = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 1 && value <= 5;
const count = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export function isVerifiedTalentDirectory(
  value: unknown, organizationId: number,
): value is TalentDirectory {
  if (!id(organizationId) || !record(value) ||
      value.organizationId !== organizationId ||
      !Array.isArray(value.employees) || !Array.isArray(value.requisitions) ||
      !text(value.notice)) return false;

  const employees = new Set<number>();
  for (const worker of value.employees) {
    if (!record(worker) || !id(worker.id) || !text(worker.label) ||
        employees.has(worker.id)) return false;
    employees.add(worker.id);
  }
  const requisitions = new Set<number>();
  for (const req of value.requisitions) {
    if (!record(req) || !id(req.id) || !text(req.title) ||
        typeof req.roleCriteriaRecorded !== "boolean" ||
        requisitions.has(req.id)) return false;
    requisitions.add(req.id);
  }
  return true;
}

function isVerifiedEvidenceRow(value: unknown): value is TalentEvidenceRow {
  if (!record(value) || !id(value.skillId) || !text(value.code) ||
      !text(value.name) || !level(value.minimumProficiency) ||
      typeof value.mandatory !== "boolean" ||
      !["profile", "family_level", "level", "family"].includes(String(value.source)) ||
      !["verified_meets", "verified_below", "unverified"].includes(String(value.status)) ||
      (value.lastCompletedReviewScore !== null && !level(value.lastCompletedReviewScore)) ||
      (value.lastCompletedReviewDate !== null && !day(value.lastCompletedReviewDate))) {
    return false;
  }
  if (value.lastCompletedReviewScore === null !== (value.lastCompletedReviewDate === null)) {
    return false;
  }
  if (value.status === "unverified") {
    if (value.verifiedProficiency !== null) return false;
  } else {
    if (!level(value.verifiedProficiency)) return false;
    if (value.status === "verified_meets" && value.verifiedProficiency < value.minimumProficiency) return false;
    if (value.status === "verified_below" && value.verifiedProficiency >= value.minimumProficiency) return false;
  }
  if (value.developmentPlan !== null) {
    const plan = value.developmentPlan;
    if (!record(plan) || !id(plan.id) || !text(plan.status) ||
        !level(plan.targetProficiency) || !day(plan.targetDate)) return false;
  }
  return true;
}

export function isVerifiedTalentComparison(
  value: unknown, organizationId: number,
  employeeId: number, requisitionId: number,
): value is TalentEvidenceResponse {
  if (!id(organizationId) || !id(employeeId) || !id(requisitionId) ||
      !record(value) || value.organizationId !== organizationId ||
      !record(value.employee) || value.employee.id !== employeeId || !text(value.employee.label) ||
      !record(value.requisition) || value.requisition.id !== requisitionId ||
      !text(value.requisition.title) || !id(value.requisition.positionId) ||
      !record(value.comparison)) return false;
  const comparison = value.comparison;
  if (comparison.version !== "hcm-private-talent-continuity-v1" ||
      !day(comparison.asOf) || typeof comparison.configured !== "boolean" ||
      !record(comparison.target) || !id(comparison.target.jobProfileId) ||
      !text(comparison.target.profileTitle) || !date(comparison.target.capturedAt) ||
      typeof comparison.target.fingerprint !== "string" ||
      !/^[a-f0-9]{64}$/.test(comparison.target.fingerprint) ||
      !record(comparison.counts) || !Array.isArray(comparison.rows) ||
      comparison.rows.length > 500 || !text(comparison.notice)) return false;

  const totals = comparison.counts;
  if (!count(totals.total) || !count(totals.mandatory) ||
      !count(totals.verifiedMeeting) || !count(totals.verifiedBelow) ||
      !count(totals.unverified) || !count(totals.activeDevelopmentPlans)) return false;

  const skillIds = new Set<number>();
  const rows: TalentEvidenceRow[] = [];
  for (const row of comparison.rows) {
    if (!isVerifiedEvidenceRow(row) || skillIds.has(row.skillId)) return false;
    skillIds.add(row.skillId);
    rows.push(row);
  }
  const mandatory = rows.filter(row => row.mandatory);
  return comparison.configured === (rows.length > 0) &&
    totals.total === rows.length && totals.mandatory === mandatory.length &&
    totals.verifiedMeeting === mandatory.filter(row => row.status === "verified_meets").length &&
    totals.verifiedBelow === mandatory.filter(row => row.status === "verified_below").length &&
    totals.unverified === mandatory.filter(row => row.status === "unverified").length &&
    totals.activeDevelopmentPlans === rows.filter(row =>
      row.developmentPlan?.status === "planned" || row.developmentPlan?.status === "in_progress").length;
}

function apiError(payload: unknown, fallback: string): string {
  return record(payload) && text(payload.error) && payload.error.length <= 350
    ? payload.error : fallback;
}

export async function readTalentDirectory(
  organizationId: number, fetcher: typeof fetch = fetch, signal?: AbortSignal,
): Promise<{ status: "ready"; data: TalentDirectory } | { status: "forbidden" }> {
  if (!id(organizationId)) throw new Error("Select a valid employer before reviewing talent.");
  const response = await fetcher(
    "/api/performance/talent-continuity?organizationId=" + organizationId,
    { cache: "no-store", signal },
  );
  if (response.status === 403) return { status: "forbidden" };
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(apiError(payload, "Cannot load authorized talent roles."));
  if (!isVerifiedTalentDirectory(payload, organizationId)) {
    throw new Error("Talent roles returned incomplete or mismatched employer evidence. Retry.");
  }
  return { status: "ready", data: payload };
}

export async function readTalentComparison(
  organizationId: number, employeeId: number, requisitionId: number,
  fetcher: typeof fetch = fetch, signal?: AbortSignal,
): Promise<{ status: "ready"; data: TalentEvidenceResponse } | { status: "forbidden" }> {
  if (!id(organizationId) || !id(employeeId) || !id(requisitionId)) {
    throw new Error("Select a valid employee and approved role.");
  }
  const params = new URLSearchParams({
    organizationId: String(organizationId),
    employeeId: String(employeeId),
    requisitionId: String(requisitionId),
  });
  const response = await fetcher(
    "/api/performance/talent-continuity?" + params.toString(),
    { cache: "no-store", signal },
  );
  if (response.status === 403) return { status: "forbidden" };
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(apiError(payload, "Cannot verify the selected role evidence."));
  if (!isVerifiedTalentComparison(payload, organizationId, employeeId, requisitionId)) {
    throw new Error("Talent comparison was incomplete or mismatched. No results can be trusted. Retry.");
  }
  return { status: "ready", data: payload };
}
