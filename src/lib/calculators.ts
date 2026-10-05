export const CALCULATORS = {
  "13th-month-pay": {
    title: "13th Month Pay Calculator Philippines",
    description: "Estimate Philippine 13th-month pay from total basic salary earned during the calendar year.",
    intro: "This calculator uses the same 13th-month computation helper used by Linaw's compliance logic: total basic salary earned during the year divided by 12.",
  },
  "overtime-pay": {
    title: "Overtime Pay Calculator Philippines",
    description: "Estimate overtime pay for ordinary days, rest days, special non-working days and regular holidays.",
    intro: "Estimate overtime from an hourly rate, hours worked and day context using Linaw's shared holiday/rest-day multiplier logic.",
  },
  "night-differential": {
    title: "Night Differential Calculator Philippines",
    description: "Estimate night differential using hourly rate, hours and work-day context.",
    intro: "Estimate the 10% night differential component using the applicable base-day multiplier from Linaw's payroll rule implementation.",
  },
  "holiday-pay": {
    title: "Holiday Pay Calculator Philippines",
    description: "Estimate premium pay for worked regular holidays, special non-working days and rest-day combinations.",
    intro: "Enter a daily rate and choose the day context. The estimate uses Linaw's shared holiday/rest-day multiplier logic.",
  },
  "sss-contribution": {
    title: "SSS Contribution Calculator Philippines",
    description: "Estimate employee, employer and EC SSS contributions using Linaw's configured payroll rules.",
    intro: "Estimate SSS contribution shares from monthly salary using the same contribution function used by Linaw's payroll engine.",
  },
  "philhealth-contribution": {
    title: "PhilHealth Contribution Calculator Philippines",
    description: "Estimate PhilHealth employee and employer premium shares.",
    intro: "Estimate the total premium and employee/employer split using Linaw's shared payroll rules.",
  },
  "pag-ibig-contribution": {
    title: "Pag-IBIG Contribution Calculator Philippines",
    description: "Estimate Pag-IBIG employee and employer contributions.",
    intro: "Estimate Pag-IBIG contribution shares using Linaw's configured contribution function.",
  },
  "withholding-tax": {
    title: "Withholding Tax Calculator Philippines",
    description: "Estimate monthly compensation withholding using Linaw's BIR payroll rule implementation.",
    intro: "Enter monthly taxable compensation, not gross salary. This estimate uses Linaw's monthly withholding-tax function.",
  },
  "payroll-cost": {
    title: "Employer Payroll Cost Calculator Philippines",
    description: "Estimate monthly employer payroll cost from salary plus configured employer SSS, PhilHealth and Pag-IBIG contributions.",
    intro: "Estimate core monthly employer payroll cost using the same statutory contribution functions used by Linaw. This does not include every possible benefit, premium or employer-specific cost.",
  },
  "final-pay": {
    title: "Final Pay Calculator Philippines",
    description: "Add known final-pay components such as unpaid salary, prorated 13th-month pay, leave conversion and other approved amounts.",
    intro: "This tool totals final-pay components you already know. It does not decide legal entitlement to separation pay, leave conversion or another benefit.",
  },
  "daily-rate": {
    title: "Daily Rate Calculator Philippines",
    description: "Estimate a daily payroll rate from monthly salary using a divisor you control.",
    intro: "Enter the monthly salary and the divisor used by your payroll policy or applicable rule. The tool does not assume one divisor is correct for every employee.",
  },
  "hourly-rate": {
    title: "Hourly Rate Calculator Philippines",
    description: "Estimate an hourly payroll rate from monthly salary, a daily-rate divisor and paid hours per day.",
    intro: "Enter the payroll divisor and hours per day that apply to the employee. Different work arrangements can require different bases.",
  },
  "payroll-outsourcing-roi": {
    title: "Payroll Outsourcing ROI Calculator Philippines",
    description: "Compare estimated internal payroll labor cost with a proposed managed payroll service cost.",
    intro: "Estimate the labor-cost difference between an internal payroll process and a managed service. This is an operating-cost screen, not a guarantee of savings.",
  },
} as const;

export type CalculatorSlug = keyof typeof CALCULATORS;

export const ADVANCED_CALCULATOR_SLUGS = [
  "final-pay",
  "daily-rate",
  "hourly-rate",
  "payroll-outsourcing-roi",
] as const;

export type AdvancedCalculatorSlug = (typeof ADVANCED_CALCULATOR_SLUGS)[number];

export function isAdvancedCalculatorSlug(slug: CalculatorSlug): slug is AdvancedCalculatorSlug {
  return (ADVANCED_CALCULATOR_SLUGS as readonly string[]).includes(slug);
}


export type CalculatorGuide = {
  steps: string[];
  verify: string[];
  faq: Array<{ question: string; answer: string }>;
};

export const CALCULATOR_GUIDES: Record<CalculatorSlug, CalculatorGuide> = {
  "13th-month-pay": {
    steps: [
      "Enter the total basic salary actually earned during the calendar year.",
      "The calculator passes that annual basic-salary amount to Linaw's shared 13th-month helper.",
      "Use the estimate as a payroll check, then reconcile the underlying salary history before release.",
    ],
    verify: [
      "Confirm that the amount entered is basic salary earned, not every item in gross compensation.",
      "Check partial-year employment, unpaid periods and payroll corrections before treating the estimate as final.",
    ],
    faq: [
      { question: "What input does this 13th-month calculator use?", answer: "It uses the total basic salary earned during the year and applies the same 13th-month computation helper used by Linaw's payroll compliance logic." },
      { question: "Should allowances and every bonus be added to the basic-salary input?", answer: "Not automatically. The calculator expects basic salary earned. Other compensation items can have different treatment and should be reviewed before they are included." },
      { question: "Can I use the estimate as the final employee payout?", answer: "Use it as a reconciliation aid. Final payroll should still confirm the employee's actual salary history, employment period and any corrections that affect the annual basic-salary total." },
    ],
  },
  "overtime-pay": {
    steps: [
      "Enter the employee's hourly rate and overtime hours.",
      "Choose the work-day context and whether the date is also a rest day.",
      "The estimate uses Linaw's shared holiday/rest-day multiplier logic for the selected context.",
    ],
    verify: [
      "Confirm that the hourly rate and overtime hours are the correct payroll inputs for the employee.",
      "Verify the actual holiday and rest-day context for the work date before payroll release.",
    ],
    faq: [
      { question: "Why does the overtime estimate change by day type?", answer: "Overtime can interact with ordinary-day, rest-day and holiday context, so the applicable payroll multiplier is not always the same." },
      { question: "Does this calculator determine whether overtime was authorized?", answer: "No. It estimates pay from the inputs you provide. Authorization evidence and the employee's actual worked time are separate payroll controls." },
      { question: "Can this replace attendance review?", answer: "No. Payroll should still reconcile the overtime hours to timekeeping, schedule context and any required approval evidence." },
    ],
  },
  "night-differential": {
    steps: [
      "Enter the hourly rate and the number of qualifying night-work hours.",
      "Choose the applicable day context and whether it is also a rest day.",
      "The estimate applies the shared base-day multiplier and the night-differential factor used by the product.",
    ],
    verify: [
      "Confirm the qualifying night-work hours from the actual shift or attendance record.",
      "Check whether overtime, holiday or rest-day context overlaps the night period.",
    ],
    faq: [
      { question: "Why does day context matter for night differential?", answer: "Night work can occur on ordinary days, rest days or holidays, so the base pay context can affect the estimate before the night component is applied." },
      { question: "Can night differential and overtime apply to the same shift?", answer: "They can overlap. The calculator is an estimate; payroll should preserve the actual worked-time and day context when calculating the final amount." },
      { question: "Should I enter the whole shift as night-work hours?", answer: "Only enter hours that qualify under the payroll rule or policy you are applying. Timekeeping should determine the actual qualifying interval." },
    ],
  },
  "holiday-pay": {
    steps: [
      "Enter the employee's daily rate.",
      "Choose whether the worked day is ordinary, special non-working or a regular holiday and whether it is also a rest day.",
      "The estimate applies Linaw's shared holiday/rest-day multiplier for a worked day.",
    ],
    verify: [
      "Confirm the official day classification and the employee's rest-day assignment for the work date.",
      "Review actual attendance and any additional overtime or night-work components separately.",
    ],
    faq: [
      { question: "Why does the calculator ask whether the holiday is also a rest day?", answer: "The payroll context can change when a holiday overlaps the employee's rest day, so the calculator keeps those inputs separate." },
      { question: "Does this calculator include overtime worked on the holiday?", answer: "No. It estimates the worked-day premium from the daily rate. Use the overtime calculator for additional overtime hours." },
      { question: "Can I rely on a saved holiday label forever?", answer: "Payroll should use the official day classification applicable to the work date and confirm any employer-specific or local context before release." },
    ],
  },
  "sss-contribution": {
    steps: [
      "Enter the employee's monthly salary input used by the calculator.",
      "The estimate calls the same SSS contribution function used by Linaw's payroll rules.",
      "The result separates employee contribution, employer contribution, EC and the total.",
    ],
    verify: [
      "Confirm the employee and payroll-period data used for the actual statutory calculation.",
      "Treat calculation, monthly reconciliation and remittance evidence as separate controls.",
    ],
    faq: [
      { question: "Does this calculator use a separate SSS formula from the payroll system?", answer: "No. It calls the shared SSS contribution helper used by Linaw's payroll rules so the public estimate does not maintain a second calculation source." },
      { question: "Why are employee and employer SSS amounts shown separately?", answer: "The employee deduction affects take-home pay while employer contributions are payroll cost. Keeping them separate makes reconciliation clearer." },
      { question: "Does a correct contribution estimate prove SSS remittance was completed?", answer: "No. Calculation and remittance are separate workflows. Actual payroll should still reconcile the covered month and retain the appropriate remittance evidence." },
    ],
  },
  "philhealth-contribution": {
    steps: [
      "Enter the salary amount used for the estimate.",
      "The calculator calls Linaw's shared PhilHealth contribution function.",
      "The output shows the employee share, employer share and total premium.",
    ],
    verify: [
      "Confirm the payroll base and employee data used for the actual covered period.",
      "Reconcile the final monthly liability separately from agency submission or remittance evidence.",
    ],
    faq: [
      { question: "Does this page maintain its own PhilHealth rate table?", answer: "No. The estimate uses the shared PhilHealth payroll function so the calculator does not create a second source of statutory logic." },
      { question: "Why is the total premium shown with both shares?", answer: "Showing employee, employer and total amounts helps payroll verify that deductions and employer cost reconcile to the full contribution." },
      { question: "Does the estimate prove the agency submission was accepted?", answer: "No. A payroll calculation can be correct while filing or remittance validation remains a separate operational step." },
    ],
  },
  "pag-ibig-contribution": {
    steps: [
      "Enter the salary amount used for the estimate.",
      "The calculator calls Linaw's shared Pag-IBIG contribution function.",
      "The result shows employee contribution, employer contribution and the combined total.",
    ],
    verify: [
      "Confirm the salary basis and covered month used by the actual payroll run.",
      "Check cutoff collection and monthly reconciliation before treating the estimate as the final liability.",
    ],
    faq: [
      { question: "Does this calculator duplicate the product's Pag-IBIG logic?", answer: "No. It reuses the contribution helper from Linaw's payroll rules." },
      { question: "Why can cutoff deductions differ from the monthly contribution workflow?", answer: "An employer can operate more than one payroll cutoff, while statutory reconciliation is monthly. Payroll should make the collection timing explicit and reconcile the final month." },
      { question: "Does this estimate include proof of remittance?", answer: "No. It only estimates the contribution amounts. Remittance and agency evidence remain separate controls." },
    ],
  },
  "withholding-tax": {
    steps: [
      "Enter monthly taxable compensation rather than gross salary.",
      "Choose the minimum-wage-earner flag only when it is appropriate for the employee and estimate.",
      "The calculator calls Linaw's monthly withholding-tax function for the entered taxable amount.",
    ],
    verify: [
      "Build the correct taxable-compensation base before using the estimate.",
      "Reconcile regular withholding with year-to-date payroll and annualization before year-end reporting.",
    ],
    faq: [
      { question: "Should I enter gross salary in the withholding-tax calculator?", answer: "No. The input is monthly taxable compensation after applying the relevant payroll classification and non-taxable treatment." },
      { question: "Does this estimate replace year-end annualization?", answer: "No. Regular payroll withholding still needs cumulative year-end reconciliation against taxable compensation and tax already withheld." },
      { question: "Does the calculator prove BIR filing readiness?", answer: "No. It estimates payroll withholding. BIR return preparation, validation and filing evidence are separate workflows." },
    ],
  },
  "payroll-cost": {
    steps: [
      "Enter the employee's monthly base salary.",
      "The calculator adds the employer-side statutory contributions returned by Linaw's shared SSS, PhilHealth and Pag-IBIG functions.",
      "The result shows the estimated salary-plus-core-statutory employer cost.",
    ],
    verify: [
      "Add employer-specific benefits, premiums, insurance, bonuses or other costs separately where applicable.",
      "Use the estimate for planning, not as a complete total-cost-of-employment statement.",
    ],
    faq: [
      { question: "What does the employer payroll cost estimate include?", answer: "It combines the entered base salary with the employer-side SSS, PhilHealth and Pag-IBIG amounts returned by the shared payroll functions." },
      { question: "Does it include every employer cost?", answer: "No. Employer-specific benefits, premiums, bonuses, insurance, leave costs and other expenses can sit outside this simplified estimate." },
      { question: "Can I use it to compare payroll scenarios?", answer: "Yes, as a planning screen. Final budgeting should still include the employer's actual benefits and workforce policies." },
    ],
  },
  "final-pay": {
    steps: [
      "Enter the known positive final-pay components that apply to the employee.",
      "Enter only authorized deductions that should reduce the subtotal.",
      "The calculator totals the values you supplied; it does not decide whether a component is legally owed.",
    ],
    verify: [
      "Confirm entitlement and tax treatment for each component before payment.",
      "Reconcile the employee's final payroll, outstanding balances and year-to-date records before release.",
    ],
    faq: [
      { question: "Does the final-pay calculator decide whether separation pay or leave conversion is owed?", answer: "No. You enter components already determined to be applicable. The tool only totals known amounts and authorized deductions." },
      { question: "Why is prorated 13th-month pay a separate input?", answer: "It lets payroll include a known prorated amount without assuming the calculator can reconstruct the employee's full salary history on this page." },
      { question: "Is the result a final legal settlement amount?", answer: "No. Final payroll still requires entitlement review, tax treatment, approved deductions and reconciliation of the employee's actual records." },
    ],
  },
  "daily-rate": {
    steps: [
      "Enter the employee's monthly salary.",
      "Enter the divisor that applies to the payroll policy or rule you are using.",
      "The calculator divides monthly salary by that entered divisor.",
    ],
    verify: [
      "Confirm the correct divisor for the employee's work arrangement before using the result in payroll.",
      "Document the divisor in payroll setup so later calculations can be explained.",
    ],
    faq: [
      { question: "Why does the calculator ask me to provide the divisor?", answer: "Different work arrangements and payroll policies can use different bases. The tool avoids assuming one divisor is correct for every employee." },
      { question: "Does Linaw choose the correct divisor for me on this page?", answer: "No. You supply the divisor that applies to the employee or policy being evaluated." },
      { question: "Where is the daily rate used next?", answer: "A daily rate can feed other payroll calculations, but each downstream calculation should still use the appropriate employee, schedule and day context." },
    ],
  },
  "hourly-rate": {
    steps: [
      "Enter monthly salary, the applicable daily-rate divisor and paid hours per day.",
      "The tool derives the daily rate from salary and divisor.",
      "It then divides that daily rate by the hours-per-day input to produce the estimate.",
    ],
    verify: [
      "Confirm both the divisor and paid-hours basis for the employee's actual work arrangement.",
      "Do not assume this planning result automatically determines overtime or premium-pay entitlement.",
    ],
    faq: [
      { question: "Why does hourly rate depend on both a divisor and hours per day?", answer: "The calculator first derives a daily rate and then converts that daily basis into an hourly amount using the paid-hours input." },
      { question: "Can I use one hourly-rate basis for every employee?", answer: "Not automatically. Work arrangements and payroll policies can differ, so the inputs should match the employee being evaluated." },
      { question: "Does the hourly rate alone determine overtime pay?", answer: "No. Overtime also depends on worked hours and the applicable work-day context." },
    ],
  },
  "payroll-outsourcing-roi": {
    steps: [
      "Enter monthly payroll-processing hours and correction or rework hours.",
      "Enter the loaded internal hourly cost and the proposed managed-payroll monthly cost.",
      "The tool compares estimated internal labor cost with the service cost and annualizes the difference.",
    ],
    verify: [
      "Include realistic internal time for payroll preparation, corrections and recurring coordination.",
      "Compare service scope and risk transfer separately; a lower modeled cost does not guarantee a better operating model.",
    ],
    faq: [
      { question: "What does the payroll outsourcing ROI calculator compare?", answer: "It compares estimated internal payroll labor cost with the managed-service monthly cost you enter, then shows the modeled monthly and annual difference." },
      { question: "Does it include every cost of payroll outsourcing?", answer: "No. It is a labor-cost planning screen. Transition effort, vendor scope, internal oversight, integrations and other costs should be evaluated separately." },
      { question: "Does a positive result guarantee savings?", answer: "No. The output depends entirely on your inputs and does not guarantee financial or operational savings." },
    ],
  },
};
