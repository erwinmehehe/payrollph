"use strict";
/**
 * #853 isolated-only calendar control. No application code or production flag
 * is changed. Only the local CI app and connected test process preload this.
 * Web Bundy still creates actual application punch records via authenticated
 * HTTP, but their timestamps are synthetic current-Manila-month-end values.
 */
const RealDate = Date;
const { qaCutoff, syntheticEpoch } = require("./synthetic-month-end.cjs");
const env = process.env;
const db = new URL(env.DATABASE_URL || "postgresql://invalid:invalid@invalid/invalid");
if (
  env.CI !== "true" || env.GITHUB_ACTIONS !== "true"
  || env.NINE_STAGE_SYNTHETIC_CLOCK !== qaCutoff(env.NINE_STAGE_CUTOFF_MODE, RealDate.now())
  || env.QA_URL !== "http://127.0.0.1:3000"
  // Only the canonical scheme may differ for production signup validation.
  // All actual network clients remain pinned to the HTTP loopback QA_URL.
  || !["http://127.0.0.1:3000", "https://127.0.0.1:3000"].includes(env.APP_BASE_URL)
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

// 16:00 Philippine time on the fictional final monthly cutoff. GitHub CI
// supplies one fresh wall-clock anchor shared by the app and Chromium. Keep
// server time monotonic (hrtime) but align its initial offset to that anchor;
// otherwise React would hydrate virtual-month-end HTML against real-time browser HTML.
const epoch = syntheticEpoch(env.NINE_STAGE_SYNTHETIC_CLOCK);
const realAnchor = Number(env.NINE_STAGE_SYNTHETIC_REAL_ANCHOR);
const anchorAgeMs = RealDate.now() - realAnchor;
if (!Number.isSafeInteger(realAnchor) || anchorAgeMs < 0 || anchorAgeMs > 30 * 60_000) {
  throw new Error("Isolated virtual month-end clock requires a fresh shared CI anchor");
}
const start = process.hrtime.bigint();
const now = () => epoch + anchorAgeMs + Number((process.hrtime.bigint() - start) / 1000000n);
// Preserve Date()'s callable form, Date.parse/UTC, instanceof checks and
// constructor overloads. Only no-argument construction and now() are virtual.
globalThis.Date = new Proxy(RealDate, {
  apply() {
    return new RealDate(now()).toString();
  },
  construct(target, args, newTarget) {
    return Reflect.construct(target, args.length === 0 ? [now()] : args, newTarget);
  },
  get(target, key, receiver) {
    return key === "now" ? now : Reflect.get(target, key, receiver);
  },
});
