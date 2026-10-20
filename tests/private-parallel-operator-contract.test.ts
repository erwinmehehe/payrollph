/**
 * Synthetic-only regression for the private, no-money parallel payroll verifier.
 *
 * IMPORTANT: this suite creates fictional employee keys and payroll amounts in a
 * disposable temp directory. No production database, bank, agency, or external
 * service is used; passing tests never mean a real employer was reconciled.
 */
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { linkSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  evaluateParallelPayrollReconciliation,
  JOURNAL_COLUMNS,
  PAYROLL_COLUMNS,
  type ParallelCycle,
  type ParallelReconciliationManifest,
} from "../src/lib/private-parallel-payroll-reconciliation";

const ENTITY = "SYNTHETIC_EMPLOYER";
const MONTH_A = "2026-07";
const MONTH_B = "2026-08";
const PEOPLE = 10;

type Money = {
  gross: number;
  net: number;
  sssEe: number;
  sssEr: number;
  ecEr: number;
  phicEe: number;
  phicEr: number;
  hdmfEe: number;
  hdmfEr: number;
  wht: number;
};

function employeeKey(index: number) {
  // This is a fixed fictional test key only, never for real payroll intake.
  return createHmac("sha256", "synthetic-only-do-not-use-for-real-workers")
    .update("fictional-worker-" + index).digest("hex");
}

function amounts(index: number, corrupt: boolean): Money {
  const gross = 10000 + 10 * index;
  const sssEe = 500 + (corrupt && index === 1 ? 0.02 : 0);
  const phicEe = 250;
  const hdmfEe = 100;
  const wht = 100;
  return {
    gross, net: gross - sssEe - phicEe - hdmfEe - wht,
    sssEe, sssEr: 1000, ecEr: 10,
    phicEe, phicEr: 250,
    hdmfEe, hdmfEr: 100, wht,
  };
}

function peso(amount: number) {
  return amount.toFixed(2);
}

function payrollCsv(period: string, corrupt: boolean) {
  const rows = Array.from({ length: PEOPLE }, (_, n) => {
    const amount = amounts(n, corrupt);
    return [
      employeeKey(n), ENTITY, period,
      peso(amount.gross), peso(amount.gross - 1000),
      peso(amount.sssEe), peso(amount.phicEe), peso(amount.hdmfEe),
      peso(amount.wht), "0.00", "0.00", "0.00", peso(amount.net),
      peso(amount.sssEr), peso(amount.ecEr), peso(amount.phicEr), peso(amount.hdmfEr),
    ].join(",");
  });
  return [...PAYROLL_COLUMNS,].join(",") + "\n" + rows.join("\n") + "\n";
}

function journalCsv(period: string) {
  // Both journals independently reconcile to the uncorrupted employee rows.
  const values = Array.from({ length: PEOPLE }, (_, n) => amounts(n, false));
  const sum = (key: keyof Money) => values.reduce((a, v) => a + v[key], 0);
  const controls: Array<[string, number, number]> = [
    ["PAYROLL_GROSS", sum("gross"), 0],
    ["BANK_NET", 0, sum("net")],
    ["EMPLOYER_STATUTORY_EXPENSE", sum("sssEr") + sum("ecEr") + sum("phicEr") + sum("hdmfEr"), 0],
    ["SSS_PAYABLE", 0, sum("sssEe") + sum("sssEr") + sum("ecEr")],
    ["PHILHEALTH_PAYABLE", 0, sum("phicEe") + sum("phicEr")],
    ["PAGIBIG_PAYABLE", 0, sum("hdmfEe") + sum("hdmfEr")],
    ["BIR_WHT_PAYABLE", 0, sum("wht")],
  ];
  return JOURNAL_COLUMNS.join(",") + "\n" + controls.map(([code, debit, credit]) =>
    [code, ENTITY, period, peso(debit), peso(credit)].join(",")
  ).join("\n") + "\n";
}

function save(root: string, name: string, content: string) {
  const filePath = name + ".csv";
  const bytes = Buffer.from(content, "utf8");
  writeFileSync(join(root, filePath), bytes, { flag: "wx" });
  return { filePath, sha256: createHash("sha256").update(bytes).digest("hex") };
}

function cycle(root: string, month: string, options: { corruptPayroll?: boolean } = {}): ParallelCycle {
  const safePeriod = month.replace("-", "");
  return {
    period: month,
    incumbentPayroll: save(root, safePeriod + "-incumbent-payroll", payrollCsv(month, false)),
    linawPayroll: save(root, safePeriod + "-linaw-payroll", payrollCsv(month, !!options.corruptPayroll)),
    incumbentJournal: save(root, safePeriod + "-incumbent-journal", journalCsv(month)),
    linawJournal: save(root, safePeriod + "-linaw-journal", journalCsv(month)),
  };
}

function manifest(cycles: ParallelCycle[]): ParallelReconciliationManifest {
  return { schemaVersion: 1, legalEntityCode: ENTITY, cycles };
}

function tempRoot(t: { after: (fn: () => void) => void }) {
  const root = mkdtempSync(join(tmpdir(), "payrollph-synthetic-parallel-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test("synthetic one-month --pilot passes while certification mode blocks one month", (t) => {
  const root = tempRoot(t);
  const data = manifest([cycle(root, MONTH_A)]);
  const pilot = evaluateParallelPayrollReconciliation(data, root, { mode: "pilot" });
  assert.equal(pilot.status, "pilot-arithmetic-reconciled-pending-independent-review");
  assert.deepEqual(pilot.issues, []);
  assert.equal(pilot.verifiedFileHashCount, 4);
  assert.equal(pilot.results[0].matchedEmployees, PEOPLE);

  const certification = evaluateParallelPayrollReconciliation(data, root);
  assert.equal(certification.status, "reconciliation-blocked");
  assert.ok(certification.issues.some(x => x.includes("Two to twelve distinct")));
});

test("two distinct months with ten matched fictional workers each pass arithmetic only", (t) => {
  const root = tempRoot(t);
  const data = manifest([cycle(root, MONTH_A), cycle(root, MONTH_B)]);
  const report = evaluateParallelPayrollReconciliation(data, root);
  assert.equal(report.status, "arithmetic-reconciled-pending-independent-review");
  assert.deepEqual(report.issues, []);
  assert.equal(report.verifiedFileHashCount, 8);
  assert.deepEqual(report.results.map(row => row.matchedEmployees), [PEOPLE, PEOPLE]);
  assert.ok(report.disclaimer.includes("not"));
  assert.equal("gaApproved" in report, false); // This checker never confers GA authority.
});

test("a two-cent employee discrepancy blocks even if gross-to-net identity is maintained", (t) => {
  const root = tempRoot(t);
  const data = manifest([cycle(root, MONTH_A, { corruptPayroll: true })]);
  const report = evaluateParallelPayrollReconciliation(data, root, { mode: "pilot" });
  assert.equal(report.status, "reconciliation-blocked");
  assert.ok(report.issues.some(issue => issue.includes("payroll sss_ee")));
  assert.ok(report.issues.some(issue => issue.includes("payroll net_pay")));
  // No fictional worker key or individual wage is printed in the report.
  const text = JSON.stringify(report);
  assert.ok(!text.includes(employeeKey(1)));
  assert.ok(!text.includes("10010.00"));
});

test("same source path reused for incumbent and PayrollPH is rejected", (t) => {
  const root = tempRoot(t);
  const record = cycle(root, MONTH_A);
  record.linawPayroll = { ...record.incumbentPayroll };
  const report = evaluateParallelPayrollReconciliation(manifest([record]), root, { mode: "pilot" });
  assert.equal(report.status, "reconciliation-blocked");
  assert.ok(report.issues.some(issue => issue.includes("file reused")));
});

test("hard-linked source alias is rejected even with independent file names", (t) => {
  const root = tempRoot(t);
  const record = cycle(root, MONTH_A);
  const alias = "202607-alias-payroll.csv";
  linkSync(join(root, record.incumbentPayroll.filePath), join(root, alias));
  record.linawPayroll = { ...record.incumbentPayroll, filePath: alias };
  const report = evaluateParallelPayrollReconciliation(manifest([record]), root, { mode: "pilot" });
  assert.equal(report.status, "reconciliation-blocked");
  assert.ok(report.issues.some(issue => issue.includes("file reused")));
});

test("extra PII-shaped canonical CSV field is rejected before comparison", (t) => {
  const root = tempRoot(t);
  const record = cycle(root, MONTH_A);
  const location = join(root, record.linawPayroll.filePath);
  const original = readFileSync(location, "utf8");
  const revised = original.replace("employee_key,legal_entity_code", "employee_key,bank_account,legal_entity_code");
  writeFileSync(location, revised);
  record.linawPayroll.sha256 = createHash("sha256").update(revised).digest("hex");
  const report = evaluateParallelPayrollReconciliation(manifest([record]), root, { mode: "pilot" });
  assert.equal(report.status, "reconciliation-blocked");
  assert.ok(report.issues.some(issue => issue.includes("Unexpected CSV columns")));
  assert.ok(!JSON.stringify(report).includes("bank_account"));
});
