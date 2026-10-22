/**
 * Employer- and year-scoped DOLE 13th-month read boundary.
 * The report's zero amounts, submission readiness and "submitted" evidence
 * are usable only when all collections and aggregate counts are present.
 * This does not calculate statutory entitlements or submit to DOLE.
 */
export type DoleProfile = {
  establishmentAddress: string; principalBusiness: string;
  contactName: string; contactPosition: string; contactPhone: string;
};
export type VerifiedDole13thRead = {
  organizationId: number;
  taxYear: number;
  profile: DoleProfile | null;
  report: {
    reportType: "13th_month_pay"; taxYear: number; dueDate: string;
    establishmentName: string; establishmentAddress: string;
    principalBusiness: string; totalEmployment: number; workersBenefited: number;
    totalBenefitsGranted: number; contactName: string; contactPosition: string;
    contactPhone: string;
    employees: Array<{ employeeNo: string; employeeName: string; amountGranted: number }>;
  };
  reportHash: string; profileComplete: boolean; readyToSubmit: boolean;
  reviewRows: Array<{
    employeeNo: string; employeeName: string; amountGranted: number;
    screeningEntitlement: number; screeningShortfall: number;
  }>;
  incompleteBasicRows: Array<{ employeeNo: string; employeeName: string }>;
  sourceNote: string;
  submissionCurrent: boolean;
  currentSubmission: { reportHash: string; portalReference: string; submittedAt: string; recordedByName: string } | null;
  latestSubmission: { reportHash: string; portalReference: string; submittedAt: string } | null;
  submissionHistory: Array<{
    id: number; reportHash: string; portalReference: string; submittedAt: string;
    recordedByName: string;
  }>;
  officialSource: { label: string; url: string; deadline: string };
};
const record = (x: unknown): x is Record<string, unknown> =>
  x !== null && typeof x === "object" && !Array.isArray(x);
const count = (x: unknown): x is number =>
  typeof x === "number" && Number.isSafeInteger(x) && x >= 0;
const id = (x: unknown) => count(x) && x > 0;
const amount = (x: unknown): x is number =>
  typeof x === "number" && Number.isFinite(x) && x >= 0;
const text = (x: unknown): x is string =>
  typeof x === "string" && x.trim().length > 0;
const hash = (x: unknown): x is string =>
  typeof x === "string" && /^[a-f0-9]{64}$/i.test(x);
const date = (x: unknown) =>
  typeof x === "string" && Number.isFinite(Date.parse(x));
function profile(value: unknown): value is DoleProfile {
  if (!record(value)) return false;
  return ["establishmentAddress", "principalBusiness", "contactName",
    "contactPosition", "contactPhone"].every((field) => typeof value[field] === "string");
}
function employee(value: unknown): value is { employeeNo: string; employeeName: string; amountGranted: number } {
  return record(value) && text(value.employeeNo) && text(value.employeeName) && amount(value.amountGranted);
}
function reviewRow(value: unknown): boolean {
  if (!employee(value)) return false;
  const fields = value as unknown as Record<string, unknown>;
  return amount(fields.screeningEntitlement) && amount(fields.screeningShortfall);
}
function submission(value: unknown, withId: boolean): boolean {
  return record(value) && (!withId || id(value.id)) && hash(value.reportHash) &&
    text(value.portalReference) && date(value.submittedAt) &&
    (!withId || text(value.recordedByName));
}
export function isVerifiedDole13thRead(
  value: unknown, organizationId: number, taxYear: number,
): value is VerifiedDole13thRead {
  if (!id(organizationId) || !Number.isSafeInteger(taxYear) || taxYear < 2000 || taxYear > 2200 ||
      !record(value) || value.organizationId !== organizationId ||
      value.taxYear !== taxYear || !(value.profile === null || profile(value.profile)) ||
      !record(value.report) || !hash(value.reportHash) ||
      typeof value.profileComplete !== "boolean" || typeof value.readyToSubmit !== "boolean" ||
      !Array.isArray(value.reviewRows) || !value.reviewRows.every(reviewRow) ||
      !Array.isArray(value.incompleteBasicRows) ||
      !value.incompleteBasicRows.every((row: unknown) => record(row) && text(row.employeeNo) && text(row.employeeName)) ||
      !text(value.sourceNote) ||
      typeof value.submissionCurrent !== "boolean" ||
      !(value.currentSubmission === null || submission(value.currentSubmission, true)) ||
      !(value.latestSubmission === null || submission(value.latestSubmission, false)) ||
      !Array.isArray(value.submissionHistory) || !value.submissionHistory.every((row: unknown) => submission(row, true)) ||
      !record(value.officialSource) || !text(value.officialSource.label) ||
      value.officialSource.url !== "https://reports.dole.gov.ph/" ||
      value.officialSource.deadline !== String(taxYear + 1) + "-01-15") return false;
  const report = value.report;
  if (report.reportType !== "13th_month_pay" || report.taxYear !== taxYear ||
      report.dueDate !== String(taxYear + 1) + "-01-15" ||
      !text(report.establishmentName) ||
      !["establishmentAddress", "principalBusiness", "contactName", "contactPosition",
        "contactPhone"].every((field) => typeof report[field] === "string") ||
      !count(report.totalEmployment) || !count(report.workersBenefited) ||
      !amount(report.totalBenefitsGranted) ||
      !Array.isArray(report.employees) || !report.employees.every(employee)) return false;
  const employees = report.employees as VerifiedDole13thRead["report"]["employees"];
  if (new Set(employees.map(row => row.employeeNo)).size !== employees.length ||
      report.totalEmployment !== employees.length ||
      report.workersBenefited !== employees.filter(row => row.amountGranted > 0).length) return false;
  const grantedCents = employees.reduce((sum, row) => sum + Math.round(row.amountGranted * 100), 0);
  if (Math.round((report.totalBenefitsGranted as number) * 100) !== grantedCents) return false;
  const complete = value.profile !== null &&
    (["establishmentAddress", "principalBusiness", "contactName", "contactPosition",
      "contactPhone"] as const).every(field => Boolean((value.profile as DoleProfile)[field].trim()));
  if (value.profileComplete !== complete ||
      value.readyToSubmit !== (complete && employees.length > 0)) return false;
  if (value.submissionCurrent !== (value.currentSubmission !== null)) return false;
  if (value.currentSubmission !== null &&
      (value.currentSubmission as Record<string, unknown>).reportHash !== value.reportHash) return false;
  return new Set((value.submissionHistory as Array<{id:number}>).map(row => row.id)).size === value.submissionHistory.length;
}
export async function readVerifiedDole13th(
  organizationId: number, taxYear: number,
  fetcher: typeof fetch = fetch, signal?: AbortSignal,
): Promise<VerifiedDole13thRead> {
  if (!id(organizationId) || !Number.isSafeInteger(taxYear)) {
    throw Error("DOLE report unavailable: invalid employer and year.");
  }
  const response = await fetcher(
    "/api/compliance/dole-13th-month?organizationId=" + organizationId + "&taxYear=" + taxYear,
    { cache: "no-store", signal },
  );
  if (!response.ok) throw Error("DOLE 13th-month report unavailable. Retry.");
  let value: unknown;
  try { value = await response.json(); }
  catch { throw Error("DOLE 13th-month response was malformed JSON. Retry."); }
  if (!isVerifiedDole13thRead(value, organizationId, taxYear)) {
    throw Error("DOLE report evidence incomplete or for another employer/year. Retry.");
  }
  return value;
}

// A successful POST is not evidence of persistence until the exact receipt
// appears in a fresh, employer/year-scoped read. Never invite blind retries.
export function confirmedDole13thMutation(
  action: "save_profile" | "record_submission", receipt: unknown,
  refreshed: VerifiedDole13thRead, organizationId: number, taxYear: number,
): boolean {
  if (!record(receipt) || !isVerifiedDole13thRead(refreshed, organizationId, taxYear))
    return false;
  if (action === "save_profile") {
    // Check the receipt's tenant identity before narrowing to the public profile fields.
    if (!record(receipt.profile) || receipt.profile.organizationId !== organizationId ||
        !profile(receipt.profile) || refreshed.profile === null) return false;
    return (["establishmentAddress", "principalBusiness", "contactName",
      "contactPosition", "contactPhone"] as const).every((field) =>
        (receipt.profile as DoleProfile)[field] === refreshed.profile?.[field]);
  }
  const saved = receipt.submission;
  if (!record(saved) || !id(saved.id) ||
      saved.organizationId !== organizationId || saved.reportYear !== taxYear ||
      !hash(saved.reportHash) || saved.reportHash !== refreshed.reportHash ||
      receipt.reportHash !== saved.reportHash ||
      !text(saved.portalReference) || !date(saved.submittedAt) ||
      refreshed.submissionCurrent !== true || refreshed.currentSubmission === null)
    return false;
  return refreshed.currentSubmission.reportHash === saved.reportHash &&
    refreshed.currentSubmission.portalReference === saved.portalReference &&
    refreshed.submissionHistory.some((row) => row.id === saved.id &&
      row.reportHash === saved.reportHash &&
      row.portalReference === saved.portalReference &&
      row.submittedAt === saved.submittedAt);
}
