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
const reviewedIso = "2026-10-05";

export const resourceWave3: AuthorityPage[] = [
  {
    slug: "13th-month-pay-philippines",
    eyebrow: "13th-month pay Philippines",
    title: "13th-month pay in the Philippines: payroll guide.",
    metaTitle: "13th Month Pay Philippines: Payroll Guide | Linaw",
    description: "13th-month pay guide for Philippine payroll covering the 1/12 basic-salary formula, part-year service, separation treatment, timing and calculator context.",
    intro: "For covered rank-and-file employees, the statutory 13th-month amount is based on one-twelfth of total basic salary earned during the calendar year. Payroll still needs to distinguish basic salary from payments that are not part of the statutory base.",
    proof: ["1/12 statutory formula", "Basic-salary base", "Proration for part-year service", "December payment timing", "Separation handling", "Calculator link"],
    sections: [
      { title: "Start with basic salary actually earned", body: "The statutory computation is based on total basic salary earned during the calendar year, not simply the employee's current monthly salary multiplied by months on the roster." },
      { title: "Do not automatically include every payroll earning", body: "Overtime, premium pay, night differential and holiday pay are generally outside the statutory basic-salary base unless an agreement or established company practice treats an item as part of basic salary." },
      { title: "Separated employees can still have a prorated amount", body: "Employees who resign or are terminated can still be entitled to a proportionate 13th-month amount based on covered basic salary earned before separation." },
      { title: "Calculate, review, then release", body: "A payroll system should show the salary base used, the resulting amount and any employer policy treatment that changes what is included before the benefit is released." },
    ],
    faq: [
      { question: "How is 13th-month pay generally calculated in the Philippines?", answer: "For covered employees, the statutory amount is generally one-twelfth of total basic salary earned during the calendar year, subject to current DOLE guidance and any more favorable company practice or agreement." },
      { question: "Are overtime and holiday premiums automatically included in the 13th-month base?", answer: "Not automatically. The statutory base is basic salary, while premium and variable items need to be classified under current rules, agreements and established employer practice." },
      { question: "Can a separated employee still receive prorated 13th-month pay?", answer: "A covered employee who resigns or is separated can still have a proportionate 13th-month amount based on basic salary earned during the covered part of the year." },
      { question: "When should employers verify the year-end timing?", answer: "Use the current DOLE advisory or official guidance for the applicable year rather than relying on an undated blog post or old payroll calendar." },
    ],
    related: [
      { label: "13th-month calculator", href: "/calculators/13th-month-pay", description: "Estimate the statutory amount from total basic salary earned." },
      { label: "Final pay guide", href: "/resources/final-pay-philippines", description: "See how prorated 13th-month pay can interact with separation payroll." },
      { label: "Payroll compliance", href: "/compliance", description: "Review the wider statutory payroll workflow." },
    ],
    lastReviewed: reviewed,
    lastReviewedIso: reviewedIso,
    sources: [
      { label: "DOLE Workers' Statutory Monetary Benefits Handbook", href: DOLE_HANDBOOK_2024 },
      { label: "DOLE labor advisories", href: DOLE_ADVISORIES },
    ],
  },
  {
    slug: "overtime-pay-philippines",
    eyebrow: "Overtime pay Philippines",
    title: "Overtime pay in the Philippines: what payroll must track.",
    metaTitle: "Overtime Pay Philippines: Payroll Guide | Linaw",
    description: "Overtime pay guide for Philippine payroll covering ordinary days, rest days, holidays, attendance evidence, approvals and work-date premium context.",
    intro: "Overtime pay is not one universal multiplier. Payroll must know the employee's hourly basis, the type of day worked, whether it was a rest day and how many qualifying overtime hours were actually worked.",
    proof: ["Ordinary-day overtime", "Rest-day context", "Holiday context", "Attendance evidence", "Approval workflow", "Calculator link"],
    sections: [
      { title: "The day type changes the premium", body: "Payroll should determine whether the work occurred on an ordinary day, rest day, special day or regular holiday before applying the overtime premium." },
      { title: "Attendance and approval should agree", body: "Approved overtime without corresponding attendance evidence, or attendance hours without an approved workflow, should be treated as an exception rather than silently paid or discarded." },
      { title: "Historical schedule context matters", body: "When rest days or schedules change, recalculating an older payroll should use the work arrangement that applied on the actual work date." },
      { title: "Keep the calculation traceable", body: "Payroll reviewers should be able to see the hourly basis, day multiplier, overtime hours and resulting premium instead of receiving only a final peso amount." },
    ],
    faq: [
      { question: "Is overtime pay one fixed multiplier?", answer: "No. The applicable premium depends on the type of day worked, whether it is also a rest day, the employee's pay basis and the qualifying overtime hours." },
      { question: "Why does attendance evidence matter for overtime?", answer: "Payroll needs reliable worked-time evidence to support the hours being priced. Approval records and attendance should be reconciled rather than treated as independent sources of truth." },
      { question: "Can overtime overlap with holiday or rest-day premiums?", answer: "Yes. Payroll must preserve the full work-date context because overtime can occur on ordinary days, rest days, special days or regular holidays." },
      { question: "What should a payroll reviewer see?", answer: "A reviewable result should expose the hourly basis, day classification, premium multiplier, overtime hours and resulting amount instead of only a final total." },
    ],
    related: [
      { label: "Overtime calculator", href: "/calculators/overtime-pay", description: "Estimate overtime under different day conditions." },
      { label: "Time & attendance", href: "/time-and-attendance", description: "See how worked time becomes payroll input." },
      { label: "DOLE payroll guide", href: "/compliance/dole", description: "Review premium-pay and schedule context." },
    ],
    lastReviewed: reviewed,
    lastReviewedIso: reviewedIso,
    sources: [{ label: "DOLE Workers' Statutory Monetary Benefits Handbook", href: DOLE_HANDBOOK_2024 }],
  },
  {
    slug: "night-differential-philippines",
    eyebrow: "Night differential Philippines",
    title: "Night differential in Philippine payroll.",
    metaTitle: "Night Differential Philippines: Payroll Guide | Linaw",
    description: "Night differential guide for Philippine payroll covering qualifying night work, attendance-derived hours, overtime overlap, holidays, rest days and review.",
    intro: "Night differential is tied to qualifying work performed during the statutory night period, so accurate time ranges matter. The same minutes can also interact with overtime or premium-day treatment.",
    proof: ["Night-work time range", "Attendance-derived minutes", "Overtime overlap", "Holiday/rest-day context", "Reviewable calculation", "Calculator link"],
    sections: [
      { title: "Use actual worked time, not a flat monthly allowance", body: "When the benefit is computed from hours worked, payroll should derive qualifying night minutes from attendance or approved time records rather than assuming every scheduled night shift was fully worked." },
      { title: "Night work can overlap other premiums", body: "An employee may work qualifying night hours during overtime, on a rest day or on a holiday. Payroll should preserve each layer of context before pricing the result." },
      { title: "Incomplete punches should become exceptions", body: "A missing clock-out can make night minutes ambiguous. The safer workflow is to surface the attendance issue for review instead of inventing an end time." },
      { title: "Keep the formula visible to reviewers", body: "The payroll review should expose the hourly basis, qualifying night hours and applicable base-day multiplier." },
    ],
    faq: [
      { question: "What payroll records should support night differential?", answer: "Use actual worked-time evidence, such as attendance or approved time records, together with the employee's pay basis and the work-date context used by payroll." },
      { question: "Can night differential overlap with overtime or holiday pay?", answer: "Yes. The same worked minutes can fall inside a night period while also being overtime, rest-day work or holiday work, so payroll should preserve each layer of context before pricing the result." },
      { question: "What should happen when a night-shift punch is incomplete?", answer: "An incomplete time record should become an attendance exception for review instead of having payroll invent a clock-out time or assume the full scheduled shift was worked." },
      { question: "What should a reviewer see before approving night differential?", answer: "The review should expose the hourly basis, qualifying night hours, applicable day context and resulting premium so the amount can be traced back to worked time." },
    ],
    related: [
      { label: "Night differential calculator", href: "/calculators/night-differential", description: "Estimate the night differential component." },
      { label: "BPO payroll", href: "/industries/bpo", description: "See how night work fits shift-heavy payroll." },
      { label: "Time & attendance", href: "/time-and-attendance", description: "Review attendance-to-payroll processing." },
    ],
    lastReviewed: reviewed,
    lastReviewedIso: reviewedIso,
    sources: [{ label: "DOLE Workers' Statutory Monetary Benefits Handbook", href: DOLE_HANDBOOK_2024 }],
  },
  {
    slug: "holiday-pay-philippines",
    eyebrow: "Holiday pay Philippines",
    title: "Holiday pay in the Philippines: payroll guide.",
    metaTitle: "Holiday Pay Philippines: Payroll Guide | Linaw",
    description: "Holiday pay guide for Philippine payroll covering regular holidays, special non-working days, worked and unworked cases, rest-day overlap and updates.",
    intro: "Holiday payroll depends on the legal classification of the date, whether the employee worked, and whether the date also fell on the employee's rest day. Payroll should not infer that context from a label alone.",
    proof: ["Regular holiday context", "Special non-working day context", "Rest-day overlap", "Worked vs unworked treatment", "Effective calendar", "Calculator link"],
    sections: [
      { title: "Classify the date correctly first", body: "Regular holidays and special non-working days can receive different payroll treatment, so the holiday calendar used for a payroll run should be effective for that year and location." },
      { title: "Worked and unworked cases differ", body: "Payroll should distinguish whether the employee actually worked on the holiday rather than applying a worked-day multiplier to every employee in the company." },
      { title: "Rest-day overlap changes context", body: "When the holiday also falls on the employee's rest day, the payroll engine needs both facts to determine the relevant premium treatment." },
      { title: "Treat new proclamations and advisories as rule updates", body: "Holiday payroll is a good example of why evergreen guide pages should link to dated regulatory updates instead of hard-coding every year's calendar into the main URL." },
    ],
    faq: [
      { question: "Why does the holiday type matter in payroll?", answer: "Regular holidays and special non-working days can receive different treatment, so payroll must classify the date correctly before applying worked or unworked pay rules." },
      { question: "Does every employee receive the same holiday treatment?", answer: "No. Payroll still needs the employee's work status, actual work performed, pay basis and whether the date also fell on a rest day before determining the applicable treatment." },
      { question: "What changes when a holiday falls on a rest day?", answer: "Rest-day overlap changes the work-date context used for premium calculations, so both facts should be preserved instead of flattening the date into a single holiday label." },
      { question: "How should payroll handle new holiday proclamations or advisories?", answer: "Use the effective calendar and current DOLE or official government advisory for the covered date rather than hard-coding one permanent holiday calendar into payroll." },
    ],
    related: [
      { label: "Holiday pay calculator", href: "/calculators/holiday-pay", description: "Estimate worked-day pay under several day types." },
      { label: "Regulatory updates", href: "/resources/updates", description: "Track dated payroll rule and government changes." },
      { label: "DOLE payroll guide", href: "/compliance/dole", description: "Review premium-pay controls." },
    ],
    lastReviewed: reviewed,
    lastReviewedIso: reviewedIso,
    sources: [
      { label: "DOLE Workers' Statutory Monetary Benefits Handbook", href: DOLE_HANDBOOK_2024 },
      { label: "DOLE labor advisories", href: DOLE_ADVISORIES },
    ],
  },
  {
    slug: "final-pay-philippines",
    eyebrow: "Final pay Philippines",
    title: "Final pay in the Philippines: payroll closeout guide.",
    metaTitle: "Final Pay Philippines: Payroll Closeout Guide | Linaw",
    description: "Final pay guide for Philippine employers covering timing, unpaid salary, prorated 13th-month pay, leave conversion, tax adjustments and closeout review.",
    intro: "Final pay is a payroll closeout, not one universal formula. DOLE reiterated in January 2026 that final pay should generally be released within 30 days after separation unless a more favorable employer policy applies.",
    proof: ["Unpaid salary", "Prorated 13th month", "Leave conversion where applicable", "Tax refund or adjustment", "Separation/retirement pay where applicable", "30-day DOLE reminder"],
    sections: [
      { title: "Start with amounts already earned but unpaid", body: "Final pay commonly begins with outstanding salary and payroll amounts earned through the employee's last covered work period." },
      { title: "Add benefits that become due on separation", body: "Depending on the employee and employer policy, final pay can include prorated 13th-month pay, convertible unused leave, separation or retirement pay, tax refunds and other amounts due under policy or agreement." },
      { title: "Do not turn every separation into the same formula", body: "The reason for separation, employee status, applicable agreement and company policy can affect which components are actually payable." },
      { title: "Use a closeout checklist before payment", body: "A strong final-pay workflow reconciles attendance, outstanding loans or authorized deductions, tax position, company assets, payslip details and release evidence before the case is closed." },
    ],
    faq: [
      { question: "Is final pay one universal formula?", answer: "No. Final pay is a closeout of amounts that are actually due, and the components depend on wages earned, benefits, tax position, employer policy, agreements and the reason for separation." },
      { question: "Does Linaw's final-pay calculator determine entitlement?", answer: "No. The calculator only totals components entered by the user and does not decide whether separation pay, leave conversion or another benefit is legally due." },
      { question: "What should be reconciled before final pay is released?", answer: "Typical checks include unpaid salary, prorated 13th-month pay, approved leave conversion, tax adjustments, authorized deductions, outstanding obligations and the final payslip." },
      { question: "What timing should employers follow?", answer: "Use current DOLE guidance and any more favorable company policy. The Wave 3 guide cites the January 2026 DOLE reminder rather than presenting an unsupported permanent deadline." },
    ],
    related: [
      { label: "Final pay calculator", href: "/calculators/final-pay", description: "Add known final-pay components without pretending every component is legally required." },
      { label: "13th-month guide", href: "/resources/13th-month-pay-philippines", description: "Review prorated 13th-month treatment." },
      { label: "Payroll audit checklist", href: "/resources/payroll-audit-checklist", description: "Use a structured review before release." },
    ],
    lastReviewed: reviewed,
    lastReviewedIso: reviewedIso,
    sources: [{ label: "DOLE final pay and COE reminder — January 21, 2026", href: DOLE_FINAL_PAY }],
  },
  {
    slug: "separation-pay-philippines",
    eyebrow: "Separation pay Philippines",
    title: "Separation pay in the Philippines: payroll considerations.",
    metaTitle: "Separation Pay Philippines: Payroll Guide | Linaw",
    description: "Separation pay guide for Philippine payroll explaining why entitlement and amount depend on the separation basis, service, policy and human or legal review.",
    intro: "Separation pay should not be treated as an automatic amount for every employee who leaves. Entitlement and calculation depend on the legal basis for separation, the employee's circumstances and any more favorable agreement or policy.",
    proof: ["Reason for separation", "Length of service", "Applicable statutory basis", "Company policy", "Final-pay interaction", "Human/legal review"],
    sections: [
      { title: "Determine entitlement before calculating", body: "Payroll should not start with a formula. The first question is whether the separation circumstances create an entitlement to separation pay under the applicable rule or agreement." },
      { title: "Keep the legal decision outside an automatic calculator", body: "Because eligibility depends on facts and legal classification, Linaw should support payroll inputs and review without presenting a universal separation-pay calculator as legal advice." },
      { title: "Separate the benefit from other final-pay components", body: "Separation pay, when due, is only one component of the employee's overall final payroll closeout." },
      { title: "Record the approved basis", body: "The payroll record should preserve the approved separation type, authorized amount and reviewer so the payment can be explained later." },
    ],
    faq: [
      { question: "Is separation pay automatic whenever an employee leaves?", answer: "No. Entitlement depends on the legal basis for separation, the employee's circumstances and any applicable agreement or more favorable company policy." },
      { question: "Why should payroll not use one universal separation-pay formula?", answer: "The amount can depend on the legally approved separation basis and length-of-service rules, so eligibility should be determined before payroll calculates or records the authorized benefit." },
      { question: "Is separation pay the same as final pay?", answer: "No. Separation pay, when due, is one possible component of the broader final-pay closeout, which can also include unpaid wages, prorated benefits, leave conversion or tax adjustments." },
      { question: "What evidence should be kept for a separation-pay payment?", answer: "Keep the approved separation basis, authorized amount, service data used in the decision and the reviewer or approver responsible for the final payroll instruction." },
    ],
    related: [
      { label: "Final pay guide", href: "/resources/final-pay-philippines", description: "See the full payroll closeout context." },
      { label: "Implementation controls", href: "/implementation", description: "Review how sensitive payroll decisions are reconciled." },
      { label: "Payroll compliance", href: "/compliance", description: "See how Linaw separates automated calculation from human/legal validation." },
    ],
    lastReviewed: reviewed,
    lastReviewedIso: reviewedIso,
    sources: [{ label: "DOLE Workers' Statutory Monetary Benefits Handbook", href: DOLE_HANDBOOK_2024 }],
  },
  {
    slug: "payroll-process-philippines",
    eyebrow: "Philippine payroll process",
    title: "A controlled payroll process from inputs to release.",
    metaTitle: "Payroll Process Philippines: From Inputs to Release | Linaw",
    description: "Philippine payroll process guide covering employee data, attendance cutoff, calculation, exception review, checker approval, release and post-payroll close.",
    intro: "A reliable payroll process is a sequence of controlled handoffs. Each stage should make its inputs, owner, exceptions and completion evidence visible.",
    proof: ["Employee data", "Attendance cutoff", "Calculation", "Exception review", "Checker approval", "Release and close"],
    sections: [
      { title: "Prepare employee and payroll inputs", body: "Confirm employee status, pay basis, schedules, recurring deductions, benefits and statutory identifiers before cutoff work begins." },
      { title: "Close time and variable inputs", body: "Attendance, overtime, leave and one-time adjustments should reach an explicit cutoff so the payroll team knows what is complete and what remains exceptional." },
      { title: "Calculate and review exceptions", body: "The payroll engine should calculate traceable results while surfacing incomplete punches, missing data, unusual adjustments and policy conflicts for human review." },
      { title: "Approve, release and reconcile", body: "An independent checker and release owner should review totals before payout, followed by payslip, accounting, statutory and audit-close activities." },
    ],
    faq: [
      { question: "What are the main stages of a controlled payroll process?", answer: "A strong process prepares employee data, closes time and variable inputs, calculates payroll, reviews exceptions, gets independent approval, releases payroll and reconciles the completed run." },
      { question: "Why should payroll inputs have an explicit cutoff?", answer: "A cutoff tells the team which attendance, leave, overtime, salary changes and one-time adjustments are complete enough to calculate, and which late items still need an exception decision." },
      { question: "Why separate payroll preparation from approval?", answer: "Role separation reduces the risk that one person can change inputs, calculate the run and release money without an independent review of totals and exceptions." },
      { question: "What should happen after payroll is released?", answer: "Reconcile payout totals, publish payslips, complete accounting and statutory handoffs, and retain the approved payroll version plus review evidence for the close." },
    ],
    related: [
      { label: "Payroll cutoff guide", href: "/resources/payroll-cutoff", description: "Design the cutoff that feeds this process." },
      { label: "Payroll audit checklist", href: "/resources/payroll-audit-checklist", description: "Review the run before and after release." },
      { label: "Live demo", href: "/demo", description: "Inspect the role-based payroll workflow." },
      { label: "Retroactive pay", href: "/resources/retroactive-pay", description: "See how effective-dated pay corrections can be settled without rewriting released history." },
    ],
    lastReviewed: reviewed,
    lastReviewedIso: reviewedIso,
  },
  {
    slug: "payroll-cutoff",
    eyebrow: "Payroll cutoff",
    title: "How to design a payroll cutoff that reduces rework.",
    metaTitle: "Payroll Cutoff Philippines: Process Guide | Linaw",
    description: "Payroll cutoff guide for Philippine teams covering input deadlines, late attendance, overtime approvals, exceptions, change freezes and controlled reopen rules.",
    intro: "A payroll cutoff is a control boundary: it defines which employee, time, leave and adjustment data is considered complete enough to calculate the run.",
    proof: ["Cutoff ownership", "Late-data policy", "Overtime approvals", "Attendance exceptions", "Change freeze", "Reopen controls"],
    sections: [
      { title: "Define separate input deadlines", body: "Attendance, overtime, leave, new hires, salary changes and one-time deductions may need different operational deadlines even if they feed the same payroll period." },
      { title: "Create a policy for late data", body: "The team should know whether late inputs reopen the current payroll, move to the next run or require an authorized off-cycle process." },
      { title: "Do not hide unresolved attendance", body: "Missing punches or schedule conflicts should become visible exceptions instead of being silently converted into zero hours or guessed time." },
      { title: "Lock only when the review state is clear", body: "A cutoff should help the team reach a stable review state, not merely stop users from editing data at an arbitrary time." },
    ],
    faq: [
      { question: "What does payroll cutoff mean?", answer: "A payroll cutoff is the operational boundary that defines which employee, attendance, leave, overtime and adjustment data is considered complete for a specific payroll run." },
      { question: "What should happen to data submitted after cutoff?", answer: "The team should have a documented rule for late inputs: reopen the current run with approval, move the item to the next run or use an authorized off-cycle process." },
      { question: "Should missing punches be converted to zero hours at cutoff?", answer: "Not automatically. Missing or conflicting attendance should remain visible as an exception so a reviewer can resolve it using evidence instead of payroll silently guessing." },
      { question: "When should a payroll cutoff be reopened?", answer: "Reopening should require a clear reason, an authorized owner and a traceable recalculation so the reviewed payroll version cannot change without visibility." },
    ],
    related: [
      { label: "Time & attendance", href: "/time-and-attendance", description: "See the source data feeding payroll cutoff." },
      { label: "Common payroll errors", href: "/resources/common-payroll-errors", description: "See what weak cutoff controls tend to create." },
      { label: "Payroll process", href: "/resources/payroll-process-philippines", description: "Place cutoff inside the broader payroll workflow." },
    ],
    lastReviewed: reviewed,
    lastReviewedIso: reviewedIso,
  },
  {
    slug: "common-payroll-errors",
    eyebrow: "Payroll errors",
    title: "Common payroll errors and the controls that prevent them.",
    metaTitle: "Common Payroll Errors Philippines: Prevention Guide | Linaw",
    description: "Common Philippine payroll errors involving employee setup, attendance, statutory rules, adjustments, approvals and payout, plus controls that reduce rework.",
    intro: "Most payroll failures are not caused by one bad formula. They come from weak handoffs between employee data, time, rules, exceptions, review and release.",
    proof: ["Wrong employee setup", "Duplicate/manual encoding", "Attendance gaps", "Outdated rules", "Unreviewed adjustments", "Payout mismatch"],
    sections: [
      { title: "Employee master-data errors", body: "Incorrect pay basis, government identifiers, status dates or schedule assignments can flow through every downstream payroll calculation." },
      { title: "Time and attendance errors", body: "Missing punches, wrong schedules, unapproved overtime and stale rest-day data can distort premium pay before payroll even starts." },
      { title: "Rule and statutory errors", body: "Hard-coded contribution tables or tax formulas without effective dates make it easy to apply the wrong rule to a historical or future period." },
      { title: "Release-control errors", body: "Even correct calculations can fail operationally when the wrong payout total is uploaded, approvals are skipped or the released run no longer matches the reviewed run." },
    ],
    faq: [
      { question: "What causes the most payroll errors?", answer: "Many errors begin before calculation: incorrect employee setup, stale schedules, missing attendance, duplicate encoding, outdated rules, unreviewed adjustments or payout files that no longer match the approved run." },
      { question: "How can duplicate payroll encoding be reduced?", answer: "Use one controlled source for employee and payroll inputs, validate imports and updates by stable employee identifiers, and avoid maintaining competing spreadsheets as parallel sources of truth." },
      { question: "Why are effective-dated rules important?", answer: "Effective dates help payroll apply the rule that belonged to the covered period instead of accidentally using today's contribution table, schedule or rest-day setup for historical payroll." },
      { question: "How can a correct payroll still fail at release?", answer: "The reviewed calculation can still become an operational failure if approvals are skipped, bank totals differ from the released net-pay total or the payout file comes from a different payroll version." },
    ],
    related: [
      { label: "Payroll audit checklist", href: "/resources/payroll-audit-checklist", description: "Turn these risks into a repeatable control list." },
      { label: "Payroll health check", href: "/payroll-health-check", description: "Assess where your current process is vulnerable." },
      { label: "Capability scorecard", href: "/scorecard", description: "See which Linaw controls are verified, partial or absent." },
    ],
    lastReviewed: reviewed,
    lastReviewedIso: reviewedIso,
  },
  {
    slug: "payroll-audit-checklist",
    eyebrow: "Payroll audit checklist",
    title: "Payroll audit checklist before release.",
    metaTitle: "Payroll Audit Checklist Philippines | Linaw",
    description: "Payroll audit checklist for Philippine teams covering employee data, time, statutory deductions, tax, approvals, payout reconciliation and release evidence.",
    intro: "A payroll audit does not need to mean a formal external audit. Every payroll run benefits from a structured pre-release review that compares source data, calculations and final money movement.",
    proof: ["Headcount reconciliation", "Gross-to-net review", "Statutory checks", "Tax review", "Payout reconciliation", "Approval evidence"],
    sections: [
      { title: "Reconcile who is in the run", body: "Compare active employees, new hires, separated employees, unpaid leave and off-cycle cases against the expected payroll population." },
      { title: "Review material changes", body: "Investigate unusual movement in gross pay, overtime, deductions, employer contributions, tax and net pay compared with prior periods or approved inputs." },
      { title: "Tie payroll to the payout file", body: "The bank or payout total should equal the final approved net-pay total, with any excluded or failed payments clearly identified." },
      { title: "Preserve reviewer evidence", body: "Record who reviewed the run, what exceptions were resolved and which exact payroll version was approved for release." },
    ],
    faq: [
      { question: "What should be reconciled before payroll release?", answer: "Reconcile the expected employee population, gross-to-net totals, material pay changes, statutory deductions, tax, exceptions, approval status and the payout total tied to the run being released." },
      { question: "Why compare payroll with the prior period?", answer: "Prior-period comparison can surface unusual movement in overtime, deductions, employer costs or net pay that deserves review before money moves." },
      { question: "Should the bank payout total equal payroll net pay?", answer: "The final supported payout total should reconcile to the approved payroll net-pay amount, with any excluded, held or failed payments identified separately." },
      { question: "What audit evidence should a payroll run retain?", answer: "Keep the exact payroll version, reviewer and approver identity, resolved exceptions, release decision and downstream payout or close evidence needed to reconstruct what happened." },
    ],
    related: [
      { label: "Payroll process", href: "/resources/payroll-process-philippines", description: "Use the checklist inside a controlled payroll cycle." },
      { label: "Payroll implementation", href: "/resources/payroll-implementation-guide", description: "Use independent reconciliation during migration." },
      { label: "Security", href: "/security", description: "Review access controls around payroll approval and release." },
    ],
    lastReviewed: reviewed,
    lastReviewedIso: reviewedIso,
  },
  {
    slug: "payslip-guide",
    eyebrow: "Payslip guide Philippines",
    title: "What a useful payroll payslip should explain.",
    metaTitle: "Payslip Guide Philippines: Payroll Information | Linaw",
    description: "Philippine payslip guide covering earnings, deductions, statutory items, net pay, payroll period, employee access and why payslips should match payroll.",
    intro: "A payslip should help an employee understand how gross pay became net pay. Clear line items reduce repeated questions and make payroll corrections easier to investigate.",
    proof: ["Pay period", "Earnings", "Premiums", "Deductions", "Statutory items", "Net pay"],
    sections: [
      { title: "Show the period and payment context", body: "Employees should be able to identify the payroll period, payment date and the employment/pay basis relevant to the calculation." },
      { title: "Separate earnings from deductions", body: "Basic pay, overtime, holiday pay and other earnings should not be mixed into the same section as taxes, contributions, loans and other deductions." },
      { title: "Make statutory deductions recognizable", body: "SSS, PhilHealth, Pag-IBIG and withholding tax should be presented clearly enough for employees to identify the item being deducted." },
      { title: "Use self-service for repeat access", body: "A secure employee portal can reduce payroll-team work by letting employees retrieve released payslips and payroll history themselves." },
    ],
    faq: [
      { question: "What should a useful payslip show?", answer: "At minimum, employees should be able to identify the payroll period, payment date, earnings, premiums, deductions, statutory items and resulting net pay." },
      { question: "Should the payslip match the released payroll run?", answer: "Yes. A payslip should be generated from the same approved payroll result used for release so employee-facing figures do not drift from the employer's final payroll record." },
      { question: "Why is employee self-service useful for payslips?", answer: "Secure self-service lets employees retrieve released payslips and history without repeatedly asking payroll staff to resend documents." },
      { question: "What should happen when an employee disputes a payslip item?", answer: "The payroll team should trace the questioned line back to the approved payroll inputs and calculation, record any correction and preserve the revised payroll evidence if a change is required." },
    ],
    related: [
      { label: "Employee self-service", href: "/employee-self-service", description: "See how employees access released payroll information." },
      { label: "Payroll software", href: "/", description: "Review the calculation workflow behind the payslip." },
      { label: "Payroll glossary", href: "/glossary", description: "Look up common payroll terms." },
    ],
    lastReviewed: reviewed,
    lastReviewedIso: reviewedIso,
  },
  {
    slug: "payroll-annualization",
    eyebrow: "Payroll annualization Philippines",
    title: "Payroll annualization and year-end tax review.",
    metaTitle: "Payroll Annualization Philippines: Tax Guide | Linaw",
    description: "Payroll annualization guide for Philippine employers covering year-to-date taxable compensation, tax withheld, year-end adjustment and BIR Form 2316 context.",
    intro: "Year-end payroll needs a cumulative view. Annualization reconciles taxable compensation and tax already withheld across the year so the final payroll position reflects the employee's annual compensation record.",
    proof: ["Year-to-date taxable income", "Tax already withheld", "Year-end adjustment", "2316 preparation", "Terminated employees", "Audit trail"],
    sections: [
      { title: "Use year-to-date payroll data", body: "Annualization depends on cumulative compensation and tax values, so payroll data continuity matters throughout the year and during migrations." },
      { title: "Reconcile tax already withheld", body: "The year-end calculation should compare the annual tax position with amounts previously withheld rather than simply applying the monthly table one more time." },
      { title: "Handle separated employees deliberately", body: "Employees who leave during the year may need tax reconciliation and certificate handling at separation rather than only during the employer's December close." },
      { title: "Tie annualization into 2316 preparation", body: "Year-end payroll review should produce traceable values that can flow into the employee's compensation and tax certificate, while filing or submission readiness remains separately validated." },
    ],
    faq: [
      { question: "Why is payroll annualization needed?", answer: "Annualization reconciles cumulative taxable compensation and tax already withheld so the employee's year-end tax position is based on the full year rather than one isolated cutoff." },
      { question: "What data does annualization depend on?", answer: "It depends on complete year-to-date taxable compensation, tax withheld and any year-end or separation adjustments, which is why opening balances and migration accuracy matter." },
      { question: "How should separated employees be handled?", answer: "Employees who leave during the year may need their tax position reconciled at separation rather than waiting for the employer's December close." },
      { question: "Does annualization make BIR Form 2316 automatically filing-ready?", answer: "No. Annualization prepares the payroll values that feed the certificate, while document review, delivery and any filing or substituted-filing requirements remain separate controls." },
    ],
    related: [
      { label: "BIR 2316 guide", href: "/compliance/bir-2316", description: "See how annual payroll values connect to the employee certificate." },
      { label: "Withholding tax guide", href: "/compliance/withholding-tax", description: "Review payroll tax calculation context." },
      { label: "BIR compliance", href: "/compliance/bir", description: "See the broader BIR payroll workflow." },
    ],
    lastReviewed: reviewed,
    lastReviewedIso: reviewedIso,
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
    metaTitle: "BIR Form 2316 Payroll Guide Philippines | Linaw",
    description: "BIR Form 2316 payroll guide covering employee compensation and tax data, annualization, certificate preparation and validation before year-end delivery.",
    intro: "BIR describes Form 2316 as the certificate showing compensation paid and tax withheld for an employee. The form depends on complete year-to-date payroll data, and BIR states it should generally be issued by January 31 of the succeeding year or on the last wage payment when employment terminates.",
    proof: ["Employee compensation certificate", "Year-to-date payroll data", "Tax withheld", "January 31 issuance context", "Termination issuance context", "Validation before submission"],
    sections: [
      { title: "2316 is downstream of payroll accuracy", body: "The certificate can only be as reliable as the employee's cumulative compensation, non-taxable items and tax-withheld records." },
      { title: "Year-end and separation events both matter", body: "Employers need a process for annual certificate preparation as well as employees who separate before year-end." },
      { title: "Use the latest official form version", body: "BIR guidance requires the current official form or exact replica when using an electronic signature workflow." },
      { title: "Keep generation separate from filing validation", body: "Producing a 2316 PDF or data row does not by itself prove that every downstream submission or substituted-filing requirement has been satisfied." },
    ],
    faq: [
      { question: "What payroll data feeds BIR Form 2316?", answer: "The certificate depends on annual compensation and withholding records, so payroll should reconcile year-to-date taxable compensation, tax withheld and year-end adjustments first." },
      { question: "Is generating a 2316 the same as completing the employer's year-end process?", answer: "No. Prepared output still needs review, employee-data validation and the employer's required delivery or filing workflow." },
      { question: "Why is annualization important before 2316 preparation?", answer: "Annualization reconciles cumulative taxable compensation and tax already withheld, helping the year-end certificate reflect the employee's final payroll tax position." },
      { question: "Should payroll keep evidence of the generated certificate?", answer: "Yes. Versioning and audit evidence help show which payroll values produced the final certificate when corrections occur." },
    ],
    related: [
      { label: "Payroll annualization", href: "/resources/payroll-annualization", description: "Review the cumulative payroll values feeding 2316." },
      { label: "BIR compliance", href: "/compliance/bir", description: "See the broader tax workflow." },
      { label: "Alphalist guide", href: "/compliance/alphalist", description: "Review annual employee/payee reporting context." },
    ],
    lastReviewed: reviewed,
    lastReviewedIso: reviewedIso,
    sources: [
      { label: "BIR Form 2316 information", href: BIR_2316 },
      { label: "BIR forms library", href: BIR_FORMS },
    ],
  },
  {
    slug: "1601-c",
    eyebrow: "BIR Form 1601-C",
    title: "BIR Form 1601-C and monthly withholding remittance.",
    metaTitle: "BIR Form 1601-C Payroll Guide Philippines | Linaw",
    description: "BIR Form 1601-C payroll guide covering compensation withholding totals, monthly remittance-return context, reconciliation and current filing-date verification.",
    intro: "BIR Form 1601-C is the monthly remittance return for income taxes withheld on compensation. Payroll should reconcile taxable compensation and tax withheld before the return is prepared, then verify the current BIR calendar for the applicable filing and payment deadline.",
    proof: ["Monthly compensation withholding", "Tax-withheld reconciliation", "Adjustments", "Filer-specific deadlines", "Current BIR calendar", "Submission evidence"],
    sections: [
      { title: "Reconcile payroll totals before preparing the return", body: "The compensation and tax-withheld totals in the return should tie back to the approved payroll records for the covered month." },
      { title: "Handle adjustments explicitly", body: "Corrections to prior withholding periods should be documented and reconciled rather than silently changing current-month payroll totals." },
      { title: "Do not hard-code one universal filing date", body: "BIR calendars can distinguish non-eFPS and eFPS filer groups, so the current official tax reminder should be checked for the actual month." },
      { title: "Store evidence of the filed result", body: "A mature payroll/compliance process records the filed period, amount, confirmation or receipt and the payroll totals that supported it." },
    ],
    faq: [
      { question: "What does payroll contribute to BIR Form 1601-C preparation?", answer: "Payroll provides the compensation withholding totals and supporting employee-level records that should reconcile to the monthly remittance-return amount." },
      { question: "Should one permanent filing date be hard-coded into payroll guidance?", answer: "No. Filing calendars can vary by filer type and current BIR schedules, so the applicable official tax reminder should be checked for the actual period." },
      { question: "What should be reconciled before the return is treated as ready?", answer: "The approved payroll withholding totals, remittance amount, covered period and any corrections should agree before filing evidence is recorded." },
      { question: "Does a correct withholding calculation prove the return was accepted?", answer: "No. Calculation accuracy and filing acceptance are separate controls; submission confirmation or other official evidence remains necessary." },
    ],
    related: [
      { label: "Withholding tax guide", href: "/compliance/withholding-tax", description: "Review how payroll determines tax withheld." },
      { label: "Compliance calendar", href: "/compliance/calendar", description: "Use official calendars instead of static deadline assumptions." },
      { label: "BIR compliance", href: "/compliance/bir", description: "See the complete payroll-tax workflow." },
    ],
    lastReviewed: reviewed,
    lastReviewedIso: reviewedIso,
    sources: [
      { label: "BIR 1601-C guidelines", href: BIR_1601C },
      { label: "BIR tax reminder", href: BIR_TAX_REMINDER },
    ],
  },
  {
    slug: "alphalist",
    eyebrow: "BIR Alphalist",
    title: "BIR Alphalist and payroll data readiness.",
    metaTitle: "BIR Alphalist Payroll Guide Philippines | Linaw",
    description: "BIR Alphalist payroll guide covering employee and payee identity data, annual compensation, tax withheld, reconciliation, output versioning and validation.",
    intro: "The Alphalist is a reporting output built from withholding records. The payroll job is to preserve complete employee/payee data and reconcile annual compensation and tax values before the file is treated as ready.",
    proof: ["Employee/payee identity data", "Annual compensation", "Tax withheld", "Return attachment context", "January annual reporting", "Validation evidence"],
    sections: [
      { title: "Treat the Alphalist as a downstream data product", body: "It should be generated from reconciled payroll and withholding records, not maintained as a separate spreadsheet that becomes its own source of truth." },
      { title: "Validate employee identifiers and totals", body: "Missing or inconsistent employee data can turn a correct payroll calculation into a rejected or inaccurate reporting output." },
      { title: "Tie the Alphalist back to annual withholding returns", body: "BIR reminders treat required alphalists as attachments to relevant withholding returns, so the payroll reporting totals should reconcile." },
      { title: "Track the exact generated version", body: "If the output is regenerated after corrections, the compliance record should identify which version was ultimately submitted." },
    ],
    faq: [
      { question: "What payroll information is needed for an Alphalist?", answer: "The output depends on complete employee or payee identity data plus annual compensation and tax-withheld records that reconcile to the related withholding returns." },
      { question: "Should the Alphalist be maintained as a separate source-of-truth spreadsheet?", answer: "A stronger model generates it from reconciled payroll and withholding data so the reporting output does not drift away from the payroll records." },
      { question: "Why should generated versions be tracked?", answer: "Corrections can cause the output to be regenerated, so the compliance record should identify which version was ultimately validated or submitted." },
      { question: "Does Linaw claim an Alphalist is filing-ready immediately after generation?", answer: "No. The product separates prepared output from external validation and acceptance evidence." },
    ],
    related: [
      { label: "BIR 2316", href: "/compliance/bir-2316", description: "Connect employee certificates with annual payroll data." },
      { label: "Payroll annualization", href: "/resources/payroll-annualization", description: "Reconcile annual compensation and withholding first." },
      { label: "Regulatory updates", href: "/resources/updates", description: "Track dated BIR reminders affecting payroll reporting." },
    ],
    lastReviewed: reviewed,
    lastReviewedIso: reviewedIso,
    sources: [
      { label: "BIR forms", href: BIR_FORMS },
      { label: "BIR tax reminder", href: BIR_TAX_REMINDER },
    ],
  },
  {
    slug: "withholding-tax",
    eyebrow: "Withholding tax on compensation",
    title: "Withholding tax on compensation in Philippine payroll.",
    metaTitle: "Withholding Tax on Compensation Philippines | Linaw",
    description: "Withholding tax on compensation guide covering taxable pay, payroll-frequency tables, minimum-wage-earner treatment, annualization, 1601-C and 2316 context.",
    intro: "Payroll withholding starts with taxable compensation, not gross salary. Statutory and non-taxable treatment, minimum-wage-earner rules where applicable and year-end annualization all affect the final tax result.",
    proof: ["Taxable compensation", "Monthly/semi-monthly payroll", "Minimum-wage-earner handling", "Year-end annualization", "1601-C connection", "2316 connection"],
    sections: [
      { title: "Build the taxable base first", body: "Payroll should classify compensation items before applying a withholding table. Treating all gross earnings as taxable can overstate withholding." },
      { title: "Use the table that matches the payroll frequency", body: "Monthly and semi-monthly payroll can use different table thresholds, so the payroll function should match the actual pay frequency." },
      { title: "Annualization is not optional cleanup", body: "The year-end process reconciles cumulative taxable compensation and tax already withheld so the employee's annual position is consistent." },
      { title: "Reporting follows the calculation", body: "1601-C, 2316 and annual reporting rely on the payroll tax records, but preparing those outputs still requires separate validation and filing evidence." },
    ],
    faq: [
      { question: "Is withholding tax calculated from gross pay?", answer: "Not necessarily. Payroll first needs the taxable compensation base after applying the relevant statutory and non-taxable treatment." },
      { question: "Why does payroll frequency matter?", answer: "Withholding thresholds and tables can differ by payroll frequency, so the calculation must use the table that matches the actual payroll cadence." },
      { question: "How does annualization relate to regular payroll withholding?", answer: "Regular payroll withholding is reconciled at year-end against cumulative taxable compensation and tax already withheld to determine the employee's final annual position." },
      { question: "How are 1601-C and 2316 connected to payroll withholding?", answer: "Those outputs rely on payroll tax records, but preparing or generating them remains separate from filing validation or employee-delivery evidence." },
    ],
    related: [
      { label: "Withholding tax calculator", href: "/calculators/withholding-tax", description: "Estimate monthly withholding from taxable compensation." },
      { label: "1601-C guide", href: "/compliance/1601-c", description: "See monthly remittance-return context." },
      { label: "Payroll annualization", href: "/resources/payroll-annualization", description: "Review the year-end reconciliation." },
    ],
    lastReviewed: reviewed,
    lastReviewedIso: reviewedIso,
    sources: [
      { label: "BIR 1601-C guidelines", href: BIR_1601C },
      { label: "BIR forms library", href: BIR_FORMS },
    ],
  },
  {
    slug: "calendar",
    eyebrow: "Payroll compliance calendar",
    title: "Philippine payroll compliance calendar: how to manage deadlines.",
    metaTitle: "Payroll Compliance Calendar Philippines | Linaw",
    description: "Philippine payroll compliance calendar guide for BIR, SSS, PhilHealth, Pag-IBIG and DOLE obligations using current official schedules, owners and evidence.",
    intro: "A compliance calendar should be a maintained operational tool, not a permanent table copied from an old blog post. Official schedules and advisories can change, and filing dates can differ by filer type or circumstance.",
    proof: ["BIR tax reminders", "DOLE advisories", "SSS contribution schedule", "PhilHealth issuances", "Pag-IBIG guidance", "Owner and evidence fields"],
    sections: [
      { title: "Use official calendars as the source of truth", body: "The current BIR tax reminder and agency advisories should be checked before a deadline is treated as final." },
      { title: "Assign an owner to each obligation", body: "Every remittance, filing or employee-delivery deadline should have an internal owner and a backup rather than living only on a shared calendar." },
      { title: "Track completion evidence", body: "The useful calendar record includes what was filed or paid, the covered period, completion date and confirmation evidence." },
      { title: "Publish updates without changing the evergreen URL", body: "The evergreen calendar page should explain the process, while dated regulatory updates record specific new advisories or schedule changes." },
    ],
    faq: [
      { question: "Should a payroll compliance calendar use permanent hard-coded deadlines?", answer: "No. The calendar should be checked against current official agency schedules because deadlines can vary by filer type, advisory, holiday or other circumstance." },
      { question: "What should each compliance-calendar item contain?", answer: "At minimum, identify the obligation, covered period, responsible owner, current official source, due-date basis, completion status and supporting evidence." },
      { question: "Why should a compliance calendar record completion evidence?", answer: "A checked box only shows that someone marked the task complete. Evidence such as a receipt, confirmation, accepted file or internal review record makes the completion traceable." },
      { question: "How should regulatory changes affect the calendar?", answer: "Dated updates should record what changed and when, while the evergreen calendar continues to point users to the current official source for the applicable period." },
    ],
    related: [
      { label: "Regulatory updates", href: "/resources/updates", description: "See dated changes and government reminders." },
      { label: "1601-C", href: "/compliance/1601-c", description: "Review monthly BIR withholding-remittance context." },
      { label: "Payroll audit", href: "/compliance/payroll-audit", description: "Reconcile compliance evidence after the payroll run." },
    ],
    lastReviewed: reviewed,
    lastReviewedIso: reviewedIso,
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
    title: "How Linaw tracks Philippine payroll rule changes.",
    metaTitle: "Payroll Regulatory Update Process Philippines | Linaw",
    description: "Method for tracking Philippine payroll regulatory changes by agency, publication date, effective date, official source, affected workflow and review status.",
    intro: "Evergreen pages explain a payroll topic. Dated updates record what changed, when it changed, the source and which payroll workflows may need review. Keeping those two content types separate reduces stale guidance.",
    proof: ["Effective date", "Issuing agency", "Source document", "Affected workflow", "Rule-review status", "Evergreen cross-links"],
    sections: [
      { title: "Record the date and source first", body: "A payroll update should identify the issuing agency, publication or advisory date and official source before summarizing operational impact." },
      { title: "Separate publication date from effective date", body: "A rule can be published on one date and apply on another. Both fields matter when deciding which payroll periods are affected." },
      { title: "Map the update to product rules", body: "Changes affecting contribution rates, tax tables, holidays or filing outputs should point to the exact calculation or compliance workflow that needs review." },
      { title: "Keep old updates available as history", body: "Historical updates help explain why an older payroll used a different rule version, while evergreen pages continue to describe the current process." },
    ],
    faq: [
      { question: "What information should a payroll regulatory update include?", answer: "Record the issuing agency, publication date, effective date, official source, affected payroll workflow and the internal review status." },
      { question: "Why separate publication date from effective date?", answer: "A rule or advisory can be published before it takes effect, so payroll needs both dates to know which payroll periods are actually affected." },
      { question: "Should old regulatory updates be deleted after a rule changes?", answer: "Usually no. Historical updates help explain why an older payroll used a different rule version, while evergreen guidance should describe the current process." },
      { question: "How should a regulatory update connect to payroll software?", answer: "Map the update to the exact rule, calculation, reporting output or operational workflow that needs review rather than treating the update as a generic news item." },
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
    metaTitle: "Payroll Compliance Audit Philippines | Linaw",
    description: "Payroll compliance audit guide covering released payroll, statutory liabilities, tax withheld, government outputs, filing evidence and unresolved exceptions.",
    intro: "A compliance audit should connect the approved payroll run with the statutory calculations and reporting evidence that followed it. The goal is traceability, not a blanket statement that everything is compliant.",
    proof: ["Approved payroll version", "Statutory liabilities", "Tax withheld", "Government output", "Submission/remittance evidence", "Exceptions"],
    sections: [
      { title: "Start with the released payroll version", body: "Compliance review should use the exact payroll run that was approved and released, not a later recalculation that no longer matches the money paid." },
      { title: "Reconcile statutory liabilities", body: "Employee deductions and employer shares should tie back to payroll totals and the reporting or remittance amount prepared for each agency." },
      { title: "Keep validation status visible", body: "A generated worksheet can be complete as a payroll artifact while still waiting for external filing validation or submission evidence." },
      { title: "Close exceptions explicitly", body: "If an employee record, contribution, tax amount or filing output remains unresolved, the compliance record should show the owner and next action." },
    ],
    faq: [
      { question: "Which payroll version should a compliance audit use?", answer: "Use the exact payroll version that was approved and released so the audit matches the money paid, employee payslips and downstream liabilities." },
      { question: "What should be reconciled after payroll release?", answer: "Reconcile employee deductions, employer contributions, tax withheld, payout totals, accounting outputs and any government reporting or remittance records created from that run." },
      { question: "How should unresolved payroll compliance exceptions be handled?", answer: "Keep the exception open with a clear owner, affected employee or period, supporting evidence and next action until the issue has a documented resolution." },
      { question: "Does completing a payroll audit mean every government filing was accepted?", answer: "No. An internal payroll audit can confirm traceability and reconciliation while external filing, remittance or agency acceptance evidence remains a separate control." },
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
  metaDescription: string;
  explanation: string;
  whyItMatters: string;
  example: string;
  related: Array<{ label: string; href: string }>;
};

export const glossaryEntries: GlossaryEntry[] = [
  {
    slug: "basic-salary",
    term: "Basic salary",
    definition: "The core salary or wage paid for services rendered, before adding many premium or variable-pay items.",
    metaDescription: "Basic salary in Philippine payroll: what it means, why it matters for payroll bases and statutory benefits, and how it differs from gross pay.",
    explanation: "Basic salary is an important payroll base because statutory benefits such as 13th-month pay can depend on what is legally or contractually treated as basic salary.",
    whyItMatters: "Payroll needs a clear basic-salary base before it can classify premium pay, benefits and other earnings correctly. Treating every earning as basic salary can distort downstream calculations.",
    example: "An employee may have a fixed monthly basic salary plus overtime and allowances. Gross pay can include all of those items, while the basic-salary figure remains the core pay amount used by rules that specifically reference basic salary.",
    related: [{ label: "13th-month pay", href: "/resources/13th-month-pay-philippines" }, { label: "Gross pay", href: "/glossary/gross-pay" }],
  },
  {
    slug: "gross-pay",
    term: "Gross pay",
    definition: "Total payroll earnings before deductions.",
    metaDescription: "Gross pay in Philippine payroll: total earnings before deductions, common components, and how it differs from taxable compensation and net pay.",
    explanation: "Gross pay can include basic pay plus overtime, premiums, allowances, bonuses or other earnings. It is not automatically the same as taxable compensation.",
    whyItMatters: "Gross pay is a useful payroll total, but it is not the answer to every downstream calculation. Tax, statutory treatment and employee payout can each use a different derived base.",
    example: "If an employee earns basic pay plus overtime and a taxable allowance, those earnings can all contribute to gross pay. Payroll still needs to classify each item before tax and deductions are applied.",
    related: [{ label: "Taxable compensation", href: "/glossary/taxable-compensation" }, { label: "Net pay", href: "/glossary/net-pay" }],
  },
  {
    slug: "net-pay",
    term: "Net pay",
    definition: "The amount remaining after applicable payroll deductions are taken from earnings.",
    metaDescription: "Net pay in Philippine payroll: the employee payout amount after deductions, how it relates to gross pay, and why it must reconcile to payout files.",
    explanation: "Net pay is the amount generally used for employee payout, so the approved payroll net-pay total should reconcile with the bank or payout file.",
    whyItMatters: "A payroll can calculate correctly and still fail operationally if the amount sent to the bank or payout provider does not match the approved net-pay result.",
    example: "If approved payroll shows total employee net pay of ₱500,000, the supported payout instruction should reconcile to that same approved amount, apart from any explicitly held or excluded payments.",
    related: [{ label: "Gross pay", href: "/glossary/gross-pay" }, { label: "Payroll audit checklist", href: "/resources/payroll-audit-checklist" }],
  },
  {
    slug: "taxable-compensation",
    term: "Taxable compensation",
    definition: "Compensation subject to withholding tax after applying the relevant tax and non-taxable treatment.",
    metaDescription: "Taxable compensation in Philippine payroll: how it differs from gross pay and why earnings must be classified before withholding tax is calculated.",
    explanation: "Taxable compensation is not necessarily identical to gross pay. Payroll must classify earnings and statutory treatment before applying a withholding table.",
    whyItMatters: "Using gross pay as a substitute for taxable compensation can overstate or misstate withholding because payroll items do not all receive identical tax treatment.",
    example: "A payroll run can contain basic pay, statutory deductions and benefits with different tax treatment. The withholding calculation should use the resulting taxable base rather than blindly applying a tax table to gross earnings.",
    related: [{ label: "Withholding tax", href: "/glossary/withholding-tax" }, { label: "BIR withholding guide", href: "/compliance/withholding-tax" }],
  },
  {
    slug: "payroll-cutoff",
    term: "Payroll cutoff",
    definition: "The operational deadline after which payroll inputs for a period are treated as complete or subject to a controlled late-change process.",
    metaDescription: "Payroll cutoff in the Philippines: what the cutoff controls, how late attendance or adjustments should be handled, and why reopen rules matter.",
    explanation: "A cutoff helps stabilize attendance, leave, overtime and adjustment data before calculation and review.",
    whyItMatters: "Without a clear cutoff, payroll can keep changing while reviewers are trying to approve it. A controlled cutoff creates a stable version and a defined path for late changes.",
    example: "Attendance may close on one date while one-time deductions close earlier. If an approved overtime item arrives late, policy should say whether the current run reopens or the item moves to a later or off-cycle run.",
    related: [{ label: "Payroll cutoff guide", href: "/resources/payroll-cutoff" }, { label: "Payroll process", href: "/resources/payroll-process-philippines" }],
  },
  {
    slug: "night-differential",
    term: "Night differential",
    definition: "Additional pay associated with qualifying work performed during the statutory night period.",
    metaDescription: "Night differential in Philippine payroll: why actual worked time matters and how night work can overlap overtime, holiday or rest-day premiums.",
    explanation: "Accurate night differential depends on worked-time ranges and can interact with overtime, holiday or rest-day premiums.",
    whyItMatters: "A flat night allowance can hide the work-time evidence behind the amount. Payroll should preserve the qualifying night minutes and the work-date context used to price them.",
    example: "A shift can include ordinary hours, qualifying night hours and overtime in the same work period. Payroll should keep those components distinct so reviewers can trace the premium calculation.",
    related: [{ label: "Night differential guide", href: "/resources/night-differential-philippines" }, { label: "Night differential calculator", href: "/calculators/night-differential" }],
  },
  {
    slug: "premium-pay",
    term: "Premium pay",
    definition: "Additional pay that can apply when work is performed under specified conditions such as rest days or certain holidays.",
    metaDescription: "Premium pay in Philippine payroll: additional pay tied to rest days, holidays and other work conditions, with context that affects the payroll result.",
    explanation: "Payroll must preserve the type of day, work status and schedule context so the premium is not reduced to one universal multiplier.",
    whyItMatters: "Premium calculations depend on why and when the work occurred. Losing the underlying day type or rest-day context can make a later payroll review impossible to explain.",
    example: "Work performed on an ordinary day, a rest day and a regular holiday can require different treatment even when the number of worked hours is identical.",
    related: [{ label: "Holiday pay guide", href: "/resources/holiday-pay-philippines" }, { label: "DOLE payroll guide", href: "/compliance/dole" }],
  },
  {
    slug: "rest-day",
    term: "Rest day",
    definition: "An employee's scheduled weekly rest period used as payroll context for certain premium-pay calculations.",
    metaDescription: "Rest day in Philippine payroll: why effective-dated schedules matter and how rest-day context can affect overtime and premium-pay calculations.",
    explanation: "When rest days change over time, historical payroll should use the rest day that applied on the work date rather than the employee's current schedule.",
    whyItMatters: "A current schedule is not always valid for an older payroll period. Effective-dated rest days help preserve the actual work arrangement that applied when the employee worked.",
    example: "If an employee's weekly rest day changes from Sunday to Monday in October, a September payroll recalculation should still use the September rest-day assignment.",
    related: [{ label: "Overtime guide", href: "/resources/overtime-pay-philippines" }, { label: "Time & attendance", href: "/time-and-attendance" }],
  },
  {
    slug: "withholding-tax",
    term: "Withholding tax on compensation",
    definition: "Income tax deducted by an employer from taxable employee compensation and remitted under BIR rules.",
    metaDescription: "Withholding tax on compensation in Philippine payroll: taxable-pay basis, payroll-frequency tables, year-end annualization and BIR reporting context.",
    explanation: "The payroll calculation depends on taxable compensation and the applicable withholding table, followed by year-end reconciliation and reporting.",
    whyItMatters: "Withholding is not just a percentage of gross pay. Payroll must establish the taxable compensation base, use the table for the pay frequency and later reconcile the employee's annual tax position.",
    example: "A semi-monthly payroll uses the taxable compensation for that cutoff with the applicable table, while year-end annualization later reconciles cumulative compensation and tax already withheld.",
    related: [{ label: "Withholding guide", href: "/compliance/withholding-tax" }, { label: "Withholding calculator", href: "/calculators/withholding-tax" }],
  },
  {
    slug: "monthly-salary-credit",
    term: "Monthly Salary Credit (MSC)",
    definition: "The SSS compensation base used to determine contribution amounts within the applicable schedule.",
    metaDescription: "Monthly Salary Credit or MSC in SSS payroll: what the contribution base means, why it differs from salary, and how it affects contribution shares.",
    explanation: "MSC is not simply another name for an employee's monthly salary; the SSS schedule determines the contribution base and applicable shares.",
    whyItMatters: "Payroll needs the applicable contribution schedule to determine the statutory base and shares instead of assuming the employee's exact cash salary is the contribution amount.",
    example: "Two employees with different cash salaries can map to contribution treatment defined by the current SSS schedule, which is why payroll should use the applicable rule rather than a hard-coded percentage of take-home pay.",
    related: [{ label: "SSS compliance", href: "/compliance/sss" }, { label: "SSS calculator", href: "/calculators/sss-contribution" }],
  },
  {
    slug: "13th-month-pay",
    term: "13th-month pay",
    definition: "A statutory benefit generally calculated as one-twelfth of total basic salary earned during the calendar year for covered employees.",
    metaDescription: "13th-month pay in the Philippines: the basic-salary concept, one-twelfth calculation, part-year service and links to current payroll guidance.",
    explanation: "Eligibility and the basic-salary base should be reviewed under current DOLE guidance and employer policy where more favorable treatment applies.",
    whyItMatters: "The payroll result depends on the basic salary actually earned during the covered year, so employers need a consistent classification of basic salary and a traceable year-to-date base.",
    example: "An employee who worked only part of the calendar year can still have a proportionate 13th-month amount based on covered basic salary earned during that period.",
    related: [{ label: "13th-month guide", href: "/resources/13th-month-pay-philippines" }, { label: "13th-month calculator", href: "/calculators/13th-month-pay" }],
  },
  {
    slug: "annualization",
    term: "Payroll annualization",
    definition: "Year-end reconciliation of cumulative taxable compensation and tax withheld to determine the employee's annual tax position.",
    metaDescription: "Payroll annualization in the Philippines: year-to-date taxable compensation, tax already withheld, year-end adjustments and BIR Form 2316 context.",
    explanation: "Annualization connects year-to-date payroll records with final tax adjustments and year-end employee reporting such as BIR Form 2316.",
    whyItMatters: "A monthly or semi-monthly withholding result is only part of the year's tax picture. Annualization reconciles cumulative values so year-end payroll and employee tax records use the final annual position.",
    example: "At year-end, payroll compares annual taxable compensation and the resulting annual tax with amounts already withheld during the year, then records any required reconciliation before preparing downstream employee tax records.",
    related: [{ label: "Annualization guide", href: "/resources/payroll-annualization" }, { label: "BIR 2316", href: "/compliance/bir-2316" }],
  },
];

export type RegulatoryUpdate = {
  slug: string;
  title: string;
  metaTitle?: string;
  metaDescription?: string;
  summary: string;
  publishedDate: string;
  reviewedDate: string;
  agency: string;
  sourceUrl: string;
  sourceLabel: string;
  affected: string[];
  whatChanged: string[];
  payrollActions: string[];
  evergreenLinks: Array<{ label: string; href: string }>;
};

export const regulatoryUpdates: RegulatoryUpdate[] = [
  {
    slug: "dole-final-pay-reminder-2026",
    title: "DOLE reiterates final-pay and COE timing in January 2026.",
    metaTitle: "DOLE Final Pay & COE Reminder 2026 | Linaw",
    metaDescription: "DOLE reminder for Philippine employers on final-pay release timing, certificate-of-employment timing and payroll closeout responsibilities in 2026.",
    summary: "DOLE reminded employers that final pay should generally be released within 30 days after separation unless a more favorable company policy applies, and reiterated the separate COE timing requirement.",
    publishedDate: "2026-01-21",
    reviewedDate: "2026-10-05",
    agency: "Department of Labor and Employment",
    sourceUrl: DOLE_FINAL_PAY,
    sourceLabel: "DOLE final pay and COE reminder",
    affected: ["Final pay", "Employee separation", "Payroll closeout"],
    whatChanged: [
      "DOLE reiterated the final-pay timing in Labor Advisory No. 06, Series of 2020.",
      "The reminder separately highlighted the Certificate of Employment timing after an employee request.",
      "DOLE directed employees with unresolved delays to its assistance channels rather than treating the payroll calculation itself as proof of compliance.",
    ],
    payrollActions: [
      "Track the employee's separation date and the employer's final-pay due date in the closeout workflow.",
      "Reconcile unpaid salary, prorated 13th-month pay, leave conversion, tax adjustments and any approved separation or retirement amounts before release.",
      "Keep final-pay release evidence separate from the payroll calculation record.",
    ],
    evergreenLinks: [{ label: "Final pay guide", href: "/resources/final-pay-philippines" }, { label: "Payroll compliance", href: "/compliance" }],
  },
  {
    slug: "dole-13th-month-guidelines-2025",
    title: "DOLE reiterates 13th-month pay rules for the 2025 year-end.",
    metaTitle: "DOLE 13th-Month Pay Reminder 2025 | Linaw",
    metaDescription: "DOLE Labor Advisory No. 16-25 reiterated 13th-month pay obligations and the December 24 payment timing for covered employees for the 2025 year-end.",
    summary: "DOLE Labor Advisory No. 16-25 reiterated the statutory 13th-month payment obligation and the December 24 payment timing for covered employees.",
    publishedDate: "2025-11-15",
    reviewedDate: "2026-10-05",
    agency: "Department of Labor and Employment",
    sourceUrl: "https://dole.gov.ph/news/labor-advisory-no-16-25-guidelines-on-the-payment-of-the-thirteenth-month-pay/",
    sourceLabel: "DOLE Labor Advisory No. 16-25",
    affected: ["13th-month pay", "Year-end payroll"],
    whatChanged: [
      "Labor Advisory No. 16-25 reiterated the 13th-month pay obligation for covered rank-and-file employees.",
      "The advisory reiterated the December 24 payment deadline for the covered 2025 year-end.",
      "The guidance reaffirmed the one-twelfth basic-salary formula and year-end employer responsibility.",
    ],
    payrollActions: [
      "Reconcile each covered employee's total basic salary earned during the calendar year before calculating the benefit.",
      "Review employees who joined, resigned or were separated during the year for the applicable proportionate amount.",
      "Keep the dated advisory linked from the evergreen 13th-month guide instead of hard-coding the 2025 rule context into a permanent URL.",
    ],
    evergreenLinks: [{ label: "13th-month pay guide", href: "/resources/13th-month-pay-philippines" }, { label: "13th-month calculator", href: "/calculators/13th-month-pay" }],
  },
  {
    slug: "bir-alphalist-reminder-2026",
    title: "BIR reminds withholding agents that required alphalists form part of withholding-return compliance.",
    metaTitle: "BIR Alphalist Reminder 2026 | Linaw",
    metaDescription: "BIR RMC No. 55-2026 reiterated alphalist submission obligations for covered withholding agents and linked applicable alphalists to withholding returns.",
    summary: "BIR Revenue Memorandum Circular No. 55-2026 reiterated alphalist submission obligations for covered withholding agents and tied applicable alphalists to the relevant withholding returns and deadlines.",
    publishedDate: "2026-05-26",
    reviewedDate: "2026-10-05",
    agency: "Bureau of Internal Revenue",
    sourceUrl: "https://bir-cdn.bir.gov.ph/BIR/pdf/RMC%20No.%2055-2026%20Digest.pdf",
    sourceLabel: "BIR RMC No. 55-2026 Digest",
    affected: ["Alphalist", "Withholding returns", "Payroll reporting"],
    whatChanged: [
      "BIR RMC No. 55-2026 reiterated alphalist submission obligations for covered withholding agents.",
      "The circular tied applicable alphalists to the related withholding-return compliance workflow.",
      "The reminder reinforces the need to reconcile annual payroll and withholding data before treating an Alphalist output as ready.",
    ],
    payrollActions: [
      "Reconcile employee or payee identity data, annual compensation and tax withheld before generating the reporting output.",
      "Tie the generated Alphalist version back to the applicable withholding return and covered period.",
      "Record the exact output version and submission or validation evidence used for the completed compliance workflow.",
    ],
    evergreenLinks: [{ label: "Alphalist guide", href: "/compliance/alphalist" }, { label: "BIR compliance", href: "/compliance/bir" }],
  },
];
