import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import { organizations, payrollRuns, payoutBatches, users, userOrganizations } from "../src/db/schema";

const require = createRequire(import.meta.url);

test("actual payout export route denies foreign employer before revealing its Xendit claim", async () => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.pathname, "/app_db");
  const [own, foreign] = await db.insert(organizations).values([
    { name: "Synthetic 813 caller employer", legalName: "Synthetic 813 caller employer" },
    { name: "Synthetic 813 private employer", legalName: "Synthetic 813 private employer" },
  ]).returning();
  const [user] = await db.insert(users).values({ email: `qa-813-${randomUUID()}@example.test`,
    name: "Synthetic Payroll Operator", passwordHash: "synthetic-unused-login", role: "payroll" }).returning();
  await db.insert(userOrganizations).values({ organizationId: own.id, userId: user.id, role: "payroll", active: true });
  const [run] = await db.insert(payrollRuns).values({ organizationId: foreign.id,
    periodLabel: "Synthetic private payout", periodStart: "2026-10-01", periodEnd: "2026-10-15",
    payDate: "2026-10-15", status: "Released", grossPay: "1.00", netPay: "1.00" }).returning();
  await db.insert(payoutBatches).values({ organizationId: foreign.id, payrollRunId: run.id,
    provider: "xendit", idempotencyKey: `qa-813-${randomUUID()}`, requestHash: "a".repeat(64),
    transferCount: 1, totalAmountCents: 100, status: "prepared" });
  // Mock only the framework's session adapter. Tenant permissions and ledger
  // reads remain the real production route and real disposable PostgreSQL.
  const authPath = require.resolve("../src/lib/auth");
  const originalAuth = require(authPath);
  let caller: typeof user | null = null;
  const cache = require.cache[authPath]!;
  cache.exports = { ...originalAuth, getSessionUser: async () => caller };
  const beforeOrigin = process.env.TRUSTED_APP_ORIGINS;
  process.env.TRUSTED_APP_ORIGINS = "http://127.0.0.1:3000";
  try {
    const { POST } = await import("../src/app/api/payroll-runs/[id]/exports/route");
    const request = () => new Request(`http://127.0.0.1:3000/api/payroll-runs/${run.id}/exports`, {
      method: "POST", headers: { origin: "http://127.0.0.1:3000", "content-type": "application/json" },
      body: JSON.stringify({ mode: "preflight" }),
    });
    assert.equal((await POST(request(), { params: Promise.resolve({ id: String(run.id) }) })).status, 401);
    caller = user;
    const denied = await POST(request(), { params: Promise.resolve({ id: String(run.id) }) });
    assert.equal(denied.status, 403);
    const body = await denied.text();
    assert.doesNotMatch(body, /xendit|ledger|providerConfigured|blockers/i);
    const [batch] = await db.select().from(payoutBatches).where(eq(payoutBatches.payrollRunId, run.id));
    assert.equal(batch.status, "prepared", "Denied request cannot change a payout claim");
  } finally {
    cache.exports = originalAuth;
    if (beforeOrigin === undefined) delete process.env.TRUSTED_APP_ORIGINS;
    else process.env.TRUSTED_APP_ORIGINS = beforeOrigin;
    await db.delete(payoutBatches).where(eq(payoutBatches.payrollRunId, run.id));
    await db.delete(payrollRuns).where(eq(payrollRuns.id, run.id));
    await db.delete(organizations).where(inArray(organizations.id, [own.id, foreign.id]));
    await db.delete(users).where(eq(users.id, user.id));
  }
});
