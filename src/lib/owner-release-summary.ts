export type OwnerReleaseChecklistItem = {
  key: string;
  label: string;
  passed: boolean;
  blocking: boolean;
  acknowledgeable?: boolean;
  detail: string;
};

type TraceEntry = {
  trace: unknown;
};

function traceInputs(trace: unknown) {
  if (!trace || typeof trace !== "object") return [];
  const raw = trace as Record<string, unknown>;
  return Array.isArray(raw.inputs)
    ? raw.inputs.filter((item): item is string => typeof item === "string")
    : [];
}

export function employerStatutoryCostFromTrace(entry: TraceEntry) {
  const prefix = "employerStatutoryCost=";
  const raw = traceInputs(entry.trace).find((item) => item.startsWith(prefix));
  if (!raw) return null;
  const value = Number(raw.slice(prefix.length));
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function buildOwnerReleaseSummary(input: {
  runStatus: string;
  grossPay: string | number;
  netPay: string | number;
  entries: TraceEntry[];
  approvalStatus?: string | null;
  checklist?: OwnerReleaseChecklistItem[] | null;
}) {
  const checklist = input.checklist ?? [];
  const hardBlockers = checklist.filter(
    (item) => item.blocking && !item.passed && !item.acknowledgeable,
  );
  const acknowledgementItems = checklist.filter(
    (item) => item.blocking && !item.passed && item.acknowledgeable,
  );

  const employerCosts = input.entries.map(employerStatutoryCostFromTrace);
  const knownEmployerCosts = employerCosts.filter((value): value is number => value !== null);
  const employerCostCoverage = knownEmployerCosts.length;
  const employerStatutoryCost = employerCostCoverage === input.entries.length && input.entries.length > 0
    ? knownEmployerCosts.reduce((sum, value) => sum + value, 0)
    : null;

  const grossPay = Number(input.grossPay);
  const netPay = Number(input.netPay);
  const totalFundingRequirement =
    employerStatutoryCost !== null && Number.isFinite(grossPay)
      ? grossPay + employerStatutoryCost
      : null;

  const approvalStatus = input.approvalStatus ?? "Not submitted";
  const checkerApproved = approvalStatus === "Approved";
  const released = input.runStatus === "Released";
  const canRelease =
    input.runStatus === "Ready for release"
    && checkerApproved
    && hardBlockers.length === 0;

  return {
    grossPay: Number.isFinite(grossPay) ? grossPay : 0,
    netPay: Number.isFinite(netPay) ? netPay : 0,
    employerStatutoryCost,
    employerCostCoverage,
    totalFundingRequirement,
    hardBlockers,
    acknowledgementItems,
    checkerApproved,
    approvalStatus,
    released,
    canRelease,
  };
}
