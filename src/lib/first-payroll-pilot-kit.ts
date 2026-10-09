/**
 * No-PII starter artifacts for a private, no-money pilot.
 *
 * The blank CSV headers mirror the existing OFFLINE parallel payroll checker.
 * They contain no sample employees, wages, identifiers or assertions of approval.
 * Browser downloads do not upload anything to PayrollPH.
 */
export const PILOT_PAYROLL_COLUMNS = [
  "employee_key", "legal_entity_code", "period",
  "gross_pay", "taxable_pay", "sss_ee", "philhealth_ee", "pagibig_ee",
  "withholding_tax", "government_loans", "company_loans",
  "other_deductions", "net_pay", "sss_er", "ec_er",
  "philhealth_er", "pagibig_er",
] as const;

export const PILOT_JOURNAL_COLUMNS = [
  "account_code", "legal_entity_code", "period", "debit", "credit",
] as const;

export function buildPilotCsvHeader(kind: "payroll" | "journal"): string {
  return (kind === "payroll" ? PILOT_PAYROLL_COLUMNS : PILOT_JOURNAL_COLUMNS).join(",") + "\n";
}

/**
 * Operator instructions, NOT a sign-off or a source of statutory values.
 * An authorized employer and independent payroll reviewer complete the
 * real evidence only in an access-controlled private location.
 */
export function buildPrivatePilotRunbook(): string {
  return [
    "# PayrollPH / Linaw - controlled first-payroll pilot",
    "",
    "STATUS: preparation checklist only. No employer or reviewer has approved this file.",
    "SCOPE: no-money parallel payroll first; do not trigger bank transfer or government filing.",
    "",
    "## Preparation",
    "- [ ] Employer authorizes the exact legal entity, payroll period and participants.",
    "- [ ] Use a restricted production-like or isolated employer tenant, not demo accounts.",
    "- [ ] Assign distinct Payroll Officer, independent Checker and Owner.",
    "- [ ] Confirm encryption, MFA, access scope and an encrypted private evidence location.",
    "- [ ] Import and independently inspect employee records, prior-period balances, leave and loans.",
    "- [ ] Validate effective-dated pay, holidays, rest days, overtime and contribution policies.",
    "",
    "## No-money rehearsal",
    "- [ ] Enter the exact cutoff's approved attendance and payroll inputs.",
    "- [ ] Resolve and audit exceptions; lock sources and record the source revision.",
    "- [ ] Calculate and inspect each employee's gross-to-net result and statutory treatment.",
    "- [ ] Payroll Officer submits, independent Checker reviews, Owner releases payroll RECORDS only.",
    "- [ ] Generate payslips, payroll register, journal and bank-file DRY RUN (do not transmit).",
    "- [ ] Preserve source and output SHA-256 hashes privately.",
    "",
    "## Independent comparison",
    "- [ ] Normalize incumbent and Linaw payroll and GL files to the attached blank CSV HEADERS.",
    "- [ ] Use a stable, secret HMAC-SHA256 employee_key; never put names, TINs or bank details in those normalized files.",
    "- [ ] Use the same legal_entity_code and YYYY-MM period; monetary amounts are decimal pesos.",
    "- [ ] Independently reconcile every worker, pay component, employer contribution and GL bridge.",
    "- [ ] Investigate and retest each unexplained difference above PHP 0.01.",
    "- [ ] Have an independent qualified payroll reviewer examine source records and sign dated findings.",
    "- [ ] Retain reviewer evidence and hashes only in the approved private encrypted vault.",
    "",
    "## Existing offline verifier (run in an authorized private environment)",
    "Copy certification/parallel-payroll-template.json to a PRIVATE, ignored evidence directory.",
    "Supply hashes for incumbentPayroll, linawPayroll, incumbentJournal and linawJournal.",
    "For one private pilot month:",
    "  npm run payroll:parallel:check -- <private-manifest.json> <private-evidence-directory> --pilot",
    "For broader certification use two distinct real employer months without --pilot.",
    "See docs/payroll-certification/private-parallel-reconciliation.md.",
    "",
    "## Sign-off boundary",
    "- [ ] Owner records the exact released run and genuine independent reference only after human review.",
    "- [ ] A no-money bank export is NOT proof of payout, agency acceptance or production general availability.",
    "- [ ] Before any money moves, separately require authorized bank acceptance, dual control and settlement proof.",
    "- [ ] Complete BIR, SSS, PhilHealth, Pag-IBIG, privacy and production recovery acceptance separately.",
    "- [ ] Obtain independent employer-specific final release approval for the exact deployed revision.",
    "",
    "NEVER upload real salary, employee identifiers, bank records, private report hashes/manifests",
    "or signed source material to public GitHub issues, PRs, CI artifacts or marketing pages.",
    "The checker proves arithmetic and input integrity only; it never issues certification.",
    "",
  ].join("\n");
}
