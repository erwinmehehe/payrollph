import type { PayrollRun } from "@/components/workspace/types";

/** Only a recorded numeric amount is money. Never coerce null, blanks or NaN to zero. */
export function verifiedDashboardAmount(value: unknown): number | null {
  if (typeof value !== "number" && !(typeof value === "string" && /^[-+]?\d+(?:\.\d+)?$/.test(value))) {
    return null;
  }
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
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
    maximumFractionDigits: 2,
  }).format(amount);
}

export function dashboardDate(value?: string) {
  if (!value) return "Not scheduled";
  return new Intl.DateTimeFormat("en-PH", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "Asia/Manila",
  }).format(new Date(value + "T00:00:00+08:00"));
}
