export type AuthorityPage = {
  slug: string;
  eyebrow: string;
  title: string;
  metaTitle?: string;
  description: string;
  intro: string;
  proof: string[];
  sections: Array<{ title: string; body: string; bullets?: string[] }>;
  faq?: Array<{ question: string; answer: string }>;
  related: Array<{ label: string; href: string; description: string }>;
  lastReviewed?: string;
  lastReviewedIso?: string;
  sources?: Array<{ label: string; href: string }>;
};

export const compliancePages: AuthorityPage[] = [
  {
    slug: "bir",
    eyebrow: "BIR payroll compliance",
    title: "BIR payroll compliance for Philippine employers.",
    metaTitle: "BIR Payroll Compliance Philippines | Linaw",
    description: "Guide to Philippine payroll withholding, year-end annualization, 2316 and Alphalist workflows, with clear separation between calculation and filing validation.",
    intro: "Linaw calculates compensation withholding and supports year-end payroll workflows while keeping agency filing readiness separate from the calculation itself.",
    proof: ["Monthly and semi-monthly withholding functions", "Year-end annualization workflow", "2316 draft output", "Alphalist draft output", "Filing validation evidence records", "Audit trail for payroll close"],
    sections: [
      { title: "Withholding starts with the right taxable base", body: "Payroll withholding should be computed from taxable compensation after the applicable statutory and non-taxable treatment, not from a simplistic gross-pay percentage." },
      { title: "Annualization is a separate year-end control", body: "Year-end payroll needs to reconcile cumulative taxable compensation, tax already withheld and the final annual tax position rather than treating every cutoff independently." },
      { title: "Prepared output is not the same as accepted filing", body: "Linaw keeps 2316 and Alphalist output in a validation-gated state until the relevant official workflow has accepted or validated the generated result." },
      { title: "Use evidence instead of blanket compliance claims", body: "The filing-validation model records evidence per government output so the system can say what has been checked and what still requires human confirmation." },
    ],
    faq: [
      { question: "What should payroll reconcile before preparing BIR year-end outputs?", answer: "Reconcile cumulative taxable compensation, tax already withheld, employee identity data and any year-end adjustments before preparing downstream certificates or annual reporting outputs." },
      { question: "Is a generated BIR payroll output automatically filing-ready?", answer: "No. Calculation and document generation are separate from the employer's validation, filing, delivery and acceptance workflow." },
      { question: "Why does payroll annualization matter for BIR reporting?", answer: "Annualization reconciles the employee's cumulative taxable compensation and tax withheld so year-end payroll records reflect the final annual position rather than isolated cutoff calculations." },
      { question: "What evidence should be kept after a BIR payroll workflow is completed?", answer: "Keep the payroll version, covered period, generated output version, review status and any filing or delivery evidence needed to trace what was actually completed." },
      { question: "How does the ₱90,000 13th-month and other-benefits ceiling affect payroll?", answer: "The BIR compensation-tax workflow treats the non-taxable 13th-month pay and other benefits ceiling as a shared pool. Amounts above the prescribed ceiling become taxable compensation." },
      { question: "Where should payroll teams verify current BIR compensation-tax rules?", answer: "Use current BIR regulations, official withholding guidance and the BIR compensation withholding calculator, then reconcile those requirements against the payroll rule version used for the period." },
    ],
    lastReviewed: "October 5, 2026",
    lastReviewedIso: "2026-10-05",
    sources: [
      { label: "BIR Withholding Tax Calculator", href: "https://web-services.bir.gov.ph/tax_calculator/wt_calculator.html" },
      { label: "BIR RR No. 29-2025 digest", href: "https://bir-cdn.bir.gov.ph/BIR/pdf/RR%20No.%2029-2025%20digest%20FINAL.pdf" },
      { label: "BIR 2026 Revenue Regulations", href: "https://www.bir.gov.ph/2026-Revenue-Regulations" },
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
    metaTitle: "SSS Payroll Compliance Philippines | Linaw",
    description: "SSS payroll compliance guide for Philippine employers covering employee and employer shares, EC, salary credits, cutoff timing and R-3 validation controls.",
    intro: "Linaw contains a tested SSS contribution path that separates employee contribution, employer share and EC, while keeping filing acceptance as a separate proof requirement.",
    proof: ["Employee and employer SSS share calculation", "Employer EC handling", "Monthly salary credit logic", "Cutoff deduction timing controls", "R-3 draft workflow", "Validation evidence gate"],
    sections: [
      { title: "Contribution calculation belongs in the payroll engine", body: "The payroll engine computes the SSS shares used by the run rather than asking payroll staff to maintain an external spreadsheet and copy the result back." },
      { title: "Employer cost is not an employee deduction", body: "Employee contribution, employer contribution and EC are represented separately so payroll reports can distinguish take-home deductions from employer payroll cost." },
      { title: "Cutoff timing can differ from monthly liability", body: "The code supports split, first-cutoff and second-cutoff collection patterns so a monthly statutory target can be reconciled across the employer's payroll cycle." },
      { title: "R-3 output remains validation-gated", body: "A generated government file or worksheet should not be described as filing-ready until it has been checked in the relevant official process." },
    ],
    faq: [
      { question: "Should employee and employer SSS amounts be tracked separately?", answer: "Yes. Employee deductions, employer contributions and employer-paid components should remain distinct so take-home pay and employer payroll cost are not mixed together." },
      { question: "Why can SSS deduction timing differ from the monthly liability?", answer: "Employers may collect a monthly statutory obligation across their payroll cutoffs, so payroll needs a clear timing rule while still reconciling the final monthly amount." },
      { question: "Does calculating SSS contributions prove the remittance was completed?", answer: "No. Payroll calculation, government reporting output and actual remittance or acceptance evidence are separate controls." },
      { question: "What should happen when an employee contribution record needs correction?", answer: "The issue should be traceable to the employee, covered month and payroll evidence, assigned to an owner, and resolved with a documented outcome rather than silently changing history." },
      { question: "What is the current SSS contribution rate for employed members?", answer: "The latest SSS employer-and-employee schedule effective January 2025 uses a 15% contribution rate on the applicable Monthly Salary Credit, split 10% employer and 5% employee, with the schedule extending to a ₱35,000 maximum MSC." },
      { question: "What happens to SSS contributions above the regular Social Security MSC?", answer: "SSS states that contributions on MSC above ₱20,000 up to the current maximum are credited under the Mandatory Provident Fund program, now called MySSS Pension Booster." },
      { question: "Is Employees' Compensation deducted from the employee?", answer: "No. The Employees' Compensation contribution is an employer-paid amount and should remain separate from the employee deduction in payroll reporting." },
    ],
    lastReviewed: "October 5, 2026",
    lastReviewedIso: "2026-10-05",
    sources: [
      { label: "SSS Pay Contributions", href: "https://www.sss.gov.ph/pay-contribution/" },
      { label: "SSS 2025 Employer and Employee Contribution Table", href: "https://www.sss.gov.ph/wp-content/uploads/2024/12/2025-SSS-Contribution-Table-rev.pdf" },
      { label: "SSS Contribution Table", href: "https://www.sss.gov.ph/sss-contribution-table/" },
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
    metaTitle: "PhilHealth Payroll Compliance Philippines | Linaw",
    description: "PhilHealth payroll compliance guide covering contribution-base rules, employee and employer shares, centavo reconciliation, deductions and RF-1 validation.",
    intro: "Linaw's payroll rules compute the PhilHealth premium and split the resulting statutory amount between employee and employer while preserving centavo-level reconciliation.",
    proof: ["Contribution-base floor and ceiling logic", "Employee/employer split", "Centavo reconciliation", "Payroll deduction integration", "RF-1 draft workflow", "Validation evidence gate"],
    sections: [
      { title: "Calculate the premium from the configured statutory base", body: "The contribution function applies the payroll rule to the relevant salary base and returns the total premium plus the employee and employer shares." },
      { title: "Keep employee and employer shares balanced", body: "When rounding creates an odd centavo, the implementation preserves the total premium and places the unavoidable one-centavo remainder on the employer side." },
      { title: "Treat payroll calculation and agency submission as separate controls", body: "The product can calculate and report payroll liability without claiming that the agency filing format has already been accepted." },
      { title: "Review changes before they reach payroll", body: "Contribution rules are part of the broader compliance-rules governance model so future rule updates can be reviewed and effective-dated instead of silently overwriting history." },
    ],
    faq: [
      { question: "Why should PhilHealth employee and employer shares reconcile to the total premium?", answer: "Payroll reporting should preserve the total statutory amount while keeping the employee deduction and employer cost separately visible." },
      { question: "How should rounding differences be handled in payroll?", answer: "Rounding should preserve the total contribution and follow the product's tested centavo-reconciliation rule rather than allowing employee and employer shares to drift from the total." },
      { question: "Does a correct payroll deduction prove PhilHealth filing or remittance was accepted?", answer: "No. The payroll calculation and the agency submission or remittance workflow require separate validation evidence." },
      { question: "What should payroll review when a PhilHealth contribution appears wrong?", answer: "Review the applicable payroll base, employee data, covered month, calculation trace, deduction timing and any remittance-member record before deciding whether a correction is needed." },
      { question: "What premium rate does the latest official PhilHealth schedule show?", answer: "PhilHealth's 2025 advisory keeps the premium rate for direct contributors at 5%, with a ₱10,000 monthly basic salary floor and a ₱100,000 ceiling." },
      { question: "What salary amount should be used for PhilHealth payroll contribution?", answer: "PhilHealth instructs employers to use Monthly Basic Salary for employee premium computation and excludes items such as commissions, overtime pay, allowances, 13th-month pay, bonuses and other gratuities from that base." },
    ],
    lastReviewed: "October 5, 2026",
    lastReviewedIso: "2026-10-05",
    sources: [
      { label: "PhilHealth Premium Contribution Advisory 2025-0002", href: "https://www.philhealth.gov.ph/advisories/2025/PA2025-0002.pdf" },
      { label: "PhilHealth Universal Health Care contribution schedule", href: "https://www.philhealth.gov.ph/uhc/" },
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
    metaTitle: "Pag-IBIG Payroll Compliance Philippines | Linaw",
    description: "Pag-IBIG payroll compliance guide for Philippine employers covering employee and employer shares, fund-salary caps, cutoff timing, monthly liability and MCRF validation.",
    intro: "Linaw computes Pag-IBIG contribution shares in the payroll rules and keeps monthly liability, cutoff collection and government-output validation as distinct concerns.",
    proof: ["Fund-salary cap logic", "Employee rate handling", "Employer share calculation", "Cutoff deduction timing", "MCRF draft workflow", "Validation evidence gate"],
    sections: [
      { title: "Separate monthly statutory liability from payroll frequency", body: "A monthly contribution obligation may be collected across different cutoffs. Linaw's statutory-deduction timing logic supports that operational distinction." },
      { title: "Keep employer share visible as payroll cost", body: "The employer share is tracked independently from the employee deduction so reports do not blur employee take-home impact and employer cost." },
      { title: "Keep the government-output status honest", body: "Prepared MCRF output is not presented as agency-accepted simply because the payroll engine produced values." },
      { title: "Use effective-dated rule governance", body: "The broader compliance-rules model is designed to resolve the approved rule version for the payroll date and fail closed on ambiguous or missing statutory configuration." },
    ],
    faq: [
      { question: "Why should Pag-IBIG monthly liability be separated from cutoff collection?", answer: "The statutory obligation is monthly while an employer may operate multiple payroll cutoffs, so the payroll system should reconcile the final monthly target without double-collecting or missing an employee." },
      { question: "Should the employer share appear as an employee deduction?", answer: "No. Employer contribution is an employer payroll cost and should remain distinct from the amount deducted from the employee's pay." },
      { question: "Does generating an MCRF-related output prove agency acceptance?", answer: "No. Prepared payroll output remains separate from official validation, submission and remittance evidence." },
      { question: "What should be checked when a Pag-IBIG contribution issue is reported?", answer: "Check the employee's covered month, applicable payroll base, deduction timing, monthly reconciliation and the remittance record before recording the resolution." },
      { question: "Where should employers verify Pag-IBIG contribution requirements?", answer: "Employers should use current Pag-IBIG Fund circulars and official employer guidance, especially when contribution bases, schedules or remittance procedures change." },
    ],
    lastReviewed: "October 5, 2026",
    lastReviewedIso: "2026-10-05",
    sources: [
      { label: "Pag-IBIG Fund Membership Guidelines", href: "https://www.pagibigfund.gov.ph/document/pdf/circulars/provident/HDMF%20Circular%20No.%20274%20-%20Revised%20Guidelines%20on%20Pag-IBIG%20Fund%20Membership.pdf" },
      { label: "Pag-IBIG Employer Registration, Contribution and Remittance Guidelines", href: "https://www.pagibigfund.gov.ph/document/pdf/circulars/provident/HDMF%20Circular%20275%20-%20Implementing%20Guidelines%20on%20Employer%20Registration%20Contribution%20and%20Remittance.pdf" },
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
    metaTitle: "DOLE Payroll Rules Philippines | Overtime & Night Pay | Linaw",
    description: "DOLE payroll compliance guide for Philippine employers covering overtime, night differential, holidays, rest days, pay intervals and wage-order review.",
    intro: "Linaw models several DOLE-relevant payroll conditions directly in the calculation path, including overtime, night differential, holiday premiums, rest-day context and payroll interval checks.",
    proof: ["Overtime multipliers", "Night differential handling", "Holiday and double-holiday context", "Effective-dated rest days", "Regional wage-order screening references", "Payroll interval validation"],
    sections: [
      { title: "Premium pay depends on the work-day context", body: "Overtime should not be priced with one universal multiplier. The payroll engine combines ordinary, rest-day and holiday context when calculating premium pay." },
      { title: "Night differential can overlap overtime and premium days", body: "Night work is derived from the actual time range and can be priced on both regular and overtime minutes using the day-specific multiplier." },
      { title: "Historical rest-day context matters", body: "Rest-day changes are effective-dated so recalculating an older payroll period does not simply apply today's weekly rest day to historical work." },
      { title: "Wage screening is advisory, not a legal conclusion", body: "Regional wage-order references can surface a review warning, but employer category, sector, establishment size and location can affect the legally applicable minimum. automated screening should surface a review rather than replace legal classification." },
    ],
    faq: [
      { question: "Why can overtime pay differ depending on the work date?", answer: "Overtime can interact with rest-day and holiday context, so the applicable premium cannot always be reduced to one universal multiplier." },
      { question: "Can night differential overlap with overtime or holiday work?", answer: "Yes. Payroll should preserve the underlying work-time and day context so overlapping premium components are calculated from the actual shift rather than converted into a flat allowance." },
      { question: "Why are historical rest-day assignments important?", answer: "If a rest-day assignment changes later, recalculating an older payroll period should still use the work schedule that applied on the original date." },
      { question: "Does a wage-order screening warning determine the employee's legal minimum wage?", answer: "No. Screening can surface a review condition, but the legally applicable wage can depend on region, sector, employer category, establishment size and other facts that require confirmation." },
      { question: "What is the statutory night shift differential under the Labor Code?", answer: "Article 86 provides a night shift differential of not less than 10% of the regular wage for covered work performed between 10:00 p.m. and 6:00 a.m." },
      { question: "What is the minimum overtime premium on an ordinary workday?", answer: "Article 87 provides an additional compensation of at least 25% of the regular wage for work beyond eight hours on an ordinary workday, subject to coverage and applicable rules." },
    ],
    lastReviewed: "October 5, 2026",
    lastReviewedIso: "2026-10-05",
    sources: [
      { label: "DOLE Labor Code, Book III: Conditions of Employment", href: "https://dole.gov.ph/book-3-conditions-of-employment/" },
      { label: "NWPC/BWC Handbook on Workers' Statutory Monetary Benefits", href: "https://nwpc.dole.gov.ph/bwc-handbook-workers-statutory-monetary-benefits/" },
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
    metaTitle: "Best Payroll Software Philippines: Buyer Guide | Linaw",
    description: "Compare Philippine payroll software by calculation depth, approvals, implementation, security, integrations and evidence before choosing a system.",
    intro: "The strongest payroll buying process evaluates more than a feature checklist. It tests whether the system can explain calculations, handle your workforce rules, control approvals and prove its operational claims.",
    proof: ["Statutory calculation depth", "Time and attendance integration", "Role separation and approvals", "Migration and reconciliation", "Security controls", "API and export options"],
    sections: [
      { title: "Start with your hardest payroll cases", body: "Ask vendors to demonstrate the pay conditions that create the most rework in your company: overtime, night work, rest days, holidays, variable schedules, deductions, benefits and exceptions." },
      { title: "Ask how payroll is reviewed before release", body: "A system should make calculation state, exceptions, reviewer ownership and final release authority visible instead of hiding the whole cycle behind one Process button." },
      { title: "Require an implementation proof plan", body: "A credible rollout should include migration validation, role configuration, parallel or controlled payroll, independent reconciliation and a clear go-live gate." },
      { title: "Make security evidence part of procurement", body: "Evaluate MFA, session controls, tenant isolation, access scope, encryption practices, audit events, incident handling and the difference between implemented controls and formal certifications." },
    ],
    faq: [
      { question: "What should I test in a Philippine payroll software demo?", answer: "Use the payroll cases that create the most rework in your business: overtime, night work, rest days, holidays, variable schedules, deductions, exceptions and approval handoffs. A polished happy-path demo is not enough." },
      { question: "Should I choose payroll software based on the longest feature list?", answer: "No. Prioritize calculation traceability, exception handling, role separation, migration controls, security evidence and the workflows your payroll team actually uses each cutoff." },
      { question: "How should I verify payroll compliance claims?", answer: "Separate payroll calculation capability from filing acceptance. Ask which rules are implemented and tested, which government outputs are validation-gated, and what evidence exists for any filing-readiness claim." },
      { question: "What should happen before a payroll system goes live?", answer: "A controlled rollout should validate migrated data, configure roles and approvals, run independent reconciliation or parallel payroll, clear material variances and document a go-live decision." },
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
    metaTitle: "Payroll Software vs Outsourcing Philippines | Linaw",
    description: "Compare payroll software and managed payroll outsourcing in the Philippines by control, staffing, approvals, exception handling, cost and continuity.",
    intro: "Software and outsourcing solve different operational problems. The right choice depends on who should own payroll preparation, exceptions, approvals, staffing and day-to-day process knowledge.",
    proof: ["In-house control vs managed processing", "Internal capability requirements", "Approval ownership", "Exception handling", "Cost structure", "Continuity risk"],
    sections: [
      { title: "Choose software when you want the process in-house", body: "Software fits teams that want payroll knowledge, configuration and daily operating control to stay inside the business." },
      { title: "Choose managed payroll when repetitive cycle work is the constraint", body: "Outsourcing can reduce processing workload while the employer still retains business decisions, approved inputs and final release authority." },
      { title: "Compare the exception model, not only the happy path", body: "Ask what happens when attendance is incomplete, a deduction is disputed, a new hire is missing data or a payroll run needs to be recalculated." },
      { title: "Use a hybrid model if ownership needs differ by entity", body: "Some groups may keep payroll in-house for one entity while using managed processing for another. Multi-client and multi-entity architecture can make that operating model easier." },
    ],
    faq: [
      { question: "When does payroll software make more sense than outsourcing?", answer: "Software fits teams that want payroll knowledge, configuration and daily operating control to remain in-house and have people who can own the recurring payroll process." },
      { question: "When does payroll outsourcing make more sense?", answer: "Managed payroll is useful when repetitive cycle work, staffing capacity or continuity is the constraint, while the employer still keeps responsibility for approved inputs and business decisions." },
      { question: "Does outsourcing remove employer approval responsibility?", answer: "No. A sound managed-payroll model keeps exception decisions and final payroll approval with authorized employer representatives rather than treating the provider as the business decision-maker." },
      { question: "Can a company use both models?", answer: "Yes. Different entities or business units can use different operating models when ownership, staffing or complexity differs, provided access and payroll data remain clearly scoped." },
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
    metaTitle: "Payroll Migration Checklist Philippines | Linaw",
    description: "Use a Philippine payroll migration checklist covering employee data, YTD balances, schedules, deductions, government IDs, roles and reconciliation.",
    intro: "Payroll migration is not a CSV upload project. It is a controlled transfer of employee data, balances, policies, schedules, statutory context and approval ownership.",
    proof: ["Employee master data", "Opening balances and YTD values", "Schedules and rest days", "Benefits and deductions", "Government IDs", "Roles and approval matrix"],
    sections: [
      { title: "Inventory payroll-critical data", body: "Map employee master data, pay rates, tax and government identifiers, schedule rules, balances, recurring deductions, loans, benefits and bank details." },
      { title: "Define what must be historically accurate", body: "Rest-day revisions, year-to-date tax, benefit-pool consumption and prior payroll values can affect future calculations and should not be reduced to today's values." },
      { title: "Validate the import before calculating payroll", body: "Use row-level validation, duplicate controls and reconciliation totals before the first migrated payroll is run." },
      { title: "Reconcile independently before go-live", body: "Prepare expected figures outside the new system and compare gross, deductions, contributions, tax, net pay, payout total, payslips and accounting output." },
    ],
    faq: [
      { question: "What payroll data should be migrated first?", answer: "Start with the employee master, pay setup, year-to-date balances, schedules and rest days, recurring deductions, benefits, loans, government identifiers and approval ownership." },
      { question: "Why do year-to-date payroll balances matter?", answer: "Current-period payroll can depend on earlier taxable compensation, tax already withheld, benefit-pool usage and other cumulative values, so opening balances must be reconciled rather than guessed." },
      { question: "Should historical schedules and rest days be migrated?", answer: "If historical or future calculations depend on them, yes. Effective-dated work rules prevent today's schedule from silently rewriting the context of an older payroll period." },
      { question: "How should the first payroll in a new system be validated?", answer: "Prepare an independent expected result and compare gross pay, deductions, statutory contributions, tax, net pay, payout totals, payslips and accounting outputs before go-live." },
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
    metaTitle: "Payroll Security Checklist Guide Philippines | Linaw",
    description: "Evaluate Philippine payroll software security across MFA, sessions, tenant isolation, role scope, encryption, audit trails and deployment controls.",
    intro: "Payroll systems hold compensation, identity and bank information. Security evaluation should focus on enforceable controls and evidence rather than generic statements that a platform is secure.",
    proof: ["MFA", "Revocable sessions", "Tenant isolation", "Role scope", "Sensitive-field encryption", "Audit and security testing"],
    sections: [
      { title: "Authentication", body: "Ask about password hashing, login rate limiting, account lockout, MFA, password reset, session expiry and server-side session revocation." },
      { title: "Authorization", body: "Confirm organization, department and employee boundaries are enforced by the server on every sensitive request instead of being only hidden in the interface." },
      { title: "Sensitive data", body: "Ask which payroll fields receive dedicated encryption, how encryption keys are managed and what happens to historical plaintext during a security migration." },
      { title: "Proof and operations", body: "Review security tests, audit logs, production-readiness gates, incident processes and the difference between code controls and independently audited certifications." },
    ],
    faq: [
      { question: "What security controls matter most in payroll software?", answer: "Focus on authentication, MFA, session revocation, server-side authorization, tenant isolation, least-privilege role scope, protection of sensitive payroll fields and auditable sensitive actions." },
      { question: "Is hiding data in the user interface enough for payroll security?", answer: "No. Organization, department and employee boundaries should be enforced on the server for each sensitive request rather than relying on the browser to hide inaccessible data." },
      { question: "Should payroll bank and government ID data be encrypted?", answer: "Sensitive payroll fields should have explicit protection at rest and controlled access paths. Buyers should also ask how keys, migrations and historical plaintext are handled operationally." },
      { question: "How is a security checklist different from a certification?", answer: "A checklist helps buyers inspect implemented controls and evidence. It does not replace an independent certification or audit, and a vendor should not imply certifications it has not obtained." },
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
    metaTitle: "Payroll Software vs Excel Philippines | Linaw",
    description: "Compare manual or Excel payroll with payroll software in the Philippines across formulas, approvals, audit trails, attendance, exceptions and repeatable outputs.",
    intro: "Manual payroll often depends on Excel or similar spreadsheets. That can be flexible, but risk grows when formulas, source data, approvals, exceptions and release evidence live across disconnected files and inboxes.",
    proof: ["Formula governance", "Change history", "Approval separation", "Attendance integration", "Employee payslips", "Repeatable exports"],
    sections: [
      { title: "Spreadsheets are flexible but easy to fork", body: "When multiple copies circulate, it becomes difficult to know which formula set, employee data and approval state produced the final payroll." },
      { title: "A payroll system can preserve workflow state", body: "Calculation, exception review, checker approval, owner release, payout evidence and payslip delivery can be represented as explicit states rather than comments in a workbook." },
      { title: "Automation only helps when the underlying rule is reviewable", body: "The goal is not to eliminate humans. It is to make repetitive calculation consistent while surfacing cases that still need judgment." },
      { title: "Migration should preserve reconciliation discipline", body: "Moving away from spreadsheets should start with parallel validation, not an assumption that the new system must be right because it is software." },
    ],
    faq: [
      { question: "When is manual or Excel payroll still reasonable?", answer: "A tightly controlled spreadsheet can work for very small and simple payrolls, especially when one knowledgeable owner maintains the formulas and review process. Risk rises as complexity and handoffs increase." },
      { question: "What payroll risks grow when spreadsheets are copied?", answer: "Multiple workbook versions can make formula ownership, source data, review state and the final approved result difficult to reconstruct after the fact." },
      { question: "Does payroll software remove the need for human review?", answer: "No. Good payroll software automates repeatable calculation while making exceptions, approvals and business judgment more visible before release." },
      { question: "How should a company move from Excel to payroll software?", answer: "Treat the move as a reconciliation project: validate imported data, preserve relevant historical context, run controlled comparisons and resolve material differences before production use." },
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
    metaTitle: "Payroll Software for Accounting Firms Philippines | Linaw",
    description: "Payroll software for Philippine accounting firms managing multiple client businesses with tenant-scoped access, payroll runs, exports and audit trails.",
    intro: "Linaw's multi-client architecture is built for operators who need to switch between client businesses without collapsing every company into one payroll workspace.",
    proof: ["Multi-client bookkeeper hub", "Tenant-scoped authorization", "Client-specific payroll runs", "Accounting exports", "Compliance context", "Audit trail"],
    sections: [
      { title: "Keep client workspaces distinct", body: "Organization membership and tenant checks prevent a user from treating a client ID in the browser as authorization to another company's data." },
      { title: "Move from payroll processing into accounting close", body: "Released payroll can feed supported journal exports, payout evidence and compliance review from the same client context." },
      { title: "Use role boundaries inside each client", body: "Bookkeepers can work alongside owners, HR, payroll officers and checkers without every role needing identical access." },
      { title: "Scale process without copying workbooks", body: "A multi-client workspace is designed to make repeatable operating controls reusable while keeping each client's employees, payroll and evidence scoped correctly." },
    ],
    faq: [
      { question: "How should an accounting firm keep multiple payroll clients separated?", answer: "Each client should have its own organization context, employee data, payroll runs and authorization checks so switching clients does not turn one firm's payroll into another firm's accessible dataset." },
      { question: "Can bookkeepers work without receiving owner-level access?", answer: "Yes. Role-based access lets bookkeepers operate inside the client workspace while owners, HR, payroll officers and checkers retain the permissions required for their own responsibilities." },
      { question: "How should released payroll connect to accounting close?", answer: "The released payroll should reconcile to supported journal exports, payout evidence and the client-specific payroll totals used by the accounting workflow." },
      { question: "What matters most when scaling payroll across many clients?", answer: "Repeatable controls, tenant isolation, clear role boundaries, consistent imports and traceable exports matter more than copying a workbook template into a larger folder structure." },
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
    metaTitle: "Manpower Payroll Software Philippines | Linaw",
    description: "Payroll software for manpower agencies handling large rosters, variable assignments, timekeeping, deductions, statutory contributions and payroll approvals.",
    intro: "Staffing and manpower payroll becomes difficult when employee volume, changing assignments, attendance inputs, deductions and client operations create constant cutoff changes.",
    proof: ["CSV bulk employee import", "Large roster processing", "Attendance and scheduling", "Loans and deductions", "Statutory payroll", "Role-based review"],
    sections: [
      { title: "Onboard and update large employee rosters", body: "CSV import supports row-level validation and update-by-employee-number behavior so recurring roster changes do not have to create duplicates." },
      { title: "Connect attendance to payroll", body: "Raw punches, schedules, overtime and night work can feed payroll instead of being manually re-encoded every cutoff." },
      { title: "Handle recurring deductions and employee obligations", body: "Loans, benefits and other payroll-impacting items can be represented in the payroll data model rather than tracked only in side spreadsheets." },
      { title: "Separate preparation from release authority", body: "Payroll staff can prepare the run while independent reviewers and owners retain the decision to approve or release it." },
    ],
    faq: [
      { question: "How can manpower agencies reduce duplicate employee records?", answer: "Use stable employee identifiers, row-level import validation and controlled update behavior so recurring roster changes update the intended employee instead of creating a second payroll record." },
      { question: "Why is attendance especially important in manpower payroll?", answer: "Large rosters and changing schedules create many payroll-impacting time events, so raw punches, overtime, night work and schedule context should feed payroll through a controlled attendance workflow." },
      { question: "How should recurring deductions be handled for large rosters?", answer: "Loans, benefits and other recurring deductions should live in the payroll data model with clear employee ownership and deduction history rather than being re-keyed from side spreadsheets every cutoff." },
      { question: "Should the payroll processor also release manpower payroll?", answer: "A stronger control model separates payroll preparation from independent review and final release, particularly when a high-volume run can move a large payout amount at once." },
    ],
    related: [
      { label: "Time & attendance", href: "/time-and-attendance", description: "See how attendance moves into payroll." },
      { label: "HRIS", href: "/hris", description: "Review employee master-data workflows." },
      { label: "Implementation", href: "/implementation", description: "Plan roster migration and payroll reconciliation." },
      { label: "Employee loan deductions", href: "/resources/employee-loans-payroll", description: "See how recurring loan schedules can stay tied to payroll." },
    ],
  },
  {
    slug: "manufacturing",
    eyebrow: "Manufacturing payroll Philippines",
    title: "Payroll and timekeeping for Philippine manufacturing teams.",
    metaTitle: "Manufacturing Payroll Software Philippines | Linaw",
    description: "Payroll software for Philippine manufacturers with shifts, biometrics, overtime, rest days, holiday premiums, work groups and controlled payroll review.",
    intro: "Manufacturing payroll is heavily shaped by attendance, schedules, overtime, rest days and holiday work. Linaw models those conditions before payroll reaches review and release.",
    proof: ["Shift scheduling", "Biometric sync endpoint", "Overtime workflows", "Effective-dated rest days", "Holiday premium logic", "Department scope"],
    sections: [
      { title: "Use schedules and punches as payroll evidence", body: "Clock data is converted into worked time, tardiness, undertime, overtime and night minutes with exceptions for incomplete or invalid punch sequences." },
      { title: "Preserve department and work-group scope", body: "Department-scoped access lets teams work within their assigned operational area while company-wide roles retain broader oversight." },
      { title: "Handle premium-pay context", body: "Holiday, rest-day, overtime and night differential calculations use the work-date context instead of a single flat overtime rule." },
      { title: "Keep exceptions visible before release", body: "Incomplete punches and payroll-relevant review conditions can be surfaced for human sign-off rather than silently guessed." },
    ],
    faq: [
      { question: "What makes manufacturing payroll difficult?", answer: "Shift work, biometrics, overtime, rest days, holidays and multiple work groups create payroll conditions where the work-date and schedule context matter as much as the employee's base pay." },
      { question: "How should biometric punches feed payroll?", answer: "Clock data should be converted into reviewable worked time, tardiness, undertime, overtime and night minutes, while incomplete or invalid punch sequences remain visible exceptions." },
      { question: "Why do effective-dated rest days matter in manufacturing payroll?", answer: "If a work group's rest day changes, historical payroll should still use the schedule that applied on the original work date instead of today's assignment." },
      { question: "How should holiday and overtime premiums be reviewed?", answer: "Payroll should preserve the actual day type, rest-day status, worked time and overtime context so reviewers can trace the resulting premium rather than receiving only a final peso total." },
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
