import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/lib/exporters.ts", "utf8");
const helper = readFileSync("src/lib/payroll-export-tenant-ownership.ts", "utf8");
const bankStart = source.indexOf("export async function generateBankFile(");
const journalStart = source.indexOf("export async function generateJournalCsv(");
const governmentStart = source.indexOf("export async function generateGovernmentDraft(");
assert.ok(bankStart >= 0 && journalStart > bankStart && governmentStart > journalStart);

const bank = source.slice(bankStart, journalStart);
const journal = source.slice(journalStart, governmentStart);
const government = source.slice(governmentStart);

function guardedBefore(section, guard, sensitiveOperation) {
  const guardAt = section.indexOf(guard);
  const sensitiveAt = section.indexOf(sensitiveOperation);
  return guardAt >= 0 && sensitiveAt > guardAt;
}

test("all five payroll-export employee joins verify actual worker employer", () => {
  assert.match(source, /import \{ assertPayrollExportTenantOwnership \} from "@\/lib\/payroll-export-tenant-ownership";/);
  assert.equal((source.match(/\.innerJoin\(employees/g) ?? []).length, 5,
    "new payroll worker joins require their own ownership verification");
  assert.equal((source.match(/assertPayrollExportTenantOwnership\(run\.organizationId, /g) ?? []).length, 5,
    "all five current, monthly and annual export populations need a guard");
  for (const [part, guard, before] of [
    [bank, "assertPayrollExportTenantOwnership(run.organizationId, entries);", "const rows = entries.map("],
    [journal, "assertPayrollExportTenantOwnership(run.organizationId, entries);", "const [allocationRows, centerRows"],
    [government, "assertPayrollExportTenantOwnership(run.organizationId, entries);", "const traceNumber ="],
    [government, "assertPayrollExportTenantOwnership(run.organizationId, monthlyEntryRows);", "const statutoryLatestByEmployee"],
    [government, "assertPayrollExportTenantOwnership(run.organizationId, annualEntries);", "const annualEmployees"],
  ]) {
    assert.ok(guardedBefore(part, guard, before), "missing pre-serialization employee ownership check: " + guard);
  }
  assert.ok(bank.indexOf("assertPayrollExportTenantOwnership(run.organizationId, entries);") <
    bank.indexOf("if (!dryRun && run.status === \"Released\")"),
    "even dry-run bank previews must check ownership");
});

test("missing guards are caught and mismatched rows are rejected without ID leakage", () => {
  const guard = "assertPayrollExportTenantOwnership(run.organizationId, entries);";
  const mutatedBank = bank.replace(guard, "");
  assert.equal(guardedBefore(mutatedBank, guard, "const rows = entries.map("), false);
  assert.match(helper, /rows\.some\(\(row\) => row\.employee\?\.organizationId !== organizationId\)/);
  assert.match(helper, /throw new Error\("Payroll export unavailable: employee ownership could not be verified\."\)/);
  assert.doesNotMatch(helper, /\.filter\(/, "do not silently discard foreign workers");
  assert.match(bank, /PAYOUT_TENANT_MISMATCH/, "keep the existing final-bank defense in depth");
});
