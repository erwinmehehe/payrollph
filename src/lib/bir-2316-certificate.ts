import { BIR_2316_NON_TAX_ITEMS, BIR_2316_TAX_ITEMS, bir2316Centavos, reviewBir2316Summary, type Bir2316ReviewSource } from "./bir-2316-reconciliation";
import type { Bir2316Withholding } from "./bir-2316-withholding";
import { computeAnnualWithholdingTax } from "./payroll-rules";
export const CERTIFICATE_ITEMS = [...BIR_2316_NON_TAX_ITEMS, ...BIR_2316_TAX_ITEMS];
export const CERTIFICATE_LABELS: Record<string, string> = {
  "29": "Exempt basic salary / statutory minimum wage", "30": "Holiday pay (MWE)", "31": "Overtime pay (MWE)",
  "32": "Night differential (MWE)", "33": "Hazard pay (MWE)", "34": "Exempt 13th month and other benefits",
  "35": "De minimis benefits", "36": "Employee contributions and union dues", "37": "Other exempt compensation",
  "39": "Taxable basic salary", "40": "Representation", "41": "Transportation", "42": "COLA", "43": "Housing",
  "44A": "Other regular A", "44B": "Other regular B", "45": "Commission", "46": "Profit sharing", "47": "Fees",
  "48": "Taxable 13th month benefits", "49": "Taxable hazard pay", "50": "Taxable overtime", "51A": "Other supplementary A", "51B": "Other supplementary B",
};
export const CERTIFICATE_TEXT_FIELDS = {
  rdo: "Employee RDO code", address: "Employee registered address", zip: "Employee registered ZIP",
  homeAddress: "Local home address", homeZip: "Local home ZIP", foreignAddress: "Foreign address (if applicable)",
  contact: "Employee contact number", minimumDaily: "Statutory minimum wage per day (0 if not applicable)",
  minimumMonthly: "Statutory minimum wage per month (0 if not applicable)", employerAddress: "Employer registered address",
  employerZip: "Employer ZIP", categoryReference: "Compensation mapping evidence reference", peraReference: "PERA review evidence reference",
  "44A": "Description for item 44A", "44B": "Description for item 44B", "51A": "Description for item 51A", "51B": "Description for item 51B",
};
export type CertificateScope = { organizationId: number; employeeId: number; taxYear: number; separationId?: number };
export type CertificateSource = {
  scope: CertificateScope; legalEntityId: number | null; employerName: string; employerTin: string; employeeName: string; employeeTin: string;
  birthDate: string | null; periodFrom: string; periodTo: string; mwe: boolean;
  summary: Bir2316ReviewSource; withholding: Bir2316Withholding | undefined;
};
export const object = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
export function prepare2316Certificate(source: CertificateSource, input: unknown) {
  const data = object(input), text = object(data.text), previous = object(data.previousEmployer);
  const detail = object(data.detailItems), issues: string[] = [];
  const fields: Record<string, string> = {};
  const field = (key: string, value: unknown, required = true, max = 120) => {
    if (typeof value !== "string" || (required && !value.trim()) || value.length > max || /[^\x20-\x7e\xa0-\xff]/.test(value)) {
      issues.push("MISSING_OR_INVALID_" + key); return "";
    }
    fields[key] = value.trim(); return fields[key];
  };
  for (const key of Object.keys(CERTIFICATE_TEXT_FIELDS)) field(key, text[key] ?? "", !["foreignAddress", "44A", "44B", "51A", "51B"].includes(key));
  if (!/^\d{3}$/.test(fields.rdo ?? "") || !/^\d{4}$/.test(fields.zip ?? "") || !/^\d{4}$/.test(fields.homeZip ?? "") || !/^\d{4}$/.test(fields.employerZip ?? "")) issues.push("INVALID_RDO_OR_ZIP");
  if (!/^[0-9+() -]{7,24}$/.test(fields.contact ?? "")) issues.push("INVALID_CONTACT");
  const contactDigits = (fields.contact ?? "").replace(/\D/g, "");
  if (contactDigits.length < 7 || contactDigits.length > 12) issues.push("CONTACT_EXCEEDS_TEMPLATE_CELLS");
  for (const key of ["minimumDaily", "minimumMonthly"]) {
    const amount = bir2316Centavos(fields[key]);
    if (amount === null || (source.mwe && amount === 0) || (!source.mwe && amount !== 0)) issues.push("INVALID_" + key);
  }
  const date = (value: string | null) => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + "T00:00:00Z")) && new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value);
  if (!date(source.birthDate) || !date(source.periodFrom) || !date(source.periodTo) || source.periodFrom > source.periodTo || !source.periodFrom.startsWith(String(source.scope.taxYear)) || !source.periodTo.startsWith(String(source.scope.taxYear))) issues.push("INVALID_SOURCE_DATES");
  if (source.birthDate && source.birthDate >= source.periodFrom) issues.push("INVALID_SOURCE_BIRTH_DATE");
  if (!/^\d{9}-\d{4}$/.test(source.employerTin) || !/^\d{9}-\d{4}$/.test(source.employeeTin)) issues.push("INVALID_SOURCE_TIN");
  if (source.withholding?.issues.length || !source.withholding) issues.push("POSTED_WITHHOLDING_UNVERIFIED");
  for (const key of ["44A", "44B", "51A", "51B"]) if ((bir2316Centavos(detail[key] as string) ?? 0) > 0 && !fields[key]) issues.push("MISSING_DESCRIPTION_" + key);
  if (!source.mwe && ["30", "31", "32", "33"].some(key => bir2316Centavos(detail[key] as string) !== 0)) issues.push("NON_MWE_EXEMPT_PREMIUM");
  let previousEvidence: { status: "none-confirmed" } | { status: "verified"; taxableCompensation: string; taxWithheld: string };
  if (previous.status === "none-confirmed") {
    previousEvidence = { status: "none-confirmed" };
    if (Object.keys(previous).some(k => k !== "status" && previous[k] !== "")) issues.push("CONTRADICTORY_PREVIOUS_EMPLOYER");
  } else {
    previousEvidence = { status: "verified", taxableCompensation: field("previousTaxable", previous.taxableCompensation), taxWithheld: field("previousWithheld", previous.taxWithheld) };
    for (const key of ["name", "tin", "address", "zip", "reference"]) field("previous" + key, previous[key]);
    if (previous.status !== "verified" || !/^\d{9}-\d{4}$/.test(fields.previoustin ?? "") || !/^\d{4}$/.test(fields.previouszip ?? "")) issues.push("PREVIOUS_EMPLOYER_UNVERIFIED");
  }
  const employerType = data.employerType;
  if (employerType !== "main" && employerType !== "secondary") issues.push("EMPLOYER_TYPE_REQUIRED");
  if (data.acknowledged !== true) issues.push("REVIEW_ACKNOWLEDGEMENT_REQUIRED");
  const reconciliation = reviewBir2316Summary(source.summary, {
    detailItems: detail as Record<string, string>, previousEmployer: previousEvidence,
    // Always server-derived. Caller-supplied collection/withholding is ignored.
    actualPresentWithheld: source.withholding?.actualPresentWithheld,
    appliedAdjustment: source.withholding?.appliedAdjustment, peraCredit: data.peraCredit as string,
  });
  issues.push(...reconciliation.issues.map(i => i.code));
  // A present-only annualization must not accept arbitrary previous taxable
  // compensation just because previous withholding/PERA were entered as zero.
  // Verify the approved tax-due output; never recompute or save payroll here.
  const combinedTaxable = reconciliation.rows.find(r => r.item === "23")?.centavos;
  const taxDue = bir2316Centavos(source.summary.taxDue);
  if (source.scope.taxYear < 2023) issues.push("TAX_YEAR_NOT_SUPPORTED");
  else if (combinedTaxable !== null && combinedTaxable !== undefined && Number.isSafeInteger(combinedTaxable)) {
    const expectedDue = bir2316Centavos(computeAnnualWithholdingTax(combinedTaxable / 100, false, `${source.scope.taxYear}-12-31`).toFixed(2));
    if (expectedDue !== taxDue) issues.push("APPROVED_COMBINED_TAX_DUE_MISMATCH");
  }
  const amounts = Object.fromEntries(reconciliation.rows.filter(r => r.item !== "internal").map(r => [r.item, r.centavos]));
  for (const key of CERTIFICATE_ITEMS) amounts[key] = bir2316Centavos(detail[key] as string);
  amounts["38"] = amounts["20 / 38"]; amounts["52"] = amounts["21 / 52"];
  for (const key of ["19", "24", "22", "23", "25A", "25B", "26", "27", "28"]) if (amounts[key] === null || amounts[key] === undefined) issues.push("MISSING_AMOUNT_" + key);
  amounts["20"] = amounts["20 / 38"]; amounts["21"] = amounts["21 / 52"];
  return { ok: issues.length === 0, issues: [...new Set(issues)], source, fields, amounts, employerType, previousStatus: previousEvidence.status };
}
