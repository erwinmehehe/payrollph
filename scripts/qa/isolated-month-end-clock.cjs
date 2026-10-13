"use strict";
/**
 * #853 isolated-only calendar control. No application code or production flag
 * is changed. Only the local CI app and connected test process preload this.
 * Web Bundy still creates actual application punch records via authenticated
 * HTTP, but they are explicitly synthetic September 30 timestamps.
 */
const RealDate = Date;
const env = process.env;
const db = new URL(env.DATABASE_URL || "postgresql://invalid:invalid@invalid/invalid");
if (
  env.CI !== "true" || env.GITHUB_ACTIONS !== "true"
  || env.NINE_STAGE_SYNTHETIC_CLOCK !== "2026-09-30"
  || env.QA_URL !== "http://127.0.0.1:3000"
  || env.APP_BASE_URL !== "http://127.0.0.1:3000"
  || env.DEMO_MODE !== "false"
  || db.protocol !== "postgresql:"
  || db.hostname !== "127.0.0.1"
  || db.port !== "5432"
  || db.pathname !== "/app_db"
  || env.PAYMONGO_DISBURSEMENTS_ENABLED !== "false"
  || env.XENDIT_PAYOUTS_ENABLED !== "false"
  || env.XENDIT_PAYOUTS_LIVE_APPROVED !== "false"
  || env.PAYMONGO_SECRET_KEY || env.XENDIT_SECRET_KEY
) throw new Error("Isolated virtual month-end clock refused non-disposable environment");

// 16:00 Philippine time on the fictional final monthly cutoff.
// Advance monotonically so rate limits, timestamps and session expiry continue
// behaving as intervals, instead of freezing time or replaying static IDs.
const epoch = RealDate.parse("2026-09-30T08:00:00.000Z");
const start = process.hrtime.bigint();
const now = () => epoch + Number((process.hrtime.bigint() - start) / 1000000n);
class IsolatedQADate extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(now());
    else super(...args);
  }
  static now() { return now(); }
}
globalThis.Date = IsolatedQADate;
