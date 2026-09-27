export type RegionCode = "NCR" | "III" | "IVA" | "VII" | "XI";

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function getRegionalWageFloor(region: RegionCode | string) {
  const floors: Record<string, number> = {
    NCR: 755,
    III: 600,
    IVA: 600,
    VII: 540,
    XI: 540,
  };
  return floors[region] ?? floors.NCR;
}

export function computeSss(monthlyCompensation: number) {
  const compensation = Math.max(0, Number(monthlyCompensation) || 0);
  const rawMsc = Math.round(compensation / 500) * 500;
  const msc = clamp(rawMsc, 5_000, 35_000);
  const regularMsc = Math.min(msc, 20_000);
  const mpfMsc = Math.max(0, msc - 20_000);
  const ec = msc >= 15_000 ? 30 : 10;

  const employeeMonthly = round2(msc * 0.05);
  const employerMonthly = round2(msc * 0.10 + ec);

  return {
    msc,
    regularMsc,
    mpfMsc,
    ec,
    employeeRegular: round2(regularMsc * 0.05),
    employeeMpf: round2(mpfMsc * 0.05),
    employerRegular: round2(regularMsc * 0.10),
    employerMpf: round2(mpfMsc * 0.10),
    employeeMonthly,
    employerMonthly,
    employeeCutoff: round2(employeeMonthly / 2),
    employerCutoff: round2(employerMonthly / 2),
  };
}

export function computePhilHealth(monthlyBasicSalary: number) {
  const base = clamp(Math.max(0, Number(monthlyBasicSalary) || 0), 10_000, 100_000);
  const premiumMonthly = round2(base * 0.05);
  const employeeMonthly = round2(premiumMonthly / 2);
  const employerMonthly = round2(premiumMonthly / 2);

  return {
    base,
    premiumMonthly,
    employeeMonthly,
    employerMonthly,
    employeeCutoff: round2(employeeMonthly / 2),
    employerCutoff: round2(employerMonthly / 2),
  };
}

export function computePagIbig(monthlyFundSalary: number) {
  const salary = Math.max(0, Number(monthlyFundSalary) || 0);
  const base = Math.min(salary, 10_000);
  const employeeRate = salary <= 1_500 ? 0.01 : 0.02;
  const employerRate = 0.02;
  const employeeMonthly = round2(base * employeeRate);
  const employerMonthly = round2(base * employerRate);

  return {
    base,
    employeeRate,
    employerRate,
    employeeMonthly,
    employerMonthly,
    employeeCutoff: round2(employeeMonthly / 2),
    employerCutoff: round2(employerMonthly / 2),
  };
}

export function computeBirSemiMonthly(taxableCompensation: number) {
  const amount = Math.max(0, Number(taxableCompensation) || 0);
  if (amount <= 10_417) return 0;
  if (amount <= 16_666) return round2((amount - 10_417) * 0.15);
  if (amount <= 33_332) return round2(937.5 + (amount - 16_667) * 0.20);
  if (amount <= 83_332) return round2(4_270.7 + (amount - 33_333) * 0.25);
  if (amount <= 333_332) return round2(16_770.7 + (amount - 83_333) * 0.30);
  return round2(91_770.7 + (amount - 333_333) * 0.35);
}

export function computePunchPay(input: {
  monthlyBasic: number;
  annualDivisor?: number;
  overtimeHours?: number;
  nightDiffHours?: number;
  holidayHours?: number;
  tardyMinutes?: number;
}) {
  const monthlyBasic = Math.max(0, Number(input.monthlyBasic) || 0);
  const annualDivisor = Math.max(1, Number(input.annualDivisor ?? 365) || 365);
  const dailyRateRaw = (monthlyBasic * 12) / annualDivisor;
  const hourlyRateRaw = dailyRateRaw / 8;
  const overtimeHours = Math.max(0, Number(input.overtimeHours ?? 0) || 0);
  const nightDiffHours = Math.max(0, Number(input.nightDiffHours ?? 0) || 0);
  const holidayHours = Math.max(0, Number(input.holidayHours ?? 0) || 0);
  const tardyMinutes = Math.max(0, Number(input.tardyMinutes ?? 0) || 0);

  return {
    dailyRate: round2(dailyRateRaw),
    hourlyRate: round2(hourlyRateRaw),
    overtimePay: round2(overtimeHours * hourlyRateRaw * 1.25),
    nightDiffPay: round2(nightDiffHours * hourlyRateRaw * 0.10),
    holidayPay: round2(holidayHours * hourlyRateRaw * 2.0),
    tardinessDeduction: round2((tardyMinutes / 60) * hourlyRateRaw),
  };
}

export function computeStatutoryCutoff(input: {
  monthlyBasic: number;
  region?: RegionCode | string;
  annualDivisor?: number;
}) {
  const monthlyBasic = Math.max(0, Number(input.monthlyBasic) || 0);
  const annualDivisor = Math.max(1, Number(input.annualDivisor ?? 365) || 365);
  const sss = computeSss(monthlyBasic);
  const philHealth = computePhilHealth(monthlyBasic);
  const pagIbig = computePagIbig(monthlyBasic);
  const dailyRate = round2((monthlyBasic * 12) / annualDivisor);
  const wageFloor = getRegionalWageFloor(input.region ?? "NCR");
  const mwe = dailyRate <= wageFloor;

  const grossCutoff = round2(monthlyBasic / 2);
  const employeeStatutory = round2(
    sss.employeeCutoff + philHealth.employeeCutoff + pagIbig.employeeCutoff,
  );
  const taxableCompensation = mwe ? 0 : round2(Math.max(0, grossCutoff - employeeStatutory));
  const tax = mwe ? 0 : computeBirSemiMonthly(taxableCompensation);

  return {
    monthlyBasic,
    grossCutoff,
    dailyRate,
    wageFloor,
    mwe,
    taxableCompensation,
    tax,
    sss,
    philHealth,
    pagIbig,
    employeeStatutory,
    netCutoff: round2(grossCutoff - employeeStatutory - tax),
  };
}
