"use client";

import { useMemo } from "react";
import { CalendarClock, Clock3, UsersRound } from "lucide-react";
import {
  calibrateRecordedWorkAgainstSchedule,
  type LaborCalibrationRow,
  type LaborCalibrationQuality,
} from "@/lib/workforce-labor-calibration";
import { Metric } from "./ui";

/** Authorized scope and evidence are owned by the existing coverage API. */
export function WorkforceLaborCalibrationPanel({
  labor, today, loading, onReviewHistory,
}: {
  labor: { rows: LaborCalibrationRow[]; quality: LaborCalibrationQuality } | null | undefined;
  today: string;
  loading: boolean;
  onReviewHistory: () => void;
}) {
  const result = useMemo(() => calibrateRecordedWorkAgainstSchedule({
    rows: labor?.rows ?? [], today, quality: labor?.quality,
  }), [labor?.rows, labor?.quality, today]);

  return (
    <section data-wfm-labor-calibration style={{ padding: "0 18px 18px" }}>
      <article className="card" style={{ margin: 0 }}>
        <div className="card-header">
          <div>
            <div className="card-kicker">Historical recorded-time calibration · read only</div>
            <h3>Where did scheduled hours differ from recorded work?</h3>
            <p>Compare completed scheduled shifts with recorded hours. This is not a prediction of customer demand or verified pay.</p>
          </div>
          <button type="button" className="secondary-button" disabled={loading} onClick={onReviewHistory}>
            Review previous 14 days
          </button>
        </div>
        <div className="notice notice-slate" style={{ margin: "0 18px 16px" }}>{result.boundary}</div>
        {result.status === "ready" ? (
          <section className="stats-grid" style={{ padding: "0 18px 18px" }}>
            <Metric label="Compared work dates" value={String(result.eligibleDates)}
              hint={result.eligibleRows + " complete requirement rows"} icon={<CalendarClock size={16} />} tone="slate"/>
            <Metric label="Recorded vs scheduled absolute variance"
              value={result.weightedAbsoluteVariancePercent!.toFixed(1) + "%"}
              hint="weighted by scheduled hours" icon={<UsersRound size={16} />} tone="blue"/>
            <Metric label="Recorded minus planned hours"
              value={result.signedHoursDifference!.toFixed(2) + "h"}
              hint="source variance, not payroll" icon={<Clock3 size={16} />} tone="slate"/>
          </section>
        ) : <div className="notice notice-amber" role="status" style={{ margin: "0 18px 18px" }}>
          {result.status === "source_review"
            ? "Reconcile source exceptions first; missing, malformed or unmatched punches cannot support calibration."
            : "At least seven complete past requirement rows across three work dates are required. Review a completed two-week window."}
        </div>}
        <p className="id" style={{ padding: "0 18px 18px" }}>
          {result.eligibleRows} comparable completed row(s); {result.excludedRows} excluded as future, incomplete or uncertain. No automated pay or attendance action is taken.
        </p>
      </article>
    </section>
  );
}
