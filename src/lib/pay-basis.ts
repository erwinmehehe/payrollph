export const PAY_BASES = ["monthly", "daily", "hourly"] as const;
export type PayBasis = (typeof PAY_BASES)[number];

export type EmployeePayProfileInput = {
  payBasis: string;
  rateAmount: string | number;
  standardWorkDaysPerMonth: string | number;
  standardHoursPerDay: string | number;
};

export type ResolvedPayProfile = {
  payBasis: PayBasis;
  rateAmount: number;
  standardWorkDaysPerMonth: number;
  standardHoursPerDay: number;
  monthlyEquivalent: number;
  dailyRate: number;
  hourlyRate: number;
};

function positive(value: string | number, label: string, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > max) {
    throw new Error(`${label} must be greater than 0 and no more than ${max}.`);
  }
  return parsed;
}

export function resolvePayProfile(input: EmployeePayProfileInput): ResolvedPayProfile {
  const basis = String(input.payBasis ?? "").trim().toLowerCase();
  if (!PAY_BASES.includes(basis as PayBasis)) {
    throw new Error("Employee pay basis must be Monthly salaried, Daily paid, or Hourly paid.");
  }

  const payBasis = basis as PayBasis;
  const rateAmount = positive(input.rateAmount, "Pay rate", 100_000_000);
  const standardWorkDaysPerMonth = positive(input.standardWorkDaysPerMonth, "Standard work days per month", 31);
  const standardHoursPerDay = positive(input.standardHoursPerDay, "Standard hours per day", 24);

  const monthlyEquivalent =
    payBasis === "monthly"
      ? rateAmount
      : payBasis === "daily"
        ? rateAmount * standardWorkDaysPerMonth
        : rateAmount * standardHoursPerDay * standardWorkDaysPerMonth;

  const dailyRate =
    payBasis === "monthly"
      ? rateAmount / standardWorkDaysPerMonth
      : payBasis === "daily"
        ? rateAmount
        : rateAmount * standardHoursPerDay;

  const hourlyRate =
    payBasis === "hourly"
      ? rateAmount
      : dailyRate / standardHoursPerDay;

  return {
    payBasis,
    rateAmount,
    standardWorkDaysPerMonth,
    standardHoursPerDay,
    monthlyEquivalent,
    dailyRate,
    hourlyRate,
  };
}

export function basicPayForCutoff(profile: ResolvedPayProfile, regularMinutes: number) {
  if (!Number.isFinite(regularMinutes) || regularMinutes < 0) {
    throw new Error("Regular minutes must be zero or greater.");
  }
  if (profile.payBasis === "monthly") return profile.rateAmount / 2;
  const regularHours = regularMinutes / 60;
  if (profile.payBasis === "daily") {
    return (regularHours / profile.standardHoursPerDay) * profile.rateAmount;
  }
  return regularHours * profile.rateAmount;
}

export function attendanceDeductionsForCutoff(
  profile: ResolvedPayProfile,
  tardinessMinutes: number,
  undertimeMinutes: number,
) {
  if (profile.payBasis !== "monthly") {
    return { tardinessDeduction: 0, undertimeDeduction: 0 };
  }
  return {
    tardinessDeduction: (Math.max(0, tardinessMinutes) / 60) * profile.hourlyRate,
    undertimeDeduction: (Math.max(0, undertimeMinutes) / 60) * profile.hourlyRate,
  };
}

export function leaveAdjustmentForCutoff(input: {
  profile: ResolvedPayProfile;
  paidDays: number;
  unpaidDays: number;
}) {
  const paidDays = Math.max(0, input.paidDays);
  const unpaidDays = Math.max(0, input.unpaidDays);
  const { profile } = input;

  if (profile.payBasis === "monthly") {
    const adjustment = -(unpaidDays * profile.dailyRate);
    return adjustment === 0 ? 0 : adjustment;
  }
  if (profile.payBasis === "daily") {
    return paidDays * profile.dailyRate;
  }
  return paidDays * profile.standardHoursPerDay * profile.hourlyRate;
}

export function payBasisLabel(payBasis: string) {
  if (payBasis === "monthly") return "Monthly salaried";
  if (payBasis === "daily") return "Daily paid";
  if (payBasis === "hourly") return "Hourly paid";
  return "Unconfigured";
}
