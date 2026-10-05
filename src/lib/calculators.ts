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
