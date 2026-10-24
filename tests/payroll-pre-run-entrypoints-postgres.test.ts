import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";

const enabled = process.env.PAYROLL_PRE_RUN_PROOF_MODE === "disposable-only";
if (enabled) {
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.protocol, "postgresql:");
  assert.equal(url.port, "5432");
  assert.ok(["/app_db", "/payroll_draft_test_20261024"].includes(url.pathname));
  assert.equal(url.username, "postgres");
  assert.equal(url.search, "");
  assert.equal(url.hash, "");
  for (const key of ["PAYMONGO_DISBURSEMENTS_ENABLED", "XENDIT_PAYOUTS_ENABLED"]) assert.notEqual(process.env[key], "true");
  for (const key of ["PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "XENDIT_PAYOUT_SECRET_KEY", "RESEND_API_KEY", "SMTP_URL"]) assert.ok(!process.env[key]);
}

test("PG: Create & process cannot bypass readiness; separating-only and mixed cohorts retain worker findings", { skip: !enabled }, async () => {
  const require = createRequire(import.meta.url);
  const authPath = require.resolve("../src/lib/auth.ts"), originalAuth = require(authPath);
  let identity: unknown = null;
  // Route fixture only: real SQL authorization; no claim of browser/session proof.
  require.cache[authPath]!.exports = { ...originalAuth, getSessionUser: async () => identity };
  const { db, pool } = await import("../src/db");
  const s = await import("../src/db/schema");
  const { eq } = await import("drizzle-orm");
  const { loadPayrollPreRunReadiness } = await import("../src/lib/payroll-pre-run-readiness-server");
  const { buildStatutoryRuleWatch, philippineCalendarDay } = await import("../src/lib/statutory-rule-watch");
  const create = require("../src/app/api/payroll-runs/route.ts").POST;
  const nonce = randomBytes(8).toString("hex");
  const saved = { PAYROLL_PRE_RUN_READINESS_ENABLED: process.env.PAYROLL_PRE_RUN_READINESS_ENABLED, APP_BASE_URL: process.env.APP_BASE_URL, APPROVED_EXIT_PAYROLL_ENABLED: process.env.APPROVED_EXIT_PAYROLL_ENABLED, PAYROLL_DRAFT_PAYOUT_DEFERRAL_ENABLED: process.env.PAYROLL_DRAFT_PAYOUT_DEFERRAL_ENABLED };
  process.env.APP_BASE_URL = "http://127.0.0.1:3011";
  process.env.APPROVED_EXIT_PAYROLL_ENABLED = "true";
  process.env.PAYROLL_PRE_RUN_READINESS_ENABLED = "true";
  const orgs: number[] = [], users: number[] = [];
  try {
    const [own, foreign] = await db.insert(s.organizations).values([
      { name: "Fictional prerun own " + nonce, legalName: "Fictional own" },
      { name: "Fictional prerun foreign " + nonce, legalName: "Fictional foreign" },
    ]).returning();
    orgs.push(own.id, foreign.id);
    const entities = await db.insert(s.legalEntities).values([own, foreign].map(org => ({
      organizationId: org.id, code: "PRIMARY", legalName: org.legalName, displayName: org.name, primaryEntity: true,
    }))).returning();
    const [owner] = await db.insert(s.users).values({ email: `prerun-${nonce}@example.invalid`, name: "Fictional owner", passwordHash: "not-a-login", role: "owner" }).returning();
    users.push(owner.id);
    await db.insert(s.userOrganizations).values({ organizationId: own.id, userId: owner.id, role: "owner", active: true });
    const workers = await db.insert(s.employees).values([own, foreign].map((org, i) => ({
      organizationId: org.id, legalEntityId: entities[i].id, employeeNo: "PRERUN-" + i + nonce,
      firstName: "Fictional", lastName: "Worker", title: "QA only", avatarInitials: "QA",
      // Deliberately no mobile wallet or bank destination: this must not
      // prevent draft-only creation, and cannot bypass Create & process.
      basicRate: "30000", startDate: "2025-01-01",
    }))).returning();
    const body = { organizationId: own.id, legalEntityId: entities[0].id,
      periodStart: "2026-10-01", periodEnd: "2026-10-15", payDate: "2026-10-15", processNow: true };
    const request = (value: unknown) => new Request("http://127.0.0.1:3011/api/payroll-runs", {
      method: "POST", headers: { origin: "http://127.0.0.1:3011", "content-type": "application/json" }, body: JSON.stringify(value),
    });
    assert.equal((await create(request(body))).status, 401);
    identity = owner;
    assert.equal((await create(request({ ...body, organizationId: foreign.id, legalEntityId: entities[1].id }))).status, 403);
    // Without payout deferral the missing destination independently blocks.
    process.env.PAYROLL_DRAFT_PAYOUT_DEFERRAL_ENABLED = "false";
    const noPayout = await create(request(body));
    assert.equal(noPayout.status, 422);
    assert.equal((await noPayout.json()).code, "PAYOUT_DETAILS_REQUIRED");
    // Enabling deferral is not an authorization to bypass source verification.
    process.env.PAYROLL_DRAFT_PAYOUT_DEFERRAL_ENABLED = "true";
    const blocked = await create(request(body)), evidence = await blocked.json();
    assert.equal(blocked.status, 422);
    assert.equal(evidence.code, "PAYROLL_PRE_RUN_READINESS_BLOCKED");
    assert.ok(evidence.readiness.findings.some((f: { code: string }) => f.code === "PRERUN_PAY_PROFILE_MISSING"));
    // Compare with actual current agency-watch evidence. Official-source dates
    // are deliberately null today, but future genuine verification must not
    // break this regression or be silently represented as still missing.
    const asOfDay = philippineCalendarDay();
    const statutoryBlockingCodes: Record<string, string> = {
      "verification-unrecorded": "PRERUN_STATUTORY_VERIFICATION_UNRECORDED",
      "review-due": "PRERUN_STATUTORY_REVIEW_DUE",
      "update-overdue": "PRERUN_STATUTORY_UPDATE_OVERDUE",
      "no-coverage": "PRERUN_STATUTORY_NO_COVERAGE",
    };
    const payDate = body.payDate > asOfDay ? body.payDate : asOfDay;
    const expectedStatutory = buildStatutoryRuleWatch(payDate, asOfDay)
      .map(row => statutoryBlockingCodes[row.status]).filter(Boolean).sort();
    const actualStatutory = (evidence.readiness.findings as { code: string }[])
      .map(finding => finding.code).filter(code => code.startsWith("PRERUN_STATUTORY_")).sort();
    assert.deepEqual(actualStatutory, expectedStatutory,
      "Create & process must report the live statutory source blockers without fabricated approvals");
    for (const org of [own, foreign]) {
      assert.equal((await db.select().from(s.payrollRuns).where(eq(s.payrollRuns.organizationId, org.id))).length, 0);
      assert.equal((await db.select().from(s.auditEvents).where(eq(s.auditEvents.organizationId, org.id))).length, 0);
    }
    process.env.PAYROLL_DRAFT_PAYOUT_DEFERRAL_ENABLED = "false";
    const draftResponse = await create(request({ ...body, processNow: false }));
    const draft = await draftResponse.json();
    assert.equal(draftResponse.status, 201);
    assert.equal(draft.run.status, "Draft");
    assert.equal(draft.queue, null);
    assert.equal((await db.select().from(s.payrollEntries).where(eq(s.payrollEntries.payrollRunId, draft.run.id))).length, 0);
    await db.update(s.employees).set({ status: "Separating" }).where(eq(s.employees.id, workers[0].id));
    await db.insert(s.separationRecords).values({ organizationId: own.id, employeeId: workers[0].id,
      separationType: "resignation", noticeDate: "2026-09-01", lastDay: "2026-10-10", status: "approved" });
    const onlySeparating = await loadPayrollPreRunReadiness(draft.run);
    assert.ok(!onlySeparating.findings.some(f => f.code === "PRERUN_NO_EMPLOYEES"));
    assert.ok(onlySeparating.findings.some(f => f.employeeId === workers[0].id && f.code === "PRERUN_PAY_PROFILE_MISSING"));
    assert.ok(!onlySeparating.findings.some(f => f.employeeId === workers[1].id));
    await db.insert(s.employees).values({ organizationId: own.id, legalEntityId: entities[0].id,
      employeeNo: "ACTIVE-" + nonce, firstName: "Fictional", lastName: "Active", title: "QA", avatarInitials: "QA", basicRate: "30000", startDate: "2025-01-01" });
    const mixed = await loadPayrollPreRunReadiness(draft.run);
    assert.ok(mixed.findings.some(f => f.employeeId === workers[0].id && f.code === "PRERUN_PAY_PROFILE_MISSING"));
    process.env.APPROVED_EXIT_PAYROLL_ENABLED = "false";
    const legacy = await loadPayrollPreRunReadiness(draft.run);
    assert.ok(!legacy.findings.some(f => f.employeeId === workers[0].id));
  } finally {
    require.cache[authPath]!.exports = originalAuth;
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    for (const id of orgs) await db.delete(s.organizations).where(eq(s.organizations.id, id));
    for (const id of users) await db.delete(s.users).where(eq(s.users.id, id));
    await pool.end();
  }
});
