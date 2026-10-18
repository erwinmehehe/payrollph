import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
const require = createRequire(import.meta.url);
const { fixtureClockOffset } = require("../scripts/qa/synthetic-session-clock.cjs");
const { qaCutoff } = require("../scripts/qa/synthetic-month-end.cjs");
const anchor = Date.now();
const fixture = {
  CI: "true", GITHUB_ACTIONS: "true", QA_URL: "http://127.0.0.1:3000",
  APP_BASE_URL: "http://127.0.0.1:3000", DEMO_MODE: "false",
  DATABASE_URL: "postgresql://postgres:fictional@127.0.0.1:5432/app_db",
  NINE_STAGE_SYNTHETIC_CLOCK: qaCutoff(undefined, anchor),
  NINE_STAGE_SYNTHETIC_REAL_ANCHOR: String(anchor),
  PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
  XENDIT_PAYOUTS_LIVE_APPROVED: "false", WFM_PUNCH_EVIDENCE_ENABLED: "false",
  WFM_GEOFENCE_PILOT_ENABLED: "false", FINAL_PAY_MANUAL_RELEASE_ENABLED: "false",
  OPENAI_API_KEY: "", PAYMONGO_SECRET_KEY: "", XENDIT_SECRET_KEY: "",
  NINE_STAGE_CUTOFF_MODE: "month",
};
function preload(patch) {
  return spawnSync(process.execPath, ["--require", "./scripts/qa/isolated-month-end-clock.cjs",
    "-e", "console.log(new Date().toISOString())"], {
    encoding: "utf8", env: { ...process.env, ...fixture, ...patch, NODE_OPTIONS: "" },
    windowsHide: true, timeout: 10000,
  });
}
test("both real clock guards accept only the same loopback canonical HTTPS alias", () => {
  for (const APP_BASE_URL of [fixture.APP_BASE_URL, "https://127.0.0.1:3000"]) {
    assert.ok(Number.isSafeInteger(fixtureClockOffset({ ...fixture, APP_BASE_URL }, anchor)));
    const child = preload({ APP_BASE_URL });
    assert.equal(child.status, 0, child.stderr);
    assert.ok(child.stdout.startsWith(fixture.NINE_STAGE_SYNTHETIC_CLOCK + "T"));
  }
});
test("clock guards reject remote or ambiguous canonical URLs and retain CI, database and provider fences", () => {
  for (const APP_BASE_URL of ["https://fictional-signup.example.test", "https://127.0.0.1:3001",
    "https://127.0.0.1:3000@remote.example.test", "https://localhost:3000"]) {
    assert.throws(() => fixtureClockOffset({ ...fixture, APP_BASE_URL }, anchor));
    assert.notEqual(preload({ APP_BASE_URL }).status, 0);
  }
  for (const patch of [{ CI: "false" }, { GITHUB_ACTIONS: "false" },
    { DATABASE_URL: "postgresql://postgres:fictional@remote.example.test:5432/app_db" },
    { PAYMONGO_SECRET_KEY: "fictional-forbidden" }, { PAYMONGO_DISBURSEMENTS_ENABLED: "true" }]) {
    const env = { ...fixture, APP_BASE_URL: "https://127.0.0.1:3000", ...patch };
    assert.throws(() => fixtureClockOffset(env, anchor));
    assert.notEqual(preload(env).status, 0);
  }
});
