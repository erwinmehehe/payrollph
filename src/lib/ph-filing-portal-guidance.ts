/**
 * Official agency navigation is guidance, not a schema guarantee.
 * An accepted portal filing DOES NOT certify PayrollPH's draft worksheet
 * layout. Sources require operator review when government sites change.
 */
export type FilingPortalGuidance = {
  agency: "BIR" | "SSS" | "PhilHealth" | "Pag-IBIG";
  form: string;
  workflow: string;
  officialInstructionsUrl: string;
  officialPortalUrl: string;
  acceptanceEvidence: string;
  worksheetStatus: "reconciliation-only";
  notes: string;
};

export const PH_FILING_PORTALS: readonly FilingPortalGuidance[] = [
  {
    agency: "SSS", form: "R-3", workflow: "My.SSS e-CL and contribution PRN",
    officialInstructionsUrl: "https://www.sss.gov.ph/pay-contribution/",
    officialPortalUrl: "https://www.sss.gov.ph/",
    acceptanceEvidence: "My.SSS employer contribution collection acknowledgement, PRN and payment/posting evidence.",
    worksheetStatus: "reconciliation-only",
    notes: "SSS current employer workflow uses electronic contribution collection lists and PRNs; the PayrollPH R-3 CSV is not an authorized My.SSS import file.",
  },
  {
    agency: "BIR", form: "1601-C", workflow: "eBIRForms or eFPS monthly withholding filing",
    officialInstructionsUrl: "https://efps.bir.gov.ph/efps-war/efpsJobaids.xhtml",
    officialPortalUrl: "https://www.bir.gov.ph/",
    acceptanceEvidence: "BIR filing acknowledgement/confirmation and distinct payment confirmation for the correct withholding month.",
    worksheetStatus: "reconciliation-only",
    notes: "Transfer reviewed figures into the official filing channel. No PayrollPH 1601-C CSV import capability is claimed; BIR dates depend on filing channel and eFPS group.",
  },
  {
    agency: "BIR", form: "1604-C", workflow: "Annual Alphalist and ADES-generated DAT",
    officialInstructionsUrl: "https://www.bir.gov.ph/",
    officialPortalUrl: "https://www.bir.gov.ph/",
    acceptanceEvidence: "Official annual ADES validation and BIR filing acknowledgement, distinct from any PayrollPH source CSV.",
    worksheetStatus: "reconciliation-only",
    notes: "Legacy per-run Alphalist CSV evidence is retired and never certifies an official DAT. BIR 2316 is an employee annual certificate, not a monthly 1601-C worksheet.",
  },
  {
    agency: "PhilHealth", form: "RF-1", workflow: "Electronic Premium Remittance System (EPRS)",
    officialInstructionsUrl: "https://www.philhealth.gov.ph/partners/employers/pay_procedures.php",
    officialPortalUrl: "https://www.philhealth.gov.ph/",
    acceptanceEvidence: "Employer EPRS remittance acknowledgement and payment evidence (such as the applicable electronic receipt).",
    worksheetStatus: "reconciliation-only",
    notes: "The PayrollPH RF-1 worksheet has not been validated against an agency import layout. Employer EPRS operational acknowledgement is not upload-format certification.",
  },
  {
    agency: "Pag-IBIG", form: "MCRF", workflow: "Electronic Submission of Remittance Schedule (eSRS)",
    officialInstructionsUrl: "https://www.pagibigfund.gov.ph/document/pdf/payments/ESRS.pdf",
    officialPortalUrl: "https://www.pagibigfund.gov.ph/",
    acceptanceEvidence: "Pag-IBIG eSRS or accepted official remittance schedule receipt and payment evidence.",
    worksheetStatus: "reconciliation-only",
    notes: "Pag-IBIG eSRS accepts its prescribed remittance workflow; the PayrollPH MCRF CSV is not asserted to match the current file template.",
  },
  {
    agency: "BIR", form: "2316", workflow: "Employer annual tax certificate review",
    officialInstructionsUrl: "https://www.bir.gov.ph/",
    officialPortalUrl: "https://www.bir.gov.ph/",
    acceptanceEvidence: "Reviewed employee Form 2316, the correct tax-year figures and applicable employer/employee execution and distribution evidence.",
    worksheetStatus: "reconciliation-only",
    notes: "Annual certificate, not an upload of monthly 1601-C data. Review Year-End Annualization and employer-specific BIR requirements.",
  },
];

export function officialFilingGuidance(agency: unknown, form: unknown): FilingPortalGuidance | null {
  return PH_FILING_PORTALS.find((entry) => entry.agency === agency && entry.form === form) ?? null;
}
