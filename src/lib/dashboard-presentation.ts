import type { PayrollRun } from "@/components/workspace/types";
import { storedMoneyCentavos, verifiedPesosFromCentavos } from "./stored-money-centavos";

/**
 * Read-only presentation of stored payroll figures. Match the strict centavo
 * contract used by Recent Payrolls: no coercion, rounding of sub-centavo
 * values, or plausible-looking money from unsafe numeric inputs.
 */
export function verifiedDashboardAmount(value: unknown): number | null {
  const centavos = storedMoneyCentavos(value);
  return centavos === null ? null : verifiedPesosFromCentavos(centavos);
}

export function dashboardPayrollSummary(
  run: PayrollRun | undefined,
  missingBank: number,
) {
  const moneyStatus = Boolean(run && [
    "Processed", "Needs review", "Pending approval", "Ready for release", "Released",
  ].includes(run.status));
  const gross = moneyStatus ? verifiedDashboardAmount(run?.grossPay) : null;
  const net = moneyStatus ? verifiedDashboardAmount(run?.netPay) : null;
  const calculated = moneyStatus && gross !== null && net !== null &&
    Number.isSafeInteger(run?.employeeCount) && (run?.employeeCount ?? 0) >= 0 &&
    Number.isSafeInteger(run?.exceptions) && (run?.exceptions ?? -1) >= 0;
  return {
    calculated,
    gross: calculated ? gross : null,
    net: calculated ? net : null,
    deductions: calculated && gross !== null && net !== null ? gross - net : null,
    readyForRelease: calculated && run?.status === "Ready for release" &&
      Number.isSafeInteger(run.employeeCount) && run.employeeCount > 0 &&
      missingBank === 0 && run.exceptions === 0,
    released: calculated && run?.status === "Released",
  };
}

export function dashboardMoney(value: number | string | null | undefined) {
  const amount = verifiedDashboardAmount(value);
  if (amount === null) return "—";
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function dashboardDate(value?: string) {
  if (!value) return "Not scheduled";
  // Stored payroll dates are calendar days, not timestamps. Reject invalid
  // dates instead of letting Date normalize (February 30 -> March 2)
  // or letting Intl throw RangeError and break the dashboard.
  if (!/^[1-9]\d{3}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)) {
    return "Date unavailable";
  }
  const day = new Date(value + "T00:00:00+08:00");
  if (!Number.isFinite(day.getTime()) ||
      new Date(day.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10) !== value) {
    return "Date unavailable";
  }
  return new Intl.DateTimeFormat("en-PH", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "Asia/Manila",
  }).format(day);
}
