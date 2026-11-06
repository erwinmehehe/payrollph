/**
 * Disposable-only 1,000 worker load & integrity acceptance.
 * Run only in GitHub Actions against an EMPTY loopback PG16.
 * No payout provider, money movement, real people or production data.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { eq } from "drizzle-orm";
import { db, pool } from "../../src/db";
import {
  organizations, legalEntities, employees, employeePayProfiles,
  employeeLoans, leavePolicies, leaveRequests, timePunches,
  payrollRuns, payrollEntries, payslips,
} from "../../src/db/schema";
import { enqueuePayrollRun, processNextPayrollJob } from "../../src/lib/payroll-engine";
import { settlePayrollRun } from "../../src/lib/payroll-settlement";
import { buildReleasedPayrollJournal, journalMoneyCentavos } from "../../src/lib/payroll-journal-export";

const HOST = "http://127.0.0.1:3000";
const COUNT = 1000;
const CHUNK = 50;
const START = "2026-10-01";
const END = "2026-10-15";
const DATE = "2026-10-15";
const PASSWORD = "OnlySynthetic!1-" + randomUUID().replaceAll("-", "").slice(0, 18);
const EMAIL = "owner.qa1000@linaw.test";
const report: Record<string, any> = {
  test: "isolated-1000-mixed-worker-cutoff",
  status: "NOT_RUN",
  environment: "GitHub Actions ephemeral PostgreSQL 16 / localhost Next.js",
  fixtureOnly: true,
  workers: COUNT,
  chunkSize: CHUNK,
  periodStart: START,
  periodEnd: END,
  moneyMoved: false,
  providerCalls: false,
  browserRenderTiming: "NOT_MEASURED; reported HTTP latencies exclude browser rendering",
  chunks: [],
  viewHttpMs: {},
};

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
  assert.equal(process.env.DEMO_MODE, "false");
  for (const key of [
    "PAYMONGO_DISBURSEMENTS_ENABLED", "XENDIT_PAYOUTS_ENABLED",
    "XENDIT_PAYOUTS_LIVE_APPROVED", "WORKER_ENABLED",
  ]) assert.equal(process.env[key], "false", key + " must be disabled");
  for (const key of [
    "OPENAI_API_KEY", "PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY",
    "RESEND_API_KEY", "POSTMARK_SERVER_TOKEN",
  ]) assert.equal(process.env[key] ?? "", "", key + " must not be set");
}

function cents(value: string | number) {
  return journalMoneyCentavos(value);
}
function mb(bytes: number) {
  return Number((bytes / 1024 / 1024).toFixed(2));
}
function round(value: number) {
  return Number(value.toFixed(2));
}
async function assertOk(path: string, options: RequestInit = {}) {
  const response = await fetch(HOST + path, {
    ...options,
    redirect: "manual",
    signal: AbortSignal.timeout(120_000),
  });
  assert.ok(response.ok, path + " returned " + response.status + ": " +
    (await response.text()).slice(0, 350));
  return response;
}
async function login() {
  const response = await assertOk("/api/auth/login", {
    method: "POST",
    headers: { origin: HOST, "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0];
  assert.ok(cookie, "Login did not issue a session cookie");
  return cookie;
}
async function measuredHttp(path: string, cookie: string, label: string, expectedCount?: number) {
  const start = performance.now();
  const response = await fetch(HOST + path, {
    headers: { cookie, "cache-control": "no-store" },
    redirect: "manual",
    signal: AbortSignal.timeout(120_000),
  });
  const body = await response.text();
  const ms = round(performance.now() - start);
  assert.equal(response.status, 200, label + " HTTP " + response.status + " " + body.slice(0, 180));
  let count: number | undefined;
  if (expectedCount !== undefined) {
    const json = JSON.parse(body) as Record<string, any>;
    const rows = json.rows ?? json.entries ?? json.payslips;
    assert.ok(Array.isArray(rows), label + " must contain an array");
    count = rows.length;
    assert.equal(count, expectedCount, label + " record count");
  }
  (report.viewHttpMs as Record<string, unknown>)[label] = {
    ms, httpStatus: response.status, bytes: Buffer.byteLength(body),
    ...(count === undefined ? {} : { rows: count }),
  };
  return body;
}

let queryCalls = 0;
pool.on("acquire", (client) => {
  const measured = client as typeof client & { __qa1000Instrumented?: boolean };
  if (measured.__qa1000Instrumented) return;
  const original = measured.query.bind(measured);
  measured.query = ((...args: any[]) => {
    queryCalls += 1;
    return (original as any)(...args);
  }) as typeof measured.query;
  measured.__qa1000Instrumented = true;
});

async function execute() {
  guard();
  const dbVersion = await pool.query("SHOW server_version_num");
  assert.equal(Math.floor(Number(dbVersion.rows[0].server_version_num) / 10000), 16);
  const present = await db.select({ id: organizations.id }).from(organizations);
  assert.equal(present.length, 0, "Only an EMPTY disposable PostgreSQL may be seeded");
  const setup = await assertOk("/api/setup", {
    method: "POST",
    headers: {
      origin: HOST, "content-type": "application/json",
      "x-setup-token": process.env.SETUP_TOKEN ?? "",
    },
    body: JSON.stringify({
      companyName: "QA1000 Fictional Employer", legalName: "QA1000 Fictional Employer Ltd.",
      name: "QA1000 Owner", email: EMAIL, password: PASSWORD,
    }),
  });
  const setupJson = await setup.json() as Record<string, any>;
  const orgId = Number(setupJson.organizationId);
  assert.ok(Number.isInteger(orgId) && orgId > 0);
  const entityRows = await db.select().from(legalEntities).where(eq(legalEntities.organizationId, orgId));
  const [entity] = entityRows.length ? entityRows :
    await db.insert(legalEntities).values({
      organizationId: orgId, code: "QA1000", legalName: "QA1000 Fictional Employer Ltd.",
      displayName: "QA1000 Fictional", primaryEntity: true,
    }).returning();
  assert.ok(entity?.id);

  const seedStarted = performance.now();
  const cohort: Array<{ id: number; number: number; basis: string; rate: string }> = [];
  for (let offset = 0; offset < COUNT; offset += 100) {
    const input = Array.from({ length: Math.min(100, COUNT - offset) }, (_, index) => {
      const n = offset + index + 1;
      const basis = n % 3 === 0 ? "monthly" : n % 3 === 1 ? "daily" : "hourly";
      const amount = basis === "monthly" ? 30000 + (n % 17) * 125 :
        basis === "daily" ? 750 + (n % 11) * 15 : 95 + (n % 13) * 5;
      return {
        number: n, basis, rate: amount.toFixed(2),
        employeeNo: "QA1000-" + String(n).padStart(4, "0"),
      };
    });
    const inserted = await db.insert(employees).values(input.map(person => ({
      organizationId: orgId, legalEntityId: entity.id,
      employeeNo: person.employeeNo, firstName: "Fictional",
      lastName: "Worker" + String(person.number).padStart(4, "0"),
      title: "Load Test Only", avatarInitials: "QA",
      status: "Active", employmentType: "Regular",
      basicRate: person.rate, startDate: "2026-01-01",
      restDay: "Sunday", region: "NCR",
      bankAccount: "SYNTHETIC" + String(person.number).padStart(8, "0"), bankCode: "BDO",
    }))).returning({ id: employees.id });
    assert.equal(inserted.length, input.length);
    const rows = inserted.map((worker, index) => ({
      id: worker.id, number: input[index].number,
      basis: input[index].basis, rate: input[index].rate,
    }));
    cohort.push(...rows);
    await db.insert(employeePayProfiles).values(rows.map(worker => ({
      organizationId: orgId, employeeId: worker.id,
      payBasis: worker.basis, rateAmount: worker.rate,
      standardWorkDaysPerMonth: "22.00", standardHoursPerDay: "8.00",
    })));
    await db.insert(timePunches).values(rows.map(worker => ({
      organizationId: orgId, employeeId: worker.id,
      workDate: "2026-10-08",
      timeIn: new Date("2026-10-08T09:00:00+08:00"),
      timeOut: new Date("2026-10-08T18:00:00+08:00"),
      shiftStart: "09:00", shiftEnd: "18:00",
      source: "qa1000_synthetic", status: "Complete",
    })));
  }
  const loanWorkers = cohort.filter(worker => worker.number % 5 === 0);
  const leaveWorkers = cohort.filter(worker => worker.number % 10 === 1);
  await db.insert(leavePolicies).values({
    organizationId: orgId, leaveType: "QA Paid Leave", annualDays: "10.0",
    payTreatment: "paid", paidPercentage: "100.00",
  });
  for (let offset = 0; offset < loanWorkers.length; offset += 100) {
    await db.insert(employeeLoans).values(loanWorkers.slice(offset, offset + 100).map(worker => ({
      organizationId: orgId, employeeId: worker.id,
      loanType: "Company Emergency Loan", referenceNo: "QA1000L" + worker.number,
      principal: "5000.00", monthlyAmortization: "600.00",
      cutoffDeduction: "300.00", remainingBalance: "5000.00",
      status: "active", startDate: "2026-01-01",
    })));
  }
  await db.insert(leaveRequests).values(leaveWorkers.map(worker => ({
    organizationId: orgId, employeeId: worker.id,
    leaveType: "QA Paid Leave", startDate: "2026-10-09", endDate: "2026-10-09",
    days: "1.0", reason: "Fictional approved leave", status: "Approved",
  })));
  assert.equal(cohort.length, COUNT);
  assert.equal(new Set(cohort.map(worker => worker.id)).size, COUNT);
  const payMix = {
    monthly: cohort.filter(worker => worker.basis === "monthly").length,
    daily: cohort.filter(worker => worker.basis === "daily").length,
    hourly: cohort.filter(worker => worker.basis === "hourly").length,
  };
  assert.ok(Object.values(payMix).every(n => n > 0));
  report.fixture = {
    payMix, activeLoans: loanWorkers.length,
    approvedPaidLeaves: leaveWorkers.length,
    timePunches: COUNT,
    seedMs: round(performance.now() - seedStarted),
  };

  const [run] = await db.insert(payrollRuns).values({
    organizationId: orgId, legalEntityId: entity.id,
    periodLabel: "QA 1-15 Oct 2026", periodStart: START,
    periodEnd: END, payDate: DATE,
    scopeLabel: "All fictional employees", status: "Draft",
  }).returning();
  report.runId = run.id;
  const queued = await enqueuePayrollRun(run.id, CHUNK);
  assert.equal(queued.employeeCount, COUNT);
  assert.equal(queued.totalChunks, Math.ceil(COUNT / CHUNK));
  const start = performance.now();
  let totalRows = 0;
  for (let n = 0; n < queued.totalChunks; n++) {
    const beforeQuery = queryCalls;
    const beforeMemory = process.memoryUsage();
    let peakRss = beforeMemory.rss;
    let peakHeap = beforeMemory.heapUsed;
    const sample = setInterval(() => {
      const memory = process.memoryUsage();
      peakRss = Math.max(peakRss, memory.rss);
      peakHeap = Math.max(peakHeap, memory.heapUsed);
    }, 20);
    const stepStarted = performance.now();
    let result: Awaited<ReturnType<typeof processNextPayrollJob>>;
    try {
      result = await processNextPayrollJob("qa1000-worker", run.id);
    } finally {
      clearInterval(sample);
    }
    assert.ok(result.processed, "Queue stopped before 1,000 employees were processed");
    const memoryAfter = process.memoryUsage();
    peakRss = Math.max(peakRss, memoryAfter.rss);
    peakHeap = Math.max(peakHeap, memoryAfter.heapUsed);
    totalRows += result.processedEmployees;
    (report.chunks as any[]).push({
      chunkIndex: result.chunkIndex,
      employees: result.processedEmployees,
      durationMs: round(performance.now() - stepStarted),
      sqlQueries: queryCalls - beforeQuery,
      rssStartMb: mb(beforeMemory.rss),
      peakRssMb: mb(peakRss),
      peakHeapMb: mb(peakHeap),
    });
    assert.equal(result.chunkIndex, n);
    assert.equal(result.done, n === queued.totalChunks - 1);
  }
  report.processMs = round(performance.now() - start);
  report.throughputEmployeesPerSecond = round(COUNT / (report.processMs / 1000));
  assert.equal(totalRows, COUNT);
  const [header] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, run.id));
  assert.equal(header.status, "Needs review");
  assert.equal(header.employeeCount, COUNT);
  assert.equal(header.processedChunks, queued.totalChunks);
  const entries = await db.select().from(payrollEntries).where(eq(payrollEntries.payrollRunId, run.id));
  const slips = await db.select().from(payslips).where(eq(payslips.organizationId, orgId));
  assert.equal(entries.length, COUNT, "Exactly 1,000 entries");
  assert.equal(slips.length, COUNT, "Exactly 1,000 payslips");
  const expectedIds = new Set(cohort.map(worker => worker.id));
  assert.deepEqual(new Set(entries.map(row => row.employeeId)), expectedIds);
  assert.deepEqual(new Set(slips.map(row => row.employeeId)), expectedIds);
  assert.equal(new Set(entries.map(row => row.employeeId)).size, COUNT, "No duplicate employee entries");
  assert.equal(new Set(slips.map(row => row.employeeId)).size, COUNT, "No duplicate payslips");
  const byEntryId = new Map(entries.map(row => [row.id, row]));
  let totalGross = 0, totalDeductions = 0, totalNet = 0;
  for (const entry of entries) {
    const gross = cents(entry.grossPay), deductions = cents(entry.deductions), net = cents(entry.netPay);
    assert.equal(gross - deductions, net, "Entry centavo reconciliation");
    totalGross += gross; totalDeductions += deductions; totalNet += net;
  }
  for (const slip of slips) {
    const entry = byEntryId.get(slip.payrollEntryId);
    assert.ok(entry, "Every payslip must link to a run entry");
    assert.equal(slip.employeeId, entry.employeeId);
    const plain = slip.content.split("---PLAINTEXT---")[1] ?? slip.content;
    for (const [label, amount] of [
      ["Gross", entry.grossPay], ["Deductions", entry.deductions], ["Net pay", entry.netPay],
    ] as const) {
      assert.ok(plain.includes(label + ": PHP " + Number(amount).toFixed(2)),
        "Payslip " + slip.id + " mismatched " + label);
    }
  }
  assert.equal(totalGross, cents(header.grossPay), "Register gross does not match run");
  assert.equal(totalNet, cents(header.netPay), "Register net does not match run");
  assert.equal(totalGross - totalDeductions, totalNet);
  report.reconciliation = {
    employeeEntries: entries.length, payslips: slips.length,
    missingEmployees: 0, duplicateEmployeeEntries: 0, duplicatePayslips: 0,
    grossCentavos: totalGross, deductionsCentavos: totalDeductions, netCentavos: totalNet,
    status: "PASS_TO_CENTAVO",
  };
  const loanEntries = entries.filter(row =>
    JSON.stringify(row.lineItems).includes("LOAN-"));
  const leaveEntries = entries.filter(row =>
    JSON.stringify(row.trace).includes("QA Paid Leave") ||
    JSON.stringify(row.lineItems).includes("QA Paid Leave"));
  report.sourceCoverage = {
    seededLoanWorkers: loanWorkers.length, loanLineEntries: loanEntries.length,
    seededLeaveWorkers: leaveWorkers.length, observedLeaveEntries: leaveEntries.length,
    attendancePunches: COUNT,
  };
  assert.ok(loanEntries.length > 0, "Active loans were not represented in payroll");
  assert.ok(leaveEntries.length > 0, "Approved leave was not represented in payroll");

  // In this disposable acceptance, use the *same* isolated settlement function
  // after an explicit synthetic state transition, not real maker/checker approval.
  await db.update(payrollRuns).set({ status: "Releasing" }).where(eq(payrollRuns.id, run.id));
  const settlement = await settlePayrollRun(run.id, {
    actor: "Fictional QA operator", resource: "Isolated 1,000-employee load test",
    metadata: { fixtureOnly: true, externalDisbursement: false },
  });
  assert.equal(settlement.run.status, "Released");
  const [released] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, run.id));
  assert.equal(released.status, "Released");
  const journal = buildReleasedPayrollJournal([released]);
  const debit = journal.reduce((sum, row) => sum + row.debitCentavos, 0);
  const credit = journal.reduce((sum, row) => sum + row.creditCentavos, 0);
  assert.equal(debit, credit);
  assert.equal(debit, totalGross);
  assert.equal(journal.find(row => row.accountCode === "2200")?.creditCentavos, totalNet);
  assert.equal(journal.find(row => row.accountCode === "2100")?.creditCentavos ?? 0, totalDeductions);
  report.reconciliation.journalDebitCentavos = debit;
  report.reconciliation.journalCreditCentavos = credit;
  report.reconciliation.journalMatched = true;
  report.syntheticSettlementOnly = true;

  const cookie = await login();
  await measuredHttp("/api/payroll-runs/" + run.id + "/variance", cookie, "variance", COUNT);
  await measuredHttp("/api/payroll-runs?runId=" + run.id + "&include=entries", cookie, "payrollRegister", COUNT);
  await measuredHttp("/api/payroll-runs/" + run.id + "/exports?kind=payslip", cookie, "payslipsList", COUNT);
  await measuredHttp("/api/payroll-runs/" + run.id + "/exports?kind=payslip&payslipId=" + slips[0].id,
    cookie, "singlePayslipPdf");
  await measuredHttp("/app?organizationId=" + orgId, cookie, "workspaceHtml");
  report.status = "PASS";
  console.log("QA1000 PASS: 1000 workers, " + queued.totalChunks + " chunks; financial journal reconciled.");
}
execute().catch(error => {
  report.status = "FAIL";
  report.error = String(error instanceof Error ? error.stack ?? error.message : error).slice(0, 1500);
  console.error("QA1000 FAIL:", report.error);
  process.exitCode = 1;
}).finally(async () => {
  mkdirSync("qa-artifacts", { recursive: true });
  writeFileSync("qa-artifacts/isolated-1000-payroll-report.json",
    JSON.stringify(report, null, 2) + "\n");
  await pool.end();
});
