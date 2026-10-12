import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  buildReleasedPayrollJournal, journalMoneyCentavos, payrollJournalToCsv,
} from "../src/lib/payroll-journal-export";
import { apiV1Page, validApiV1DateOnly, extendedV1NeedsEntityScope, scopedJournalEntityId } from "../src/lib/api-v1-extended";
import { criticalReleaseFlagEnabled } from "../src/lib/critical-release-flags";

const run = { id: 12, organizationId: 4, legalEntityId: 9, status: "Released",
  payDate: "2026-10-10", periodLabel: "First half of October",
  grossPay: "12345.67", netPay: "10999.99" };

test("released journal produces balanced centavo-exact debit and credits", () => {
  const rows = buildReleasedPayrollJournal([run]);
  assert.equal(rows.length, 3);
  assert.equal(rows.reduce((sum, row) => sum + row.debitCentavos, 0), 1234567);
  assert.equal(rows.reduce((sum, row) => sum + row.creditCentavos, 0), 1234567);
  assert.equal(rows[1].creditCentavos, 134568);
  assert.equal(rows.every(row => row.legalEntityId === 9), true);
});

test("journal forbids draft payroll, missing entity, reversed money and excess precision", () => {
  assert.throws(() => buildReleasedPayrollJournal([{ ...run, status: "Draft" }]), /released/i);
  assert.throws(() => buildReleasedPayrollJournal([{ ...run, legalEntityId: null }]), /legal-employer/i);
  assert.throws(() => buildReleasedPayrollJournal([{ ...run, netPay: "12346.00" }]), /gross\/net/i);
  assert.throws(() => journalMoneyCentavos("1.000"), /precision/i);
});

test("CSV neutralizes spreadsheet formula injection in period label", () => {
  const csv = payrollJournalToCsv(buildReleasedPayrollJournal([{ ...run, periodLabel: "=IMPORTXML()" }]));
  assert.ok(csv.includes("'=IMPORTXML()"));
});

test("strict bounded pagination rejects decimals and oversized offsets", () => {
  assert.deepEqual(apiV1Page(new URLSearchParams("limit=20&offset=200")), { limit: 20, offset: 200 });
  assert.equal(apiV1Page(new URLSearchParams("limit=1.2")), null);
  assert.equal(apiV1Page(new URLSearchParams("limit=101")), null);
  assert.equal(apiV1Page(new URLSearchParams("offset=999999")), null);
});

test("new API feature gate is default off", () => {
  assert.equal(criticalReleaseFlagEnabled("apiV1ExtendedReads", {}), false);
  assert.equal(criticalReleaseFlagEnabled("apiV1ExtendedReads", { API_V1_EXTENDED_READS_ENABLED: "TRUE" }), false);
  assert.equal(criticalReleaseFlagEnabled("apiV1ExtendedReads", { API_V1_EXTENDED_READS_ENABLED: "true" }), true);
});

test("API v1 extension rejects missing/ambiguous or cross-entity attribution", () => {
 assert.equal(extendedV1NeedsEntityScope(0), true);
 assert.equal(extendedV1NeedsEntityScope(-1), true);
 assert.equal(extendedV1NeedsEntityScope(1), false);
 assert.equal(extendedV1NeedsEntityScope(2), true);
 assert.equal(extendedV1NeedsEntityScope(Number.NaN), true);
});

test("journal export rejects malformed dates without throwing a server error", () => {
 for (const invalid of ["", "2026-13-01", "2026-02-30", "2026-02-29", "2026-00-01", "2026-10-01T00:00:00Z"]) {
   assert.equal(validApiV1DateOnly(invalid), false, invalid);
 }
 for (const valid of ["2026-10-12", "2024-02-29", "2026-12-31"]) {
   assert.equal(validApiV1DateOnly(valid), true, valid);
 }
});

test("journal scope cannot be broadened using legalEntityId filters", () => {
  assert.equal(scopedJournalEntityId(null, 9), 9);
  assert.equal(scopedJournalEntityId("9", 9), 9);
  for (const id of ["1", "0", "-9", "10", "9 ", "999999999999999999999"]) {
    assert.equal(scopedJournalEntityId(id, 9), null, id);
  }
  assert.equal(scopedJournalEntityId(null, 0), null);
});

test("additive API never replaces the existing employer-scoped public endpoints", () => {
  const units = readFileSync("src/app/api/v1/org-units/route.ts", "utf8");
  const payslips = readFileSync("src/app/api/v1/payslips/route.ts", "utf8");
  const events = readFileSync("src/app/api/v1/events/route.ts", "utf8");
  const journal = readFileSync("src/app/api/v1/journal-entries/route.ts", "utf8");
  const inbox = readFileSync("src/app/api/v1/provider-events/route.ts", "utf8");
  assert.match(units, /authorizeExtendedApi/);
  assert.match(payslips, /authorizeExtendedApi/);
  assert.match(events, /authorizeExtendedApi/);
  assert.match(journal, /scopedJournalEntityId/);
  assert.match(inbox, /innerJoin\(payrollRuns/);
});
