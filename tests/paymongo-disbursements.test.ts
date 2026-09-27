import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBatchTransferPayload,
  choosePayrollRail,
  matchReceivingInstitution,
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
