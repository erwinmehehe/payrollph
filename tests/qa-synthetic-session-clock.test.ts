import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { eq } from "drizzle-orm";
import { users, sessions } from "../src/db/schema";
import { spendIsolatedDatabase } from "./helpers/spend-isolated-database";
const { alignEmptySessionClock } = createRequire(import.meta.url)("../scripts/qa/synthetic-session-clock.cjs");

test("real session creation shares the synthetic PG clock without rewriting sessions or auth limits", async () => {
  const fixture = await spendIsolatedDatabase();
  const client = await fixture.pool.connect();
  const RealDate = Date;
  const anchor = RealDate.parse("2026-10-14T08:00:00Z");
  const offset = 17 * 86400000;
  const env = { CI: "true", GITHUB_ACTIONS: "true", QA_URL: "http://127.0.0.1:3000",
    APP_BASE_URL: "http://127.0.0.1:3000", DEMO_MODE: "false",
    DATABASE_URL: "postgresql://postgres:fictional@127.0.0.1:5432/app_db",
    NINE_STAGE_SYNTHETIC_CLOCK: "2026-10-31", NINE_STAGE_SYNTHETIC_REAL_ANCHOR: String(anchor),
    PAYMONGO_DISBURSEMENTS_ENABLED: "false", XENDIT_PAYOUTS_ENABLED: "false",
    XENDIT_PAYOUTS_LIVE_APPROVED: "false", WFM_PUNCH_EVIDENCE_ENABLED: "false",
    WFM_GEOFENCE_PILOT_ENABLED: "false", FINAL_PAY_MANUAL_RELEASE_ENABLED: "false" };
  try {
    globalThis.Date = new Proxy(RealDate, {
      construct(target, args, newTarget) {
        return Reflect.construct(target, args.length ? args : [RealDate.now() + offset], newTarget);
      },
      get(target, key, receiver) {
        return key === "now" ? () => RealDate.now() + offset : Reflect.get(target, key, receiver);
      },
    });
    const { createSession } = await import("../src/lib/auth");
    const { effectiveSessionPolicyForUser } = await import("../src/lib/enterprise-session");
    const [user] = await fixture.db.insert(users).values({ name: "Fictional clock actor",
      email: "clock@example.test", passwordHash: "fixture", role: "employee" }).returning();
    await createSession(user.id);
    const [before] = await fixture.db.select().from(sessions).where(eq(sessions.userId, user.id));
    const policy = await effectiveSessionPolicyForUser(user.id);
    assert.ok(Date.now() - before.createdAt.getTime() > policy.maxHours * 3600000,
      "Reproduce the session-age failure from real PG default vs virtual application clock");
    await assert.rejects(() => alignEmptySessionClock(client, env, anchor), /empty disposable fixture/);
    await fixture.db.delete(users).where(eq(users.id, user.id));
    await alignEmptySessionClock(client, env, anchor);
    const [freshUser] = await fixture.db.insert(users).values({ name: "Fictional clock actor",
      email: "clock@example.test", passwordHash: "fixture", role: "employee" }).returning();
    const issued = await createSession(freshUser.id);
    const [after] = await fixture.db.select().from(sessions).where(eq(sessions.userId, freshUser.id));
    assert.ok(Math.abs(Date.now() - after.createdAt.getTime()) < 5000);
    assert.ok(Math.abs(after.lastSeenAt!.getTime() - after.createdAt.getTime()) < 5000);
    assert.equal(after.expiresAt.getTime(), issued.expiresAt.getTime());
    assert.ok(issued.token.length > 20, "Actual authentication creates the opaque token");
    assert.notEqual(after.tokenHash, issued.token);
    assert.deepEqual(await effectiveSessionPolicyForUser(freshUser.id), policy,
      "Production maximum/idle/MFA/active-session policies remain unchanged");
    await assert.rejects(() => alignEmptySessionClock(client, env, anchor), /empty disposable fixture/);
    const [unchanged] = await fixture.db.select().from(sessions).where(eq(sessions.id, after.id));
    assert.deepEqual(unchanged, after, "A populated session is never rewritten");
  } finally {
    globalThis.Date = RealDate;
    client.release();
    await fixture.close();
  }
});
