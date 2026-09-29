import { annualize, type AnnualizationResult } from "@/lib/annualization";
import { computeThirteenthMonthPay } from "@/lib/ph-compliance";
import { round2 } from "@/lib/round";

export type StoredPayrollLine = {
  code?: string;
  label?: string;
  amount?: string | number;
  notes?: string[];
};

export type PayrollEntryForFinalPay = {
  grossPay: string | number;
  lineItems: unknown;
  trace?: unknown;
};

export type SeparationCause =
  | "resignation"
  | "end_of_contract"
  | "just_cause"
  | "labor_saving_device"
  | "redundancy"
  | "retrenchment"
  | "closure_not_serious_losses"
  | "closure_serious_losses"
  | "disease"
  | "retirement";

function isoDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Invalid date: ${value}`);
  const [year, month, day] = value.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function lineItems(value: unknown): StoredPayrollLine[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const row = raw as Record<string, unknown>;
    const amount = Number(row.amount ?? 0);
    if (!Number.isFinite(amount)) return [];
    return [{
      code: typeof row.code === "string" ? row.code : "",
      label: typeof row.label === "string" ? row.label : "",
      amount,
      notes: Array.isArray(row.notes) ? row.notes.filter((note): note is string => typeof note === "string") : [],
    }];
  });
}

function traceValues(value: unknown) {
  if (!value || typeof value !== "object") return new Map<string, string>();
  const inputs = (value as Record<string, unknown>).inputs;
  if (!Array.isArray(inputs)) return new Map<string, string>();
  const values = new Map<string, string>();
  for (const raw of inputs) {
    if (typeof raw !== "string") continue;
    const separator = raw.indexOf("=");
    if (separator <= 0) continue;
    values.set(raw.slice(0, separator), raw.slice(separator + 1));
  }
  return values;
}

export function thirteenthMonthBasicFromEntry(
  entry: PayrollEntryForFinalPay,
  options?: { eligibleRetroIds?: Set<number> },
) {
  let basic = 0;
  for (const line of lineItems(entry.lineItems)) {
    const code = String(line.code ?? "").toUpperCase();
    const amount = Number(line.amount ?? 0);
    if (code === "BASIC") {
      basic += amount;
      continue;
    }
    if (code.startsWith("LEAVE-") && !code.startsWith("LEAVE_CONV-")) {
      basic += amount;
      continue;
    }
    if (code.startsWith("RETRO-")) {
      const id = Number(code.slice("RETRO-".length));
      if (!options?.eligibleRetroIds || options.eligibleRetroIds.has(id)) basic += amount;
    }
  }
  return round2(Math.max(0, basic));
}

export function thirteenthMonthPaidFromEntry(entry: PayrollEntryForFinalPay) {
  return round2(lineItems(entry.lineItems).reduce((sum, line) => {
    const text = `${line.code ?? ""} ${line.label ?? ""}`.toLowerCase();
    if (!text.includes("13th") && !text.includes("thirteenth")) return sum;
    return sum + Math.max(0, Number(line.amount ?? 0));
  }, 0));
}

export function payrollTaxSummary(entry: PayrollEntryForFinalPay) {
  const values = traceValues(entry.trace);
  const deMinimisPaid = Math.max(0, Number(values.get("deMinimisPaid") ?? 0));
  const deMinimisTaxableExcess = Math.max(0, Number(values.get("deMinimisTaxableExcess") ?? 0));
  let gross = Math.max(0, Number(entry.grossPay ?? 0));
  let thirteenthMonth = 0;
  let statutoryContributions = 0;
  let taxWithheld = 0;
  let otherNonTaxable = 0;

  for (const line of lineItems(entry.lineItems)) {
    const code = String(line.code ?? "").toUpperCase();
    const amount = Number(line.amount ?? 0);
    const text = `${line.code ?? ""} ${line.label ?? ""}`.toLowerCase();
    if (["SSS", "PHIC", "PHILHEALTH", "HDMF", "PAGIBIG", "PAG-IBIG"].includes(code)) {
      statutoryContributions += Math.abs(amount);
      continue;
    }
    if (code === "WHT" || code === "TAX" || text.includes("withholding tax")) {
      taxWithheld += Math.abs(amount);
      continue;
    }
    if (text.includes("13th") || text.includes("thirteenth")) {
      thirteenthMonth += Math.max(0, amount);
      continue;
    }
    if (code.startsWith("EXP-")) {
      otherNonTaxable += Math.max(0, amount);
      continue;
    }
    if (code.startsWith("LEAVE_CONV-") && (line.notes ?? []).some((note) => /exempt/i.test(note))) {
      otherNonTaxable += Math.max(0, amount);
    }
  }

  if (deMinimisPaid > 0) {
    otherNonTaxable += Math.max(0, deMinimisPaid - deMinimisTaxableExcess);
  }

  gross = round2(gross);
  return {
    grossCompensation: gross,
    thirteenthMonth: round2(thirteenthMonth),
    statutoryContributions: round2(statutoryContributions),
    taxWithheld: round2(taxWithheld),
    otherNonTaxable: round2(otherNonTaxable),
  };
}

export function computeThirteenthMonthBalance(input: {
  basicSalaryEarned: number;
  alreadyPaid: number;
  eligible: boolean;
}) {
  if (!input.eligible) {
    return {
      eligible: false,
      basicSalaryEarned: round2(Math.max(0, input.basicSalaryEarned)),
      entitlement: 0,
      alreadyPaid: round2(Math.max(0, input.alreadyPaid)),
      balanceDue: 0,
      overpaid: round2(Math.max(0, input.alreadyPaid)),
    };
  }
  const entitlement = computeThirteenthMonthPay(input.basicSalaryEarned);
  const alreadyPaid = round2(Math.max(0, input.alreadyPaid));
  return {
    eligible: true,
    basicSalaryEarned: round2(Math.max(0, input.basicSalaryEarned)),
    entitlement,
    alreadyPaid,
    balanceDue: round2(Math.max(0, entitlement - alreadyPaid)),
    overpaid: round2(Math.max(0, alreadyPaid - entitlement)),
  };
}

export function roundedYearsOfService(startDate: string, lastDay: string) {
  const start = isoDay(startDate);
  const end = isoDay(lastDay);
  if (end < start) throw new Error("Last day cannot be before the hire date.");

  const startDateUtc = new Date(start);
  const endDateUtc = new Date(end);
  let completedYears = endDateUtc.getUTCFullYear() - startDateUtc.getUTCFullYear();
  const anniversary = Date.UTC(
    endDateUtc.getUTCFullYear(),
    startDateUtc.getUTCMonth(),
    startDateUtc.getUTCDate(),
  );
  if (end < anniversary) completedYears -= 1;
  completedYears = Math.max(0, completedYears);

  const lastAnniversary = Date.UTC(
    startDateUtc.getUTCFullYear() + completedYears,
    startDateUtc.getUTCMonth(),
    startDateUtc.getUTCDate(),
  );
  const nextSixMonths = new Date(lastAnniversary);
  nextSixMonths.setUTCMonth(nextSixMonths.getUTCMonth() + 6);
  return completedYears + (end >= nextSixMonths.getTime() ? 1 : 0);
}

export function computeStatutorySeparationPay(input: {
  cause: SeparationCause;
  monthlyEquivalent: number;
  startDate: string;
  lastDay: string;
}) {
  const monthly = Math.max(0, Number(input.monthlyEquivalent) || 0);
  const years = roundedYearsOfService(input.startDate, input.lastDay);
  const oneMonthMinimum = monthly;

  if (input.cause === "labor_saving_device" || input.cause === "redundancy") {
    return {
      years,
      factorPerYear: 1,
      amount: round2(Math.max(oneMonthMinimum, monthly * Math.max(1, years))),
      basis: "one_month_per_year",
    } as const;
  }

  if (["retrenchment", "closure_not_serious_losses", "disease"].includes(input.cause)) {
    return {
      years,
      factorPerYear: 0.5,
      amount: round2(Math.max(oneMonthMinimum, monthly * 0.5 * Math.max(1, years))),
      basis: "half_month_per_year_with_one_month_floor",
    } as const;
  }

  return { years, factorPerYear: 0, amount: 0, basis: "none" } as const;
}

export function computeStatutoryRetirementPay(input: {
  dailyRate: number;
  startDate: string;
  lastDay: string;
  birthDate: string | null | undefined;
}) {
  const years = roundedYearsOfService(input.startDate, input.lastDay);
  if (!input.birthDate) {
    return { eligible: false, blocker: "Birth date is required to validate statutory retirement eligibility.", years, amount: 0 };
  }
  const birth = isoDay(input.birthDate);
  const last = isoDay(input.lastDay);
  let age = new Date(last).getUTCFullYear() - new Date(birth).getUTCFullYear();
  const birthdayThisYear = Date.UTC(
    new Date(last).getUTCFullYear(),
    new Date(birth).getUTCMonth(),
    new Date(birth).getUTCDate(),
  );
  if (last < birthdayThisYear) age -= 1;

  if (age < 60 || age > 65) {
    return { eligible: false, blocker: "Statutory retirement under Article 302 requires age 60 to 65 unless a better plan or agreement applies.", years, age, amount: 0 };
  }
  if (years < 5) {
    return { eligible: false, blocker: "Statutory retirement under Article 302 requires at least five years of service unless a better plan or agreement applies.", years, age, amount: 0 };
  }
  return {
    eligible: true,
    blocker: null,
    years,
    age,
    amount: round2(Math.max(0, input.dailyRate) * 22.5 * years),
  };
}

export type FinalPayTaxInputs = {
  grossCompensationBeforeFinalPay: number;
  thirteenthMonthPaidBeforeFinalPay: number;
  statutoryContributions: number;
  taxWithheld: number;
  otherNonTaxable: number;
  finalUnpaidBasicSalary: number;
  finalOtherTaxableEarnings: number;
  finalOtherNonTaxableEarnings: number;
  thirteenthMonthBalance: number;
  leaveMonetization: number;
  statutorySeparationPay: number;
  statutoryRetirementPay: number;
  separationPayTaxExempt: boolean;
  retirementPayTaxExempt: boolean;
  mwe: boolean;
};

export function computeFinalPayTaxAdjustment(input: FinalPayTaxInputs): AnnualizationResult {
  const grossCompensation =
    Math.max(0, input.grossCompensationBeforeFinalPay)
    + Math.max(0, input.finalUnpaidBasicSalary)
    + Math.max(0, input.finalOtherTaxableEarnings)
    + Math.max(0, input.finalOtherNonTaxableEarnings)
    + Math.max(0, input.thirteenthMonthBalance)
    + Math.max(0, input.leaveMonetization)
    + Math.max(0, input.statutorySeparationPay)
    + Math.max(0, input.statutoryRetirementPay);

  const otherNonTaxable =
    Math.max(0, input.otherNonTaxable)
    + Math.max(0, input.finalOtherNonTaxableEarnings)
    + (input.separationPayTaxExempt ? Math.max(0, input.statutorySeparationPay) : 0)
    + (input.retirementPayTaxExempt ? Math.max(0, input.statutoryRetirementPay) : 0);

  return annualize({
    grossCompensation,
    thirteenthMonth: Math.max(0, input.thirteenthMonthPaidBeforeFinalPay) + Math.max(0, input.thirteenthMonthBalance),
    statutoryContributions: Math.max(0, input.statutoryContributions),
    taxWithheld: Math.max(0, input.taxWithheld),
    otherNonTaxable,
    mwe: input.mwe,
  });
}

export function finalPayDueDate(lastDay: string) {
  const due = isoDay(lastDay) + 30 * 86_400_000;
  return new Date(due).toISOString().slice(0, 10);
}
