import type { AuthorityPage } from "@/lib/seo-content";

export const resourceWave16: AuthorityPage[] = [
  {
    slug: "manual-payroll-vs-software",
    eyebrow: "Manual payroll vs software",
    title: "Manual payroll vs payroll software: what changes as payroll gets more complex?",
    metaTitle: "Manual Payroll vs Software Philippines | Linaw",
    description: "Compare manual payroll and payroll software in the Philippines by calculations, timekeeping, approvals, auditability, compliance workflows and recurring payroll effort.",
    intro: "Manual payroll can work when the workforce and rules are simple, but complexity increases quickly when teams add overtime, holidays, night work, employee changes, deductions, multiple cutoffs and review requirements. The decision is less about spreadsheet preference and more about how much payroll logic, evidence and repeatability the process needs.",
    proof: [
      "Repeated calculations",
      "Timekeeping handoff",
      "Exception visibility",
      "Approval controls",
      "Audit evidence",
      "Recurring payroll effort",
    ],
    sections: [
      {
        title: "Manual payroll depends heavily on process discipline",
        body: "A spreadsheet can calculate pay, but accuracy depends on formulas, source files, version control and the people who know how the workbook is supposed to work. The more exceptions payroll has, the more important those controls become.",
      },
      {
        title: "Software can centralize recurring payroll logic",
        body: "A payroll system can apply configured rules consistently across pay periods, reducing repeated formula maintenance. That does not eliminate review; it changes review from rebuilding calculations to validating inputs, exceptions and outputs.",
      },
      {
        title: "Timekeeping is often where manual work multiplies",
        body: "Attendance from schedules, punches, overtime, leave and holidays can become separate files that need to be reconciled before payroll. A connected workflow keeps the source context closer to the resulting payroll calculation.",
      },
      {
        title: "Approvals are easier to evidence in a governed workflow",
        body: "Manual payroll often relies on email, chat or file copies for sign-off. Payroll software can separate preparation, checking and release actions so reviewers can see which state the payroll is in and who performed sensitive actions.",
      },
      {
        title: "Software does not remove the need for payroll judgment",
        body: "Unusual employee cases, missing time, policy questions and changes still require people to make decisions. The value of automation is in making the repeatable work and the exceptions easier to distinguish.",
      },
      {
        title: "Compare the total operating model",
        body: "When evaluating manual payroll against software, include time spent encoding, checking, correcting, rebuilding reports, tracing changes, managing access and recovering from errors—not only subscription cost.",
      },
    ],
    faq: [
      {
        question: "Is manual payroll always a bad idea?",
        answer: "No. A small, simple payroll can be managed manually when the process is controlled and the team can maintain accurate formulas and records. The risk increases as payroll rules, headcount, locations and exceptions grow.",
      },
      {
        question: "What usually makes companies move away from spreadsheets?",
        answer: "Common triggers include repeated payroll corrections, complex attendance, statutory calculations, multiple reviewers, employee self-service needs, audit requirements and too much time spent reconciling files.",
      },
      {
        question: "Does payroll software eliminate payroll errors?",
        answer: "No. Software can reduce repeated manual work and enforce configured rules, but incorrect inputs, wrong configuration or unresolved exceptions can still produce incorrect payroll. Review remains necessary.",
      },
      {
        question: "How should manual payroll and software be compared?",
        answer: "Compare calculation effort, timekeeping handoff, exception handling, approvals, reporting, access controls, auditability, implementation work and recurring operating cost.",
      },
    ],
    related: [
      { label: "Payroll software", href: "/", description: "See the controlled payroll workflow Linaw provides." },
      { label: "Payroll software ROI", href: "/resources/payroll-software-roi", description: "Evaluate recurring payroll operating cost beyond subscription price." },
      { label: "Payroll system comparison", href: "/resources/payroll-system-comparison", description: "Use a structured evaluation matrix when comparing systems." },
    ],
  },
  {
    slug: "employee-loans-payroll",
    eyebrow: "Employee loans in payroll",
    title: "How employee loan deductions work inside payroll.",
    metaTitle: "Employee Loans in Payroll Philippines | Linaw",
    description: "Learn how employee loan schedules, cut-off deductions, balances, manual payments and payroll controls can be managed inside a Philippine payroll workflow.",
    intro: "Employee loans can become difficult to manage when reference numbers, amortization schedules, balances and payroll deductions live in separate files. A payroll-linked loan ledger keeps the recurring deduction and the remaining balance connected to the employee record while preserving review and auditability.",
    proof: [
      "Employee loan ledger",
      "Cut-off deduction amount",
      "Remaining balance",
      "Manual payment recording",
      "Pause and resume controls",
      "Audit events",
    ],
    sections: [
      {
        title: "Register the loan as a governed employee record",
        body: "A payroll loan record should identify the employee, loan type, reference number, principal, amortization amount, deduction per cutoff, start date and remaining balance. Keeping those fields together reduces dependence on a separate deduction spreadsheet.",
      },
      {
        title: "Deduct only what the active schedule allows",
        body: "Linaw loads active employee loans into payroll and uses the configured cut-off deduction while limiting the requested deduction to the remaining balance. This keeps a final deduction from exceeding the recorded outstanding amount.",
      },
      {
        title: "Track balances instead of repeating static deductions",
        body: "The loan ledger stores total paid and remaining balance so payroll teams can see whether a loan is active, paused or already paid off rather than relying on a fixed deduction that continues indefinitely.",
      },
      {
        title: "Record direct or manual payments separately",
        body: "When an employee makes a payment outside the normal payroll deduction, the payment can be recorded against the loan and the remaining balance updated. The workflow rejects a manual payment that exceeds the recorded remaining balance.",
      },
      {
        title: "Pause or resume deductions without deleting the loan",
        body: "A loan can be paused and resumed while keeping its history and balance. That is safer than removing the record and later reconstructing the amortization history from notes or spreadsheets.",
      },
      {
        title: "Keep payroll access scoped",
        body: "Loan management is restricted to authorized People or payroll roles and follows organization and employee access scope. Changes such as loan registration and manual payment can also produce audit evidence.",
      },
    ],
    faq: [
      {
        question: "Can employee loan deductions be included automatically in payroll?",
        answer: "Yes. Linaw can load active employee loan records into payroll and apply the configured cut-off deduction, limited by the remaining balance.",
      },
      {
        question: "Can a payroll team pause a loan deduction temporarily?",
        answer: "Yes. The loan workflow supports active and paused states so deductions can be paused without deleting the loan record.",
      },
      {
        question: "What happens if an employee pays directly outside payroll?",
        answer: "A manual payment can be recorded against the loan, reducing the remaining balance. The system prevents a recorded payment from exceeding the outstanding balance.",
      },
      {
        question: "Does the payroll system determine whether a loan is legally valid?",
        answer: "No. The payroll workflow records and deducts an approved loan schedule. Eligibility, loan approval and external lender requirements remain separate business or agency processes.",
      },
    ],
    related: [
      { label: "Payroll software", href: "/", description: "See where recurring deductions fit into the payroll workflow." },
      { label: "SSS payroll compliance", href: "/compliance/sss", description: "Review SSS payroll contribution workflows separately from loan deductions." },
      { label: "Pag-IBIG payroll compliance", href: "/compliance/pag-ibig", description: "Review Pag-IBIG payroll contribution workflows separately from loan deductions." },
    ],
  },
  {
    slug: "retroactive-pay",
    eyebrow: "Retroactive pay",
    title: "Retroactive pay in payroll: correcting an effective-dated pay change.",
    metaTitle: "Retroactive Pay Philippines | Payroll Guide | Linaw",
    description: "Understand retroactive pay when an effective-dated pay change affects a previously released payroll period, and how later payroll can settle the difference without rewriting history.",
    intro: "Retroactive pay is different from simply editing an old payroll run. When a pay change is effective in a period that has already been released, a controlled payroll system can preserve the released history, calculate the difference attributable to that effective date and settle the adjustment in a later payroll.",
    proof: [
      "Effective-dated pay revisions",
      "Previously released payroll periods",
      "Calculated retro adjustment",
      "Source-period traceability",
      "Pending-to-settled lifecycle",
      "Later-payroll settlement",
    ],
    sections: [
      {
        title: "Start with an effective-dated pay change",
        body: "Linaw records pay changes with an effective date, prior pay values, new pay values and a reason. This lets payroll distinguish when the new rate should apply instead of treating every pay-profile edit as if it had always been true.",
      },
      {
        title: "Do not rewrite released payroll history",
        body: "If the effective date reaches into a payroll period that is already released, the system can create a separate retro adjustment linked to the pay revision and the original payroll run rather than changing the released payroll entry in place.",
      },
      {
        title: "Keep the source period attached to the adjustment",
        body: "Retro adjustments retain the source payroll run and source period label. That makes the later earning traceable back to the period that created the difference.",
      },
      {
        title: "Settle pending retro pay in a later payroll",
        body: "Pending retro adjustments are loaded into payroll as separate retro-pay earning lines. The payroll engine adds the adjustment to gross pay while keeping the retro amount visible in the payroll trace.",
      },
      {
        title: "Use chronology to keep the revision chain understandable",
        body: "Effective-dated pay changes are entered in chronological order. The workflow rejects a new change dated before an already recorded later revision so the historical pay timeline remains unambiguous.",
      },
      {
        title: "Separate payroll mechanics from legal entitlement",
        body: "A payroll system can calculate and settle a recorded effective-dated correction, but it does not decide whether a particular employee is legally entitled to retroactive pay. The employer must establish the approved effective date and underlying pay decision.",
      },
    ],
    faq: [
      {
        question: "What is retroactive pay?",
        answer: "Retroactive pay is a later payroll adjustment for compensation that should have applied from an earlier effective date. In Linaw, this can arise when an approved pay revision affects a payroll period that was already released.",
      },
      {
        question: "Should an old released payroll be edited to add retro pay?",
        answer: "A controlled workflow should preserve released history. Linaw creates a separate adjustment tied to the original period and settles it in a later payroll instead of silently rewriting the released run.",
      },
      {
        question: "Can the retro adjustment be traced to the original payroll period?",
        answer: "Yes. The adjustment records the source payroll run and source period label, and the later payroll line identifies it as retro pay.",
      },
      {
        question: "Does the software decide who is entitled to retroactive pay?",
        answer: "No. The system applies an approved effective-dated pay correction. The employer remains responsible for the underlying compensation decision and effective date.",
      },
    ],
    related: [
      { label: "Payroll process", href: "/resources/payroll-process-philippines", description: "Review the broader payroll preparation, review and release workflow." },
      { label: "Payroll annualization", href: "/resources/payroll-annualization", description: "See how payroll changes can affect year-to-date tax context." },
      { label: "Implementation & migration", href: "/implementation", description: "See why historical payroll and opening balances matter during implementation." },
    ],
  },
];
