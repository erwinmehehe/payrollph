import type { CompensationBudgetPreview } from "./hcm-compensation-cycle-budget-preview";

/**
 * Hypothetical, read-only client calculation for a sourced compensation form.
 * This cannot reserve a budget, approve a proposal or alter a worker's pay.
 * The authoritative compensation endpoint independently revalidates every
 * input, including effective dates, band applicability, cycle and HR approvals.
 */
export type CompensationWhatIfBand = {
  minimumAnnual: string;
  midpointAnnual: string;
  maximumAnnual: string;
};

export type CompensationWhatIf =
  | { state: "incomplete" | "unavailable"; reason: string; authorizesCompensation: false }
  | {
      state: "ready";
      currentAnnual: number;
      proposedAnnual: number;
      changeAnnual: number;
      changePercent: number | null;
      proposedCompaRatioPercent: number;
      proposedRangePositionPercent: number;
      withinSelectedBand: boolean;
      hasExistingProposal: boolean;
      /**
       * Only populated with an authorized, complete company-wide snapshot.
       * Includes committed and all existing pending proposals plus this new
       * proposed increase. Null when already proposed to avoid double count.
       */
      remainingIfAllProceedAnnual: number | null;
      possibleBudgetOverageAnnual: number | null;
      authorizesCompensation: false;
    };

function amountToCents(value: string): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0") || "0");
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : null;
}

/** JSON numeric source amounts must already have centavo precision. */
function sourceNumberToCents(value: number, allowNegative = false): number | null {
  if (!Number.isFinite(value) || (!allowNegative && value < 0)) return null;
  const scaled = value * 100;
  const cents = Math.round(scaled);
  if (!Number.isSafeInteger(cents) || Math.abs(scaled - cents) > 0.000001) return null;
  return cents;
}

export function previewCompensationProposal(input: {
  currentAnnual: number | null;
  proposedAnnual: string;
  selectedBand: CompensationWhatIfBand | null;
  /** Null when the viewer has restricted scope or the source is unavailable. */
  authorizedCycleBudget: CompensationBudgetPreview | null;
  hasExistingProposal: boolean;
}): CompensationWhatIf {
  if (!input.proposedAnnual.trim()) {
    return { state: "incomplete", reason: "Enter annual pay to preview the proposed change.", authorizesCompensation: false };
  }
  if (!input.selectedBand) {
    return { state: "incomplete", reason: "Select a salary band before comparing the proposal.", authorizesCompensation: false };
  }
  const current = input.currentAnnual == null ? null : sourceNumberToCents(input.currentAnnual);
  const proposed = amountToCents(input.proposedAnnual);
  if (current === null || proposed === null || proposed <= 0) {
    return { state: "unavailable", reason: "Current or proposed annual pay is missing or not a valid centavo amount.", authorizesCompensation: false };
  }
  const minimum = amountToCents(input.selectedBand.minimumAnnual);
  const midpoint = amountToCents(input.selectedBand.midpointAnnual);
  const maximum = amountToCents(input.selectedBand.maximumAnnual);
  if (minimum === null || midpoint === null || maximum === null ||
      midpoint <= 0 || minimum > midpoint || midpoint > maximum || maximum <= minimum) {
    return { state: "unavailable", reason: "The selected salary band does not have a consistent source range.", authorizesCompensation: false };
  }

  const change = proposed - current;
  let remainingIfAllProceedAnnual: number | null = null;
  let possibleBudgetOverageAnnual: number | null = null;
  if (!input.hasExistingProposal && input.authorizedCycleBudget?.state === "available") {
    const remaining = sourceNumberToCents(input.authorizedCycleBudget.remainingAnnual, true);
    const pending = sourceNumberToCents(input.authorizedCycleBudget.pendingAnnual);
    if (remaining !== null && pending !== null) {
      const result = remaining - pending - Math.max(0, change);
      if (Number.isSafeInteger(result)) {
        remainingIfAllProceedAnnual = result / 100;
        possibleBudgetOverageAnnual = Math.max(0, -result) / 100;
      }
    }
  }

  return {
    state: "ready",
    currentAnnual: current / 100,
    proposedAnnual: proposed / 100,
    changeAnnual: change / 100,
    changePercent: current > 0 ? 100 * change / current : null,
    proposedCompaRatioPercent: 100 * proposed / midpoint,
    proposedRangePositionPercent: 100 * (proposed - minimum) / (maximum - minimum),
    withinSelectedBand: proposed >= minimum && proposed <= maximum,
    hasExistingProposal: input.hasExistingProposal,
    remainingIfAllProceedAnnual,
    possibleBudgetOverageAnnual,
    authorizesCompensation: false,
  };
}
