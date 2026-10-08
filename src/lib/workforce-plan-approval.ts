type RecordLike = Record<string, unknown>;

function object(value: unknown): RecordLike {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordLike : {};
}

function finite(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function workforcePlanApprovalAmount(input: { scenarioSnapshot: unknown; currentBaselineSnapshot?: unknown | null }) {
  const scenario = object(input.scenarioSnapshot);
  const forecast = object(scenario.forecast);
  const summary = object(forecast.summary);
  const assumptions = object(forecast.assumptions);
  const proposedAnnualLaborCost = finite(summary.annualRunRateLaborCost);
  if (proposedAnnualLaborCost == null || proposedAnnualLaborCost < 0) {
    throw new Error("The staffing scenario is missing a valid annual labor-cost forecast for approval routing.");
  }

  const baselineForecast = object(object(input.currentBaselineSnapshot).forecast);
  const publishedBaselineAnnualLaborCost = finite(baselineForecast.annualRunRateLaborCost);
  if (publishedBaselineAnnualLaborCost != null && publishedBaselineAnnualLaborCost >= 0) {
    return {
      amount: round2(Math.max(0, proposedAnnualLaborCost - publishedBaselineAnnualLaborCost)),
      basis: "incremental_annual_labor_cost_vs_published_baseline" as const,
      proposedAnnualLaborCost: round2(proposedAnnualLaborCost),
      referenceAnnualLaborCost: round2(publishedBaselineAnnualLaborCost),
    };
  }

  const windowDays = finite(assumptions.windowDays);
  const annualizedBasePayroll = finite(summary.annualizedBasePayroll);
  const statutory = finite(summary.currentPeriodStatutoryEmployerCost);
  const benefits = finite(summary.currentPeriodBenefitEmployerCost);
  const recurring = finite(summary.currentPeriodRecurringCompensationCost);
  if (windowDays == null || windowDays <= 0 || annualizedBasePayroll == null || statutory == null || benefits == null || recurring == null) {
    throw new Error("The staffing scenario is missing current-workforce cost evidence for approval routing.");
  }

  const referenceAnnualLaborCost = annualizedBasePayroll + (statutory + benefits + recurring) * 365.25 / windowDays;
  return {
    amount: round2(Math.max(0, proposedAnnualLaborCost - referenceAnnualLaborCost)),
    basis: "incremental_annual_labor_cost_vs_current_workforce" as const,
    proposedAnnualLaborCost: round2(proposedAnnualLaborCost),
    referenceAnnualLaborCost: round2(referenceAnnualLaborCost),
  };
}
