import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReleasedPayrollJournal, journalMoneyCentavos, payrollJournalToCsv,
} from "../src/lib/payroll-journal-export";
import { apiV1Page } from "../src/lib/api-v1-extended";
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

test("API v1 extension cannot serve cross-entity data with a tenant-only key",async()=>{
 const {extendedV1NeedsEntityScope}=await import("../src/lib/api-v1-extended");
 assert.equal(extendedV1NeedsEntityScope(0),false);
 assert.equal(extendedV1NeedsEntityScope(1),false);
 assert.equal(extendedV1NeedsEntityScope(2),true);
 assert.equal(extendedV1NeedsEntityScope(Number.NaN),true);
});
