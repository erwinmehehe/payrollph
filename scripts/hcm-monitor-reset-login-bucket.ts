import assert from "node:assert/strict";
import { asc, sql } from "drizzle-orm";
import { db } from "../src/db";
import { organizations } from "../src/db/schema";

/**
 * TEST-ONLY fixture reset between two independent Chromium acceptance suites.
 *
 * Login rate limiting is deliberately shared across Next.js instances through
 * Postgres. Our two separately authenticated test journeys would otherwise
 * collectively exceed the real 10 attempts/minute cap. Preserve production
 * auth/rate-limit behavior and reset ONLY the IP bucket in the disposable DB.
 */
async function main() {
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.HCM_MONITOR_ACCEPTANCE_MODE, "synthetic-postgres-only");
  assert.equal(process.env.HCM_PROCESS_MONITOR_ENABLED, "true");
  assert.notEqual(process.env.VERCEL, "1");
  assert.equal(process.env.TRUSTED_PROXY_HOPS ?? "", "");
  assert.equal(process.env.OPENAI_API_KEY ?? "", "");
  assert.equal(process.env.APP_BASE_URL, "http://127.0.0.1:3000");
  const dbUrl = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(dbUrl.protocol, "postgresql:");
  assert.equal(dbUrl.hostname, "127.0.0.1");
  assert.equal(dbUrl.port, "5432");
  assert.equal(dbUrl.pathname, "/app_db");

  const employers = await db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .orderBy(asc(organizations.id));
  assert.deepEqual(employers, [
    { id: 1, name: "Monitor Fictional Alpha" },
    { id: 2, name: "Monitor Fictional Beta" },
  ], "Refusing any database without the exact two-employer disposable fixture");

  // With no trusted proxy configured, the real clientIp() implementation
  // intentionally assigns the single conservative "unknown" IP bucket.
  // Never clear per-account limits, user lockouts or any live employer data.
  const cleared = await db.execute(sql`
    delete from rate_limit_hits
    where bucket_key = ${"login:unknown"}
    returning bucket_key
  `);
  assert.ok(cleared.rows.length > 0, "Synthetic sign-in fixture did not create a limiter bucket");
  console.log(JSON.stringify({
    status: "PASS",
    syntheticOnly: true,
    deletedIpBuckets: cleared.rows.length,
    accountLimitersChanged: false,
    authenticationPolicyChanged: false,
    productionAccessed: false,
  }));
}

main().catch((error) => {
  console.error("Disposable HRIS browser limiter reset refused:",
    error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
