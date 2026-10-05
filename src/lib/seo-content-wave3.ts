import type { AuthorityPage } from "@/lib/seo-content";

const DOLE_HANDBOOK_2024 =
  "https://nwpc.dole.gov.ph/wp-content/uploads/2024/11/Workers-Statutory-Monetary-Benefits-Handbook-2024-Edition.pdf";
const DOLE_FINAL_PAY =
  "https://dole.gov.ph/final-pay-coe-must-be-released-on-time-dole/";
const DOLE_ADVISORIES = "https://bwc.dole.gov.ph/issuances/labor-advisories/";
const BIR_FORMS = "https://www.bir.gov.ph/bir-forms";
const BIR_TAX_REMINDER = "https://www.bir.gov.ph/Tax-Reminder";
const BIR_1601C = "https://efps.bir.gov.ph/efps-war/EFPSWeb_war/help/help1601c_v2.html";
const BIR_2316 =
  "https://www.bir.gov.ph/bir-forms?datasetCode=3381&idTag=BIR2304&label=2304&tab=Certificates&type=TAB+LINK";
const SSS_CONTRIBUTIONS = "https://www.sss.gov.ph/pay-contribution/";
const PHILHEALTH_UHC = "https://www.philhealth.gov.ph/uhc/";
const PAGIBIG_GUIDELINES =
  "https://www.pagibigfund.gov.ph/document/pdf/circulars/provident/HDMF%20Circular%20No.%20274%20-%20Revised%20Guidelines%20on%20Pag-IBIG%20Fund%20Membership.pdf";

const reviewed = "October 5, 2026";

export const resourceWave3: AuthorityPage[] = [
  {
    slug: "13th-month-pay-philippines",
    eyebrow: "13th-month pay Philippines",
    title: "13th-month pay in the Philippines: payroll guide.",
    description: "Understand 13th-month pay coverage, basic-salary treatment, timing and payroll calculation in the Philippines.",
    intro: "For covered rank-and-file employees, the statutory 13th-month amount is based on one-twelfth of total basic salary earned during the calendar year. Payroll still needs to distinguish basic salary from payments that are not part of the statutory base.",
    proof: ["1/12 statutory formula", "Basic-salary base", "Proration for part-year service", "December payment timing", "Separation handling", "Calculator link"],
    sections: [
      { title: "Start with basic salary actually earned", body: "The statutory computation is based on total basic salary earned during the calendar year, not simply the employee's current monthly salary multiplied by months on the roster." },
      { title: "Do not automatically include every payroll earning", body: "Overtime, premium pay, night differential and holiday pay are generally outside the statutory basic-salary base unless an agreement or established company practice treats an item as part of basic salary." },
      { title: "Separated employees can still have a prorated amount", body: "Employees who resign or are terminated can still be entitled to a proportionate 13th-month amount based on covered basic salary earned before separation." },
      { title: "Calculate, review, then release", body: "A payroll system should show the salary base used, the resulting amount and any employer policy treatment that changes what is included before the benefit is released." },
    ],
    related: [
      { label: "13th-month calculator", href: "/calculators/13th-month-pay", description: "Estimate the statutory amount from total basic salary earned." },
      { label: "Final pay guide", href: "/resources/final-pay-philippines", description: "See how prorated 13th-month pay can interact with separation payroll." },
      { label: "Payroll compliance", href: "/compliance", description: "Review the wider statutory payroll workflow." },
    ],
    lastReviewed: reviewed,
    sources: [
      { label: "DOLE Workers' Statutory Monetary Benefits Handbook", href: DOLE_HANDBOOK_2024 },
      { label: "DOLE labor advisories", href: DOLE_ADVISORIES },
    ],
  },
  {
    slug: "overtime-pay-philippines",
    eyebrow: "Overtime pay Philippines",
    title: "Overtime pay in the Philippines: what payroll must track.",
    description: "Guide to overtime payroll inputs, ordinary days, rest days, holidays and the importance of work-date context.",
    intro: "Overtime pay is not one universal multiplier. Payroll must know the employee's hourly basis, the type of day worked, whether it was a rest day and how many qualifying overtime hours were actually worked.",
    proof: ["Ordinary-day overtime", "Rest-day context", "Holiday context", "Attendance evidence", "Approval workflow", "Calculator link"],
    sections: [
      { title: "The day type changes the premium", body: "Payroll should determine whether the work occurred on an ordinary day, rest day, special day or regular holiday before applying the overtime premium." },
      { title: "Attendance and approval should agree", body: "Approved overtime without corresponding attendance evidence, or attendance hours without an approved workflow, should be treated as an exception rather than silently paid or discarded." },
      { title: "Historical schedule context matters", body: "When rest days or schedules change, recalculating an older payroll should use the work arrangement that applied on the actual work date." },
      { title: "Keep the calculation traceable", body: "Payroll reviewers should be able to see the hourly basis, day multiplier, overtime hours and resulting premium instead of receiving only a final peso amount." },
    ],
    related: [
      { label: "Overtime calculator", href: "/calculators/overtime-pay", description: "Estimate overtime under different day conditions." },
      { label: "Time & attendance", href: "/time-and-attendance", description: "See how worked time becomes payroll input." },
      { label: "DOLE payroll guide", href: "/compliance/dole", description: "Review premium-pay and schedule context." },
    ],
    lastReviewed: reviewed,
    sources: [{ label: "DOLE Workers' Statutory Monetary Benefits Handbook", href: DOLE_HANDBOOK_2024 }],
  },
  {
    slug: "night-differential-philippines",
    eyebrow: "Night differential Philippines",
    title: "Night differential in Philippine payroll.",
    description: "Understand night-work payroll inputs, overlap with overtime and premium days, and how attendance time ranges affect calculation.",
    intro: "Night differential is tied to qualifying work performed during the statutory night period, so accurate time ranges matter. The same minutes can also interact with overtime or premium-day treatment.",
    proof: ["Night-work time range", "Attendance-derived minutes", "Overtime overlap", "Holiday/rest-day context", "Reviewable calculation", "Calculator link"],
    sections: [
      { title: "Use actual worked time, not a flat monthly allowance", body: "When the benefit is computed from hours worked, payroll should derive qualifying night minutes from attendance or approved time records rather than assuming every scheduled night shift was fully worked." },
      { title: "Night work can overlap other premiums", body: "An employee may work qualifying night hours during overtime, on a rest day or on a holiday. Payroll should preserve each layer of context before pricing the result." },
      { title: "Incomplete punches should become exceptions", body: "A missing clock-out can make night minutes ambiguous. The safer workflow is to surface the attendance issue for review instead of inventing an end time." },
      { title: "Keep the formula visible to reviewers", body: "The payroll review should expose the hourly basis, qualifying night hours and applicable base-day multiplier." },
    ],
    related: [
      { label: "Night differential calculator", href: "/calculators/night-differential", description: "Estimate the night differential component." },
      { label: "BPO payroll", href: "/industries/bpo", description: "See how night work fits shift-heavy payroll." },
      { label: "Time & attendance", href: "/time-and-attendance", description: "Review attendance-to-payroll processing." },
    ],
    lastReviewed: reviewed,
    sources: [{ label: "DOLE Workers' Statutory Monetary Benefits Handbook", href: DOLE_HANDBOOK_2024 }],
  },
  {
    slug: "holiday-pay-philippines",
    eyebrow: "Holiday pay Philippines",
    title: "Holiday pay in the Philippines: payroll guide.",
    description: "Guide to regular holidays, special non-working days, rest-day overlap and worked-day payroll context.",
    intro: "Holiday payroll depends on the legal classification of the date, whether the employee worked, and whether the date also fell on the employee's rest day. Payroll should not infer that context from a label alone.",
    proof: ["Regular holiday context", "Special non-working day context", "Rest-day overlap", "Worked vs unworked treatment", "Effective calendar", "Calculator link"],
    sections: [
      { title: "Classify the date correctly first", body: "Regular holidays and special non-working days can receive different payroll treatment, so the holiday calendar used for a payroll run should be effective for that year and location." },
      { title: "Worked and unworked cases differ", body: "Payroll should distinguish whether the employee actually worked on the holiday rather than applying a worked-day multiplier to every employee in the company." },
      { title: "Rest-day overlap changes context", body: "When the holiday also falls on the employee's rest day, the payroll engine needs both facts to determine the relevant premium treatment." },
      { title: "Treat new proclamations and advisories as rule updates", body: "Holiday payroll is a good example of why evergreen guide pages should link to dated regulatory updates instead of hard-coding every year's calendar into the main URL." },
    ],
    related: [
      { label: "Holiday pay calculator", href: "/calculators/holiday-pay", description: "Estimate worked-day pay under several day types." },
      { label: "Regulatory updates", href: "/resources/updates", description: "Track dated payroll rule and government changes." },
      { label: "DOLE payroll guide", href: "/compliance/dole", description: "Review premium-pay controls." },
    ],
    lastReviewed: reviewed,
    sources: [
      { label: "DOLE Workers' Statutory Monetary Benefits Handbook", href: DOLE_HANDBOOK_2024 },
      { label: "DOLE labor advisories", href: DOLE_ADVISORIES },
    ],
  },
  {
    slug: "final-pay-philippines",
    eyebrow: "Final pay Philippines",
    title: "Final pay in the Philippines: payroll closeout guide.",
    description: "Guide to final pay timing, unpaid wages, prorated 13th-month pay, leave conversion, tax adjustments and separation payroll review.",
    intro: "Final pay is a payroll closeout, not one universal formula. DOLE reiterated in January 2026 that final pay should generally be released within 30 days after separation unless a more favorable employer policy applies.",
    proof: ["Unpaid salary", "Prorated 13th month", "Leave conversion where applicable", "Tax refund or adjustment", "Separation/retirement pay where applicable", "30-day DOLE reminder"],
    sections: [
      { title: "Start with amounts already earned but unpaid", body: "Final pay commonly begins with outstanding salary and payroll amounts earned through the employee's last covered work period." },
      { title: "Add benefits that become due on separation", body: "Depending on the employee and employer policy, final pay can include prorated 13th-month pay, convertible unused leave, separation or retirement pay, tax refunds and other amounts due under policy or agreement." },
      { title: "Do not turn every separation into the same formula", body: "The reason for separation, employee status, applicable agreement and company policy can affect which components are actually payable." },
      { title: "Use a closeout checklist before payment", body: "A strong final-pay workflow reconciles attendance, outstanding loans or authorized deductions, tax position, company assets, payslip details and release evidence before the case is closed." },
    ],
    related: [
      { label: "Final pay calculator", href: "/calculators/final-pay", description: "Add known final-pay components without pretending every component is legally required." },
      { label: "13th-month guide", href: "/resources/13th-month-pay-philippines", description: "Review prorated 13th-month treatment." },
      { label: "Payroll audit checklist", href: "/resources/payroll-audit-checklist", description: "Use a structured review before release." },
    ],
    lastReviewed: reviewed,
    sources: [{ label: "DOLE final pay and COE reminder — January 21, 2026", href: DOLE_FINAL_PAY }],
  },
  {
    slug: "separation-pay-philippines",
    eyebrow: "Separation pay Philippines",
    title: "Separation pay in the Philippines: payroll considerations.",
    description: "Understand why separation-pay entitlement and amount depend on the reason for separation and applicable labor rules.",
    intro: "Separation pay should not be treated as an automatic amount for every employee who leaves. Entitlement and calculation depend on the legal basis for separation, the employee's circumstances and any more favorable agreement or policy.",
    proof: ["Reason for separation", "Length of service", "Applicable statutory basis", "Company policy", "Final-pay interaction", "Human/legal review"],
    sections: [
      { title: "Determine entitlement before calculating", body: "Payroll should not start with a formula. The first question is whether the separation circumstances create an entitlement to separation pay under the applicable rule or agreement." },
      { title: "Keep the legal decision outside an automatic calculator", body: "Because eligibility depends on facts and legal classification, Linaw should support payroll inputs and review without presenting a universal separation-pay calculator as legal advice." },
      { title: "Separate the benefit from other final-pay components", body: "Separation pay, when due, is only one component of the employee's overall final payroll closeout." },
      { title: "Record the approved basis", body: "The payroll record should preserve the approved separation type, authorized amount and reviewer so the payment can be explained later." },
    ],
    related: [
      { label: "Final pay guide", href: "/resources/final-pay-philippines", description: "See the full payroll closeout context." },
      { label: "Implementation controls", href: "/implementation", description: "Review how sensitive payroll decisions are reconciled." },
      { label: "Payroll compliance", href: "/compliance", description: "See how Linaw separates automated calculation from human/legal validation." },
    ],
    lastReviewed: reviewed,
    sources: [{ label: "DOLE Workers' Statutory Monetary Benefits Handbook", href: DOLE_HANDBOOK_2024 }],
  },
  {
    slug: "payroll-process-philippines",
    eyebrow: "Philippine payroll process",
    title: "A controlled payroll process from inputs to release.",
    description: "Walk through a Philippine payroll process covering employee data, time, calculation, exceptions, approvals, payout and post-payroll review.",
    intro: "A reliable payroll process is a sequence of controlled handoffs. Each stage should make its inputs, owner, exceptions and completion evidence visible.",
    proof: ["Employee data", "Attendance cutoff", "Calculation", "Exception review", "Checker approval", "Release and close"],
    sections: [
      { title: "Prepare employee and payroll inputs", body: "Confirm employee status, pay basis, schedules, recurring deductions, benefits and statutory identifiers before cutoff work begins." },
      { title: "Close time and variable inputs", body: "Attendance, overtime, leave and one-time adjustments should reach an explicit cutoff so the payroll team knows what is complete and what remains exceptional." },
      { title: "Calculate and review exceptions", body: "The payroll engine should calculate traceable results while surfacing incomplete punches, missing data, unusual adjustments and policy conflicts for human review." },
      { title: "Approve, release and reconcile", body: "An independent checker and release owner should review totals before payout, followed by payslip, accounting, statutory and audit-close activities." },
    ],
    related: [
      { label: "Payroll cutoff guide", href: "/resources/payroll-cutoff", description: "Design the cutoff that feeds this process." },
      { label: "Payroll audit checklist", href: "/resources/payroll-audit-checklist", description: "Review the run before and after release." },
      { label: "Live demo", href: "/demo", description: "Inspect the role-based payroll workflow." },
    ],
    lastReviewed: reviewed,
  },
  {
    slug: "payroll-cutoff",
    eyebrow: "Payroll cutoff",
    title: "How to design a payroll cutoff that reduces rework.",
    description: "Guide to payroll cutoff dates, late attendance, overtime approvals, exceptions and change control.",
    intro: "A payroll cutoff is a control boundary: it defines which employee, time, leave and adjustment data is considered complete enough to calculate the run.",
    proof: ["Cutoff ownership", "Late-data policy", "Overtime approvals", "Attendance exceptions", "Change freeze", "Reopen controls"],
    sections: [
      { title: "Define separate input deadlines", body: "Attendance, overtime, leave, new hires, salary changes and one-time deductions may need different operational deadlines even if they feed the same payroll period." },
      { title: "Create a policy for late data", body: "The team should know whether late inputs reopen the current payroll, move to the next run or require an authorized off-cycle process." },
      { title: "Do not hide unresolved attendance", body: "Missing punches or schedule conflicts should become visible exceptions instead of being silently converted into zero hours or guessed time." },
      { title: "Lock only when the review state is clear", body: "A cutoff should help the team reach a stable review state, not merely stop users from editing data at an arbitrary time." },
    ],
    related: [
      { label: "Time & attendance", href: "/time-and-attendance", description: "See the source data feeding payroll cutoff." },
      { label: "Common payroll errors", href: "/resources/common-payroll-errors", description: "See what weak cutoff controls tend to create." },
      { label: "Payroll process", href: "/resources/payroll-process-philippines", description: "Place cutoff inside the broader payroll workflow." },
    ],
    lastReviewed: reviewed,
  },
  {
    slug: "common-payroll-errors",
    eyebrow: "Payroll errors",
    title: "Common payroll errors and the controls that prevent them.",
    description: "Review common Philippine payroll errors involving employee data, attendance, statutory deductions, approvals and payout.",
    intro: "Most payroll failures are not caused by one bad formula. They come from weak handoffs between employee data, time, rules, exceptions, review and release.",
    proof: ["Wrong employee setup", "Duplicate/manual encoding", "Attendance gaps", "Outdated rules", "Unreviewed adjustments", "Payout mismatch"],
    sections: [
      { title: "Employee master-data errors", body: "Incorrect pay basis, government identifiers, status dates or schedule assignments can flow through every downstream payroll calculation." },
      { title: "Time and attendance errors", body: "Missing punches, wrong schedules, unapproved overtime and stale rest-day data can distort premium pay before payroll even starts." },
      { title: "Rule and statutory errors", body: "Hard-coded contribution tables or tax formulas without effective dates make it easy to apply the wrong rule to a historical or future period." },
      { title: "Release-control errors", body: "Even correct calculations can fail operationally when the wrong payout total is uploaded, approvals are skipped or the released run no longer matches the reviewed run." },
    ],
    related: [
      { label: "Payroll audit checklist", href: "/resources/payroll-audit-checklist", description: "Turn these risks into a repeatable control list." },
      { label: "Payroll health check", href: "/payroll-health-check", description: "Assess where your current process is vulnerable." },
      { label: "Capability scorecard", href: "/scorecard", description: "See which Linaw controls are verified, partial or absent." },
    ],
    lastReviewed: reviewed,
  },
  {
    slug: "payroll-audit-checklist",
    eyebrow: "Payroll audit checklist",
    title: "Payroll audit checklist before release.",
    description: "A practical payroll review checklist covering headcount, gross pay, deductions, statutory contributions, tax, net pay, payout and approvals.",
    intro: "A payroll audit does not need to mean a formal external audit. Every payroll run benefits from a structured pre-release review that compares source data, calculations and final money movement.",
    proof: ["Headcount reconciliation", "Gross-to-net review", "Statutory checks", "Tax review", "Payout reconciliation", "Approval evidence"],
    sections: [
      { title: "Reconcile who is in the run", body: "Compare active employees, new hires, separated employees, unpaid leave and off-cycle cases against the expected payroll population." },
      { title: "Review material changes", body: "Investigate unusual movement in gross pay, overtime, deductions, employer contributions, tax and net pay compared with prior periods or approved inputs." },
      { title: "Tie payroll to the payout file", body: "The bank or payout total should equal the final approved net-pay total, with any excluded or failed payments clearly identified." },
      { title: "Preserve reviewer evidence", body: "Record who reviewed the run, what exceptions were resolved and which exact payroll version was approved for release." },
    ],
    related: [
      { label: "Payroll process", href: "/resources/payroll-process-philippines", description: "Use the checklist inside a controlled payroll cycle." },
      { label: "Payroll implementation", href: "/resources/payroll-implementation-guide", description: "Use independent reconciliation during migration." },
      { label: "Security", href: "/security", description: "Review access controls around payroll approval and release." },
    ],
    lastReviewed: reviewed,
  },
  {
    slug: "payslip-guide",
    eyebrow: "Payslip guide Philippines",
    title: "What a useful payroll payslip should explain.",
    description: "Guide to clear payslip presentation of earnings, deductions, statutory items and net pay for Philippine employees.",
    intro: "A payslip should help an employee understand how gross pay became net pay. Clear line items reduce repeated questions and make payroll corrections easier to investigate.",
    proof: ["Pay period", "Earnings", "Premiums", "Deductions", "Statutory items", "Net pay"],
    sections: [
      { title: "Show the period and payment context", body: "Employees should be able to identify the payroll period, payment date and the employment/pay basis relevant to the calculation." },
      { title: "Separate earnings from deductions", body: "Basic pay, overtime, holiday pay and other earnings should not be mixed into the same section as taxes, contributions, loans and other deductions." },
      { title: "Make statutory deductions recognizable", body: "SSS, PhilHealth, Pag-IBIG and withholding tax should be presented clearly enough for employees to identify the item being deducted." },
      { title: "Use self-service for repeat access", body: "A secure employee portal can reduce payroll-team work by letting employees retrieve released payslips and payroll history themselves." },
    ],
    related: [
      { label: "Employee self-service", href: "/employee-self-service", description: "See how employees access released payroll information." },
      { label: "Payroll software", href: "/", description: "Review the calculation workflow behind the payslip." },
      { label: "Payroll glossary", href: "/glossary", description: "Look up common payroll terms." },
    ],
    lastReviewed: reviewed,
  },
  {
    slug: "payroll-annualization",
    eyebrow: "Payroll annualization Philippines",
    title: "Payroll annualization and year-end tax review.",
    description: "Understand why year-end payroll annualization reconciles cumulative taxable compensation and tax withheld instead of treating the final cutoff independently.",
    intro: "Year-end payroll needs a cumulative view. Annualization reconciles taxable compensation and tax already withheld across the year so the final payroll position reflects the employee's annual compensation record.",
    proof: ["Year-to-date taxable income", "Tax already withheld", "Year-end adjustment", "2316 preparation", "Terminated employees", "Audit trail"],
    sections: [
      { title: "Use year-to-date payroll data", body: "Annualization depends on cumulative compensation and tax values, so payroll data continuity matters throughout the year and during migrations." },
      { title: "Reconcile tax already withheld", body: "The year-end calculation should compare the annual tax position with amounts previously withheld rather than simply applying the monthly table one more time." },
      { title: "Handle separated employees deliberately", body: "Employees who leave during the year may need tax reconciliation and certificate handling at separation rather than only during the employer's December close." },
      { title: "Tie annualization into 2316 preparation", body: "Year-end payroll review should produce traceable values that can flow into the employee's compensation and tax certificate, while filing or submission readiness remains separately validated." },
    ],
    related: [
      { label: "BIR 2316 guide", href: "/compliance/bir-2316", description: "See how annual payroll values connect to the employee certificate." },
      { label: "Withholding tax guide", href: "/compliance/withholding-tax", description: "Review payroll tax calculation context." },
      { label: "BIR compliance", href: "/compliance/bir", description: "See the broader BIR payroll workflow." },
    ],
    lastReviewed: reviewed,
    sources: [
      { label: "BIR forms", href: BIR_FORMS },
      { label: "BIR Form 2316 information", href: BIR_2316 },
    ],
  },
];

export const complianceWave3: AuthorityPage[] = [
  {
    slug: "bir-2316",
    eyebrow: "BIR Form 2316",
    title: "BIR Form 2316 and payroll year-end data.",
    description: "Guide to BIR Form 2316, employee compensation and tax-withheld data, year-end preparation and termination handling.",
    intro: "BIR describes Form 2316 as the certificate showing compensation paid and tax withheld for an employee. The form depends on complete year-to-date payroll data, and BIR states it should generally be issued by January 31 of the succeeding year or on the last wage payment when employment terminates.",
    proof: ["Employee compensation certificate", "Year-to-date payroll data", "Tax withheld", "January 31 issuance context", "Termination issuance context", "Validation before submission"],
    sections: [
      { title: "2316 is downstream of payroll accuracy", body: "The certificate can only be as reliable as the employee's cumulative compensation, non-taxable items and tax-withheld records." },
      { title: "Year-end and separation events both matter", body: "Employers need a process for annual certificate preparation as well as employees who separate before year-end." },
      { title: "Use the latest official form version", body: "BIR guidance requires the current official form or exact replica when using an electronic signature workflow." },
      { title: "Keep generation separate from filing validation", body: "Producing a 2316 PDF or data row does not by itself prove that every downstream submission or substituted-filing requirement has been satisfied." },
    ],
    related: [
      { label: "Payroll annualization", href: "/resources/payroll-annualization", description: "Review the cumulative payroll values feeding 2316." },
      { label: "BIR compliance", href: "/compliance/bir", description: "See the broader tax workflow." },
      { label: "Alphalist guide", href: "/compliance/alphalist", description: "Review annual employee/payee reporting context." },
    ],
    lastReviewed: reviewed,
    sources: [
      { label: "BIR Form 2316 information", href: BIR_2316 },
      { label: "BIR forms library", href: BIR_FORMS },
    ],
  },
  {
    slug: "1601-c",
    eyebrow: "BIR Form 1601-C",
    title: "BIR Form 1601-C and monthly withholding remittance.",
    description: "Guide to BIR Form 1601-C, monthly compensation withholding, payroll reconciliation and deadline verification.",
    intro: "BIR Form 1601-C is the monthly remittance return for income taxes withheld on compensation. Payroll should reconcile taxable compensation and tax withheld before the return is prepared, then verify the current BIR calendar for the applicable filing and payment deadline.",
    proof: ["Monthly compensation withholding", "Tax-withheld reconciliation", "Adjustments", "Filer-specific deadlines", "Current BIR calendar", "Submission evidence"],
    sections: [
      { title: "Reconcile payroll totals before preparing the return", body: "The compensation and tax-withheld totals in the return should tie back to the approved payroll records for the covered month." },
      { title: "Handle adjustments explicitly", body: "Corrections to prior withholding periods should be documented and reconciled rather than silently changing current-month payroll totals." },
      { title: "Do not hard-code one universal filing date", body: "BIR calendars can distinguish non-eFPS and eFPS filer groups, so the current official tax reminder should be checked for the actual month." },
      { title: "Store evidence of the filed result", body: "A mature payroll/compliance process records the filed period, amount, confirmation or receipt and the payroll totals that supported it." },
    ],
    related: [
      { label: "Withholding tax guide", href: "/compliance/withholding-tax", description: "Review how payroll determines tax withheld." },
      { label: "Compliance calendar", href: "/compliance/calendar", description: "Use official calendars instead of static deadline assumptions." },
      { label: "BIR compliance", href: "/compliance/bir", description: "See the complete payroll-tax workflow." },
    ],
    lastReviewed: reviewed,
    sources: [
      { label: "BIR 1601-C guidelines", href: BIR_1601C },
      { label: "BIR tax reminder", href: BIR_TAX_REMINDER },
    ],
  },
  {
    slug: "alphalist",
    eyebrow: "BIR Alphalist",
    title: "BIR Alphalist and payroll data readiness.",
    description: "Guide to payroll data needed for BIR Alphalist preparation, annual reconciliation and submission validation.",
    intro: "The Alphalist is a reporting output built from withholding records. The payroll job is to preserve complete employee/payee data and reconcile annual compensation and tax values before the file is treated as ready.",
    proof: ["Employee/payee identity data", "Annual compensation", "Tax withheld", "Return attachment context", "January annual reporting", "Validation evidence"],
    sections: [
      { title: "Treat the Alphalist as a downstream data product", body: "It should be generated from reconciled payroll and withholding records, not maintained as a separate spreadsheet that becomes its own source of truth." },
      { title: "Validate employee identifiers and totals", body: "Missing or inconsistent employee data can turn a correct payroll calculation into a rejected or inaccurate reporting output." },
      { title: "Tie the Alphalist back to annual withholding returns", body: "BIR reminders treat required alphalists as attachments to relevant withholding returns, so the payroll reporting totals should reconcile." },
      { title: "Track the exact generated version", body: "If the output is regenerated after corrections, the compliance record should identify which version was ultimately submitted." },
    ],
    related: [
      { label: "BIR 2316", href: "/compliance/bir-2316", description: "Connect employee certificates with annual payroll data." },
      { label: "Payroll annualization", href: "/resources/payroll-annualization", description: "Reconcile annual compensation and withholding first." },
      { label: "Regulatory updates", href: "/resources/updates", description: "Track dated BIR reminders affecting payroll reporting." },
    ],
    lastReviewed: reviewed,
    sources: [
      { label: "BIR forms", href: BIR_FORMS },
      { label: "BIR tax reminder", href: BIR_TAX_REMINDER },
    ],
  },
  {
    slug: "withholding-tax",
    eyebrow: "Withholding tax on compensation",
    title: "Withholding tax on compensation in Philippine payroll.",
    description: "Guide to taxable compensation, payroll withholding, year-to-date reconciliation and BIR reporting context.",
    intro: "Payroll withholding starts with taxable compensation, not gross salary. Statutory and non-taxable treatment, minimum-wage-earner rules where applicable and year-end annualization all affect the final tax result.",
    proof: ["Taxable compensation", "Monthly/semi-monthly payroll", "Minimum-wage-earner handling", "Year-end annualization", "1601-C connection", "2316 connection"],
    sections: [
      { title: "Build the taxable base first", body: "Payroll should classify compensation items before applying a withholding table. Treating all gross earnings as taxable can overstate withholding." },
      { title: "Use the table that matches the payroll frequency", body: "Monthly and semi-monthly payroll can use different table thresholds, so the payroll function should match the actual pay frequency." },
      { title: "Annualization is not optional cleanup", body: "The year-end process reconciles cumulative taxable compensation and tax already withheld so the employee's annual position is consistent." },
      { title: "Reporting follows the calculation", body: "1601-C, 2316 and annual reporting rely on the payroll tax records, but preparing those outputs still requires separate validation and filing evidence." },
    ],
    related: [
      { label: "Withholding tax calculator", href: "/calculators/withholding-tax", description: "Estimate monthly withholding from taxable compensation." },
      { label: "1601-C guide", href: "/compliance/1601-c", description: "See monthly remittance-return context." },
      { label: "Payroll annualization", href: "/resources/payroll-annualization", description: "Review the year-end reconciliation." },
    ],
    lastReviewed: reviewed,
    sources: [
      { label: "BIR 1601-C guidelines", href: BIR_1601C },
      { label: "BIR forms library", href: BIR_FORMS },
    ],
  },
  {
    slug: "calendar",
    eyebrow: "Payroll compliance calendar",
    title: "Philippine payroll compliance calendar: how to manage deadlines.",
    description: "Build a payroll compliance calendar around current BIR, SSS, PhilHealth, Pag-IBIG and DOLE source dates instead of stale hard-coded deadlines.",
    intro: "A compliance calendar should be a maintained operational tool, not a permanent table copied from an old blog post. Official schedules and advisories can change, and filing dates can differ by filer type or circumstance.",
    proof: ["BIR tax reminders", "DOLE advisories", "SSS contribution schedule", "PhilHealth issuances", "Pag-IBIG guidance", "Owner and evidence fields"],
    sections: [
      { title: "Use official calendars as the source of truth", body: "The current BIR tax reminder and agency advisories should be checked before a deadline is treated as final." },
      { title: "Assign an owner to each obligation", body: "Every remittance, filing or employee-delivery deadline should have an internal owner and a backup rather than living only on a shared calendar." },
      { title: "Track completion evidence", body: "The useful calendar record includes what was filed or paid, the covered period, completion date and confirmation evidence." },
      { title: "Publish updates without changing the evergreen URL", body: "The evergreen calendar page should explain the process, while dated regulatory updates record specific new advisories or schedule changes." },
    ],
    related: [
      { label: "Regulatory updates", href: "/resources/updates", description: "See dated changes and government reminders." },
      { label: "1601-C", href: "/compliance/1601-c", description: "Review monthly BIR withholding-remittance context." },
      { label: "Payroll audit", href: "/compliance/payroll-audit", description: "Reconcile compliance evidence after the payroll run." },
    ],
    lastReviewed: reviewed,
    sources: [
      { label: "BIR tax reminder", href: BIR_TAX_REMINDER },
      { label: "DOLE labor advisories", href: DOLE_ADVISORIES },
      { label: "SSS contributions", href: SSS_CONTRIBUTIONS },
      { label: "PhilHealth UHC contribution schedule", href: PHILHEALTH_UHC },
      { label: "Pag-IBIG membership contribution guidelines", href: PAGIBIG_GUIDELINES },
    ],
  },
  {
    slug: "regulatory-updates",
    eyebrow: "Payroll regulatory updates",
    title: "How PayrollPH tracks Philippine payroll rule changes.",
    description: "Understand the difference between evergreen payroll guidance and dated regulatory updates from Philippine government agencies.",
    intro: "Evergreen pages explain a payroll topic. Dated updates record what changed, when it changed, the source and which payroll workflows may need review. Keeping those two content types separate reduces stale guidance.",
    proof: ["Effective date", "Issuing agency", "Source document", "Affected workflow", "Rule-review status", "Evergreen cross-links"],
    sections: [
      { title: "Record the date and source first", body: "A payroll update should identify the issuing agency, publication or advisory date and official source before summarizing operational impact." },
      { title: "Separate publication date from effective date", body: "A rule can be published on one date and apply on another. Both fields matter when deciding which payroll periods are affected." },
      { title: "Map the update to product rules", body: "Changes affecting contribution rates, tax tables, holidays or filing outputs should point to the exact calculation or compliance workflow that needs review." },
      { title: "Keep old updates available as history", body: "Historical updates help explain why an older payroll used a different rule version, while evergreen pages continue to describe the current process." },
    ],
    related: [
      { label: "Regulatory update archive", href: "/resources/updates", description: "Browse dated government payroll updates." },
      { label: "Compliance calendar", href: "/compliance/calendar", description: "Manage recurring deadlines using current sources." },
      { label: "Compliance center", href: "/compliance", description: "See the evergreen compliance architecture." },
    ],
    lastReviewed: reviewed,
  },
  {
    slug: "payroll-audit",
    eyebrow: "Payroll compliance audit",
    title: "Payroll compliance audit: evidence to review after each run.",
    description: "Review statutory calculations, tax, government outputs, approvals and completion evidence after payroll.",
    intro: "A compliance audit should connect the approved payroll run with the statutory calculations and reporting evidence that followed it. The goal is traceability, not a blanket statement that everything is compliant.",
    proof: ["Approved payroll version", "Statutory liabilities", "Tax withheld", "Government output", "Submission/remittance evidence", "Exceptions"],
    sections: [
      { title: "Start with the released payroll version", body: "Compliance review should use the exact payroll run that was approved and released, not a later recalculation that no longer matches the money paid." },
      { title: "Reconcile statutory liabilities", body: "Employee deductions and employer shares should tie back to payroll totals and the reporting or remittance amount prepared for each agency." },
      { title: "Keep validation status visible", body: "A generated worksheet can be complete as a payroll artifact while still waiting for external filing validation or submission evidence." },
      { title: "Close exceptions explicitly", body: "If an employee record, contribution, tax amount or filing output remains unresolved, the compliance record should show the owner and next action." },
    ],
    related: [
      { label: "Payroll audit checklist", href: "/resources/payroll-audit-checklist", description: "Review operational payroll before release." },
      { label: "Compliance calendar", href: "/compliance/calendar", description: "Track the obligations that follow payroll." },
      { label: "Trust center", href: "/trust", description: "See Linaw's evidence-first product philosophy." },
    ],
    lastReviewed: reviewed,
  },
];

export type GlossaryEntry = {
  slug: string;
  term: string;
  definition: string;
  explanation: string;
  related: Array<{ label: string; href: string }>;
};

export const glossaryEntries: GlossaryEntry[] = [
  { slug: "basic-salary", term: "Basic salary", definition: "The core salary or wage paid for services rendered, before adding many premium or variable-pay items.", explanation: "Basic salary is an important payroll base because statutory benefits such as 13th-month pay can depend on what is legally or contractually treated as basic salary.", related: [{ label: "13th-month pay", href: "/resources/13th-month-pay-philippines" }, { label: "Gross pay", href: "/glossary/gross-pay" }] },
  { slug: "gross-pay", term: "Gross pay", definition: "Total payroll earnings before deductions.", explanation: "Gross pay can include basic pay plus overtime, premiums, allowances, bonuses or other earnings. It is not automatically the same as taxable compensation.", related: [{ label: "Taxable compensation", href: "/glossary/taxable-compensation" }, { label: "Net pay", href: "/glossary/net-pay" }] },
  { slug: "net-pay", term: "Net pay", definition: "The amount remaining after applicable payroll deductions are taken from earnings.", explanation: "Net pay is the amount generally used for employee payout, so the approved payroll net-pay total should reconcile with the bank or payout file.", related: [{ label: "Gross pay", href: "/glossary/gross-pay" }, { label: "Payroll audit checklist", href: "/resources/payroll-audit-checklist" }] },
  { slug: "taxable-compensation", term: "Taxable compensation", definition: "Compensation subject to withholding tax after applying the relevant tax and non-taxable treatment.", explanation: "Taxable compensation is not necessarily identical to gross pay. Payroll must classify earnings and statutory treatment before applying a withholding table.", related: [{ label: "Withholding tax", href: "/glossary/withholding-tax" }, { label: "BIR withholding guide", href: "/compliance/withholding-tax" }] },
  { slug: "payroll-cutoff", term: "Payroll cutoff", definition: "The operational deadline after which payroll inputs for a period are treated as complete or subject to a controlled late-change process.", explanation: "A cutoff helps stabilize attendance, leave, overtime and adjustment data before calculation and review.", related: [{ label: "Payroll cutoff guide", href: "/resources/payroll-cutoff" }, { label: "Payroll process", href: "/resources/payroll-process-philippines" }] },
  { slug: "night-differential", term: "Night differential", definition: "Additional pay associated with qualifying work performed during the statutory night period.", explanation: "Accurate night differential depends on worked-time ranges and can interact with overtime, holiday or rest-day premiums.", related: [{ label: "Night differential guide", href: "/resources/night-differential-philippines" }, { label: "Night differential calculator", href: "/calculators/night-differential" }] },
  { slug: "premium-pay", term: "Premium pay", definition: "Additional pay that can apply when work is performed under specified conditions such as rest days or certain holidays.", explanation: "Payroll must preserve the type of day, work status and schedule context so the premium is not reduced to one universal multiplier.", related: [{ label: "Holiday pay guide", href: "/resources/holiday-pay-philippines" }, { label: "DOLE payroll guide", href: "/compliance/dole" }] },
  { slug: "rest-day", term: "Rest day", definition: "An employee's scheduled weekly rest period used as payroll context for certain premium-pay calculations.", explanation: "When rest days change over time, historical payroll should use the rest day that applied on the work date rather than the employee's current schedule.", related: [{ label: "Overtime guide", href: "/resources/overtime-pay-philippines" }, { label: "Time & attendance", href: "/time-and-attendance" }] },
  { slug: "withholding-tax", term: "Withholding tax on compensation", definition: "Income tax deducted by an employer from taxable employee compensation and remitted under BIR rules.", explanation: "The payroll calculation depends on taxable compensation and the applicable withholding table, followed by year-end reconciliation and reporting.", related: [{ label: "Withholding guide", href: "/compliance/withholding-tax" }, { label: "Withholding calculator", href: "/calculators/withholding-tax" }] },
  { slug: "monthly-salary-credit", term: "Monthly Salary Credit (MSC)", definition: "The SSS compensation base used to determine contribution amounts within the applicable schedule.", explanation: "MSC is not simply another name for an employee's monthly salary; the SSS schedule determines the contribution base and applicable shares.", related: [{ label: "SSS compliance", href: "/compliance/sss" }, { label: "SSS calculator", href: "/calculators/sss-contribution" }] },
  { slug: "13th-month-pay", term: "13th-month pay", definition: "A statutory benefit generally calculated as one-twelfth of total basic salary earned during the calendar year for covered employees.", explanation: "Eligibility and the basic-salary base should be reviewed under current DOLE guidance and employer policy where more favorable treatment applies.", related: [{ label: "13th-month guide", href: "/resources/13th-month-pay-philippines" }, { label: "13th-month calculator", href: "/calculators/13th-month-pay" }] },
  { slug: "annualization", term: "Payroll annualization", definition: "Year-end reconciliation of cumulative taxable compensation and tax withheld to determine the employee's annual tax position.", explanation: "Annualization connects year-to-date payroll records with final tax adjustments and year-end employee reporting such as BIR Form 2316.", related: [{ label: "Annualization guide", href: "/resources/payroll-annualization" }, { label: "BIR 2316", href: "/compliance/bir-2316" }] },
];

export type RegulatoryUpdate = {
  slug: string;
  title: string;
  summary: string;
  publishedDate: string;
  agency: string;
  sourceUrl: string;
  sourceLabel: string;
  affected: string[];
  evergreenLinks: Array<{ label: string; href: string }>;
};

export const regulatoryUpdates: RegulatoryUpdate[] = [
  {
    slug: "dole-final-pay-reminder-2026",
    title: "DOLE reiterates final-pay and COE timing in January 2026.",
    summary: "DOLE reminded employers that final pay should generally be released within 30 days after separation unless a more favorable company policy applies, and reiterated the separate COE timing requirement.",
    publishedDate: "2026-01-21",
    agency: "Department of Labor and Employment",
    sourceUrl: DOLE_FINAL_PAY,
    sourceLabel: "DOLE final pay and COE reminder",
    affected: ["Final pay", "Employee separation", "Payroll closeout"],
    evergreenLinks: [{ label: "Final pay guide", href: "/resources/final-pay-philippines" }, { label: "Payroll compliance", href: "/compliance" }],
  },
  {
    slug: "dole-13th-month-guidelines-2025",
    title: "DOLE reiterates 13th-month pay rules for the 2025 year-end.",
    summary: "DOLE Labor Advisory No. 16-25 reiterated the statutory 13th-month payment obligation and the December 24 payment timing for covered employees.",
    publishedDate: "2025-11-15",
    agency: "Department of Labor and Employment",
    sourceUrl: DOLE_ADVISORIES,
    sourceLabel: "DOLE Labor Advisories",
    affected: ["13th-month pay", "Year-end payroll"],
    evergreenLinks: [{ label: "13th-month pay guide", href: "/resources/13th-month-pay-philippines" }, { label: "13th-month calculator", href: "/calculators/13th-month-pay" }],
  },
  {
    slug: "bir-alphalist-reminder-2026",
    title: "BIR reminds withholding agents that required alphalists form part of withholding-return compliance.",
    summary: "BIR Revenue Memorandum Circular No. 55-2026 reiterated alphalist submission obligations for covered withholding agents and tied applicable alphalists to the relevant withholding returns and deadlines.",
    publishedDate: "2026-05-26",
    agency: "Bureau of Internal Revenue",
    sourceUrl: "https://bir-cdn.bir.gov.ph/BIR/pdf/RMC%20No.%2055-2026%20Digest.pdf",
    sourceLabel: "BIR RMC No. 55-2026 Digest",
    affected: ["Alphalist", "Withholding returns", "Payroll reporting"],
    evergreenLinks: [{ label: "Alphalist guide", href: "/compliance/alphalist" }, { label: "BIR compliance", href: "/compliance/bir" }],
  },
];
