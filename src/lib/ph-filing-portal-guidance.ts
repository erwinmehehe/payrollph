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
  /** Concrete artifacts to independently verify before closing an external filing gate. */
  acceptanceChecklist: readonly string[];
  worksheetStatus: "reconciliation-only";
  notes: string;
};

export const PH_FILING_PORTALS: readonly FilingPortalGuidance[] = [
  {
    agency: "SSS", form: "R-3", workflow: "My.SSS e-CL and contribution PRN",
    officialInstructionsUrl: "https://www.sss.gov.ph/pay-contribution/",
    officialPortalUrl: "https://www.sss.gov.ph/",
    acceptanceEvidence: "My.SSS employer contribution collection acknowledgement, PRN and payment/posting evidence.",
    acceptanceChecklist: [
      "Reconcile monthly employee SSS numbers and total employee/employer/EC shares to released payroll.",
      "Use the current My.SSS e-CL/PRN workflow or the official SSS R-3 File Generator, not an unverified PayrollPH CSV upload.",
      "Retain the generated PRN, submitted employee collection list and separate payment/posting evidence.",
    ],
    worksheetStatus: "reconciliation-only",
    notes: "SSS employer reporting uses electronic contribution lists and PRNs; an official SSS R-3 File Generator is also published. The PayrollPH R-3 CSV has no verified agency import acceptance and must not be presented as an SSS upload file.",
  },
  {
    agency: "BIR", form: "1601-C", workflow: "eBIRForms or eFPS monthly withholding filing",
    officialInstructionsUrl: "https://efps.bir.gov.ph/efps-war/EFPSWeb_war/help/help1601c_v2.html",
    officialPortalUrl: "https://www.bir.gov.ph/",
    acceptanceEvidence: "BIR filing acknowledgement/confirmation and distinct payment confirmation for the correct withholding month.",
    acceptanceChecklist: [
      "Match the legal employer, filing month and withholding totals to released payroll.",
      "File Form 1601-C through the employer's current eBIRForms/eFPS channel and record the BIR submission acknowledgement.",
      "Retain the separate tax payment confirmation; verify due dates using the current BIR calendar and eFPS filer group.",
    ],
    worksheetStatus: "reconciliation-only",
    notes: "Transfer reviewed figures into the official filing channel. No PayrollPH 1601-C CSV import capability is claimed; BIR dates depend on filing channel and eFPS group.",
  },
  {
    agency: "BIR", form: "1604-C", workflow: "Annual Alphalist and ADES-generated DAT",
    officialInstructionsUrl: "https://www.bir.gov.ph/",
    officialPortalUrl: "https://www.bir.gov.ph/",
    acceptanceEvidence: "Official annual ADES validation and BIR filing acknowledgement, distinct from any PayrollPH source CSV.",
    acceptanceChecklist: [
      "Reconcile annual totals and employee TINs using all released payrolls for the tax year.",
      "Validate and create the final official DAT through the currently prescribed BIR Alphalist/ADES workflow.",
      "Retain the BIR acknowledgement and separate annual tax filing proof; the source worksheet alone does not qualify.",
    ],
    worksheetStatus: "reconciliation-only",
    notes: "Legacy per-run Alphalist CSV evidence is retired and never certifies an official DAT. BIR 2316 is an employee annual certificate, not a monthly 1601-C worksheet.",
  },
  {
    agency: "PhilHealth", form: "RF-1", workflow: "Electronic Premium Remittance System (EPRS)",
    officialInstructionsUrl: "https://www.philhealth.gov.ph/partners/employers/pay_procedures.php",
    officialPortalUrl: "https://www.philhealth.gov.ph/",
    acceptanceEvidence: "Employer EPRS remittance acknowledgement and payment evidence (such as the applicable electronic receipt).",
    acceptanceChecklist: [
      "Reconcile employee PINs, contribution period and employee/employer premium totals.",
      "Prepare and submit the official EPRS remittance report using the currently accepted channel/template.",
      "Retain the EPRS acknowledgement and payment/posting proof, independent of the PayrollPH worksheet.",
    ],
    worksheetStatus: "reconciliation-only",
    notes: "The PayrollPH RF-1 worksheet has not been validated against an agency import layout. Employer EPRS operational acknowledgement is not upload-format certification.",
  },
  {
    agency: "Pag-IBIG", form: "MCRF", workflow: "Electronic Submission of Remittance Schedule (eSRS)",
    officialInstructionsUrl: "https://www.pagibigfund.gov.ph/document/pdf/payments/ESRS.pdf",
    officialPortalUrl: "https://www.pagibigfund.gov.ph/",
    acceptanceEvidence: "Pag-IBIG eSRS or accepted official remittance schedule receipt and payment evidence.",
    acceptanceChecklist: [
      "Reconcile employee MID numbers, membership type, contribution period and employee/employer amounts.",
      "Use the currently accepted Pag-IBIG eSRS remittance schedule and employer registration; do not rename an MCRF worksheet as an eSRS MSRF upload.",
      "Retain the remittance submission, payment instruction, final payment and member-posting evidence.",
    ],
    worksheetStatus: "reconciliation-only",
    notes: "The published eSRS guide refers to an MSRF membership savings remittance schedule, while Pag-IBIG also publishes separate MCRF encoding instructions. These are not interchangeable by file extension. The PayrollPH MCRF CSV remains an internal reconciliation worksheet until an agency-approved layout and actual import are verified.",
  },
  {
    agency: "BIR", form: "2316", workflow: "Employer annual tax certificate review",
    officialInstructionsUrl: "https://bir-cdn.bir.gov.ph/local/pdf/2316%20Sep%202021%20ENCS_Final_corrected.pdf",
    officialPortalUrl: "https://www.bir.gov.ph/bir-forms",
    acceptanceEvidence: "Reviewed official employee Form 2316, year-end compensation and withholding figures, applicable signatures and employee distribution evidence.",
    acceptanceChecklist: [
      "Reconcile each employee's annual compensation and taxes withheld against the employer's full-year payroll.",
      "Prepare the current official BIR 2316 certificate; it is not the monthly Form 1601-C or an annual Alphalist DAT.",
      "Confirm required employer and employee execution, distribute by the applicable deadline (BIR lists January 31 of the succeeding year or the final wage payment on termination), and retain issuance proof.",
    ],
    worksheetStatus: "reconciliation-only",
    notes: "Employee annual withholding certificate, separate from the annual Alphalist filing and monthly 1601-C remittance. The official 2316 certificate's content, signatures and delivery require independent employer review; PayrollPH does not assert it has been generated or issued.",
  },
];

export function officialFilingGuidance(agency: unknown, form: unknown): FilingPortalGuidance | null {
  return PH_FILING_PORTALS.find((entry) => entry.agency === agency && entry.form === form) ?? null;
}
