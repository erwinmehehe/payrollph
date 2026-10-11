/**
 * Historical WFM plan-vs-recorded-time calibration. This is NOT independent
 * customer demand, model-validation accuracy, timecard approval or payroll.
 * Unknown/flagged attendance is excluded, never interpreted as zero work.
 */
export type LaborCalibrationRow = {
  workDate: string;
  requiredHours: number;
  scheduledHours: number;
  actualHours: number;
  attendanceFlags: readonly string[];
};
export type LaborCalibrationQuality = {
  unmatchedPunchRows?: number;
  roleEvidenceIssues?: readonly string[];
  capabilityEvidenceIssues?: readonly string[];
  absenceEvidenceIssues?: readonly string[];
  siteEvidenceIssues?: readonly string[];
};
export type LaborCalibration = {
  status: "ready" | "insufficient_evidence" | "source_review";
  eligibleRows: number;
  eligibleDates: number;
  excludedRows: number;
  scheduledHours: number | null;
  recordedHours: number | null;
  requiredHours: number | null;
  weightedAbsoluteVariancePercent: number | null;
  meanAbsoluteVarianceHours: number | null;
  signedHoursDifference: number | null;
  observedToRequiredPercent: number | null;
  boundary: string;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const BOUNDARY = "Completed recorded-work variance, not a forecast of customer demand, lateness, attendance misconduct, paid time or a labor compliance decision. Missing/uncertain punch evidence must be reconciled first.";
function validDate(value: string) {
  if (!DATE.test(value)) return false;
  const parsed = new Date(value + "T00:00:00Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function calibrateRecordedWorkAgainstSchedule(input: {
  rows: readonly LaborCalibrationRow[];
  today: string;
  quality?: LaborCalibrationQuality | null;
}): LaborCalibration {
  const invalid = (): LaborCalibration => ({
    status: "source_review", eligibleRows: 0, eligibleDates: 0,
    excludedRows: input.rows.length, scheduledHours: null, recordedHours: null,
    requiredHours: null, weightedAbsoluteVariancePercent: null,
    meanAbsoluteVarianceHours: null, signedHoursDifference: null,
    observedToRequiredPercent: null, boundary: BOUNDARY,
  });
  if (!validDate(input.today) || input.rows.length > 500) return invalid();
  const q = input.quality;
  const sourceIssues = (q?.unmatchedPunchRows ?? 0) > 0 ||
    [q?.roleEvidenceIssues, q?.capabilityEvidenceIssues,
      q?.absenceEvidenceIssues, q?.siteEvidenceIssues]
      .some(items => (items?.length ?? 0) > 0);
  if (sourceIssues) return invalid();

  let excluded = 0;
  const rows: LaborCalibrationRow[] = [];
  const dates = new Set<string>();
  for (const row of input.rows) {
    if (!validDate(row.workDate) || !Array.isArray(row.attendanceFlags) ||
      ![row.requiredHours, row.scheduledHours, row.actualHours].every(
        value => Number.isFinite(value) && value >= 0)) return invalid();
    // Open/future work and missing punch evidence are not observed work.
    if (row.workDate >= input.today || row.attendanceFlags.length > 0 ||
      row.requiredHours <= 0 || row.scheduledHours <= 0 || row.actualHours <= 0) {
      excluded++;
      continue;
    }
    dates.add(row.workDate);
    rows.push(row);
  }
  const base = { eligibleRows: rows.length, eligibleDates: dates.size,
    excludedRows: excluded, boundary: BOUNDARY };
  if (rows.length < 7 || dates.size < 3) return {
    ...base, status: "insufficient_evidence", scheduledHours: null,
    recordedHours: null, requiredHours: null,
    weightedAbsoluteVariancePercent: null,
    meanAbsoluteVarianceHours: null, signedHoursDifference: null,
    observedToRequiredPercent: null,
  };
  const sum = (f: (r: LaborCalibrationRow) => number) => rows.reduce((a, row) => a + f(row), 0);
  const scheduled = sum(r => r.scheduledHours);
  const recorded = sum(r => r.actualHours);
  const required = sum(r => r.requiredHours);
  return { ...base, status: "ready", scheduledHours: round2(scheduled),
    recordedHours: round2(recorded), requiredHours: round2(required),
    weightedAbsoluteVariancePercent: round2(100 * sum(r => Math.abs(r.actualHours - r.scheduledHours)) / scheduled),
    meanAbsoluteVarianceHours: round2(sum(r => Math.abs(r.actualHours - r.scheduledHours)) / rows.length),
    signedHoursDifference: round2(recorded - scheduled),
    observedToRequiredPercent: required > 0 ? round2(100 * recorded / required) : null,
  };
}
