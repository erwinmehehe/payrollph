import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("proprietary bank exports require bank-provided mappings and Metrobank XLS", () => {
  const source = readFileSync("src/lib/exporters.ts", "utf8");
  assert.ok(source.includes("explicit bank-provided template mapping"));
  assert.ok(source.includes("bank-provided formatted .xls template"));
  assert.ok(!source.includes("Standard Universal Bank CSV"));
});

test("Pag-IBIG worksheet follows published MCRF columns", () => {
  const source = readFileSync("src/lib/exporters.ts", "utf8");
  assert.ok(source.includes("MembershipProgram"));
  assert.ok(source.includes("PeriodCovered"));
  assert.ok(source.includes('"F1"'));
  assert.ok(source.includes("periodCovered"));
});

test("BIR 1601-C is explicitly monthly and aggregates month runs", () => {
  const source = readFileSync("src/lib/exporters.ts", "utf8");
  assert.ok(source.includes("BIR Form 1601-C is a monthly remittance return"));
  assert.ok(source.includes("monthRuns"));
  assert.ok(source.includes("monthEntries"));
  assert.ok(source.includes("PayrollRunsIncluded"));
});
