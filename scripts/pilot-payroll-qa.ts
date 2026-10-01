import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { db, pool } from "../src/db";
import { auditEvents, employees, payrollRuns, timePunches, userOrganizations, users } from "../src/db/schema";
import { hashPassword } from "../src/lib/crypto";
import { isEncryptedBankAccount } from "../src/lib/bank-account-crypto";

const base = process.env.QA_URL ?? "http://127.0.0.1:3000";
const setupToken = process.env.SETUP_TOKEN ?? "";
const readinessToken = process.env.READINESS_TOKEN ?? "";
const unique = randomUUID().replaceAll("-", "");
const credentials = {
  owner: `Owner!Aa1${unique.slice(0, 16)}`,
  payroll: `Payroll!Aa1${unique.slice(4, 20)}`,
  checker: `Checker!Aa1${unique.slice(8, 24)}`,
  employee: `Employee!Aa1${unique.slice(12, 28)}`,
};
const payoutAccounts = [`PILOT${unique.slice(0, 12)}`, `PILOT${unique.slice(12, 24)}`];

const report: Record<string, unknown> = {
  base,
  tenant: "fresh-non-demo",
  lifecycle: [],
  externalReadinessBlockers: [],
};

class ApiClient {
  cookie = "";
  async request(path: string, init: RequestInit & { json?: unknown } = {}) {
    const method = (init.method ?? "GET").toUpperCase();
    const headers = new Headers(init.headers ?? {});
    if (this.cookie) headers.set("cookie", this.cookie);
    if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) headers.set("origin", base);
    let body = init.body;
    if (init.json !== undefined) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(init.json);
    }
    const response = await fetch(`${base}${path}`, { ...init, method, headers, body });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";")[0];
    return response;
  }
  async json(path: string, init: RequestInit & { json?: unknown } = {}) {
    const response = await this.request(path, init);
    const payload = await response.json().catch(() => ({}));
    return { response, payload };
  }
}

async function expectOk(client: ApiClient, path: string, init: RequestInit & { json?: unknown } = {}) {
  const { response, payload } = await client.json(path, init);
  assert.ok(response.ok, `${init.method ?? "GET"} ${path} failed (${response.status}): ${JSON.stringify(payload)}`);
  return payload as Record<string, any>;
}

async function login(email: string, password: string) {
  const client = new ApiClient();
  await expectOk(client, "/api/auth/login", { method: "POST", json: { email, password } });
  assert.ok(client.cookie, `No session cookie for ${email}`);
  return client;
}

async function main() {
  assert.ok(setupToken && readinessToken, "Pilot QA tokens must be configured.");
  mkdirSync("qa-artifacts", { recursive: true });

  const bootstrap = new ApiClient();
  const setup = await expectOk(bootstrap, "/api/setup", {
    method: "POST",
    headers: { "x-setup-token": setupToken },
    json: {
      companyName: "Pilot Works PH",
      legalName: "Pilot Works Philippines Inc.",
      name: "Olivia Owner",
      email: "owner.pilot@linaw.test",
      password: credentials.owner,
    },
  });
  const organizationId = Number(setup.organizationId);
  assert.ok(organizationId > 0, "Setup returned no organization id.");
  report.organizationId = organizationId;
  (report.lifecycle as string[]).push("workspace-created");

  // Login boots only global reference data when DEMO_MODE=false.
  const owner = await login("owner.pilot@linaw.test", credentials.owner);

  const inputs = [
    { employeeNo: "PILOT-001", firstName: "Ella", middleName: "Marie", lastName: "Employee", email: "ella.employee@linaw.test", title: "Operations Specialist", rateAmount: 42000, bankAccount: payoutAccounts[0], mobile: "QA-MOBILE-001", tin: "QA-TIN-001", sssNo: "QA-SSS-001", philHealthNo: "QA-PHIC-001", pagIbigNo: "QA-HDMF-001", startDate: "2026-01-05" },
    { employeeNo: "PILOT-002", firstName: "Mara", middleName: "Luz", lastName: "Santos", email: "mara.santos@linaw.test", title: "Customer Success Specialist", rateAmount: 36000, bankAccount: payoutAccounts[1], mobile: "QA-MOBILE-002", tin: "QA-TIN-002", sssNo: "QA-SSS-002", philHealthNo: "QA-PHIC-002", pagIbigNo: "QA-HDMF-002", startDate: "2026-02-10" },
  ];

  const created: Array<{ id: number; employeeNo: string }> = [];
  for (const input of inputs) {
    const payload = await expectOk(owner, "/api/employees", {
      method: "POST",
      json: {
        organizationId,
        ...input,
        payBasis: "monthly",
        standardWorkDaysPerMonth: 22,
        standardHoursPerDay: 8,
        region: "NCR",
        bankCode: "BDO",
        tinBranchCode: "0000",
      },
    });
    assert.match(String(payload.employee?.bankAccount ?? ""), /^••••.{4}$/, "Bank account must be masked in API output.");
    created.push({ id: Number(payload.employee.id), employeeNo: String(payload.employee.employeeNo) });
  }
  (report.lifecycle as string[]).push("employees-created-with-payout-details");

  const stored = await db.select().from(employees).where(eq(employees.organizationId, organizationId));
  assert.equal(stored.length, 2);
  for (const row of stored) {
    assert.equal(isEncryptedBankAccount(row.bankAccount), true, `${row.employeeNo} payout account is not encrypted.`);
  }
  (report.lifecycle as string[]).push("bank-data-encryption-proven");

  const [payrollUser, checkerUser, employeeUser] = await db.insert(users).values([
    { email: "payroll.pilot@linaw.test", name: "Peter Payroll", passwordHash: hashPassword(credentials.payroll), role: "payroll", totpEnabled: false, backupCodes: [] },
    { email: "checker.pilot@linaw.test", name: "Casey Checker", passwordHash: hashPassword(credentials.checker), role: "checker", totpEnabled: false, backupCodes: [] },
    { email: "ella.employee@linaw.test", name: "Ella Employee", passwordHash: hashPassword(credentials.employee), role: "employee", employeeId: created[0].id, totpEnabled: false, backupCodes: [] },
  ]).returning();
  await db.insert(userOrganizations).values([
    { userId: payrollUser.id, organizationId, role: "payroll", orgUnitId: null },
    { userId: checkerUser.id, organizationId, role: "checker", orgUnitId: null },
    { userId: employeeUser.id, organizationId, role: "employee", orgUnitId: null },
  ]);
  report.roles = { owner: "Olivia Owner", payroll: payrollUser.name, checker: checkerUser.name, employee: employeeUser.name };
  (report.lifecycle as string[]).push("real-role-identities-created");

  const dates = ["2026-09-16", "2026-09-17", "2026-09-18"];
  await db.insert(timePunches).values(created.flatMap((person) => dates.map((workDate) => ({
    organizationId,
    employeeId: person.id,
    workDate,
    timeIn: new Date(`${workDate}T01:00:00.000Z`),
    timeOut: new Date(`${workDate}T10:00:00.000Z`),
    shiftStart: "09:00",
    shiftEnd: "18:00",
    status: "Complete",
    source: "pilot-qa",
  }))));
  (report.lifecycle as string[]).push("attendance-recorded");

  const payroll = await login(payrollUser.email, credentials.payroll);
  const checker = await login(checkerUser.email, credentials.checker);
  const employee = await login(employeeUser.email, credentials.employee);

  const runPayload = await expectOk(payroll, "/api/payroll-runs", {
    method: "POST",
    json: { organizationId, periodStart: "2026-09-16", periodEnd: "2026-09-30", payDate: "2026-10-05", processNow: true },
  });
  const runId = Number(runPayload.run?.id);
  assert.ok(runId > 0);
  assert.ok(["Needs review", "Processed"].includes(String(runPayload.run?.status)));
  assert.equal(Number(runPayload.run?.exceptions), 0, "Pilot calculation must have zero engine exceptions.");
  report.runId = runId;
  (report.lifecycle as string[]).push("payroll-calculated");

  const register = await expectOk(payroll, `/api/payroll-runs?runId=${runId}&include=entries`);
  assert.equal(register.entries?.length, 2);
  assert.ok(register.entries.every((entry: any) => Number(entry.netPay) > 0));

  const before = await expectOk(payroll, `/api/payroll-runs/${runId}/release-checklist`);
  const blockers = (before.items ?? []).filter((item: any) => item.blocking && !item.passed);
  assert.deepEqual(blockers.map((item: any) => item.key), ["approval"], `Unexpected pre-approval blockers: ${JSON.stringify(blockers)}`);
  (report.lifecycle as string[]).push("release-checklist-clean-before-approval");

  const approvers = await expectOk(payroll, `/api/organizations/${organizationId}/payroll-approvers`);
  assert.ok((approvers.approvers ?? []).some((item: any) => item.id === checkerUser.id), "Checker is absent from approver discovery.");

  const submission = await expectOk(payroll, `/api/payroll-runs/${runId}/submit-review`, {
    method: "POST",
    json: { approverUserId: checkerUser.id },
  });
  assert.ok(submission.task?.id);
  (report.lifecycle as string[]).push("payroll-submitted-by-payroll-officer");

  await expectOk(checker, `/api/approvals/${submission.task.id}`, { method: "PATCH", json: { status: "Approved" } });
  (report.lifecycle as string[]).push("payroll-approved-by-independent-checker");

  const approved = await expectOk(owner, `/api/payroll-runs/${runId}/release-checklist`);
  assert.equal(approved.ready, true, `Approved payroll is not release-ready: ${JSON.stringify(approved.items)}`);

  const release = await expectOk(owner, `/api/payroll-runs/${runId}/release`, { method: "POST", json: { acknowledgeExceptions: false } });
  assert.equal(Number(release.receipt?.employeeCount), 2);
  assert.ok(Number(release.receipt?.totalNetPay) > 0);
  assert.equal(release.receipt?.bankExport?.status, "waiting");
  assert.ok(Number(release.receipt?.payslips?.available) >= 2);
  (report.lifecycle as string[]).push("owner-released-payroll");

  const bank = await owner.request(`/api/payroll-runs/${runId}/exports?kind=bank&template=${encodeURIComponent("BDO DAT")}&dryRun=false`);
  const bankBody = await bank.text();
  assert.ok(bank.ok, `Final bank file failed (${bank.status}): ${bankBody}`);
  assert.equal(bank.headers.get("x-linaw-dry-run"), "false");
  assert.ok(payoutAccounts.every((account) => bankBody.includes(account)), "Final bank file did not decrypt captured payout destinations.");
  (report.lifecycle as string[]).push("final-bank-file-generated");

  const payout = await expectOk(owner, `/api/payroll-runs/${runId}/exports`, {
    method: "POST",
    json: { mode: "complete-manual", reference: `PILOT-${unique.slice(0, 12)}`, confirmed: true },
  });
  assert.equal(payout.completed, true);
  assert.equal(payout.moneyMovedByLinaw, false);
  (report.lifecycle as string[]).push("external-payout-confirmed");

  const self = await expectOk(employee, "/api/self/payslips");
  const slip = (self.payslips ?? []).find((row: any) => row.period.includes("Sep 16") && row.period.includes("Sep 30"));
  assert.ok(slip, "Released payslip is missing from employee self-service.");
  const pdf = await employee.request(`/api/self/payslips/${slip.entryId}`);
  assert.ok(pdf.ok);
  assert.match(pdf.headers.get("content-type") ?? "", /application\/pdf/);
  assert.ok((await pdf.arrayBuffer()).byteLength > 500);
  (report.lifecycle as string[]).push("employee-payslip-available");

  const [finalRun] = await db.select().from(payrollRuns).where(and(eq(payrollRuns.id, runId), eq(payrollRuns.organizationId, organizationId))).limit(1);
  assert.equal(finalRun?.status, "Released");

  const events = await db.select().from(auditEvents).where(eq(auditEvents.organizationId, organizationId));
  const actions = new Set(events.map((event) => event.action));
  const expectedActions = ["Payroll submitted for review", "Approval approved", "Payroll released", "bank export generated", "Payroll payout completed manually"];
  for (const action of expectedActions) assert.ok(actions.has(action), `Missing audit event: ${action}`);
  report.auditEventsVerified = expectedActions;

  const readinessResponse = await fetch(`${base}/api/readiness`, { headers: { "x-readiness-token": readinessToken } });
  assert.ok(readinessResponse.ok);
  const readiness = await readinessResponse.json();
  report.externalReadinessBlockers = (readiness.gates ?? [])
    .filter((gate: any) => gate.blocks === "launch" && !gate.ready)
    .map((gate: any) => ({ key: gate.key, label: gate.label, manualWorkaround: gate.manualWorkaround ?? null }));
  report.readiness = {
    status: readiness.status,
    launchBlockersRemaining: readiness.launchBlockersRemaining,
    manualLaunchReady: readiness.manualLaunch?.ready ?? false,
  };
  report.result = "passed";
  writeFileSync("qa-artifacts/pilot-payroll-report.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error) => {
    report.result = "failed";
    report.error = error instanceof Error ? error.stack ?? error.message : String(error);
    mkdirSync("qa-artifacts", { recursive: true });
    writeFileSync("qa-artifacts/pilot-payroll-report.json", JSON.stringify(report, null, 2));
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
