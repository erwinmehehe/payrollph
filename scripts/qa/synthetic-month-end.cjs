"use strict";

/**
 * The CI-only connected-payroll scenario must use a *current* Manila month-end.
 * A permanently hard-coded historical cutoff can make a genuine signed login
 * cookie expire in Chromium's real-time cookie store even while Node uses a
 * simulated clock. This chooses the end of the CURRENT Manila calendar month
 * without weakening or overriding any server/browser auth controls.
 */
const RealDate = Date;

function manilaMonthEnd(nowEpochMs = RealDate.now()) {
  if (!Number.isFinite(nowEpochMs)) throw new Error("Invalid wall clock");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila", year: "numeric", month: "numeric",
  }).formatToParts(new RealDate(nowEpochMs));
  const year = Number(parts.find(p => p.type === "year")?.value);
  const month = Number(parts.find(p => p.type === "month")?.value);
  if (!Number.isSafeInteger(year) || year < 2020
      || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("Cannot resolve current Manila month");
  }
  // Date.UTC month arguments are zero-indexed: day zero of the following
  // month gives the final calendar day of this Manila month.
  return new RealDate(RealDate.UTC(year, month, 0)).toISOString().slice(0, 10);
}

function syntheticEpoch(clockDate) {
  if (typeof clockDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(clockDate)) {
    throw new Error("Synthetic cutoff must be a YYYY-MM-DD date");
  }
  const ms = RealDate.parse(clockDate + "T08:00:00.000Z"); // 16:00 PH
  if (!Number.isFinite(ms) ||
      new RealDate(RealDate.UTC(
        Number(clockDate.slice(0, 4)),
        Number(clockDate.slice(5, 7)),
        0,
      )).toISOString().slice(0, 10) !== clockDate) {
    throw new Error("Synthetic cutoff must be a real Manila calendar month-end");
  }
  return ms;
}

if (require.main === module) {
  process.stdout.write(manilaMonthEnd() + "\n");
}
module.exports = { manilaMonthEnd, syntheticEpoch };
