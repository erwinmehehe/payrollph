import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";

const enabled = process.env.PAYROLL_COMBINED_RECOVERY_PROOF_MODE === "disposable-only";
const historyEnabled = process.env.PAYROLL_CALCULATION_HISTORY_ENABLED === "true";
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(url.protocol, "postgresql:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "5432");
  assert.equal(url.username, "postgres");
  assert.equal(url.search + url.hash, "");
  assert.ok(/^\/payroll_intent_\d{8}_[a-f0-9]{8}$/.test(url.pathname) ||
    (url.pathname === "/app_db" && process.env.CI === "true" && process.env.GITHUB_ACTIONS === "true"));
  for (const key of ["PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "RESEND_API_KEY", "SMTP_URL"]) {
    assert.equal(Boolean(process.env[key]), false, key);
  }
  for (const key of ["WORKER_ENABLED", "CENTRAL_SCHEDULER_ENABLED", "PAYMONGO_DISBURSEMENTS_ENABLED", "XENDIT_PAYOUTS_ENABLED"]) {
    assert.notEqual(process.env[key], "true", key);
  }
}

test("PG: lost draft response, same-key replay and expired worker recovery equal uninterrupted payroll", {
  skip: !enabled, timeout: 120_000,
}, async () => {
  const require = createRequire(import.meta.url);
  const authPath = require.resolve("../src/lib/auth");
  const auth = require(authPath);
  let identity: unknown = null;
  require.cache[authPath]!.exports = { ...auth, getSessionUser: async () => identity };
  const { db, pool } = await import("../src/db");
  const s = await import("../src/db/schema");
  const { and, eq, inArray } = await import("drizzle-orm");
  const { enqueuePayrollRun, processNextPayrollJob, PAYROLL_JOB_LEASE_SECONDS } = await import("../src/lib/payroll-engine");
  const post = require("../src/app/api/payroll-runs/route.ts").POST;
  const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
  const previousOrigin = process.env.APP_BASE_URL;
  process.env.APP_BASE_URL = "http://127.0.0.1:3011";
  try {
    const employers = [];
    for (let n = 0; n < 3; n++) {
      const [org] = await db.insert(s.organizations).values({ name: `Fictional recovery ${suffix}-${n}`, legalName: "Fictional only" }).returning();
      const [entity] = await db.insert(s.legalEntities).values({ organizationId: org.id, code: "PRIMARY", legalName: "Fictional only", displayName: "Fictional", primaryEntity: true }).returning();
      const [user] = await db.insert(s.users).values({ email: `combined-${suffix}-${n}@example.invalid`, name: "Fictional owner", role: "owner", passwordHash: "not-a-login" }).returning();
      await db.insert(s.userOrganizations).values({ organizationId: org.id, userId: user.id, role: "owner", active: true });
      const workers = [];
      for (let w = 0; w < 2; w++) {
        const [employee] = await db.insert(s.employees).values({ organizationId: org.id, legalEntityId: entity.id,
          employeeNo: "COMBINED-" + w, firstName: "Fictional", lastName: "Recovery", title: "QA only", avatarInitials: "QA",
          basicRate: "30000", startDate: "2025-01-01", restDay: "Sunday" }).returning();
        await db.insert(s.employeePayProfiles).values({ organizationId: org.id, employeeId: employee.id,
          payBasis: "monthly", rateAmount: "30000", standardWorkDaysPerMonth: "22", standardHoursPerDay: "8" });
        workers.push(employee);
      }
      employers.push({ org, entity, user, workers });
    }
    const [interrupted, control, victim] = employers;
    const body = (employer: typeof interrupted) => ({ organizationId: employer.org.id, legalEntityId: employer.entity.id,
      periodStart: "2026-10-01", periodEnd: "2026-10-15", payDate: "2026-10-15", processNow: false });
    const create = async (employer: typeof interrupted) => {
      identity = employer.user;
      return post(new Request("http://127.0.0.1:3011/api/payroll-runs", { method: "POST", headers: {
        origin: "http://127.0.0.1:3011", "content-type": "application/json", "Idempotency-Key": "combined-recovery-" + suffix,
      }, body: JSON.stringify(body(employer)) }));
    };
    const snapshot = async (orgId: number) => {
      const runIds = db.select({ id: s.payrollRuns.id }).from(s.payrollRuns).where(eq(s.payrollRuns.organizationId, orgId));
      return {
        runs: await db.select().from(s.payrollRuns).where(eq(s.payrollRuns.organizationId, orgId)),
        jobs: await db.select().from(s.payrollJobs).where(eq(s.payrollJobs.organizationId, orgId)),
        entries: await db.select().from(s.payrollEntries).where(inArray(s.payrollEntries.payrollRunId, runIds)),
        history: await db.select().from(s.payrollCalculationHistory).where(eq(s.payrollCalculationHistory.organizationId, orgId)),
        receipts: await db.select().from(s.idempotencyKeys).where(eq(s.idempotencyKeys.organizationId, orgId)),
        audit: await db.select().from(s.auditEvents).where(eq(s.auditEvents.organizationId, orgId)),
      };
    };
    assert.equal((await create(victim)).status, 201);
    const victimBefore = await snapshot(victim.org.id);

    // Deliberately discard the successful body: the caller did not observe its run ID.
    assert.equal((await create(interrupted)).status, 201);
    const afterLostResponse = await snapshot(interrupted.org.id);
    const replay = await create(interrupted);
    assert.equal(replay.status, 200);
    const replayBody = await replay.json();
    const runId = replayBody.run.id;
    assert.equal(replayBody.idempotentReplay, true);
    assert.equal(runId, afterLostResponse.runs[0].id);
    assert.deepEqual(await snapshot(interrupted.org.id), afterLostResponse);
    assert.equal(afterLostResponse.runs.length, 1);
    assert.equal(afterLostResponse.receipts.length, 1);

    await enqueuePayrollRun(runId, 1);
    assert.equal((await processNextPayrollJob("combined-first", runId)).processed, true);
    const first = await snapshot(interrupted.org.id);
    assert.equal(first.entries.length, 1);
    assert.equal(first.history.length, historyEnabled ? 1 : 0);
    // Model death after claiming the remaining chunk; no wall-clock sleep or live worker kill.
    await db.update(s.payrollJobs).set({ status: "processing", lockedBy: "fictional-dead-worker", lockedAt: new Date(), attempts: 2 })
      .where(eq(s.payrollJobs.payrollRunId, runId));
    const claimed = await snapshot(interrupted.org.id);
    assert.equal((await processNextPayrollJob("cannot-steal-fresh", runId)).processed, false);
    assert.deepEqual(await snapshot(interrupted.org.id), claimed);
    assert.equal((await create(interrupted)).status, 200);
    assert.deepEqual(await snapshot(interrupted.org.id), claimed, "Creation retry cannot reset an in-flight payroll job");
    await db.update(s.payrollJobs).set({ lockedAt: new Date(Date.now() - (PAYROLL_JOB_LEASE_SECONDS + 60) * 1000) })
      .where(eq(s.payrollJobs.payrollRunId, runId));
    assert.equal((await processNextPayrollJob("combined-replacement", runId)).processed, true);

    const recovered = await snapshot(interrupted.org.id);
    assert.equal(recovered.runs.length, 1);
    assert.equal(recovered.receipts.length, 1);
    assert.equal(recovered.jobs.length, 1);
    assert.equal(recovered.jobs[0].status, "completed");
    assert.equal(recovered.jobs[0].attempts, 3);
    assert.equal(recovered.runs[0].status, "Needs review");
    assert.equal(recovered.runs[0].processedChunks, 2);
    assert.equal(recovered.entries.length, 2);
    assert.equal(new Set(recovered.entries.map(e => e.employeeId)).size, 2);
    assert.deepEqual(recovered.entries.find(e => e.id === first.entries[0].id), first.entries[0]);
    if (historyEnabled) assert.deepEqual(recovered.history.find(e => e.id === first.history[0].id), first.history[0]);
    assert.equal(recovered.history.length, historyEnabled ? 2 : 0);
    assert.ok(recovered.history.every(h => h.revision === 1));
    const payslips = await db.select().from(s.payslips).where(inArray(s.payslips.payrollEntryId, recovered.entries.map(e => e.id)));
    assert.equal(payslips.length, 2);
    assert.equal(new Set(payslips.map(p => p.payrollEntryId)).size, 2);
    const auditCount = (action: string) => recovered.audit.filter(e => e.action === action).length;
    assert.equal(auditCount("Payroll draft created"), 1);
    assert.equal(auditCount("Payroll worker lease recovered"), 1);
    assert.equal(auditCount("Payroll calculation completed"), 1);

    // Same pay inputs through an uninterrupted actual worker, with distinct identities.
    const controlResponse = await create(control);
    assert.equal(controlResponse.status, 201);
    const controlId = (await controlResponse.json()).run.id;
    await enqueuePayrollRun(controlId, 1);
    for (let n = 0; n < 2; n++) assert.equal((await processNextPayrollJob("combined-control", controlId)).processed, true);
    const baseline = await snapshot(control.org.id);
    const amounts = (entries: typeof recovered.entries) => entries.map(e => ({
      gross: e.grossPay, deductions: e.deductions, net: e.netPay, status: e.status, lineItems: e.lineItems,
    })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    assert.deepEqual(amounts(recovered.entries), amounts(baseline.entries));
    assert.equal(recovered.runs[0].grossPay, baseline.runs[0].grossPay);
    assert.equal(recovered.runs[0].netPay, baseline.runs[0].netPay);
    const cents = (value: string) => BigInt(value.replace(".", ""));
    assert.equal(cents(recovered.runs[0].grossPay), BigInt(3_000_000));
    assert.equal(recovered.entries.reduce((sum, e) => sum + cents(e.grossPay), BigInt(0)), cents(recovered.runs[0].grossPay));
    assert.equal(recovered.entries.reduce((sum, e) => sum + cents(e.netPay), BigInt(0)), cents(recovered.runs[0].netPay));
    for (const entry of recovered.entries) assert.equal(cents(entry.grossPay) - cents(entry.deductions), cents(entry.netPay));
    assert.equal((await processNextPayrollJob("completed-again", runId)).processed, false);
    assert.equal((await create(interrupted)).status, 200);
    assert.deepEqual(await snapshot(interrupted.org.id), recovered, "Completed creation and worker retries are no-ops");
    assert.deepEqual(await snapshot(victim.org.id), victimBefore);
    assert.equal((await db.select().from(s.auditEvents).where(and(eq(s.auditEvents.organizationId, interrupted.org.id),
      eq(s.auditEvents.action, "Payroll calculation completed")))).length, 1);
  } finally {
    require.cache[authPath]!.exports = auth;
    if (previousOrigin === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = previousOrigin;
    await pool.end();
  }
});
