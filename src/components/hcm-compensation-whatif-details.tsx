"use client";

import type { CompensationWhatIf } from "@/lib/hcm-compensation-proposal-whatif";

const money = (value: number) => new Intl.NumberFormat("en-PH", {
  style: "currency", currency: "PHP", minimumFractionDigits: 2, maximumFractionDigits: 2,
}).format(value);
const pct = (value: number) => value.toFixed(1) + "%";

/** Presentation-only: never render company-wide budget to a restricted role. */
export function HcmCompensationWhatIfDetails({
  impact, companyWide,
}: { impact: CompensationWhatIf; companyWide: boolean }) {
  return (
    <div className="notice notice-slate" role="status" aria-live="polite"
      data-hcm-compensation-whatif={impact.state}
      style={{ margin: 0, display: "grid", gap: 6 }}>
      <strong>Proposed salary impact · read-only what-if</strong>
      {impact.state === "ready" ? (
        <>
          <span>
            Current {money(impact.currentAnnual)} → proposed {money(impact.proposedAnnual)}
            {" · "}change {impact.changeAnnual > 0 ? "+" : ""}{money(impact.changeAnnual)}
            {impact.changePercent !== null && <> ({pct(impact.changePercent)})</>}
          </span>
          <span>
            Proposed compa-ratio {pct(impact.proposedCompaRatioPercent)}
            {" · "}salary-band position {pct(impact.proposedRangePositionPercent)}
          </span>
          {!impact.withinSelectedBand && (
            <strong>The proposed salary is outside the selected band&apos;s recorded range.
              The server must independently verify eligibility and applicable band.</strong>
          )}
          {impact.hasExistingProposal && (
            <strong>This worker already has an in-flight or applied proposal in the selected cycle.
              Review the existing source record; no additional budget estimate is shown.</strong>
          )}
          {companyWide && impact.remainingIfAllProceedAnnual !== null && (
            <span>
              Hypothetical pool remaining if existing pending proposals and this new increase all proceed:
              {" "}{money(impact.remainingIfAllProceedAnnual)}
            </span>
          )}
          {companyWide && impact.possibleBudgetOverageAnnual !== null &&
              impact.possibleBudgetOverageAnnual > 0 && (
            <strong>
              Potential budget excess: {money(impact.possibleBudgetOverageAnnual)}.
              Independent HR/Finance and source checks are still required.
            </strong>
          )}
          {companyWide && impact.remainingIfAllProceedAnnual === null && (
            <span>Full budget estimate unavailable or an existing worker proposal needs review.</span>
          )}
          {!companyWide && (
            <span>Company-wide compensation budget totals are not available in your role&apos;s view.</span>
          )}
        </>
      ) : <span>{impact.reason}</span>}
      <small>
        This provisional comparison reflects currently loaded records, not effective-dated
        pay authority, band eligibility, budget reservation, HR/Finance approval or a payroll
        instruction. The server checks the current evidence again on submission and decision.
      </small>
    </div>
  );
}
