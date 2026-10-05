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

export const CALCULATOR_LAST_REVIEWED = "October 5, 2026";

export const CALCULATOR_SOURCES: Partial<Record<CalculatorSlug, Array<{ label: string; href: string }>>> = {
  "13th-month-pay": [
    { label: "NWPC/BWC Handbook on Workers' Statutory Monetary Benefits", href: "https://nwpc.dole.gov.ph/bwc-handbook-workers-statutory-monetary-benefits/" },
  ],
  "overtime-pay": [
    { label: "DOLE Labor Code, Book III", href: "https://dole.gov.ph/book-3-conditions-of-employment/" },
    { label: "NWPC/BWC Handbook on Workers' Statutory Monetary Benefits", href: "https://nwpc.dole.gov.ph/bwc-handbook-workers-statutory-monetary-benefits/" },
  ],
  "night-differential": [
    { label: "DOLE Labor Code, Book III", href: "https://dole.gov.ph/book-3-conditions-of-employment/" },
    { label: "NWPC/BWC Handbook on Workers' Statutory Monetary Benefits", href: "https://nwpc.dole.gov.ph/bwc-handbook-workers-statutory-monetary-benefits/" },
  ],
  "holiday-pay": [
    { label: "DOLE Labor Code, Book III", href: "https://dole.gov.ph/book-3-conditions-of-employment/" },
    { label: "NWPC/BWC Handbook on Workers' Statutory Monetary Benefits", href: "https://nwpc.dole.gov.ph/bwc-handbook-workers-statutory-monetary-benefits/" },
  ],
  "sss-contribution": [
    { label: "SSS Pay Contributions", href: "https://www.sss.gov.ph/pay-contribution/" },
    { label: "SSS Contribution Table", href: "https://www.sss.gov.ph/sss-contribution-table/" },
  ],
  "philhealth-contribution": [
    { label: "PhilHealth Premium Contribution Advisory 2025-0002", href: "https://www.philhealth.gov.ph/advisories/2025/PA2025-0002.pdf" },
    { label: "PhilHealth Universal Health Care contribution schedule", href: "https://www.philhealth.gov.ph/uhc/" },
  ],
  "pag-ibig-contribution": [
    { label: "Pag-IBIG Membership Guidelines", href: "https://www.pagibigfund.gov.ph/document/pdf/circulars/provident/HDMF%20Circular%20No.%20274%20-%20Revised%20Guidelines%20on%20Pag-IBIG%20Fund%20Membership.pdf" },
    { label: "Pag-IBIG Employer Contribution and Remittance Guidelines", href: "https://www.pagibigfund.gov.ph/document/pdf/circulars/provident/HDMF%20Circular%20275%20-%20Implementing%20Guidelines%20on%20Employer%20Registration%20Contribution%20and%20Remittance.pdf" },
  ],
  "withholding-tax": [
    { label: "BIR Withholding Tax Calculator", href: "https://web-services.bir.gov.ph/tax_calculator/wt_calculator.html" },
    { label: "BIR 2026 Revenue Regulations", href: "https://www.bir.gov.ph/2026-Revenue-Regulations" },
  ],
  "payroll-cost": [
    { label: "SSS Pay Contributions", href: "https://www.sss.gov.ph/pay-contribution/" },
    { label: "PhilHealth Universal Health Care contribution schedule", href: "https://www.philhealth.gov.ph/uhc/" },
    { label: "Pag-IBIG Employer Contribution and Remittance Guidelines", href: "https://www.pagibigfund.gov.ph/document/pdf/circulars/provident/HDMF%20Circular%20275%20-%20Implementing%20Guidelines%20on%20Employer%20Registration%20Contribution%20and%20Remittance.pdf" },
  ],
};


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
  metaTitle: string;
  howItWorks: string;
  assumptions: string[];
  faq: Array<{ question: string; answer: string }>;
};

export const CALCULATOR_GUIDES: Record<CalculatorSlug, CalculatorGuide> = {
  "13th-month-pay": {
    metaTitle: "13th Month Pay Calculator Philippines | Linaw",
    howItWorks: "Enter the employee's total basic salary earned during the calendar year. The estimate applies the same 13th-month computation helper used by Linaw and divides that basic-salary total by 12.",
    assumptions: [
      "Use basic salary actually earned for the covered year, not total gross compensation.",
      "Bonuses, allowances and other amounts may need separate treatment depending on their nature.",
      "For separated employees or partial-year service, use only the basic salary earned during the covered period.",
    ],
    faq: [
      { question: "What amount should I enter in the 13th-month pay calculator?", answer: "Enter total basic salary earned during the calendar year or covered employment period, not the employee's total gross pay including every allowance or bonus." },
      { question: "Can this estimate be used for an employee who left before year-end?", answer: "Yes, if the input reflects only basic salary actually earned during the employee's covered service period. Final entitlement and release timing should still be reviewed in context." },
      { question: "Does this calculator decide which allowances belong in the 13th-month base?", answer: "No. It estimates from the basic-salary amount you provide. Classification of a particular payment should be reviewed before relying on the result." },
    ],
  },
  "overtime-pay": {
    metaTitle: "Overtime Pay Calculator Philippines | Linaw",
    howItWorks: "Enter the hourly rate, overtime hours and work-day context. The calculator applies Linaw's shared holiday/rest-day overtime multiplier to estimate the premium amount.",
    assumptions: [
      "The hourly rate entered is already the correct payroll basis for the employee.",
      "Day type and rest-day status materially affect the multiplier.",
      "The estimate does not decide whether the hours are legally compensable or properly authorized.",
    ],
    faq: [
      { question: "Why does overtime pay change by day type?", answer: "Ordinary days, rest days and holidays can use different premium contexts, so the overtime multiplier depends on when the work occurred." },
      { question: "Should I enter monthly salary or hourly rate?", answer: "Enter the hourly payroll rate that applies to the employee. Use the hourly-rate calculator first if you still need to derive that basis." },
      { question: "Does this calculator approve overtime?", answer: "No. It estimates pay from the inputs. Authorization, attendance evidence and payroll review remain separate controls." },
    ],
  },
  "night-differential": {
    metaTitle: "Night Differential Calculator Philippines | Linaw",
    howItWorks: "Enter the hourly rate, covered hours and work-day context. The estimate applies the base day multiplier and then calculates the night-differential component.",
    assumptions: [
      "The hours entered are the night-work hours that should receive the differential.",
      "The hourly rate is already the correct payroll basis.",
      "Holiday, rest-day and overtime context can change the underlying base used for the estimate.",
    ],
    faq: [
      { question: "What hours should I enter for night differential?", answer: "Enter only the hours that fall within the applicable night-work period for the employee and payroll context you are estimating." },
      { question: "Can night differential overlap with overtime?", answer: "Yes. Night work and overtime can overlap, which is why the payroll context matters when calculating the applicable base." },
      { question: "Does the calculator derive night hours from clock-in and clock-out times?", answer: "No. This public calculator accepts the night hours directly. Linaw's attendance workflows can derive payroll-relevant minutes from time records inside the product." },
    ],
  },
  "holiday-pay": {
    metaTitle: "Holiday Pay Calculator Philippines | Linaw",
    howItWorks: "Enter the daily rate and select the work-day context. The calculator applies Linaw's shared holiday/rest-day multiplier for a worked day.",
    assumptions: [
      "The daily rate entered is the correct payroll basis.",
      "Select whether the day is ordinary, special or a regular holiday and whether it is also a rest day.",
      "The estimate covers the selected worked-day context and does not determine eligibility from attendance history.",
    ],
    faq: [
      { question: "Why does rest-day status matter on a holiday?", answer: "A holiday that also falls on the employee's rest day can have a different premium context from the same holiday on a scheduled work day." },
      { question: "Does this calculator determine whether an employee qualifies for holiday pay?", answer: "No. It estimates the amount for the context you select. Eligibility can depend on facts outside this calculator." },
      { question: "Can I use this for overtime on a holiday?", answer: "Use the overtime-pay calculator for overtime hours because it applies the overtime context in addition to the selected day type." },
    ],
  },
  "sss-contribution": {
    metaTitle: "SSS Contribution Calculator Philippines | Linaw",
    howItWorks: "Enter monthly salary and the calculator calls the same SSS contribution function used by Linaw's payroll engine to return employee, employer and EC amounts.",
    assumptions: [
      "The salary input should match the monthly compensation basis used by the configured payroll rule.",
      "The estimate reflects the rule implementation currently configured in Linaw.",
      "Government remittance and filing validation remain separate from contribution calculation.",
    ],
    faq: [
      { question: "Does the result include the employer share?", answer: "Yes. The calculator shows the employee contribution, employer contribution, EC and total based on the shared SSS rule function." },
      { question: "Is this the same logic used inside Linaw payroll?", answer: "Yes. The public calculator reuses the same contribution helper instead of maintaining a separate marketing formula." },
      { question: "Does a correct contribution estimate mean an SSS filing is ready?", answer: "No. Contribution calculation and government submission or acceptance are separate operational controls." },
    ],
  },
  "philhealth-contribution": {
    metaTitle: "PhilHealth Contribution Calculator Philippines | Linaw",
    howItWorks: "Enter the monthly salary basis. The calculator reuses Linaw's PhilHealth contribution function and returns the employee share, employer share and total premium.",
    assumptions: [
      "Use the payroll salary basis that applies to the employee.",
      "The current Linaw rule implementation determines floors, ceilings and the employee/employer split.",
      "Agency submission remains a separate validation step.",
    ],
    faq: [
      { question: "Does the calculator show both employee and employer shares?", answer: "Yes. It returns the employee share, employer share and total premium from the same helper used by the payroll engine." },
      { question: "How does the calculator handle rounding?", answer: "The shared payroll function preserves the total premium while reconciling the employee and employer shares at centavo level." },
      { question: "Is this an official PhilHealth portal calculator?", answer: "No. It is a Linaw payroll estimate using the product's configured contribution rules." },
    ],
  },
  "pag-ibig-contribution": {
    metaTitle: "Pag-IBIG Contribution Calculator Philippines | Linaw",
    howItWorks: "Enter monthly salary and the calculator calls Linaw's shared Pag-IBIG contribution function to estimate employee and employer shares.",
    assumptions: [
      "The monthly salary input should match the contribution basis used by your payroll setup.",
      "The result follows the rule configuration currently used by Linaw.",
      "Cutoff collection timing and monthly remittance are separate payroll concerns.",
    ],
    faq: [
      { question: "Does this show the employer contribution too?", answer: "Yes. The calculator returns both employee and employer shares from the shared Pag-IBIG rule helper." },
      { question: "Why can payroll deductions differ by cutoff even when the monthly contribution is fixed?", answer: "Employers can collect monthly statutory liability using different cutoff timing patterns, so one cutoff deduction does not always equal the full monthly obligation." },
      { question: "Does this tool create an MCRF filing?", answer: "No. It estimates contribution shares only; government-output preparation and validation are separate workflows." },
    ],
  },
  "withholding-tax": {
    metaTitle: "Withholding Tax Calculator Philippines | Linaw",
    howItWorks: "Enter monthly taxable compensation, not gross salary. The calculator passes that taxable amount to Linaw's monthly compensation-withholding function.",
    assumptions: [
      "The amount entered is already taxable compensation after applicable non-taxable treatment.",
      "The minimum-wage-earner option changes the estimate only for the context represented by the shared rule function.",
      "Year-end annualization can differ from a single-month estimate.",
    ],
    faq: [
      { question: "Should I enter gross salary?", answer: "No. Enter monthly taxable compensation. Gross pay can contain amounts that are treated differently for tax purposes." },
      { question: "Why can year-end tax differ from this monthly estimate?", answer: "Year-end annualization reconciles cumulative taxable compensation and tax already withheld, while this calculator estimates one monthly withholding amount." },
      { question: "Does this replace a BIR filing or tax review?", answer: "No. It is a payroll estimate and does not replace employer filing, annualization review or official validation." },
    ],
  },
  "payroll-cost": {
    metaTitle: "Employer Payroll Cost Calculator Philippines | Linaw",
    howItWorks: "Enter monthly salary. The calculator adds the employer-side SSS, PhilHealth and Pag-IBIG amounts returned by Linaw's shared statutory helpers to estimate core employer payroll cost.",
    assumptions: [
      "The estimate covers base salary plus the employer statutory contributions represented by the shared helpers.",
      "It does not include every allowance, benefit, premium, insurance cost or employer-specific obligation.",
      "Use it for screening rather than final budgeting.",
    ],
    faq: [
      { question: "What costs are included in this employer payroll estimate?", answer: "The estimate includes base salary plus employer-side SSS including EC, PhilHealth and Pag-IBIG from Linaw's shared payroll rules." },
      { question: "What costs are not included?", answer: "Benefits, bonuses, overtime, leave costs, insurance, equipment, recruitment and other employer-specific costs can sit outside this estimate." },
      { question: "Can I use this as a total cost-to-company figure?", answer: "Use it as a core payroll-cost screen, not a complete cost-to-company calculation." },
    ],
  },
  "final-pay": {
    metaTitle: "Final Pay Calculator Philippines | Linaw",
    howItWorks: "Enter the final-pay components you have already determined, such as unpaid salary, prorated 13th-month pay, leave conversion and other approved amounts. The tool totals those inputs.",
    assumptions: [
      "You decide which components are actually due before entering them.",
      "The calculator does not determine legal entitlement to separation pay, leave conversion or another benefit.",
      "Taxes, deductions and clearances may still affect the amount ultimately released.",
    ],
    faq: [
      { question: "Does this calculator decide whether separation pay is required?", answer: "No. It totals components you provide and does not decide legal entitlement to separation pay or other benefits." },
      { question: "Can prorated 13th-month pay be included?", answer: "Yes. If you have already determined the prorated amount, enter it as one of the final-pay components." },
      { question: "Is the total always the employee's final net release?", answer: "Not necessarily. Taxes, lawful deductions, clearances and other final-pay adjustments can still affect the released amount." },
    ],
  },
  "daily-rate": {
    metaTitle: "Daily Rate Calculator Philippines | Linaw",
    howItWorks: "Enter monthly salary and the divisor used by the employee's payroll policy or applicable rule. The calculator divides the monthly amount by that divisor.",
    assumptions: [
      "There is no single divisor that is automatically correct for every work arrangement.",
      "Use the divisor documented for the employee's payroll basis.",
      "The result is a rate conversion, not a legal classification decision.",
    ],
    faq: [
      { question: "What divisor should I use for a daily rate?", answer: "Use the divisor that actually applies to the employee's work arrangement, payroll policy and applicable rule. This calculator deliberately does not force one universal divisor." },
      { question: "Why does the divisor matter?", answer: "Different divisors produce different daily rates, which can affect downstream payroll estimates such as absences or premium pay." },
      { question: "Does Linaw choose the divisor automatically here?", answer: "No. The public tool requires you to enter the basis you intend to use so it does not make an unsupported assumption." },
    ],
  },
  "hourly-rate": {
    metaTitle: "Hourly Rate Calculator Philippines | Linaw",
    howItWorks: "Enter monthly salary, the daily-rate divisor and paid hours per day. The calculator derives the daily rate first and then the hourly payroll rate.",
    assumptions: [
      "Use the divisor and paid hours that apply to the employee's work arrangement.",
      "The result is a payroll rate conversion and does not establish employee classification.",
      "Premium-pay calculators may apply additional multipliers to this hourly basis.",
    ],
    faq: [
      { question: "Why do I need both a divisor and hours per day?", answer: "The divisor converts monthly salary to a daily basis, and paid hours per day then converts that daily amount to an hourly rate." },
      { question: "Can I use this hourly rate for overtime estimates?", answer: "Yes, if the inputs reflect the correct payroll basis for the employee. The overtime calculator can then apply the relevant day context." },
      { question: "Is one hourly-rate formula correct for every employee?", answer: "No. Work arrangements and payroll bases can differ, so this tool keeps the divisor and paid-hours inputs explicit." },
    ],
  },
  "payroll-outsourcing-roi": {
    metaTitle: "Payroll Outsourcing ROI Calculator Philippines | Linaw",
    howItWorks: "Enter the internal payroll labor inputs and the proposed managed-service cost. The calculator compares the estimated operating-cost difference between the two models.",
    assumptions: [
      "The result reflects only the cost inputs you provide.",
      "It does not quantify every operational benefit, risk or transition cost.",
      "A lower estimated cost does not guarantee that outsourcing is the better operating model.",
    ],
    faq: [
      { question: "What does the payroll outsourcing ROI calculator compare?", answer: "It compares estimated internal payroll labor cost with the managed-service cost you enter." },
      { question: "Does it include every outsourcing benefit or risk?", answer: "No. Continuity, process knowledge, exception handling, implementation effort and control preferences are not fully captured by a simple cost comparison." },
      { question: "Should I choose outsourcing only if the calculator shows savings?", answer: "No. Cost is one factor. The right model also depends on who should own payroll preparation, exceptions, approvals and day-to-day operating knowledge." },
    ],
  },
};
