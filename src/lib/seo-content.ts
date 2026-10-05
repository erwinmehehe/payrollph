export type AuthorityPage = {
  slug: string;
  eyebrow: string;
  title: string;
  description: string;
  intro: string;
  proof: string[];
  sections: Array<{ title: string; body: string; bullets?: string[] }>;
  related: Array<{ label: string; href: string; description: string }>;
  lastReviewed?: string;
  sources?: Array<{ label: string; href: string }>;
};

export const compliancePages: AuthorityPage[] = [
  {
    slug: "bir",
    eyebrow: "BIR payroll compliance",
    title: "BIR payroll compliance for Philippine employers.",
    description: "Guide to Philippine payroll withholding, year-end annualization, 2316 and Alphalist workflows, with clear separation between calculation and filing validation.",
    intro: "Linaw calculates compensation withholding and supports year-end payroll workflows while keeping agency filing readiness separate from the calculation itself.",
    proof: ["Monthly and semi-monthly withholding functions", "Year-end annualization workflow", "2316 draft output", "Alphalist draft output", "Filing validation evidence records", "Audit trail for payroll close"],
    sections: [
      { title: "Withholding starts with the right taxable base", body: "Payroll withholding should be computed from taxable compensation after the applicable statutory and non-taxable treatment, not from a simplistic gross-pay percentage." },
      { title: "Annualization is a separate year-end control", body: "Year-end payroll needs to reconcile cumulative taxable compensation, tax already withheld and the final annual tax position rather than treating every cutoff independently." },
      { title: "Prepared output is not the same as accepted filing", body: "Linaw keeps 2316 and Alphalist output in a validation-gated state until the relevant official workflow has accepted or validated the generated result." },
      { title: "Use evidence instead of blanket compliance claims", body: "The filing-validation model records evidence per government output so the system can say what has been checked and what still requires human confirmation." },
    ],
    related: [
      { label: "Withholding tax calculator", href: "/calculators/withholding-tax", description: "Estimate monthly compensation withholding using the shared payroll rule implementation." },
      { label: "Compliance center", href: "/compliance", description: "See the broader Philippine payroll compliance architecture." },
      { label: "Payroll implementation", href: "/implementation", description: "Review the reconciliation controls used before production rollout." },
    ],
  },
  {
    slug: "sss",
    eyebrow: "SSS payroll compliance",
    title: "SSS contribution handling inside Philippine payroll.",
    description: "Understand SSS employee and employer contribution handling, payroll deduction timing and validation controls in Linaw.",
    intro: "Linaw contains a tested SSS contribution path that separates employee contribution, employer share and EC, while keeping filing acceptance as a separate proof requirement.",
    proof: ["Employee and employer SSS share calculation", "Employer EC handling", "Monthly salary credit logic", "Cutoff deduction timing controls", "R-3 draft workflow", "Validation evidence gate"],
    sections: [
      { title: "Contribution calculation belongs in the payroll engine", body: "The payroll engine computes the SSS shares used by the run rather than asking payroll staff to maintain an external spreadsheet and copy the result back." },
      { title: "Employer cost is not an employee deduction", body: "Employee contribution, employer contribution and EC are represented separately so payroll reports can distinguish take-home deductions from employer payroll cost." },
      { title: "Cutoff timing can differ from monthly liability", body: "The code supports split, first-cutoff and second-cutoff collection patterns so a monthly statutory target can be reconciled across the employer's payroll cycle." },
      { title: "R-3 output remains validation-gated", body: "A generated government file or worksheet should not be described as filing-ready until it has been checked in the relevant official process." },
    ],
    related: [
      { label: "SSS contribution calculator", href: "/calculators/sss-contribution", description: "Estimate SSS shares using the same contribution function used by the product." },
      { label: "Payroll compliance", href: "/compliance", description: "Explore the wider compliance and validation model." },
      { label: "Payroll software", href: "/", description: "See how statutory deductions flow through a complete payroll run." },
    ],
  },
  {
    slug: "philhealth",
    eyebrow: "PhilHealth payroll compliance",
    title: "PhilHealth contribution handling for Philippine payroll.",
    description: "PhilHealth payroll contribution guide covering contribution base, employee and employer shares, payroll treatment and validation status.",
    intro: "Linaw's payroll rules compute the PhilHealth premium and split the resulting statutory amount between employee and employer while preserving centavo-level reconciliation.",
    proof: ["Contribution-base floor and ceiling logic", "Employee/employer split", "Centavo reconciliation", "Payroll deduction integration", "RF-1 draft workflow", "Validation evidence gate"],
    sections: [
      { title: "Calculate the premium from the configured statutory base", body: "The contribution function applies the payroll rule to the relevant salary base and returns the total premium plus the employee and employer shares." },
      { title: "Keep employee and employer shares balanced", body: "When rounding creates an odd centavo, the implementation preserves the total premium and places the unavoidable one-centavo remainder on the employer side." },
      { title: "Treat payroll calculation and agency submission as separate controls", body: "The product can calculate and report payroll liability without claiming that the agency filing format has already been accepted." },
      { title: "Review changes before they reach payroll", body: "Contribution rules are part of the broader compliance-rules governance model so future rule updates can be reviewed and effective-dated instead of silently overwriting history." },
    ],
    related: [
      { label: "PhilHealth calculator", href: "/calculators/philhealth-contribution", description: "Estimate the employee and employer premium shares." },
      { label: "Compliance center", href: "/compliance", description: "See validation and rule-governance controls." },
      { label: "Security", href: "/security", description: "Review how employee and payroll data access is controlled." },
    ],
  },
  {
    slug: "pag-ibig",
    eyebrow: "Pag-IBIG payroll compliance",
    title: "Pag-IBIG contribution handling for Philippine payroll.",
    description: "Pag-IBIG payroll contribution guide for employee and employer shares, payroll deduction timing and filing-validation controls.",
    intro: "Linaw computes Pag-IBIG contribution shares in the payroll rules and keeps monthly liability, cutoff collection and government-output validation as distinct concerns.",
    proof: ["Fund-salary cap logic", "Employee rate handling", "Employer share calculation", "Cutoff deduction timing", "MCRF draft workflow", "Validation evidence gate"],
    sections: [
      { title: "Separate monthly statutory liability from payroll frequency", body: "A monthly contribution obligation may be collected across different cutoffs. Linaw's statutory-deduction timing logic supports that operational distinction." },
      { title: "Keep employer share visible as payroll cost", body: "The employer share is tracked independently from the employee deduction so reports do not blur employee take-home impact and employer cost." },
      { title: "Keep the government-output status honest", body: "Prepared MCRF output is not presented as agency-accepted simply because the payroll engine produced values." },
      { title: "Use effective-dated rule governance", body: "The broader compliance-rules model is designed to resolve the approved rule version for the payroll date and fail closed on ambiguous or missing statutory configuration." },
    ],
    related: [
      { label: "Pag-IBIG calculator", href: "/calculators/pag-ibig-contribution", description: "Estimate employee and employer contributions." },
      { label: "Payroll compliance", href: "/compliance", description: "See the compliance-rules and filing-validation model." },
      { label: "Payroll software", href: "/", description: "See statutory deductions in the wider payroll workflow." },
    ],
  },
  {
    slug: "dole",
    eyebrow: "DOLE payroll compliance",
    title: "DOLE payroll rules that affect pay calculations.",
    description: "Guide to payroll rules involving overtime, night differential, holidays, rest days, pay intervals and wage-order review in the Philippines.",
    intro: "Linaw models several DOLE-relevant payroll conditions directly in the calculation path, including overtime, night differential, holiday premiums, rest-day context and payroll interval checks.",
    proof: ["Overtime multipliers", "Night differential handling", "Holiday and double-holiday context", "Effective-dated rest days", "Regional wage-order screening references", "Payroll interval validation"],
    sections: [
      { title: "Premium pay depends on the work-day context", body: "Overtime should not be priced with one universal multiplier. The payroll engine combines ordinary, rest-day and holiday context when calculating premium pay." },
      { title: "Night differential can overlap overtime and premium days", body: "Night work is derived from the actual time range and can be priced on both regular and overtime minutes using the day-specific multiplier." },
      { title: "Historical rest-day context matters", body: "Rest-day changes are effective-dated so recalculating an older payroll period does not simply apply today's weekly rest day to historical work." },
      { title: "Wage screening is advisory, not a legal conclusion", body: "Regional wage-order references can surface a review warning, but employer category, sector, establishment size and location can affect the legally applicable minimum." },
    ],
    related: [
      { label: "Overtime calculator", href: "/calculators/overtime-pay", description: "Estimate overtime using the product's holiday/rest-day multiplier logic." },
      { label: "Night differential calculator", href: "/calculators/night-differential", description: "Estimate night differential on regular or overtime work." },
      { label: "Time & attendance", href: "/time-and-attendance", description: "See how raw punches become payroll-relevant worked time." },
    ],
  },
];

export const resourcePages: AuthorityPage[] = [
  {
    slug: "best-payroll-software-philippines",
    eyebrow: "Payroll software buyer guide",
    title: "How to evaluate payroll software in the Philippines.",
    description: "A practical buyer guide for comparing Philippine payroll systems across calculations, controls, implementation, security, integrations and proof.",
    intro: "The strongest payroll buying process evaluates more than a feature checklist. It tests whether the system can explain calculations, handle your workforce rules, control approvals and prove its operational claims.",
    proof: ["Statutory calculation depth", "Time and attendance integration", "Role separation and approvals", "Migration and reconciliation", "Security controls", "API and export options"],
    sections: [
      { title: "Start with your hardest payroll cases", body: "Ask vendors to demonstrate the pay conditions that create the most rework in your company: overtime, night work, rest days, holidays, variable schedules, deductions, benefits and exceptions." },
      { title: "Ask how payroll is reviewed before release", body: "A system should make calculation state, exceptions, reviewer ownership and final release authority visible instead of hiding the whole cycle behind one Process button." },
      { title: "Require an implementation proof plan", body: "A credible rollout should include migration validation, role configuration, parallel or controlled payroll, independent reconciliation and a clear go-live gate." },
      { title: "Make security evidence part of procurement", body: "Evaluate MFA, session controls, tenant isolation, access scope, encryption practices, audit events, incident handling and the difference between implemented controls and formal certifications." },
    ],
    related: [
      { label: "Capability scorecard", href: "/scorecard", description: "See how Linaw classifies its own verified, partial and absent capabilities." },
      { label: "Payroll software vs outsourcing", href: "/resources/payroll-software-vs-outsourcing", description: "Choose the operating model that fits your payroll team." },
      { label: "Payroll security checklist", href: "/resources/payroll-security-checklist", description: "Use a security-focused procurement checklist." },
    ],
  },
  {
    slug: "payroll-software-vs-outsourcing",
    eyebrow: "Payroll operating model",
    title: "Payroll software vs payroll outsourcing: which model fits?",
    description: "Compare running payroll in-house with software versus using a managed payroll service in the Philippines.",
    intro: "Software and outsourcing solve different operational problems. The right choice depends on who should own payroll preparation, exceptions, approvals, staffing and day-to-day process knowledge.",
    proof: ["In-house control vs managed processing", "Internal capability requirements", "Approval ownership", "Exception handling", "Cost structure", "Continuity risk"],
    sections: [
      { title: "Choose software when you want the process in-house", body: "Software fits teams that want payroll knowledge, configuration and daily operating control to stay inside the business." },
      { title: "Choose managed payroll when repetitive cycle work is the constraint", body: "Outsourcing can reduce processing workload while the employer still retains business decisions, approved inputs and final release authority." },
      { title: "Compare the exception model, not only the happy path", body: "Ask what happens when attendance is incomplete, a deduction is disputed, a new hire is missing data or a payroll run needs to be recalculated." },
      { title: "Use a hybrid model if ownership needs differ by entity", body: "Some groups may keep payroll in-house for one entity while using managed processing for another. Multi-client and multi-entity architecture can make that operating model easier." },
    ],
    related: [
      { label: "Payroll outsourcing", href: "/payroll-outsourcing", description: "See Linaw's managed payroll service model." },
      { label: "Payroll software", href: "/", description: "See the self-operated software workflow." },
      { label: "Implementation guide", href: "/implementation", description: "Understand the migration and rollout work in either model." },
    ],
  },
  {
    slug: "payroll-migration-checklist",
    eyebrow: "Payroll migration checklist",
    title: "Payroll migration checklist for Philippine businesses.",
    description: "A practical checklist for moving employee, payroll, attendance, statutory and approval data into a new payroll system.",
    intro: "Payroll migration is not a CSV upload project. It is a controlled transfer of employee data, balances, policies, schedules, statutory context and approval ownership.",
    proof: ["Employee master data", "Opening balances and YTD values", "Schedules and rest days", "Benefits and deductions", "Government IDs", "Roles and approval matrix"],
    sections: [
      { title: "Inventory payroll-critical data", body: "Map employee master data, pay rates, tax and government identifiers, schedule rules, balances, recurring deductions, loans, benefits and bank details." },
      { title: "Define what must be historically accurate", body: "Rest-day revisions, year-to-date tax, benefit-pool consumption and prior payroll values can affect future calculations and should not be reduced to today's values." },
      { title: "Validate the import before calculating payroll", body: "Use row-level validation, duplicate controls and reconciliation totals before the first migrated payroll is run." },
      { title: "Reconcile independently before go-live", body: "Prepare expected figures outside the new system and compare gross, deductions, contributions, tax, net pay, payout total, payslips and accounting output." },
    ],
    related: [
      { label: "Implementation", href: "/implementation", description: "See the full Linaw migration and rollout model." },
      { label: "HRIS", href: "/hris", description: "Review the employee-data foundation." },
      { label: "Payroll security checklist", href: "/resources/payroll-security-checklist", description: "Add security review to implementation planning." },
    ],
  },
  {
    slug: "payroll-security-checklist",
    eyebrow: "Payroll software security checklist",
    title: "Payroll software security checklist for buyers.",
    description: "Questions to ask about authentication, authorization, tenant isolation, sensitive payroll data, auditability and deployment security.",
    intro: "Payroll systems hold compensation, identity and bank information. Security evaluation should focus on enforceable controls and evidence rather than generic statements that a platform is secure.",
    proof: ["MFA", "Revocable sessions", "Tenant isolation", "Role scope", "Sensitive-field encryption", "Audit and security testing"],
    sections: [
      { title: "Authentication", body: "Ask about password hashing, login rate limiting, account lockout, MFA, password reset, session expiry and server-side session revocation." },
      { title: "Authorization", body: "Confirm organization, department and employee boundaries are enforced by the server on every sensitive request instead of being only hidden in the interface." },
      { title: "Sensitive data", body: "Ask which payroll fields receive dedicated encryption, how encryption keys are managed and what happens to historical plaintext during a security migration." },
      { title: "Proof and operations", body: "Review security tests, audit logs, production-readiness gates, incident processes and the difference between code controls and independently audited certifications." },
    ],
    related: [
      { label: "Security", href: "/security", description: "See Linaw's repository-evidenced security controls." },
      { label: "Trust center", href: "/trust", description: "Review capability, status and security proof surfaces." },
      { label: "Buyer guide", href: "/resources/best-payroll-software-philippines", description: "Use security alongside payroll and implementation criteria." },
    ],
  },
  {
    slug: "payroll-software-vs-excel",
    eyebrow: "Payroll process comparison",
    title: "Payroll software vs Excel for Philippine payroll.",
    description: "Compare spreadsheet payroll with a controlled payroll system across calculations, approvals, auditability, employee access and recurring compliance work.",
    intro: "Excel can be flexible, but payroll risk grows when formulas, source data, approvals, exceptions and release evidence live across disconnected files and inboxes.",
    proof: ["Formula governance", "Change history", "Approval separation", "Attendance integration", "Employee payslips", "Repeatable exports"],
    sections: [
      { title: "Spreadsheets are flexible but easy to fork", body: "When multiple copies circulate, it becomes difficult to know which formula set, employee data and approval state produced the final payroll." },
      { title: "A payroll system can preserve workflow state", body: "Calculation, exception review, checker approval, owner release, payout evidence and payslip delivery can be represented as explicit states rather than comments in a workbook." },
      { title: "Automation only helps when the underlying rule is reviewable", body: "The goal is not to eliminate humans. It is to make repetitive calculation consistent while surfacing cases that still need judgment." },
      { title: "Migration should preserve reconciliation discipline", body: "Moving away from spreadsheets should start with parallel validation, not an assumption that the new system must be right because it is software." },
    ],
    related: [
      { label: "Payroll migration checklist", href: "/resources/payroll-migration-checklist", description: "Plan a controlled move away from spreadsheets." },
      { label: "Implementation", href: "/implementation", description: "See how Linaw approaches validation before rollout." },
      { label: "Live demo", href: "/demo", description: "Inspect the payroll workflow directly." },
    ],
  },
];

export const industryPages: AuthorityPage[] = [
  {
    slug: "accounting-firms",
    eyebrow: "Payroll software for accounting firms",
    title: "Multi-client payroll for Philippine accounting firms and bookkeepers.",
    description: "Payroll workspace for bookkeepers and accounting firms managing multiple Philippine client businesses with scoped access, payroll runs, exports and compliance context.",
    intro: "Linaw's multi-client architecture is built for operators who need to switch between client businesses without collapsing every company into one payroll workspace.",
    proof: ["Multi-client bookkeeper hub", "Tenant-scoped authorization", "Client-specific payroll runs", "Accounting exports", "Compliance context", "Audit trail"],
    sections: [
      { title: "Keep client workspaces distinct", body: "Organization membership and tenant checks prevent a user from treating a client ID in the browser as authorization to another company's data." },
      { title: "Move from payroll processing into accounting close", body: "Released payroll can feed supported journal exports, payout evidence and compliance review from the same client context." },
      { title: "Use role boundaries inside each client", body: "Bookkeepers can work alongside owners, HR, payroll officers and checkers without every role needing identical access." },
      { title: "Scale process without copying workbooks", body: "A multi-client workspace is designed to make repeatable operating controls reusable while keeping each client's employees, payroll and evidence scoped correctly." },
    ],
    related: [
      { label: "Payroll outsourcing", href: "/payroll-outsourcing", description: "See the managed payroll operating model." },
      { label: "Developer center", href: "/developers", description: "Review API and webhook capabilities for connected workflows." },
      { label: "Security", href: "/security", description: "Inspect tenant isolation and role controls." },
    ],
  },
  {
    slug: "manpower",
    eyebrow: "Payroll software for manpower agencies",
    title: "Payroll for Philippine manpower and staffing operations.",
    description: "Payroll software for manpower agencies handling large rosters, variable assignments, timekeeping, deductions, statutory contributions and payroll approvals.",
    intro: "Staffing and manpower payroll becomes difficult when employee volume, changing assignments, attendance inputs, deductions and client operations create constant cutoff changes.",
    proof: ["CSV bulk employee import", "Large roster processing", "Attendance and scheduling", "Loans and deductions", "Statutory payroll", "Role-based review"],
    sections: [
      { title: "Onboard and update large employee rosters", body: "CSV import supports row-level validation and update-by-employee-number behavior so recurring roster changes do not have to create duplicates." },
      { title: "Connect attendance to payroll", body: "Raw punches, schedules, overtime and night work can feed payroll instead of being manually re-encoded every cutoff." },
      { title: "Handle recurring deductions and employee obligations", body: "Loans, benefits and other payroll-impacting items can be represented in the payroll data model rather than tracked only in side spreadsheets." },
      { title: "Separate preparation from release authority", body: "Payroll staff can prepare the run while independent reviewers and owners retain the decision to approve or release it." },
    ],
    related: [
      { label: "Time & attendance", href: "/time-and-attendance", description: "See how attendance moves into payroll." },
      { label: "HRIS", href: "/hris", description: "Review employee master-data workflows." },
      { label: "Implementation", href: "/implementation", description: "Plan roster migration and payroll reconciliation." },
    ],
  },
  {
    slug: "manufacturing",
    eyebrow: "Manufacturing payroll Philippines",
    title: "Payroll and timekeeping for Philippine manufacturing teams.",
    description: "Payroll software for manufacturers with shifts, biometrics, overtime, rest days, holidays, multiple work groups and controlled payroll review.",
    intro: "Manufacturing payroll is heavily shaped by attendance, schedules, overtime, rest days and holiday work. Linaw models those conditions before payroll reaches review and release.",
    proof: ["Shift scheduling", "Biometric sync endpoint", "Overtime workflows", "Effective-dated rest days", "Holiday premium logic", "Department scope"],
    sections: [
      { title: "Use schedules and punches as payroll evidence", body: "Clock data is converted into worked time, tardiness, undertime, overtime and night minutes with exceptions for incomplete or invalid punch sequences." },
      { title: "Preserve department and work-group scope", body: "Department-scoped access lets teams work within their assigned operational area while company-wide roles retain broader oversight." },
      { title: "Handle premium-pay context", body: "Holiday, rest-day, overtime and night differential calculations use the work-date context instead of a single flat overtime rule." },
      { title: "Keep exceptions visible before release", body: "Incomplete punches and payroll-relevant review conditions can be surfaced for human sign-off rather than silently guessed." },
    ],
    related: [
      { label: "Time & attendance", href: "/time-and-attendance", description: "Explore the attendance-to-payroll workflow." },
      { label: "DOLE payroll guide", href: "/compliance/dole", description: "Review premium-pay and wage-screening context." },
      { label: "Overtime calculator", href: "/calculators/overtime-pay", description: "Estimate overtime under different work-day conditions." },
    ],
  },
];

export function authorityPage(collection: AuthorityPage[], slug: string) {
  return collection.find((page) => page.slug === slug);
}
