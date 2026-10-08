export type EffectiveRulePack<T> = {
  version: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
  sourceDocument: string;
  params: T;
};

function validIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function resolveEffectiveRulePack<T>(
  packs: readonly EffectiveRulePack<T>[],
  asOf: string,
  ruleName: string,
): EffectiveRulePack<T> {
  if (!validIsoDate(asOf)) {
    throw new Error(`${ruleName} requires an ISO applicable date (YYYY-MM-DD).`);
  }
  const applicable = packs.filter((pack) =>
    pack.effectiveFrom <= asOf && (!pack.effectiveUntil || asOf <= pack.effectiveUntil)
  );
  if (applicable.length === 0) {
    throw new Error(
      `No approved ${ruleName} rule pack covers ${asOf}. Add and certify the statutory version before calculating payroll for this date.`,
    );
  }
  if (applicable.length > 1) {
    throw new Error(
      `Ambiguous ${ruleName} rule packs cover ${asOf}: ${applicable.map((pack) => pack.version).join(", ")}.`,
    );
  }
  return applicable[0];
}

export const SSS_RULE_PACKS = [{
  version: "SSS-2025-CIRCULAR-2024-006",
  effectiveFrom: "2025-01-01",
  effectiveUntil: null,
  sourceDocument: "SSS Circular No. 2024-006",
  params: {
    mscFloor: 5_000,
    mscCeiling: 35_000,
    mscStep: 500,
    regularMscCeiling: 20_000,
    employeeRate: 0.05,
    employerRate: 0.10,
    ecThreshold: 15_000,
    ecBelow: 10,
    ecAtOrAbove: 30,
  },
}] as const;

export const PHILHEALTH_RULE_PACKS = [{
  version: "PHIC-2024-5PCT",
  effectiveFrom: "2024-01-01",
  effectiveUntil: null,
  sourceDocument: "PhilHealth premium contribution schedule, 5% rate",
  params: {
    salaryFloor: 10_000,
    salaryCeiling: 100_000,
    premiumRate: 0.05,
    employeeShare: 0.5,
  },
}] as const;

export const PAGIBIG_RULE_PACKS = [{
  version: "HDMF-2024-MFS-10000",
  effectiveFrom: "2024-02-01",
  effectiveUntil: null,
  sourceDocument: "Pag-IBIG Fund contribution schedule effective February 2024",
  params: {
    fundSalaryCeiling: 10_000,
    lowRateThreshold: 1_500,
    employeeLowRate: 0.01,
    employeeStandardRate: 0.02,
    employerRate: 0.02,
  },
}] as const;

export const BIR_WITHHOLDING_RULE_PACKS = [{
  version: "BIR-RR11-2018-2023-TABLE",
  effectiveFrom: "2023-01-01",
  effectiveUntil: null,
  sourceDocument: "BIR Revised Withholding Tax Tables effective 2023 onward",
  params: {
    annual: [
      { limit: 250_000, base: 0, floor: 0, rate: 0 },
      { limit: 400_000, base: 0, floor: 250_000, rate: 0.15 },
      { limit: 800_000, base: 22_500, floor: 400_000, rate: 0.20 },
      { limit: 2_000_000, base: 102_500, floor: 800_000, rate: 0.25 },
      { limit: 8_000_000, base: 402_500, floor: 2_000_000, rate: 0.30 },
      { limit: Infinity, base: 2_202_500, floor: 8_000_000, rate: 0.35 },
    ],
    monthly: [
      { limit: 20_833, base: 0, floor: 0, rate: 0 },
      { limit: 33_333, base: 0, floor: 20_833, rate: 0.15 },
      { limit: 66_667, base: 1_875, floor: 33_333, rate: 0.20 },
      { limit: 166_667, base: 8_541.8, floor: 66_667, rate: 0.25 },
      { limit: 666_667, base: 33_541.8, floor: 166_667, rate: 0.30 },
      { limit: Infinity, base: 183_541.8, floor: 666_667, rate: 0.35 },
    ],
    semiMonthly: [
      { limit: 10_417, base: 0, floor: 0, rate: 0 },
      { limit: 16_667, base: 0, floor: 10_417, rate: 0.15 },
      { limit: 33_333, base: 937.5, floor: 16_667, rate: 0.20 },
      { limit: 83_333, base: 4_270.7, floor: 33_333, rate: 0.25 },
      { limit: 333_333, base: 16_770.7, floor: 83_333, rate: 0.30 },
      { limit: Infinity, base: 91_770.7, floor: 333_333, rate: 0.35 },
    ],
  },
}] as const;

export function statutoryRuleVersionsForDate(asOf: string) {
  return {
    sss: resolveEffectiveRulePack(SSS_RULE_PACKS, asOf, "SSS").version,
    philHealth: resolveEffectiveRulePack(PHILHEALTH_RULE_PACKS, asOf, "PhilHealth").version,
    pagIbig: resolveEffectiveRulePack(PAGIBIG_RULE_PACKS, asOf, "Pag-IBIG").version,
    withholding: resolveEffectiveRulePack(BIR_WITHHOLDING_RULE_PACKS, asOf, "BIR withholding").version,
  };
}
