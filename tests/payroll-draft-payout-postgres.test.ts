import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";

// Explicit disposable loopback database only. The authentication adapter below
// is a route-level fixture, not proof of browser login or HTTP middleware.
const enabled = process.env.PAYROLL_DRAFT_PROOF_MODE === "disposable-only";
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(url.protocol, "postgresql:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "5432");
  assert.ok(["/app_db", "/payroll_draft_test_20261024"].includes(url.pathname));
  assert.equal(url.username, "postgres");
  assert.equal(url.search, "");
  for (const key of ["PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "XENDIT_PAYOUT_SECRET_KEY", "RESEND_API_KEY", "SMTP_URL", "POSTMARK_SERVER_TOKEN"]) {
    assert.equal(Boolean(process.env[key]), false, key);
  }
  for (const key of ["PAYMONGO_DISBURSEMENTS_ENABLED", "XENDIT_PAYOUTS_ENABLED", "PUBLIC_DEMO_DATA_MODE"]) {
    assert.notEqual(process.env[key], "true", key);
  }
}

test("PG: authorized no-destination draft calculates, but cannot enter approval or release", { skip: !enabled }, async () => {
  const require = createRequire(import.meta.url);
  const authPath = require.resolve("../src/lib/auth.ts");
  const auth = require(authPath);
  let identity: unknown = null;
  require.cache[authPath]!.exports = { ...auth, getSessionUser: async () => identity };
  const { db, pool } = await import("../src/db");
  const s = await import("../src/db/schema");
  const { eq } = await import("drizzle-orm");
  const create = require("../src/app/api/payroll-runs/route.ts").POST;
  const calculateExisting = require("../src/app/api/payroll-runs/[id]/process/route.ts").POST;
  const submit = require("../src/app/api/payroll-runs/[id]/submit-review/route.ts").POST;
  const { buildPayrollReleaseChecklist } = await import("../src/lib/payroll-release-checklist");
  const suffix = randomBytes(8).toString("hex");
  const settings = {
    APP_BASE_URL: "http://127.0.0.1:3011", PUBLIC_SIGNUP_MODE: "disabled",
    PAYROLL_DRAFT_PAYOUT_DEFERRAL_ENABLED: "false",
    PAYROLL_PRE_RUN_READINESS_ENABLED: "false",
  };
  const previous = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
  Object.assign(process.env, settings);
  const orgs: number[] = [], userIds: number[] = [];
  const request = (body: unknown) => new Request("http://127.0.0.1:3011/api/payroll-runs", {
    method: "POST", headers: { origin: "http://127.0.0.1:3011", "content-type": "application/json" }, body: JSON.stringify(body),
  });
  try {
    const [alpha, beta] = await db.insert(s.organizations).values([
      { name: "Fictional draft Alpha " + suffix, legalName: "Fictional Alpha" },
      { name: "Fictional draft Beta " + suffix, legalName: "Fictional Beta" },
    ]).returning();
    orgs.push(alpha.id, beta.id);
    const [entity, foreignEntity] = await db.insert(s.legalEntities).values([
      { organizationId: alpha.id, code: "PRIMARY", legalName: "Fictional Alpha", displayName: "Alpha", primaryEntity: true },
      { organizationId: beta.id, code: "PRIMARY", legalName: "Fictional Beta", displayName: "Beta", primaryEntity: true },
    ]).returning();
    const [maker, checker] = await db.insert(s.users).values([
      { email: `draft-maker-${suffix}@example.invalid`, name: "Fictional maker", role: "owner", passwordHash: "not-a-login" },
      { email: `draft-checker-${suffix}@example.invalid`, name: "Fictional checker", role: "checker", passwordHash: "not-a-login" },
    ]).returning();
    userIds.push(maker.id, checker.id);
    await db.insert(s.userOrganizations).values([
      { organizationId: alpha.id, userId: maker.id, role: "owner", active: true },
      { organizationId: alpha.id, userId: checker.id, role: "checker", active: true },
    ]);
    const [worker, victim] = await db.insert(s.employees).values([
      { organizationId: alpha.id, legalEntityId: entity.id, employeeNo: "DRAFT-A-" + suffix,
        firstName: "Fictional", lastName: "Draft", title: "QA only", avatarInitials: "QA", basicRate: "30000", startDate: "2025-01-01" },
      { organizationId: beta.id, legalEntityId: foreignEntity.id, employeeNo: "DRAFT-B-" + suffix,
        firstName: "Fictional", lastName: "Victim", title: "QA only", avatarInitials: "QB", basicRate: "90000", startDate: "2025-01-01" },
    ]).returning();
    await db.insert(s.employeePayProfiles).values({ employeeId: worker.id, organizationId: alpha.id,
      payBasis: "monthly", rateAmount: "30000", standardWorkDaysPerMonth: "22", standardHoursPerDay: "8" });
    identity = maker;
    const body = { organizationId: alpha.id, legalEntityId: entity.id, periodStart: "2026-10-01", periodEnd: "2026-10-15", payDate: "2026-10-15", processNow: true };
    const rejected = await create(request(body));
    assert.equal(rejected.status, 422);
    assert.equal((await rejected.json()).code, "PAYOUT_DETAILS_REQUIRED");
    assert.equal((await db.select().from(s.payrollRuns).where(eq(s.payrollRuns.organizationId, alpha.id))).length, 0);
    process.env.PAYROLL_DRAFT_PAYOUT_DEFERRAL_ENABLED = "true";
    identity = null;
    assert.equal((await create(request(body))).status, 401);
    identity = maker;
    assert.equal((await create(request({ ...body, organizationId: beta.id, legalEntityId: foreignEntity.id }))).status, 403);
    const created = await create(request(body));
    const payload = await created.json();
    assert.equal(created.status, 201, JSON.stringify(payload));
    assert.equal(payload.payoutReadiness.deferred, true);
    assert.deepEqual(payload.payoutReadiness.missingEmployeeIds, [worker.id]);
    assert.notEqual(payload.run.status, "Released");
    const entries = await db.select().from(s.payrollEntries).where(eq(s.payrollEntries.payrollRunId, payload.run.id));
    assert.equal(entries.length, 1);
    assert.equal(entries[0].employeeId, worker.id);
    assert.equal(Number(entries[0].grossPay), 15000);
    assert.ok(Number(entries[0].netPay) > 0);
    // The same stored calculation succeeds with the new gate OFF, then
    // the strict ON path rejects its unverified sources without claiming the run.
    const beforeStrictGate = (await db.select().from(s.payrollRuns).where(eq(s.payrollRuns.id, payload.run.id)))[0];
    process.env.PAYROLL_PRE_RUN_READINESS_ENABLED = "true";
    const strictRecalculation = await calculateExisting(request({}), { params: Promise.resolve({ id: String(payload.run.id) }) });
    assert.equal(strictRecalculation.status, 422);
    assert.equal((await strictRecalculation.json()).code, "PAYROLL_PRE_RUN_READINESS_BLOCKED");
    assert.deepEqual((await db.select().from(s.payrollRuns).where(eq(s.payrollRuns.id, payload.run.id)))[0], beforeStrictGate);
    assert.deepEqual(await db.select().from(s.payrollEntries).where(eq(s.payrollEntries.payrollRunId, payload.run.id)), entries);
    const checklist = await buildPayrollReleaseChecklist(payload.run.id);
    assert.ok(checklist);
    assert.ok(checklist.assurance?.findings.some(f => f.code === "MISSING_BANK_DETAILS" && f.blocking));
    assert.ok(checklist.items.some(item => item.key === "bank" && item.blocking && !item.passed));
    assert.ok(checklist.items.some(item => item.key === "approval" && !item.passed));
    const selfApproval = await submit(request({ approverUserId: maker.id }), { params: Promise.resolve({ id: String(payload.run.id) }) });
    assert.equal(selfApproval.status, 409);
    assert.match((await selfApproval.json()).error, /different people/);
    const missingBank = await submit(request({ approverUserId: checker.id }), { params: Promise.resolve({ id: String(payload.run.id) }) });
    assert.equal(missingBank.status, 409);
    assert.ok((await missingBank.json()).blockingFindings.some((f: { code: string }) => f.code === "MISSING_BANK_DETAILS"));
    assert.equal((await db.select().from(s.approvalTasks).where(eq(s.approvalTasks.payrollRunId, payload.run.id))).length, 0);
    assert.equal((await db.select().from(s.payrollRuns).where(eq(s.payrollRuns.organizationId, beta.id))).length, 0);
    assert.deepEqual((await db.select().from(s.employees).where(eq(s.employees.id, victim.id)))[0], victim);
    const audit = await db.select().from(s.auditEvents).where(eq(s.auditEvents.organizationId, alpha.id));
    assert.ok(audit.some(e => e.action === "Payroll draft created" && (e.metadata as Record<string, unknown>).payoutSetupDeferred === true));
  } finally {
    require.cache[authPath]!.exports = auth;
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    for (const id of orgs) await db.delete(s.organizations).where(eq(s.organizations.id, id));
    for (const id of userIds) await db.delete(s.users).where(eq(s.users.id, id));
    await pool.end();
  }
});
