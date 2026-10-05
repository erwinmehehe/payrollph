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
} as const;

export type CalculatorSlug = keyof typeof CALCULATORS;
