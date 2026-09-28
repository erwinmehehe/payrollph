import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { employees, organizations, payrollEntries, payrollRuns } from "../src/db/schema";
import {
  buildBatchTransferPayload,
  choosePayrollRail,
  matchReceivingInstitution,
  preflightPaymongoPayrollDisbursement,
  type PayrollPayoutRow,
} from "../src/lib/paymongo-disbursements";

function row(overrides: Partial<PayrollPayoutRow> = {}): PayrollPayoutRow {
  return {
    employeeNo: "E-001",
    employeeName: "Juan Dela Cruz",
    accountNumber: "1234567890",
    bankName: "BDO",
    amountCents: 5_000_00,
    referenceNumber: "PAY-1-E-001",
    ...overrides,
  };
}

test("a real payroll batch (>1 employee) always uses PESONet, per PayMongo's own payroll guidance", () => {
  const rows = [row(), row({ employeeNo: "E-002" })];
  assert.equal(choosePayrollRail(rows), "pesonet");
});

test("a payroll batch is routed to PESONet even when every row is individually under the InstaPay cap", () => {
  const rows = [row({ amountCents: 10_00 }), row({ employeeNo: "E-002", amountCents: 10_00 })];
  assert.equal(choosePayrollRail(rows), "pesonet");
});

test("a single small correction payout can use InstaPay", () => {
  const rows = [row({ amountCents: 20_000_00 })];
  assert.equal(choosePayrollRail(rows), "instapay");
});

test("a single payout over the InstaPay cap still uses PESONet", () => {
  const rows = [row({ amountCents: 60_000_00 })];
  assert.equal(choosePayrollRail(rows), "pesonet");
});

test("PESONet is used for a batch that mixes small and large amounts, matching PayMongo's one-rail-per-batch rule", () => {
  const rows = [row({ amountCents: 10_00 }), row({ employeeNo: "E-002", amountCents: 60_000_00 })];
  assert.equal(choosePayrollRail(rows), "pesonet");
});

test("matchReceivingInstitution finds a bank by partial, case-insensitive name", () => {
  const institutions = [
    { name: "BDO Unibank", bic: "BNORPHMM" },
    { name: "Bank of the Philippine Islands", bic: "BOPIPHMM" },
  ];
  assert.equal(matchReceivingInstitution("bdo", institutions).bic, "BNORPHMM");
});

test("matchReceivingInstitution throws rather than guessing when nothing matches", () => {
  assert.throws(
    () => matchReceivingInstitution("Some Unlisted Bank", [{ name: "BDO Unibank", bic: "BNORPHMM" }]),
    /No receiving institution matched/,
  );
});

test("buildBatchTransferPayload produces the documented Transfer V2 field shape", () => {
  const rows = [row(), row({ employeeNo: "E-002", employeeName: "Maria Santos", bankName: "BPI" })];
  const bics = new Map([
    ["BDO", "BNORPHMM"],
    ["BPI", "BOPIPHMM"],
  ]);
  const payload = buildBatchTransferPayload(rows, "pesonet", bics);

  assert.equal(payload.transfers.length, 2);
  assert.deepEqual(payload.transfers[0], {
    provider: "pesonet",
    amount: 5_000_00,
    currency: "PHP",
    destination_account: {
      number: "1234567890",
      name: "Juan Dela Cruz",
      bic: "BNORPHMM",
    },
    reference_number: "PAY-1-E-001",
    purpose: "Payroll disbursement",
    description: "Payroll payout for Juan Dela Cruz (E-001)",
  });
  assert.equal(payload.transfers[1].destination_account.bic, "BOPIPHMM");
});

test("buildBatchTransferPayload refuses to silently omit a BIC it couldn't resolve", () => {
  const rows = [row({ bankName: "Unmapped Bank" })];
  assert.throws(() => buildBatchTransferPayload(rows, "pesonet", new Map()), /No resolved BIC/);
});


test("PayMongo payroll preflight validates live bank mapping without creating a transfer", async () => {
  const [org] = await db.insert(organizations).values({
    name: "PayMongo Preflight Test",
    legalName: "PayMongo Preflight Test Inc.",
  }).returning();

  const previousSecret = process.env.PAYMONGO_SECRET_KEY;
  const previousFetch = globalThis.fetch;
  const requestedUrls: string[] = [];

  try {
    const [employee] = await db.insert(employees).values({
      organizationId: org.id,
      employeeNo: "PAY-001",
      firstName: "Juan",
      lastName: "Dela Cruz",
      title: "Staff",
      avatarInitials: "JD",
      basicRate: "30000",
      bankAccount: "1234567890",
      bankCode: "BDO",
      startDate: "2026-01-01",
    }).returning();

    const [run] = await db.insert(payrollRuns).values({
      organizationId: org.id,
      periodLabel: "Sep 16–30, 2026",
      periodStart: "2026-09-16",
      periodEnd: "2026-09-30",
      payDate: "2026-09-30",
      status: "Released",
    }).returning();

    await db.insert(payrollEntries).values({
      payrollRunId: run.id,
      employeeId: employee.id,
      grossPay: "30000",
      deductions: "5000",
      netPay: "25000",
    });

    process.env.PAYMONGO_SECRET_KEY = "sk_test_preflight_only";
    globalThis.fetch = async (input) => {
      const url = String(input);
      requestedUrls.push(url);
      assert.ok(url.includes("/v2/transfers/receiving_institutions"), "preflight must only read receiving institutions");
      assert.ok(!url.includes("/v2/batch_transfers"), "preflight must never create a batch transfer");
      return new Response(JSON.stringify({
        data: [{ attributes: { name: "BDO Unibank", bic: "BNORPHMM" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    };

    const result = await preflightPaymongoPayrollDisbursement(run.id);
    assert.equal(result.ready, true);
    assert.equal(result.employeeCount, 1);
    assert.equal(result.totalAmountCents, 2_500_000);
    assert.equal(result.provider, "instapay");
    assert.deepEqual(result.banks, [{ bankName: "BDO", bic: "BNORPHMM" }]);
    assert.equal(requestedUrls.length, 1);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousSecret === undefined) delete process.env.PAYMONGO_SECRET_KEY;
    else process.env.PAYMONGO_SECRET_KEY = previousSecret;
    await db.delete(organizations).where(eq(organizations.id, org.id));
  }
});
