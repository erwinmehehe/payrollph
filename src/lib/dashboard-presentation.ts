import type { PayrollRun } from "@/components/workspace/types";

export function dashboardPayrollSummary(
  run: PayrollRun | undefined,
  missingBank: number,
) {
  const calculated = Boolean(
    run &&
    [
      "Processed",
      "Needs review",
      "Pending approval",
      "Ready for release",
      "Released",
    ].includes(run.status),
  );
  const gross = calculated ? Number(run!.grossPay) : null;
  const net = calculated ? Number(run!.netPay) : null;
  return {
    calculated,
    gross,
    net,
    deductions: gross !== null && net !== null ? gross - net : null,
    readyForRelease:
      run?.status === "Ready for release" &&
      missingBank === 0 &&
      run.exceptions === 0,
    released: run?.status === "Released",
  };
}

export function dashboardMoney(value: number | string | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 2,
  }).format(Number(value));
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
