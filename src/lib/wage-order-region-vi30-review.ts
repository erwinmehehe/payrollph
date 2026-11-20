/**
 * REVIEW-ONLY official-source reference for Western Visayas Wage Order VI-30.
 *
 * DO NOT import into the live wage screening/payroll engine or use this
 * reference to assign an employee's minimum wage/MWE tax class.
 * The source-pinned src/lib/wage-orders.ts is deliberately unchanged until
 * the dependent tenant-isolation proofs are withdrawn and independently
 * renewed. Current production payroll activation is NOT APPROVED.
 *
 * NWPC original: https://nwpc.dole.gov.ph/region-vi/
 * Order: https://nwpc.dole.gov.ph/wp-content/uploads/2026/11/WAGE-ORDER-NO.-VI-WESTERN-VISAYAS-30.pdf
 * Issued 2026-10-21, published 2026-11-04, effective 2026-11-20.
 *
 * These three classes cover the listed private-sector ordinary wage
 * schedules only. Domestic workers, special statutory classifications,
 * individual exemptions, local business size and worker eligibility all
 * require independent verification by a qualified Philippine payroll reviewer.
 */
export type RegionVIPrivateWageClass =
  | "nonagri_gt10"
  | "nonagri_le10"
  | "agriculture";

export const REGION_VI30_SOURCE = Object.freeze({
  authority: "NWPC / RTWPB-VI",
  wageOrder: "WO-RBVI-30",
  issuedOn: "2026-10-21",
  publishedOn: "2026-11-04",
  effectiveOn: "2026-11-20",
  sourceUrl: "https://nwpc.dole.gov.ph/region-vi/",
  orderUrl: "https://nwpc.dole.gov.ph/wp-content/uploads/2026/11/WAGE-ORDER-NO.-VI-WESTERN-VISAYAS-30.pdf",
  precedingWageOrder: "WO-RBVI-29",
  precedingEffectiveOn: "2025-11-19",
});

export const REGION_VI30_REVIEW_TIERS = Object.freeze({
  nonagri_gt10: Object.freeze({
    description: "Non-agriculture/industrial/commercial employer with more than ten workers",
    previousDailyRate: 550,
    newDailyRate: 590,
  }),
  nonagri_le10: Object.freeze({
    description: "Non-agriculture/industrial/commercial employer with ten or fewer workers",
    previousDailyRate: 525,
    newDailyRate: 565,
  }),
  agriculture: Object.freeze({
    description: "Agriculture",
    previousDailyRate: 520,
    newDailyRate: 565,
  }),
});

function exactWorkDate(value: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Region VI wage reference requires an explicit YYYY-MM-DD work date.");
  }
  const date = new Date(value + "T00:00:00Z");
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error("Invalid Region VI wage reference work date.");
  }
  if (value < REGION_VI30_SOURCE.precedingEffectiveOn) {
    throw new Error("No source-verified Region VI category history before 2025-11-19.");
  }
  return value;
}

function requireClass(value: RegionVIPrivateWageClass): RegionVIPrivateWageClass {
  if (!Object.prototype.hasOwnProperty.call(REGION_VI30_REVIEW_TIERS, value)) {
    throw new Error("Verified Region VI private-sector worker and employer classification required.");
  }
  return value;
}

/**
 * Deterministic original-source lookup, NOT the live payroll rate.
 * Supplying a sector category is an input to QA; it does not establish that
 * a real employer/employee actually belongs to the category.
 */
export function regionVIWageReference(
  workDate: string,
  wageClass: RegionVIPrivateWageClass,
) {
  const asOf = exactWorkDate(workDate);
  const group = REGION_VI30_REVIEW_TIERS[requireClass(wageClass)];
  const newOrderApplies = asOf >= REGION_VI30_SOURCE.effectiveOn;
  return Object.freeze({
    region: "VI" as const,
    workDate: asOf,
    wageClass,
    dailyRate: newOrderApplies ? group.newDailyRate : group.previousDailyRate,
    wageOrder: newOrderApplies ? REGION_VI30_SOURCE.wageOrder : REGION_VI30_SOURCE.precedingWageOrder,
    effectiveOn: newOrderApplies ? REGION_VI30_SOURCE.effectiveOn : REGION_VI30_SOURCE.precedingEffectiveOn,
    referenceOnly: true as const,
    independentPayrollReview: "PENDING" as const,
    productionPayrollAccepted: false as const,
  });
}

/** A cutoff crossing November 20 must be split or reviewed by work date. */
export function regionVIWorkPeriodReference(
  start: string,
  end: string,
  wageClass: RegionVIPrivateWageClass,
) {
  const first = regionVIWageReference(start, wageClass);
  const last = regionVIWageReference(end, wageClass);
  if (first.workDate > last.workDate) {
    throw new Error("Region VI work period starts after it ends.");
  }
  return Object.freeze({
    first,
    last,
    effectiveDateChange: first.wageOrder !== last.wageOrder,
    manualWorkDateReviewRequired: first.wageOrder !== last.wageOrder,
    productionPayrollAccepted: false as const,
  });
}

/**
 * Unknown employer class: only a conservative highest-tier *advisory* value.
 * Never call this a legally applicable minimum, or auto-classify a worker.
 */
export function regionVIUnclassifiedReview(workDate: string) {
  const asOf = exactWorkDate(workDate);
  return Object.freeze({
    region: "VI" as const,
    workDate: asOf,
    highestListedDailyRate: asOf >= REGION_VI30_SOURCE.effectiveOn ? 590 : 550,
    employerClassVerified: false as const,
    advisoryOnly: true as const,
    productionPayrollAccepted: false as const,
  });
}
