import type { PeopleIntelligenceSummary } from "./hcm-people-intelligence";

export type PeopleEvidenceStatus = "verified" | "partial" | "empty-scope";

/** This is *worker-status* coverage, not a blanket certification of every
 * staffing/compensation/recruiting metric in the report. */
export function describePeopleEvidenceCoverage(
  coverage: PeopleIntelligenceSummary["coverage"],
): { status: PeopleEvidenceStatus; label: string; detail: string } {
  if (coverage.eligible === 0) {
    return { status: "empty-scope", label: "No eligible workers in this scope",
      detail: "No worker-status records were eligible in the selected scope. This does not establish company-wide headcount or completeness." };
  }
  if (coverage.unverified > 0 || coverage.verified !== coverage.eligible) {
    return { status: "partial", label: "Partial coverage",
      detail: coverage.verified + " of " + coverage.eligible + " eligible worker-status records verified. " +
        "Unverified records are not treated as zero, and affected aggregates must be withheld." };
  }
  return { status: "verified", label: "Worker-status coverage verified",
    detail: coverage.verified + " of " + coverage.eligible +
      " eligible worker-status records verified for this date. Other metrics have independent source limits." };
}
