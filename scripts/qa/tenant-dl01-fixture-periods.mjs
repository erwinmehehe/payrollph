/**
 * DL-01: non-overlapping, fictional released payroll cutoffs for the two
 * independent payout action paths. No DB access or provider interaction.
 * PostgreSQL 0089 enforces non-overlapping Released runs for an employer,
 * legal entity and organization scope; the proof must not bypass that gate.
 */
const RELEASED_WINDOWS = Object.freeze({
  PROVIDER: Object.freeze({
    periodStart: "2026-05-01", periodEnd: "2026-05-15", payDate: "2026-05-16",
  }),
  MANUAL: Object.freeze({
    periodStart: "2026-05-16", periodEnd: "2026-05-31", payDate: "2026-06-01",
  }),
});

export function releasedFixturePeriod(suffix) {
  if (suffix !== "PROVIDER" && suffix !== "MANUAL") {
    throw new Error("DL01_UNEXPECTED_RELEASED_FIXTURE_KIND");
  }
  return RELEASED_WINDOWS[suffix];
}
