/**
 * Critical payroll acceptance checks. Runs ONLY after the 1,000-person synthetic
 * benchmark, on the same disposable PostgreSQL 16 GitHub Actions service.
 * This is deliberately a destructive fixture: never run against another DB.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { eq } from "drizzle-orm";
import { db, pool } from "../../src/db";
import {
  organizations, legalEntities, employees, employeePayProfiles, timePunches,
  employeeLoans, loanPayments, leavePolicies, leaveRequests, overtimeRequests,
  holidays, payrollRuns, payrollJobs, payrollEntries, payslips, users,
  userOrganizations,
} from "../../src/db/schema";
import { hashPassword } from "../../src/lib/crypto";
import { enqueuePayrollRun, processNextPayrollJob } from "../../src/lib/payroll-engine";
import { journalMoneyCentavos } from "../../src/lib/payroll-journal-export";

const HOST = "http://127.0.0.1:3000";
const report: Record<string, any> = {
  test: "qa1000-critical-payroll-negative-and-recovery",
  status: "NOT_RUN",
  moneyMoved: false,
  providerCalls: false,
  environment: "GitHub Actions / disposable loopback PostgreSQL 16",
  checks: {},
};
function pass(name: string, detail: Record<string, unknown>) {
  report.checks[name] = { status: "PASS", ...detail };
  console.log("QA CRITICAL PASS:", name);
}
function guard() {
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert.equal(process.env.CI, "true");
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(url.protocol, "postgresql:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "5432");
  assert.equal(url.pathname, "/app_db");
  assert.equal(url.username, "postgres");
  assert.equal(url.password, "postgres");
  assert.equal(url.search, "");
  assert.equal(process.env.QA_URL, HOST);
  for (const key of ["WORKER_ENABLED", "PAYMONGO_DISBURSEMENTS_ENABLED",
    "XENDIT_PAYOUTS_ENABLED", "XENDIT_PAYOUTS_LIVE_APPROVED"]) {
    assert.equal(process.env[key], "false", key + " must be disabled");
  }
  for (const key of ["PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "OPENAI_API_KEY",
    "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN"]) {
    assert.equal(process.env[key] ?? "", "", key + " must be empty");
  }
}
function money(value: string | number) { return journalMoneyCentavos(value); }
async function http(path: string, options: { method?: string; cookie?: string; origin?: string; body?: unknown } = {}) {
  const response = await fetch(HOST + path, {
    method: options.method ?? "GET",
    headers: {
      ...(options.cookie ? { cookie: options.cookie } : {}),
      ...(options.origin ? { origin: options.origin } : {}),
      ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    redirect: "manual",
    signal: AbortSignal.timeout(120_000),
  });
  const text = await response.text();
  return { status: response.status, text, cookie: (response.headers.get("set-cookie") ?? "").split(";")[0] };
}
async function login(email: string, password: string) {
  const result = await http("/api/auth/login", { method: "POST", origin: HOST, body: { email, password } });
  assert.equal(result.status, 200, "QA login failed: " + result.text.slice(0, 200));
  assert.ok(result.cookie.includes("="), "Expected a session cookie");
  return result.cookie;
}
function lines(entry: typeof payrollEntries.$inferSelect) {
  assert.ok(Array.isArray(entry.lineItems));
  return entry.lineItems as Array<{ code: string; amount: string; label?: string }>;
}
function lineAmount(entry: typeof payrollEntries.$inferSelect, code: string) {
  return lines(entry).filter(l => l.code === code).reduce((sum, line) => sum + Number(line.amount), 0);
}
function assertRunReconciles(run: typeof payrollRuns.$inferSelect, entries: Array<typeof payrollEntries.$inferSelect>) {
  assert.equal(entries.length, run.employeeCount);
  const gross = entries.reduce((sum, entry) => sum + money(entry.grossPay), 0);
  const net = entries.reduce((sum, entry) => sum + money(entry.netPay), 0);
  assert.equal(gross, money(run.grossPay));
  assert.equal(net, money(run.netPay));
  for (const entry of entries) {
    assert.equal(money(entry.grossPay) - money(entry.deductions), money(entry.netPay));
    assert.equal(lines(entry).reduce((sum, line) => sum + Math.round(Number(line.amount) * 100), 0),
      money(entry.netPay), "Signed payslip lines must equal stored net");
  }
  return { grossCentavos: gross, netCentavos: net };
}
async function execute() {
  guard();
  const version = await pool.query("SHOW server_version_num");
  assert.equal(Math.floor(Number(version.rows[0].server_version_num) / 10000), 16);
  const priorOrgs = await db.select().from(organizations);
  assert.equal(priorOrgs.length, 1, "Requires ONLY the preceding isolated 1,000-worker benchmark");
  assert.equal(priorOrgs[0].name, "QA1000 Fictional Employer");
  const baseOrg = priorOrgs[0];
  const priorRuns = await db.select().from(payrollRuns);
  assert.equal(priorRuns.length, 1, "Only the synthetic baseline run may exist");
  assert.equal(priorRuns[0].status, "Released");
  assert.equal(priorRuns[0].employeeCount, 1000);
  const released = priorRuns[0];
  const originalEntries = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, released.id));
  const originalSlips = await db.select().from(payslips).where(eq(payslips.organizationId, baseOrg.id));
  const originalJobs = await db.select().from(payrollJobs).where(eq(payrollJobs.payrollRunId, released.id));
  const originalPayments = await db.select().from(loanPayments);
  const originalBalances = await db.select({ id: employeeLoans.id, remainingBalance: employeeLoans.remainingBalance }).from(employeeLoans);
  assert.equal(originalEntries.length, 1000);
  assert.equal(originalSlips.length, 1000);

  // Repeated and simultaneous attempts to recalculate a released run must fail
  // WITHOUT deleting historic entries, payslips, jobs, loan settlements or balances.
  const denied = await Promise.allSettled(Array.from({ length: 4 }, () => enqueuePayrollRun(released.id, 50)));
  assert.ok(denied.every(result => result.status === "rejected" &&
    String(result.reason).includes("PAYROLL_RECALCULATION_NOT_ALLOWED")));
  const idle = await Promise.all(Array.from({ length: 4 }, (_, n) =>
    processNextPayrollJob("qa-released-idle-" + n, released.id)));
  assert.ok(idle.every(result => !result.processed));
  const afterEntries = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, released.id));
  const afterSlips = await db.select().from(payslips).where(eq(payslips.organizationId, baseOrg.id));
  const afterJobs = await db.select().from(payrollJobs).where(eq(payrollJobs.payrollRunId, released.id));
  const afterPayments = await db.select().from(loanPayments);
  const afterBalances = await db.select({ id: employeeLoans.id, remainingBalance: employeeLoans.remainingBalance }).from(employeeLoans);
  assert.deepEqual(afterEntries, originalEntries);
  assert.deepEqual(afterSlips, originalSlips);
  assert.deepEqual(afterJobs, originalJobs);
  assert.deepEqual(afterPayments, originalPayments);
  assert.deepEqual(afterBalances, originalBalances);
  pass("released_run_double_processing_blocked", {
    attemptedRequeues: denied.length, noMoreWorkerJobs: true,
    entriesUnchanged: 1000, payslipsUnchanged: 1000,
    loansAndLedgerUnchanged: true,
  });

  // Concurrent callers race to queue a distinct 1,000-person cutoff.
  // Exactly one may claim the draft, and workers must share one chunk cursor.
  const [concurrentRun] = await db.insert(payrollRuns).values({
    organizationId: baseOrg.id, legalEntityId: released.legalEntityId,
    periodLabel: "QA concurrency 1-15 Nov 2026",
    periodStart: "2026-11-01", periodEnd: "2026-11-15",
    payDate: "2026-11-15", scopeLabel: "Only synthetic QA workers", status: "Draft",
  }).returning();
  const queues = await Promise.allSettled(Array.from({ length: 4 }, () => enqueuePayrollRun(concurrentRun.id, 50)));
  const queueSuccess = queues.filter((q): q is PromiseFulfilledResult<Awaited<ReturnType<typeof enqueuePayrollRun>>> => q.status === "fulfilled");
  assert.equal(queueSuccess.length, 1, "Only one concurrent enqueue may succeed");
  assert.equal(queueSuccess[0].value.employeeCount, 1000);
  const workerStarted = performance.now();
  const processedByWorker = await Promise.all(Array.from({ length: 5 }, async (_, worker) => {
    let processed = 0;
    const until = Date.now() + 60_000;
    while (Date.now() < until) {
      const result = await processNextPayrollJob("qa-concurrent-" + worker, concurrentRun.id);
      if (result.processed) {
        processed += result.processedEmployees;
        if (result.done) return processed;
      } else {
        const [state] = await db.select({ status: payrollRuns.status }).from(payrollRuns)
          .where(eq(payrollRuns.id, concurrentRun.id));
        if (state?.status === "Needs review") return processed;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    }
    throw new Error("Concurrent chunk test timed out before completion");
  }));
  const [concurrentFinished] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, concurrentRun.id));
  assert.equal(concurrentFinished.status, "Needs review");
  assert.equal(concurrentFinished.processedChunks, 20);
  assert.equal(processedByWorker.reduce((sum, n) => sum + n, 0), 1000);
  const secondEntries = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, concurrentRun.id));
  assert.equal(new Set(secondEntries.map(entry => entry.employeeId)).size, 1000);
  const secondSlips = await db.select({ id: payslips.id }).from(payslips)
    .innerJoin(payrollEntries, eq(payslips.payrollEntryId, payrollEntries.id))
    .where(eq(payrollEntries.payrollRunId, concurrentRun.id));
  assert.equal(secondSlips.length, 1000);
  const concurrentMoney = assertRunReconciles(concurrentFinished, secondEntries);
  pass("concurrent_queue_and_worker_integrity", {
    queueAttempts: 4, acceptedQueues: 1, workers: 5,
    processedByWorker, employees: 1000, chunks: 20, payslips: secondSlips.length,
    processingMs: Math.round(performance.now() - workerStarted),
    ...concurrentMoney,
  });

  // A second entirely fictional employer hosts a small mixed edge-case roster
  // and a deliberately injected PostgreSQL failure between committed chunks.
  const [otherOrg] = await db.insert(organizations).values({
    name: "QA1000 Critical Edge Employer", legalName: "QA1000 Critical Edge Employer Ltd.", plan: "Core",
  }).returning();
  const [otherEntity] = await db.insert(legalEntities).values({
    organizationId: otherOrg.id, code: "QA-EDGE", legalName: "QA1000 Critical Edge Employer Ltd.",
    displayName: "QA edge cases", primaryEntity: true,
  }).returning();
  const personas = [
    { label: "normal-daily", basis: "daily", rate: "800.00", start: "2026-01-01" },
    { label: "overtime-hourly", basis: "hourly", rate: "100.00", start: "2026-01-01" },
    { label: "holiday-daily", basis: "daily", rate: "800.00", start: "2026-01-01" },
    { label: "unpaid-leave-monthly", basis: "monthly", rate: "24000.00", start: "2026-01-01" },
    { label: "zero-hours-hourly", basis: "hourly", rate: "100.00", start: "2026-01-01" },
    { label: "midcutoff-monthly-hire", basis: "monthly", rate: "30000.00", start: "2026-10-10" },
  ];
  const edgePeople = await db.insert(employees).values(personas.map((p, i) => ({
    organizationId: otherOrg.id, legalEntityId: otherEntity.id,
    employeeNo: "QAEDGE-" + (i + 1), firstName: "Fictional",
    lastName: p.label, title: "QA no money", avatarInitials: "QA", status: "Active",
    employmentType: "Regular", basicRate: p.rate, startDate: p.start,
    restDay: "Sunday", region: "NCR", bankAccount: "SYNTHETIC-EDGE-" + i, bankCode: "BDO",
  }))).returning();
  assert.equal(edgePeople.length, personas.length);
  await db.insert(employeePayProfiles).values(edgePeople.map((p, i) => ({
    organizationId: otherOrg.id, employeeId: p.id,
    payBasis: personas[i].basis, rateAmount: personas[i].rate,
    standardWorkDaysPerMonth: "22.00", standardHoursPerDay: "8.00",
  })));
  for (const [i, workDate, hourOut] of [
    [0, "2026-10-07", 18], [1, "2026-10-07", 20],
    [2, "2026-10-08", 18], [5, "2026-10-12", 18],
  ] as const) {
    await db.insert(timePunches).values({
      organizationId: otherOrg.id, employeeId: edgePeople[i].id,
      workDate, timeIn: new Date(workDate + "T09:00:00+08:00"),
      timeOut: new Date(workDate + "T" + String(hourOut).padStart(2, "0") + ":00:00+08:00"),
      shiftStart: "09:00", shiftEnd: "18:00", source: "qa_critical", status: "Complete",
    });
  }
  await db.insert(holidays).values({
    organizationId: otherOrg.id, holidayDate: "2026-10-08", name: "Fictional QA Regular Holiday", kind: "regular",
  });
  await db.insert(overtimeRequests).values({
    organizationId: otherOrg.id, employeeId: edgePeople[1].id,
    workDate: "2026-10-07", requestedMinutes: 120, reason: "QA approved extra work",
    requestKind: "pre_approved", status: "approved", requestedBy: "Fictional QA",
    decidedBy: "Fictional QA checker",
  });
  await db.insert(leavePolicies).values({
    organizationId: otherOrg.id, leaveType: "QA Unpaid Leave",
    annualDays: "10.0", payTreatment: "unpaid", paidPercentage: "0.00",
  });
  await db.insert(leaveRequests).values({
    organizationId: otherOrg.id, employeeId: edgePeople[3].id,
    leaveType: "QA Unpaid Leave", startDate: "2026-10-09", endDate: "2026-10-09",
    days: "1.0", reason: "Fictional unpaid day", status: "Approved",
  });
  await db.insert(employeeLoans).values({
    organizationId: otherOrg.id, employeeId: edgePeople[0].id,
    loanType: "Company Emergency Loan", referenceNo: "QAEDGE-LOAN",
    principal: "1000.00", monthlyAmortization: "300.00",
    cutoffDeduction: "300.00", remainingBalance: "100.00",
    status: "active", startDate: "2026-01-01",
  });
  const [edgeRun] = await db.insert(payrollRuns).values({
    organizationId: otherOrg.id, legalEntityId: otherEntity.id,
    periodLabel: "QA edge and retry 1-15 Oct 2026",
    periodStart: "2026-10-01", periodEnd: "2026-10-15", payDate: "2026-10-15",
    scopeLabel: "Six fictional edge cases", status: "Draft",
  }).returning();
  const queuedEdge = await enqueuePayrollRun(edgeRun.id, 2);
  assert.equal(queuedEdge.employeeCount, 6);
  assert.equal(queuedEdge.totalChunks, 3);
  const firstChunk = await processNextPayrollJob("qa-edge-first", edgeRun.id);
  assert.ok(firstChunk.processed && firstChunk.chunkIndex === 0);
  assert.equal((await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, edgeRun.id))).length, 2);

  // One transaction fails AFTER the previous chunk committed. This trigger is
  // restricted to the disposable schema and removed before the retry.
  const trigger = "qa1000_inject_entry_failure";
  await pool.query("CREATE FUNCTION " + trigger +
    "() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.payroll_run_id = " +
    Number(edgeRun.id) + " THEN RAISE EXCEPTION 'QA1000_INJECTED_CHUNK_FAILURE'; END IF; RETURN NEW; END; $$");
  await pool.query("CREATE TRIGGER " + trigger + " BEFORE INSERT ON payroll_entries FOR EACH ROW EXECUTE FUNCTION " + trigger + "()");
  try {
    await assert.rejects(
      () => processNextPayrollJob("qa-edge-fails", edgeRun.id),
      /QA1000_INJECTED_CHUNK_FAILURE/,
    );
  } finally {
    await pool.query("DROP TRIGGER IF EXISTS " + trigger + " ON payroll_entries");
    await pool.query("DROP FUNCTION IF EXISTS " + trigger + "()");
  }
  const [failedRun] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, edgeRun.id));
  const [failedJob] = await db.select().from(payrollJobs).where(eq(payrollJobs.payrollRunId, edgeRun.id));
  assert.equal(failedRun.status, "Failed");
  assert.equal(failedJob.status, "failed");
  assert.equal(failedJob.chunkIndex, 1);
  assert.equal((await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, edgeRun.id))).length, 2,
    "Failed chunk must not leave half-committed payroll rows");
  const retried = await processNextPayrollJob("qa-edge-retry", edgeRun.id);
  assert.ok(retried.processed && retried.chunkIndex === 1 && !retried.done);
  // Simulate a process dying after taking the next job: stale lease recovered.
  await db.update(payrollJobs).set({
    status: "processing", lockedAt: new Date(Date.now() - 60 * 60_000),
    lockedBy: "qa-fictional-crashed-worker",
  }).where(eq(payrollJobs.payrollRunId, edgeRun.id));
  const recovered = await processNextPayrollJob("qa-edge-recovery", edgeRun.id);
  assert.ok(recovered.processed && recovered.chunkIndex === 2 && recovered.done);
  const [edgeFinished] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, edgeRun.id));
  assert.equal(edgeFinished.status, "Needs review");
  const edgeEntries = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, edgeRun.id));
  assert.equal(edgeEntries.length, 6);
  assert.equal(new Set(edgeEntries.map(entry => entry.employeeId)).size, 6);
  const edgeSlips = await db.select({ id: payslips.id }).from(payslips)
    .innerJoin(payrollEntries, eq(payslips.payrollEntryId, payrollEntries.id))
    .where(eq(payrollEntries.payrollRunId, edgeRun.id));
  assert.equal(edgeSlips.length, 6);
  const edgeMoney = assertRunReconciles(edgeFinished, edgeEntries);
  const [recoveredJob] = await db.select().from(payrollJobs).where(eq(payrollJobs.payrollRunId, edgeRun.id));
  assert.equal(recoveredJob.status, "completed");
  assert.ok(recoveredJob.attempts >= 4, "Failed/retried/stale-lease attempts must be counted");
  pass("injected_chunk_failure_retry_and_stale_lease", {
    firstChunkCommitted: 2, failedChunkPersisted: 0,
    retriedChunks: [1, 2], recoveredFromExpiredLease: true,
    employeeEntries: 6, payslips: 6, attemptCount: recoveredJob.attempts, ...edgeMoney,
  });

  const byId = new Map(edgeEntries.map(entry => [entry.employeeId, entry]));
  const entryFor = (index: number) => {
    const entry = byId.get(edgePeople[index].id);
    assert.ok(entry);
    return entry;
  };
  assert.ok(lineAmount(entryFor(1), "OT") > 0, "Hourly overtime must be itemized");
  assert.ok(lineAmount(entryFor(2), "HOLIDAY") > 0, "Worked regular holiday must pay a premium");
  assert.ok(lines(entryFor(3)).some(line => line.code.startsWith("LEAVE-") && Number(line.amount) < 0),
    "One unpaid leave day must reduce monthly pay");
  assert.equal(lineAmount(entryFor(4), "BASIC"), 0, "Employee with no hours must not receive worked pay");
  assert.ok(lineAmount(entryFor(5), "BASIC") > 0 && lineAmount(entryFor(5), "BASIC") < 15000,
    "Hire after the cutoff begins must receive only the eligible fraction of monthly basic");
  const loanDeduction = lines(entryFor(0))
    .filter(line => line.code.startsWith("LOAN-"))
    .reduce((sum, line) => sum - Number(line.amount), 0);
  assert.ok(loanDeduction >= 0 && loanDeduction <= 100,
    "Loan deduction cannot exceed the remaining principal");
  pass("six_real_engine_calculation_edge_cases", {
    scenarios: [
      "daily base with bounded loan", "hourly overtime", "worked regular holiday",
      "monthly unpaid leave", "hourly worker with zero hours", "midcutoff hire",
    ],
    overtimePhp: lineAmount(entryFor(1), "OT"),
    regularHolidayPremiumPhp: lineAmount(entryFor(2), "HOLIDAY"),
    loanDeductionPhp: loanDeduction,
    unpaidLeaveApplied: true,
    zeroWorkedPay: true,
    midcutoffProrated: true,
  });

  // HTTP access: two actual isolated password logins with different tenant roles.
  // Cross-tenant owners must not see payroll, and payroll-ineligible members
  // must not read payslips, variance or initiate a release.
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const viewerEmail = "qa.viewer." + suffix + "@linaw.test";
  const outsiderEmail = "qa.outsider." + suffix + "@linaw.test";
  const viewerPassword = "QAFictionalViewer!22-" + suffix;
  const outsiderPassword = "QAFictionalOutsider!22-" + suffix;
  const [viewer, outsider] = await db.insert(users).values([
    { email: viewerEmail, name: "Fictional Payroll Excluded User",
      passwordHash: hashPassword(viewerPassword), role: "employee" },
    { email: outsiderEmail, name: "Fictional Other Employer Owner",
      passwordHash: hashPassword(outsiderPassword), role: "owner" },
  ]).returning();
  await db.insert(userOrganizations).values([
    { userId: viewer.id, organizationId: baseOrg.id, role: "employee" },
    { userId: outsider.id, organizationId: otherOrg.id, role: "owner" },
  ]);
  const viewerCookie = await login(viewerEmail, viewerPassword);
  const outsiderCookie = await login(outsiderEmail, outsiderPassword);
  const deniedRequests = [
    { label: "anonymous-register", path: "/api/payroll-runs?runId=" + released.id },
    { label: "anonymous-payslips", path: "/api/payroll-runs/" + released.id + "/exports?kind=payslip" },
    { label: "anonymous-variance", path: "/api/payroll-runs/" + released.id + "/variance" },
    { label: "viewer-register", path: "/api/payroll-runs?runId=" + released.id, cookie: viewerCookie },
    { label: "viewer-payslips", path: "/api/payroll-runs/" + released.id + "/exports?kind=payslip", cookie: viewerCookie },
    { label: "viewer-variance", path: "/api/payroll-runs/" + released.id + "/variance", cookie: viewerCookie },
    { label: "outsider-register", path: "/api/payroll-runs?runId=" + released.id, cookie: outsiderCookie },
    { label: "outsider-payslips", path: "/api/payroll-runs/" + released.id + "/exports?kind=payslip", cookie: outsiderCookie },
    { label: "outsider-variance", path: "/api/payroll-runs/" + released.id + "/variance", cookie: outsiderCookie },
    { label: "outsider-run-list", path: "/api/payroll-runs?organizationId=" + baseOrg.id, cookie: outsiderCookie },
  ];
  for (const attempt of deniedRequests) {
    const response = await http(attempt.path, { cookie: attempt.cookie });
    assert.equal(response.status, attempt.cookie ? 403 : 401, attempt.label + " " + response.status +
      " " + response.text.slice(0, 160));
  }
  const deniedReleases = [
    { label: "anonymous-release", cookie: undefined, expected: 401 },
    { label: "viewer-release", cookie: viewerCookie, expected: 403 },
    { label: "outsider-release", cookie: outsiderCookie, expected: 403 },
  ];
  for (const attempt of deniedReleases) {
    const response = await http("/api/payroll-runs/" + released.id + "/release", {
      method: "POST", origin: HOST, cookie: attempt.cookie, body: {},
    });
    assert.equal(response.status, attempt.expected, attempt.label + " " + response.status);
  }
  const authorized = await http("/api/payroll-runs?runId=" + edgeRun.id + "&include=entries", {
    cookie: outsiderCookie,
  });
  assert.equal(authorized.status, 200, "Other employer owner should see only their own payroll");
  assert.equal((JSON.parse(authorized.text) as { entries: unknown[] }).entries.length, 6);
  const notApproved = await http("/api/payroll-runs/" + edgeRun.id + "/release", {
    method: "POST", origin: HOST, cookie: outsiderCookie, body: {},
  });
  assert.equal(notApproved.status, 409, "A calculated but not checker-approved payroll must not release");
  const [unchangedEdge] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, edgeRun.id));
  assert.equal(unchangedEdge.status, "Needs review");
  pass("cross_tenant_role_and_release_authorization", {
    anonymousReadDenials: 3, viewerReadDenials: 3, crossTenantReadDenials: 4,
    unauthorizedReleaseDenials: 3, unauthorizedReleaseStatuses: [401, 403, 403],
    unapprovedOwnerReleaseBlocked: true, authorizedOtherTenantRegisterRows: 6,
  });

  // This is deliberately HTTP concurrency (not full browser-render timing).
  const requested = Array.from({ length: 12 }, () =>
    "/api/payroll-runs?runId=" + edgeRun.id + "&include=entries");
  const start = performance.now();
  const concurrentReads = await Promise.all(requested.map(async path => {
    const before = performance.now();
    const response = await http(path, { cookie: outsiderCookie });
    assert.equal(response.status, 200);
    const payload = JSON.parse(response.text) as { entries: unknown[] };
    assert.equal(payload.entries.length, 6);
    return Math.round(performance.now() - before);
  }));
  concurrentReads.sort((a, b) => a - b);
  pass("parallel_http_read_smoke", {
    simultaneousRequests: concurrentReads.length,
    totalWallClockMs: Math.round(performance.now() - start),
    p50Ms: concurrentReads[Math.floor(concurrentReads.length * 0.50)],
    p95Ms: concurrentReads[Math.ceil(concurrentReads.length * 0.95) - 1],
    mode: "HTTP only: does not measure browser rendering",
  });
  report.status = "PASS";
  console.log("QA1000 CRITICAL CHECKS PASS: concurrent, rollback/retry, edge cases and access controls.");
}
execute().catch(error => {
  report.status = "FAIL";
  report.error = String(error instanceof Error ? error.stack ?? error.message : error).slice(0, 2500);
  console.error("QA1000 CRITICAL CHECKS FAIL:", report.error);
  process.exitCode = 1;
}).finally(async () => {
  mkdirSync("qa-artifacts", { recursive: true });
  writeFileSync("qa-artifacts/isolated-1000-critical-checks-report.json",
    JSON.stringify(report, null, 2) + "\n");
  await pool.end();
});
