import { round2 } from "@/lib/round";

export type BenefitCategory = "hmo" | "insurance" | "voluntary" | "allowance";

export type BenefitPlanInput = {
  id: number;
  name: string;
  category: BenefitCategory;
  /** Monthly employee share in PHP. */
  employeeShare: number;
  /** Monthly employer share in PHP. */
  employerShare: number;
  /** Optional legal/plan ceiling for voluntary programmes. */
  cap: number | null;
};

export type EnrollmentInput = {
  plan: BenefitPlanInput;
  /** Employee-chosen monthly amount. 0 falls back to the plan default. */
  monthlyContribution: number;
  /** 1 = full semi-monthly period; the module halves the monthly amount. */
  active: boolean;
};

export type BenefitLine = {
  code: string;
  label: string;
  amount: number;
  planId: number;
  category: BenefitCategory;
  basis: string;
};

export const BENEFIT_CATEGORIES: BenefitCategory[] = ["hmo", "insurance", "voluntary", "allowance"];

/** Semi-monthly deductions or credits for one employee's enrolments. */
export function calculateBenefits(enrollments: EnrollmentInput[]): BenefitLine[] {
  const lines: BenefitLine[] = [];

  for (const enrollment of enrollments) {
    if (!enrollment.active) continue;
    const plan = enrollment.plan;

    const requested = enrollment.monthlyContribution > 0 ? enrollment.monthlyContribution : plan.employeeShare;
    const capped = plan.cap != null ? Math.min(requested, plan.cap) : requested;
    if (capped <= 0) continue;

    lines.push({
      code: `BEN-${plan.id}`,
      label: plan.name,
      amount: -round2(capped / 2),
      planId: plan.id,
      category: plan.category,
      basis: plan.cap != null
        ? `₱${capped.toFixed(2)}/month ÷ 2 (cap ₱${plan.cap.toFixed(2)})`
        : `₱${capped.toFixed(2)}/month ÷ 2`,
    });
  }

  return lines;
}

/** Employer-side benefit cost, used for cost reporting. Not a deduction. */
export function employerBenefitCost(enrollments: EnrollmentInput[]) {
  return round2(enrollments
    .filter((enrollment) => enrollment.active)
    .reduce((sum, enrollment) => sum + enrollment.plan.employerShare, 0));
}

/**
 * Voluntary savers need a sanity check: contributions must land inside the plan
 * ceiling and never exceed what the employee actually earns.
 */
export function validateContribution(plan: BenefitPlanInput, monthlyContribution: number, monthlyNet: number) {
  const problems: string[] = [];
  if (monthlyContribution < 0) problems.push("Contribution cannot be negative.");
  if (plan.cap != null && monthlyContribution > plan.cap) {
    problems.push(`Contribution ₱${monthlyContribution.toFixed(2)} exceeds the ${plan.name} cap of ₱${plan.cap.toFixed(2)}.`);
  }
  if (monthlyNet > 0 && monthlyContribution > monthlyNet) {
    problems.push("Contribution exceeds monthly take-home pay.");
  }
  return { ok: problems.length === 0, problems };
}
