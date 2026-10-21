/**
 * Pure employer/year-bound DOLE read verifier.
 * Invalid 200s must never become zeros, cleared filing evidence, or actions.
 */
export type DoleSubmission = {
  id: number; organizationId: number; reportHash: string; status: string;
  portalReference: string; submittedAt: string; recordedByName: string;
};
export type DoleProfile = {
  establishmentAddress: string; principalBusiness: string;
  contactName: string; contactPosition: string; contactPhone: string;
};
export type VerifiedDoleRead = {
  organizationId: number; legalEntityId: null;
  organization: { id: number; name: string; legalName: string | null };
  profile: DoleProfile | null;
  report: {
    reportType: string; taxYear: number; dueDate: string;
    establishmentName: string; establishmentAddress: string; principalBusiness: string;
    totalEmployment: number; workersBenefited: number; totalBenefitsGranted: number;
    contactName: string; contactPosition: string; contactPhone: string;
    employees: Array<{employeeNo: string; employeeName: string; amountGranted: number}>;
  };
  reportHash: string; profileComplete: boolean; readyToSubmit: boolean;
  reviewRows: Array<{employeeNo: string; employeeName: string; amountGranted: number;
    screeningEntitlement: number; screeningShortfall: number}>;
  incompleteBasicRows: Array<{employeeNo: string; employeeName: string}>;
  sourceNote: string; submissionCurrent: boolean;
  currentSubmission: DoleSubmission | null;
  latestSubmission: DoleSubmission | null;
  submissionHistory: DoleSubmission[];
  officialSource: { label: string; url: string; deadline: string };
};
const obj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const count = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const amount = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1e15;
const sha = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/i.test(v);
const stamp = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v));
const fields = ["establishmentAddress","principalBusiness","contactName","contactPosition","contactPhone"] as const;
const profile = (v: unknown): v is DoleProfile => obj(v) && fields.every(key => typeof v[key] === "string");
const employee = (v: unknown) => obj(v) && text(v.employeeNo) && text(v.employeeName) && amount(v.amountGranted);
const submission = (v: unknown, org: number): v is DoleSubmission =>
  obj(v) && id(v.id) && v.organizationId === org && v.status === "submitted" &&
  sha(v.reportHash) && text(v.portalReference) && stamp(v.submittedAt) && text(v.recordedByName);

export function isVerifiedDoleThirteenthRead(
  v: unknown, organizationId: number, taxYear: number,
): v is VerifiedDoleRead {
  if (!id(organizationId) || !count(taxYear) || !obj(v) ||
      v.organizationId !== organizationId || v.legalEntityId !== null ||
      !obj(v.organization) || v.organization.id !== organizationId ||
      !text(v.organization.name) ||
      !(v.organization.legalName === null || typeof v.organization.legalName === "string") ||
      !obj(v.report) || !obj(v.officialSource) ||
      !sha(v.reportHash) || !text(v.sourceNote) ||
      typeof v.profileComplete !== "boolean" || typeof v.readyToSubmit !== "boolean" ||
      typeof v.submissionCurrent !== "boolean" || !Array.isArray(v.submissionHistory) ||
      v.submissionHistory.length > 10000 ||
      !Array.isArray(v.reviewRows) || !Array.isArray(v.incompleteBasicRows)) return false;
  const r = v.report;
  if (r.reportType !== "13th_month_pay" || r.taxYear !== taxYear ||
      r.dueDate !== String(taxYear + 1) + "-01-15" ||
      !text(r.establishmentName) ||
      fields.some(key => typeof r[key] !== "string") ||
      !count(r.totalEmployment) || !count(r.workersBenefited) || !amount(r.totalBenefitsGranted) ||
      !Array.isArray(r.employees) || r.employees.length > 100000 || !r.employees.every(employee) ||
      r.totalEmployment !== r.employees.length ||
      r.workersBenefited !== r.employees.filter(e => e.amountGranted > 0).length) return false;
  const nos = new Set<string>();
  let cents = 0;
  for (const e of r.employees) {
    if (nos.has(e.employeeNo)) return false;
    nos.add(e.employeeNo);
    cents += Math.round(e.amountGranted * 100);
  }
  if (Math.round(r.totalBenefitsGranted * 100) !== cents) return false;
  if (v.profile !== null && !profile(v.profile)) return false;
  const p = v.profile as DoleProfile | null;
  const complete = Boolean(p && fields.every(key => p[key].trim().length > 0));
  if (v.profileComplete !== complete || v.readyToSubmit !== (complete && r.totalEmployment > 0)) return false;
  if (fields.some(key => r[key] !== (p?.[key] ?? ""))) return false;
  if (!v.reviewRows.every((e: unknown) => employee(e) && obj(e) &&
      nos.has(e.employeeNo as string) && amount(e.screeningEntitlement) && amount(e.screeningShortfall))) return false;
  if (!v.incompleteBasicRows.every((e: unknown) => obj(e) &&
      text(e.employeeNo) && nos.has(e.employeeNo) && text(e.employeeName))) return false;
  if (!v.submissionHistory.every((e: unknown) => submission(e, organizationId))) return false;
  const history = v.submissionHistory as DoleSubmission[];
  if (new Set(history.map(e => e.id)).size !== history.length) return false;
  if (v.currentSubmission !== null && (!submission(v.currentSubmission, organizationId) ||
      v.currentSubmission.reportHash !== v.reportHash ||
      !history.some(e => e.id === (v.currentSubmission as DoleSubmission).id))) return false;
  if (v.submissionCurrent !== (v.currentSubmission !== null)) return false;
  if (history.length === 0 ? v.latestSubmission !== null :
      !submission(v.latestSubmission, organizationId) ||
      (v.latestSubmission as DoleSubmission).id !== history[0].id) return false;
  return v.officialSource.label === "DOLE Online Compliance Portal" &&
    v.officialSource.url === "https://reports.dole.gov.ph/" &&
    v.officialSource.deadline === r.dueDate;
}
