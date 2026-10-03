import type { ExplainPayModel } from "@/lib/payroll-explain";

export type PayrollVarianceCategory =
  | "exception"
  | "salary_change"
  | "overtime_spike"
  | "retro"
  | "new_hire"
  | "new_to_run"
  | "separation"
  | "missing_from_run"
  | "bank_details"
  | "statutory"
  | "net_variance";

const statutoryCodes = new Set([
  "SSS",
  "PHIC",
  "PHILHEALTH",
  "HDMF",
  "HDMF_VOL",
  "PAGIBIG",
  "PAG-IBIG",
  "WHT",
  "TAX",
]);

export function classifyPayrollVariance(input: {
  explanation: ExplainPayModel;
  currentStatus?: string | null;
  employeeStatus?: string | null;
  hasCurrentEntry: boolean;
  hasPreviousEntry: boolean;
  hasPayRevision: boolean;
  isNewHire: boolean;
  bankDetailsChanged: boolean;
}): PayrollVarianceCategory[] {
  const {
    explanation,
    currentStatus,
    employeeStatus,
    hasCurrentEntry,
    hasPreviousEntry,
    hasPayRevision,
    isNewHire,
    bankDetailsChanged,
  } = input;

  const categories = new Set<PayrollVarianceCategory>();
  const changedLines = explanation.lines.filter((line) => Math.abs(line.netEffectDelta ?? 0) >= 0.01);

  if (currentStatus === "Exception") categories.add("exception");
  if (hasPayRevision || Number(explanation.context.effectivePayChanges ?? 0) > 0) categories.add("salary_change");

  const overtime = explanation.lines.find((line) => line.code === "OT");
  if (overtime && overtime.delta != null && overtime.delta > 0) {
    const prior = overtime.previous ?? 0;
    const increase = overtime.delta;
    // A checker-facing "spike" should be meaningful, not every tiny OT change.
    // Flag either a >=50% increase versus prior OT, or >=PHP 500 when prior OT was zero.
    if ((prior > 0 && overtime.current >= prior * 1.5) || (prior === 0 && increase >= 500)) {
      categories.add("overtime_spike");
    }
  }

  if (
    explanation.lines.some((line) => line.code.startsWith("RETRO-") && line.current > 0) ||
    Number(explanation.context.retroPay ?? 0) > 0 ||
    Number(explanation.context.retroAdjustments ?? 0) > 0
  ) {
    categories.add("retro");
  }

  if (isNewHire) categories.add("new_hire");
  else if (hasCurrentEntry && !hasPreviousEntry) categories.add("new_to_run");

  const inactive = Boolean(employeeStatus && !/^active$/i.test(employeeStatus));
  if (!hasCurrentEntry && hasPreviousEntry) {
    categories.add(inactive ? "separation" : "missing_from_run");
  } else if (inactive && hasCurrentEntry) {
    categories.add("separation");
  }

  if (bankDetailsChanged) categories.add("bank_details");
  if (changedLines.some((line) => statutoryCodes.has(line.code))) categories.add("statutory");
  if (explanation.netDelta != null && Math.abs(explanation.netDelta) >= 0.01) categories.add("net_variance");

  return [...categories];
}
