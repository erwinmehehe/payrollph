/**
 * #579 ENGINEERING REHEARSAL ONLY — 50 fictional workers, two isolated employers.
 * Never real #579 evidence. No provider, statutory submission, bank ID or bank file transfer.
 * This invokes the real localhost HTTP payroll path in a disposable PG16 CI database.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { eq, and } from "drizzle-orm";
import { requireFictionalJourney, reconcileFirstPayroll, centavos } from "./first-payroll-full-contract.mjs";

const { base, database } = requireFictionalJourney();
assert.equal(process.env.CI, "true");
assert.equal(process.env.GITHUB_ACTIONS, "true");
assert.equal(database.port, "5432");
const forbiddenFlags = [
  "PAYMONGO_DISBURSEMENTS_ENABLED", "XENDIT_PAYOUTS_ENABLED",
  "XENDIT_PAYOUTS_LIVE_APPROVED", "PAYROLL_CALCULATION_HISTORY_ENABLED",
  "FINAL_PAY_SIGNED_REVIEW_ENABLED", "EXACT_THIRTEENTH_CENTAVOS_ENABLED",
  "NEXT_CSP_ENABLED",
];
for (const flag of forbiddenFlags) assert.equal(process.env[flag], "false", flag + " must remain false");
for (const name of ["PAYMONGO_SECRET_KEY", "XENDIT_SECRET_KEY", "XENDIT_API_KEY"]) {
  assert.ok(!process.env[name], "Real provider credentials forbidden");
}
const { db, pool } = await import("../../src/db/index.ts");
const s = await import("../../src/db/schema.ts");
const { encryptBankAccount } = await import("../../src/lib/bank-account-crypto.ts");
const {
  seedEmployer, standaloneMakeSession, standaloneRequest,
} = await import("./tenant-table-http.mjs");
const nonce = randomUUID().replaceAll("-", "").slice(0, 9);
const period = { periodStart: "2026-05-01", periodEnd: "2026-05-15", payDate: "2026-05-15" };
const summary = {
  result: "NOT_RUN",
  classification: "fictional-579-application-rehearsal-not-real-579",
  employers: [],
  stage: "preflight",
  sourceCommit: process.env.GITHUB_SHA ?? null,
  payoutEnabled: false,
  providerCalls: 0,
  finalBankFilesGenerated: 0,
  uploadedBankFiles: 0,
  checks: [],
};
const digest = value => createHash("sha256").update(value).digest("hex");
function moneyCents(value) {
  return centavos(String(value).trim());
}
function moneyString(value) {
  const absolute = Math.abs(value);
  return (value < 0 ? "-" : "") + Math.floor(absolute / 100) + "." + String(absolute % 100).padStart(2, "0");
}
function csvRows(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && c === ",") { row.push(cell); cell = ""; }
    else if (!quoted && c === "\n") {
      row.push(cell.replace(/\r$/, ""));
      if (row.some(x => x.length)) rows.push(row);
      row = []; cell = "";
    } else cell += c;
  }
  if (row.length || cell) { row.push(cell); rows.push(row); }
  assert.equal(quoted, false, "CSV quoting must be closed");
  return rows;
}
async function call(actor, path, method = "GET", body = undefined, expected = 200) {
  const response = await standaloneRequest(path, { cookie: actor.cookie, method, body });
  if (response.status !== expected) {
    const publicCode = String(response.json?.code || "HTTP_" + response.status)
      .replace(/[^A-Z0-9_]/gi, "").slice(0, 72);
    throw new Error("HTTP_STEP_FAILED_" + expected + "_GOT_" + response.status + "_" + publicCode);
  }
  return response;
}
async function roleFor(employer, role) {
  const [user] = await db.insert(s.users).values({
    email: "fictional-579-" + role + "-" + nonce + "-" + employer.label + "@example.invalid",
    name: "Fictional 579 " + role, passwordHash: "not-a-real-login", role, totpEnabled: true,
  }).returning();
  await db.insert(s.userOrganizations).values({
    organizationId: employer.org.id, userId: user.id, role, active: true,
  });
  const session = await standaloneMakeSession(user.id);
  await db.update(s.sessions).set({ mfaVerifiedAt: new Date() }).where(eq(s.sessions.id, session.id));
  return { id: user.id, cookie: session.cookie };
}
function punch(employee, date, start, end, breakStart, breakEnd, shiftStart = "09:00", shiftEnd = "18:00") {
  const instant = value => new Date(value + "+08:00");
  return {
    organizationId: employee.organizationId, employeeId: employee.id,
    workDate: date, timeIn: instant(date + "T" + start),
    timeOut: instant((end.includes("T") ? end : date + "T" + end)),
    breakStart: breakStart ? instant(breakStart) : null,
    breakEnd: breakEnd ? instant(breakEnd) : null,
    shiftStart, shiftEnd, status: "Complete", source: "fictional-579",
  };
}
async function setupEmployer(label) {
  const employer = await seedEmployer(label, nonce, standaloneMakeSession);
  employer.label = label;
  await db.update(s.organizations).set({ accountType: "enterprise" })
    .where(eq(s.organizations.id, employer.org.id));
  await db.update(s.employees).set({ status: "Inactive" }).where(eq(s.employees.id, employer.worker.id));
  const maker = await roleFor(employer, "payroll");
  const checker = await roleFor(employer, "checker");
  const hr = await roleFor(employer, "hr");
  assert.notEqual(maker.id, checker.id);
  assert.notEqual(checker.id, employer.owner.id);

  const people = await db.insert(s.employees).values(Array.from({ length: 25 }, (_, i) => ({
    organizationId: employer.org.id, legalEntityId: employer.entity.id, orgUnitId: employer.unit.id,
    employeeNo: "F579-" + label + "-" + String(i + 1).padStart(2, "0") + "-" + nonce,
    firstName: "Fictional", lastName: "Worker" + String(i + 1).padStart(2, "0"),
    title: "No-money QA", avatarInitials: "FQ",
    basicRate: moneyString(2600000 + i * 15500),
    startDate: i === 24 ? "2026-05-08" : "2026-01-05",
    restDay: "Sunday", bankCode: "FICT-ONLY",
    bankAccount: encryptBankAccount("FICTIONAL-NO-BANK-DESTINATION-" + label + "-" + nonce + "-" + i),
  }))).returning();
  await db.insert(s.employeePayProfiles).values(people.map((worker, i) => ({
    organizationId: employer.org.id, employeeId: worker.id,
    payBasis: "monthly", rateAmount: moneyString(2600000 + i * 15500),
    standardWorkDaysPerMonth: "22", standardHoursPerDay: "8",
  })));
  const punches = people.map((worker, i) =>
    punch(worker, i === 24 ? "2026-05-09" : "2026-05-06", "09:00", "18:00",
      (i === 24 ? "2026-05-09" : "2026-05-06") + "T12:00:00",
      (i === 24 ? "2026-05-09" : "2026-05-06") + "T13:00:00"));
  // Premium paths: night differential, approved OT, rest day, worked regular holiday.
  punches.push(punch(people[0], "2026-05-08", "22:00", "2026-05-09T06:00",
    "2026-05-09T01:00:00", "2026-05-09T02:00:00", "22:00", "06:00"));
  punches.push(punch(people[1], "2026-05-04", "09:00", "20:00",
    "2026-05-04T12:00:00", "2026-05-04T13:00:00"));
  punches.push(punch(people[2], "2026-05-03", "09:00", "18:00",
    "2026-05-03T12:00:00", "2026-05-03T13:00:00"));
  punches.push(punch(people[3], "2026-05-01", "09:00", "18:00",
    "2026-05-01T12:00:00", "2026-05-01T13:00:00"));
  await db.insert(s.timePunches).values(punches);
  await db.insert(s.overtimeRequests).values({
    organizationId: employer.org.id, employeeId: people[1].id,
    workDate: "2026-05-04", requestedMinutes: 120,
    reason: "Fictional overtime authorization", requestKind: "pre_approved",
    status: "approved", requestedBy: "Fictional manager",
    requestedByUserId: maker.id, decidedBy: "Fictional HR",
    decidedByUserId: hr.id, decidedAt: new Date(),
  });
  await db.insert(s.leavePolicies).values({
    organizationId: employer.org.id, leaveType: "Fictional paid leave",
    annualDays: "10.0", payTreatment: "paid", paidPercentage: "100", active: true,
  });
  await db.insert(s.leaveRequests).values({
    organizationId: employer.org.id, employeeId: people[4].id,
    leaveType: "Fictional paid leave", startDate: "2026-05-07", endDate: "2026-05-07",
    days: "1.0", status: "Approved", reason: "Approved fictional paid day",
    decidedBy: "Fictional HR",
  });
  const loanTypes = [
    "SSS Fictional Loan", "PhilHealth Fictional Loan",
    "Pag-IBIG Fictional Loan", "Company Fictional Loan",
  ];
  await db.insert(s.employeeLoans).values(loanTypes.map((type, i) => ({
    organizationId: employer.org.id, employeeId: people[i + 5].id,
    loanType: type, referenceNo: "FICTIONAL-TEST-LOAN-" + (i + 1),
    principal: "1800.00", monthlyAmortization: "300.00",
    cutoffDeduction: "150.00", remainingBalance: "1800.00",
    status: "active", requestedByUserId: maker.id, reviewedByUserId: checker.id,
    reviewedAt: new Date(), reviewEvidenceReference: "FICTIONAL-ONLY-REVIEW",
    deductionAuthorizationReference: "FICTIONAL-ONLY-NOT-LEGAL",
  })));
  const template = "Fictional 579 Amounts " + label + " " + nonce;
  await db.insert(s.bankTemplates).values({
    name: template, version: "fictional-v1", format: "CSV",
    mappings: { columns: ["employee_no", "amount"], includeHeader: true },
    adapterStage: "draft", specSource: "internal_demo",
  });
  return { employer, maker, checker, hr, people, template };
}
async function runEmployer(label) {
  summary.stage = label + ":seed";
  const { employer, maker, checker, hr, people, template } = await setupEmployer(label);
  summary.stage = label + ":attendance";
  // Strict cut-off and approved timesheet evidence use actual app HTTP endpoints.
  await call(employer, "/api/workforce/attendance-locks", "POST",
    { organizationId: employer.org.id, action: "set_policy", requirePayrollCutoffLock: true });
  await call(employer, "/api/workforce/timesheets", "POST",
    { organizationId: employer.org.id, action: "update_policy", enforcementMode: "block", active: true });
  for (const employee of people) {
    const sheet = (await call(employer, "/api/workforce/timesheets", "POST",
      { organizationId: employer.org.id, action: "submit",
        employeeId: employee.id, periodStart: period.periodStart, periodEnd: period.periodEnd }, 201)).json.timesheet;
    assert.ok(sheet?.id);
    await call(hr, "/api/workforce/timesheets", "POST", {
      organizationId: employer.org.id, action: "decide", timesheetId: sheet.id, decision: "approved",
    });
  }
  const creation = { organizationId: employer.org.id, legalEntityId: employer.entity.id, ...period, processNow: true };
  const beforeLock = await call(maker, "/api/payroll-runs", "POST", creation, 422);
  assert.equal(beforeLock.json?.code, "ATTENDANCE_CUTOFF_LOCK_REQUIRED");
  assert.equal((await db.select().from(s.payrollRuns).where(eq(s.payrollRuns.organizationId, employer.org.id))).length, 0);
  const lock = (await call(employer, "/api/workforce/attendance-locks", "POST", {
    organizationId: employer.org.id, action: "lock_period",
    lockType: "payroll_cutoff", periodStart: period.periodStart, periodEnd: period.periodEnd,
    reason: "Fictional May cutoff, no bank or money movement",
  }, 201)).json.lock;
  assert.ok(lock?.id);

  summary.stage = label + ":calculate";
  const key = "rehearsal-579-" + nonce + "-" + label;
  async function create() {
    const response = await fetch(new URL("/api/payroll-runs", base), {
      method: "POST", headers: {
        cookie: maker.cookie, origin: base.origin, "sec-fetch-site": "same-origin",
        "content-type": "application/json", "idempotency-key": key,
      }, body: JSON.stringify(creation),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error("CREATE_PAYROLL_" + response.status + "_" +
        String(body?.code || "NO_CODE").replace(/[^A-Z0-9_]/gi, "").slice(0, 48));
    }
    return response.json();
  }
  const created = await create();
  const runId = created.run?.id ?? created.id;
  assert.ok(Number.isInteger(runId));
  assert.equal((await create()).run?.id ?? runId, runId);
  const [run] = await db.select().from(s.payrollRuns).where(eq(s.payrollRuns.id, runId));
  const entries = await db.select().from(s.payrollEntries).where(eq(s.payrollEntries.payrollRunId, runId));
  assert.equal(entries.length, 25);
  reconcileFirstPayroll(run, entries);
  assert.equal(run.employeeCount, 25);
  const grossCents = entries.reduce((sum, x) => sum + moneyCents(x.grossPay), 0);
  const netCents = entries.reduce((sum, x) => sum + moneyCents(x.netPay), 0);
  assert.equal(grossCents, moneyCents(run.grossPay));
  assert.equal(netCents, moneyCents(run.netPay));

  summary.stage = label + ":maker-checker-owner";
  const submission = await call(maker, "/api/payroll-runs/" + runId + "/submit-review", "POST",
    { approverUserId: checker.id }, 201);
  const taskId = submission.json?.task?.id;
  assert.ok(taskId);
  await call(maker, "/api/approvals/" + taskId, "PATCH", { status: "Approved" }, 403);
  await call(checker, "/api/approvals/" + taskId, "PATCH", { status: "Approved" });
  await call(checker, "/api/payroll-runs/" + runId + "/release", "POST", {}, 403);
  await call(employer, "/api/payroll-runs/" + runId + "/release", "POST", {});
  const [released] = await db.select().from(s.payrollRuns).where(eq(s.payrollRuns.id, runId));
  assert.equal(released.status, "Released");

  summary.stage = label + ":exports";
  const register = await call(employer, "/api/payroll-runs?runId=" + runId + "&include=entries");
  assert.equal(register.json?.entries?.length, 25);
  assert.deepEqual(
    register.json.entries.map(x => x.netPay).sort(),
    entries.map(x => x.netPay).sort(),
  );
  const slips = await call(employer, "/api/payroll-runs/" + runId + "/exports?kind=payslip");
  assert.equal(slips.json?.payslips?.length, 25);
  assert.ok(slips.json.payslips.every(x => String(x.content).includes("Gross: PHP ")));
  const pdf = await call(employer, "/api/payroll-runs/" + runId + "/exports?kind=payslip&payslipId=" +
    slips.json.payslips[0].id);
  assert.ok(pdf.text.startsWith("%PDF-1.4"));

  const journalResponse = await call(employer, "/api/payroll-runs/" + runId + "/exports?kind=journal");
  const journalRows = csvRows(journalResponse.text);
  const debitAt = journalRows[0].indexOf("Debit"), creditAt = journalRows[0].indexOf("Credit");
  assert.ok(debitAt >= 0 && creditAt >= 0 && journalRows.length > 1);
  const debit = journalRows.slice(1).reduce((sum, row) => sum + moneyCents(row[debitAt] || "0"), 0);
  const credit = journalRows.slice(1).reduce((sum, row) => sum + moneyCents(row[creditAt] || "0"), 0);
  assert.equal(debit, credit, "GL debits and credits must balance");

  summary.stage = label + ":bank-dry-run-only";
  const bankPath = "/api/payroll-runs/" + runId + "/exports?kind=bank&template=" +
    encodeURIComponent(template) + "&dryRun=true";
  const bank = await call(employer, bankPath);
  assert.equal(bank.headers.get("x-linaw-dry-run"), "true");
  assert.ok(bank.text.startsWith("# DRY-RUN VALIDATION"));
  const bankCsv = bank.text.split(/\r?\n/).filter(line => line && !line.startsWith("#")).join("\n");
  const payoutRows = csvRows(bankCsv);
  assert.deepEqual(payoutRows[0], ["employee_no", "amount"]);
  assert.equal(payoutRows.length - 1, 25);
  const bankSum = payoutRows.slice(1).reduce((sum, row) => sum + moneyCents(row[1]), 0);
  assert.equal(bankSum, netCents, "Bank dry-run rows must equal the exact net-pay register");
  const events = await db.select().from(s.auditEvents)
    .where(and(eq(s.auditEvents.organizationId, employer.org.id)));
  const preview = events.find(x => x.action === "Bank file dry-run generated" &&
    Number(x.metadata?.runId) === runId);
  assert.ok(preview);
  assert.equal(preview.metadata.bankExportSha256, digest(bank.text));
  assert.equal(preview.metadata.bankExportTotalNet, moneyString(netCents));
  assert.equal(preview.metadata.bankExportRowCount, 25);
  for (const action of ["Payroll attendance cutoff locked", "Payroll submitted for review", "Payroll release receipt"]) {
    assert.ok(events.some(x => x.action === action), "Required audit event missing: " + action);
  }
  summary.checks.push("locked-cutoff", "timesheets-approved", "actual-calculation",
    "distinct-maker-checker-owner", "payslip-pdf", "payroll-register",
    "balanced-export-journal", "bank-preview-rows-only", "source-hashes");
  summary.employers.push({
    fixture: label, employeeCount: 25, entryCount: 25, payslipCount: 25,
    runStatus: "Released", grossPay: moneyString(grossCents), netPay: moneyString(netCents),
    journalDebits: moneyString(debit), journalCredits: moneyString(credit),
    bankDryRunRows: 25, bankDryRunTotal: moneyString(bankSum),
    hashes: {
      registerSha256: digest(JSON.stringify(register.json.entries)),
      payslipsSha256: digest(JSON.stringify(slips.json.payslips.map(x => x.content))),
      journalSha256: digest(journalResponse.text),
      bankDryRunSha256: digest(bank.text),
    },
    audit: {
      cutoffLocked: true, checkerApproved: true, ownerReleasedRecordsOnly: true,
      bankDryRunRecorded: true, bankFileSent: false,
    },
  });
  // Never persist raw preview bytes, filenames, salaries per worker, fictional bank strings or HMAC secret.
}
try {
  for (const label of ["ATTA", "ATTB"]) await runEmployer(label);
  summary.result = "PASS_SYNTHETIC_APP_PATH_ONLY";
  summary.stage = "complete";
} catch (error) {
  summary.result = "BLOCKED_SYNTHETIC_APP_PATH";
  summary.failureCode = String(error instanceof Error ? error.message : "UNKNOWN")
    .replace(/[^A-Z0-9_-]/gi, "").slice(0, 160);
} finally {
  mkdirSync("outputs", { recursive: true });
  writeFileSync("outputs/579-synthetic-no-money-summary.json", JSON.stringify(summary, null, 2));
  await pool.end();
}
if (summary.result !== "PASS_SYNTHETIC_APP_PATH_ONLY") {
  throw Error("Synthetic #579 application rehearsal blocked at " + summary.stage + ": " + summary.failureCode);
}
console.log("PASS: synthetic no-money HTTP payroll journey for two employers, 25 workers each; bank DRY RUN only");
