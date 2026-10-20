"use strict";
const assert = require("node:assert/strict");
const { qaCutoff, syntheticEpoch } = require("./synthetic-month-end.cjs");

// Disposable fixture only: PostgreSQL defaults must share Node's fictional
// timeline before actual login creates any session. Never rewrite a session.
function fixtureClockOffset(env, realNow = Date.now()) {
  assert.equal(env.CI, "true");
  assert.equal(env.GITHUB_ACTIONS, "true");
  assert.equal(env.QA_URL, "http://127.0.0.1:3000");
  // HTTPS is a canonical-URL alias for production signup checks, never a
  // network destination: QA_URL and the database must still be exact loopback.
  assert.ok([env.QA_URL, "https://127.0.0.1:3000"].includes(env.APP_BASE_URL),
    "Synthetic canonical URL must remain the exact loopback host and port");
  assert.equal(env.DEMO_MODE, "false");
  const url = new URL(env.DATABASE_URL || "https://invalid");
  assert.equal(url.protocol, "postgresql:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "5432");
  assert.equal(url.pathname, "/app_db");
  assert.equal(url.username, "postgres");
  assert.equal(url.search, "");
  assert.equal(url.hash, "");
  for (const key of ["PAYMONGO_DISBURSEMENTS_ENABLED", "XENDIT_PAYOUTS_ENABLED",
    "XENDIT_PAYOUTS_LIVE_APPROVED", "WFM_PUNCH_EVIDENCE_ENABLED",
    "WFM_GEOFENCE_PILOT_ENABLED", "FINAL_PAY_MANUAL_RELEASE_ENABLED"]) {
    assert.equal(env[key], "false", key + " must remain disabled");
  }
  for (const key of ["OPENAI_API_KEY", "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY"])
    if (env[key]) throw new Error("Provider credentials are forbidden in the disposable fixture");
  assert.equal(env.NINE_STAGE_SYNTHETIC_CLOCK, qaCutoff(env.NINE_STAGE_CUTOFF_MODE, realNow));
  const anchor = Number(env.NINE_STAGE_SYNTHETIC_REAL_ANCHOR);
  assert.ok(Number.isSafeInteger(anchor) && realNow >= anchor && realNow - anchor < 30 * 60_000,
    "A fresh shared clock anchor is required");
  const offset = syntheticEpoch(env.NINE_STAGE_SYNTHETIC_CLOCK) - anchor;
  assert.ok(Number.isSafeInteger(offset) && Math.abs(offset) <
    (env.NINE_STAGE_CUTOFF_MODE === "year-end" ? 367 : 32) * 86400000);
  return offset;
}

async function alignEmptySessionClock(client, env, realNow = Date.now()) {
  const offset = fixtureClockOffset(env, realNow);
  await client.query("BEGIN");
  try {
    const identity = await client.query("SELECT current_database() AS name, current_setting('server_version_num')::integer AS version");
    assert.equal(identity.rows[0].name, "app_db");
    assert.ok((identity.rows[0].version >= 160000 && identity.rows[0].version < 170000) ||
      (identity.rows[0].version >= 180000 && identity.rows[0].version < 190000),
      "Only disposable PostgreSQL 16 or PostgreSQL 18 is supported");
    await client.query("LOCK TABLE organizations, users, sessions IN ACCESS EXCLUSIVE MODE");
    const counts = await client.query("SELECT (SELECT count(*) FROM organizations) + (SELECT count(*) FROM users) + (SELECT count(*) FROM sessions) AS records");
    assert.equal(Number(counts.rows[0].records), 0, "Clock preparation requires an empty disposable fixture");
    // offset is a bounded safe integer, never arbitrary SQL or credential data.
    await client.query(`ALTER TABLE sessions ALTER COLUMN created_at SET DEFAULT (clock_timestamp() + ${offset} * interval '1 millisecond')`);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
module.exports = { fixtureClockOffset, alignEmptySessionClock };
if (require.main === module) {
  fixtureClockOffset(process.env);
  const { Client } = require("pg");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  client.connect().then(() => alignEmptySessionClock(client, process.env))
    .then(() => console.log("Empty PG16/18 session clock aligned; no sessions rewritten"))
    .catch(() => { console.error("Disposable session clock preparation failed"); process.exitCode = 1; })
    .finally(() => client.end());
}
