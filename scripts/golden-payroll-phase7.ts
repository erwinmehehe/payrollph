/**
 * Golden payroll certification, Phase 7: separation (final) pay.
 * Regular payroll runs do not compute 13th-month pay, so this is the path that does. It runs the real computeFinalPay
 * and calculateLeaveMonetizationPay / finalPayDueDate functions and compares every value to immutable literals in
 * certification/golden-payroll-phase7.json. Expected values are never computed with PayrollPH functions.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { calculateLeaveMonetizationPay, computeFinalPay, finalPayDueDate } from "../src/lib/final-pay";

type CaseInput = {
  releasedBasicYtd: number; unpaidBasicSalary: number; grossCompensationYtd: number; statutoryContributionsYtd: number; taxWithheldYtd: number;
  thirteenthPaidYtd?: number; mwe?: boolean; leaveDays?: number; leaveDailyRate?: number; separationPay?: number; taxableSeparationPay?: number; loanDeductions?: number;
};
type Catalog = {
  version: string;
  toleranceCentavos: number;
  sources: Record<string, string>;
  assumptions: string[];
  cases: Record<string, { description: string; input: CaseInput; expected: Record<string, number>; outcome: string }>;
  leaveMonetization: Array<{ description: string; days: number; dailyRate: number; expected: number }>;
  dueDates: Array<{ description: string; lastDay: string; expected: string }>;
  limitations: string[];
};

const catalogPath = "certification/golden-payroll-phase7.json";
const artifactPath = "qa-artifacts/golden-payroll-phase7-reconciliation.json";

const cents = (value: number, label: string) => {
  assert.ok(Number.isFinite(value), `${label}: non-finite amount`);
  const result = Math.round((value + Number.EPSILON) * 100);
  assert.ok(Number.isSafeInteger(result), `${label}: unsafe centavo amount`);
  return result;
};

function runCase(input: CaseInput) {
  const leave = input.leaveDays ? calculateLeaveMonetizationPay(input.leaveDays, input.leaveDailyRate ?? 0) : 0;
  return computeFinalPay({
    releasedBasicYtd: input.releasedBasicYtd,
    historicalBasicYtd: 0,
    unpaidBasicSalary: input.unpaidBasicSalary,
    thirteenthPaidYtd: input.thirteenthPaidYtd ?? 0,
    grossCompensationYtd: input.grossCompensationYtd,
    statutoryContributionsYtd: input.statutoryContributionsYtd,
    taxWithheldYtd: input.taxWithheldYtd,
    mwe: input.mwe ?? false,
    leaveMonetizationPay: leave,
    separationPay: input.separationPay ?? 0,
    ...(input.taxableSeparationPay === undefined ? {} : { taxableSeparationPay: input.taxableSeparationPay }),
    retirementPay: 0,
    otherBenefits: 0,
    loanDeductions: input.loanDeductions ?? 0,
  });
}

function main() {
  const raw = readFileSync(catalogPath, "utf8");
  const catalog = JSON.parse(raw) as Catalog;
  assert.equal(catalog.toleranceCentavos, 0, "Phase 7 compares exact centavos");
  const results: Array<{ id: string; status: "passed" | "failed"; expected: unknown; actual?: unknown; failures: string[] }> = [];

  for (const [id, { input, expected, outcome }] of Object.entries(catalog.cases)) {
    const failures: string[] = [];
    let actual: Record<string, number | string> | undefined;
    try {
      const result = runCase(input) as unknown as Record<string, number | string>;
      actual = {};
      for (const key of Object.keys(expected)) {
        assert.ok(key in result, `${id}: unknown expected key ${key}`);
        actual[key] = result[key];
        const got = Number(result[key]);
        if (!Number.isFinite(got) || cents(got, id) !== cents(expected[key], id)) failures.push(`${key}: expected ₱${expected[key].toFixed(2)}, got ₱${got.toFixed(2)}`);
      }
      actual.taxOutcome = result.taxOutcome;
      if (result.taxOutcome !== outcome) failures.push(`taxOutcome: expected ${outcome}, got ${String(result.taxOutcome)}`);
      // The payout can never invent money: net equals what remains after tax, statutory deductions and loans.
      const net = cents(Number(result.netFinalPay), id);
      const gross = cents(Number(result.grossFinalPay), id);
      const taxAdjustment = cents(Number(result.taxAdjustment), id);
      const loans = cents(Number(result.loanDeductions), id);
      const expectedNet = Math.max(0, gross + Math.max(0, taxAdjustment) - cents(Number(result.appliedTaxCollection), id) - cents(Number(result.appliedStatutoryDeductions), id) - loans);
      if (net !== expectedNet) failures.push(`net does not reconcile: ${net} vs ${expectedNet} centavos`);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
    results.push({ id, status: failures.length ? "failed" : "passed", expected: { ...expected, taxOutcome: outcome }, actual, failures });
  }

  catalog.leaveMonetization.forEach((item, index) => {
    const id = `leaveMonetization[${index}]`;
    const failures: string[] = [];
    let actual: number | undefined;
    try {
      actual = calculateLeaveMonetizationPay(item.days, item.dailyRate);
      if (cents(actual, id) !== cents(item.expected, id)) failures.push(`expected ₱${item.expected.toFixed(2)}, got ₱${actual.toFixed(2)}`);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
    results.push({ id, status: failures.length ? "failed" : "passed", expected: item.expected, actual, failures });
  });
  // Invalid leave inputs must fail closed rather than pay a negative or non-finite amount.
  for (const [days, rate] of [[-1, 1000], [Number.NaN, 1000], [5, 0], [5, -10]] as const) {
    const id = `leaveMonetizationRejects(${days},${rate})`;
    let threw = false;
    try { calculateLeaveMonetizationPay(days, rate); } catch { threw = true; }
    results.push({ id, status: threw ? "passed" : "failed", expected: "throws", failures: threw ? [] : ["accepted an invalid input"] });
  }

  catalog.dueDates.forEach((item, index) => {
    const id = `dueDate[${index}]`;
    const actual = finalPayDueDate(item.lastDay);
    results.push({ id, status: actual === item.expected ? "passed" : "failed", expected: item.expected, actual, failures: actual === item.expected ? [] : [`expected ${item.expected}, got ${actual}`] });
  });

  const failed = results.filter((r) => r.status === "failed");
  mkdirSync("qa-artifacts", { recursive: true });
  writeFileSync(artifactPath, JSON.stringify({
    version: catalog.version,
    catalogSha256: createHash("sha256").update(raw).digest("hex"),
    status: failed.length ? "failed" : "passed",
    caseCount: results.length,
    sources: catalog.sources,
    assumptions: catalog.assumptions,
    results,
    limitations: catalog.limitations,
  }, null, 2) + "\n");
  for (const r of failed) console.error(`FAILED ${r.id}\n  ${r.failures.join("\n  ")}`);
  console.log(JSON.stringify({ status: failed.length ? "failed" : "passed", caseCount: results.length, failed: failed.map((r) => r.id) }, null, 2));
  if (failed.length) process.exitCode = 1;
}

main();
