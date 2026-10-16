import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { manilaMonthEnd, syntheticEpoch, qaCutoff } =
  require("../scripts/qa/synthetic-month-end.cjs");

test("annual journey explicitly selects this Manila year's December cutoff; default is unchanged", () => {
  const now = Date.parse("2026-10-14T08:00:00Z");
  assert.equal(qaCutoff(undefined, now), manilaMonthEnd(now));
  assert.equal(qaCutoff("month", now), "2026-10-31");
  assert.equal(qaCutoff("year-end", now), "2026-12-31");
  assert.equal(qaCutoff("year-end", Date.parse("2026-12-31T16:01:00Z")), "2027-12-31");
  assert.throws(() => qaCutoff("2025-12-31", now), /Unsupported/);
});

test("annual session offset still refuses non-QA targets and provider credentials", () => {
  const { fixtureClockOffset } = require("../scripts/qa/synthetic-session-clock.cjs");
  const now = Date.parse("2026-01-02T08:00:00Z");
  const env = { CI: "true", GITHUB_ACTIONS: "true", QA_URL: "http://127.0.0.1:3000",
    APP_BASE_URL: "http://127.0.0.1:3000", DEMO_MODE: "false",
    DATABASE_URL: "postgresql://postgres:fixture@127.0.0.1:5432/app_db",
    NINE_STAGE_CUTOFF_MODE: "year-end", NINE_STAGE_SYNTHETIC_CLOCK: "2026-12-31",
    NINE_STAGE_SYNTHETIC_REAL_ANCHOR: String(now), PAYMONGO_DISBURSEMENTS_ENABLED: "false",
    XENDIT_PAYOUTS_ENABLED: "false", XENDIT_PAYOUTS_LIVE_APPROVED: "false",
    WFM_PUNCH_EVIDENCE_ENABLED: "false", WFM_GEOFENCE_PILOT_ENABLED: "false", FINAL_PAY_MANUAL_RELEASE_ENABLED: "false" };
  assert.equal(fixtureClockOffset(env, now), syntheticEpoch("2026-12-31") - now);
  for (const bad of [{ CI: "false" }, { GITHUB_ACTIONS: "false" }, { DEMO_MODE: "true" },
    { DATABASE_URL: "postgresql://postgres:fixture@remote.example:5432/app_db" },
    { DATABASE_URL: "postgresql://postgres:fixture@127.0.0.1:5432/customer" },
    { NINE_STAGE_SYNTHETIC_CLOCK: "2025-12-31" }, { NINE_STAGE_SYNTHETIC_CLOCK: "2027-12-31" },
    { NINE_STAGE_CUTOFF_MODE: "unknown" }, { NINE_STAGE_SYNTHETIC_REAL_ANCHOR: String(now-1800001) },
    { PAYMONGO_SECRET_KEY: "forbidden" }, { XENDIT_PAYOUTS_ENABLED: "true" }])
    assert.throws(() => fixtureClockOffset({ ...env, ...bad }, now));
});

test("CI month-end is current Manila month, including UTC date rollover", () => {
  assert.equal(manilaMonthEnd(Date.parse("2026-10-14T08:00:00Z")), "2026-10-31");
  assert.equal(manilaMonthEnd(Date.parse("2026-10-31T15:59:00Z")), "2026-10-31");
  assert.equal(manilaMonthEnd(Date.parse("2026-10-31T16:01:00Z")), "2026-11-30");
  assert.equal(manilaMonthEnd(Date.parse("2026-12-31T16:01:00Z")), "2027-01-31");
  assert.equal(manilaMonthEnd(Date.parse("2024-02-14T09:00:00Z")), "2024-02-29");
  assert.equal(manilaMonthEnd(Date.parse("2026-02-14T09:00:00Z")), "2026-02-28");
});
test("only real final cutoffs can become the 16:00 Asia/Manila synthetic clock", () => {
  assert.equal(new Date(syntheticEpoch("2026-10-31")).toISOString(),
    "2026-10-31T08:00:00.000Z");
  assert.equal(new Date(syntheticEpoch("2024-02-29")).toISOString(),
    "2024-02-29T08:00:00.000Z");
  for (const date of ["2026-02-29", "2026-10-30", "2026-11-31",
    "2026-10-00", "2026-13-31", "not-a-date", "2026-10-31T08:00Z"]) {
    assert.throws(() => syntheticEpoch(date), /month-end|YYYY-MM-DD/);
  }
});
test("malformed wall-clock inputs are not treated as payroll cutoffs", () => {
  assert.throws(() => manilaMonthEnd(NaN), /Invalid wall clock/);
  assert.throws(() => manilaMonthEnd(Infinity), /Invalid wall clock/);
});
