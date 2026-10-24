import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  bankTemplates, employees, legalEntities, organizations, payrollEntries,
  payrollRuns, payoutBatches, payoutBatchTransfers, payoutTransfers,
} from "../src/db/schema";
import { generateBankFile } from "../src/lib/exporters";
import { prepareInitialPayoutBatch } from "../src/lib/payout-ledger";

// No bank/provider HTTP. This can mutate only schema-pushed, disposable PG.
const local = (() => {
  const raw = process.env.DATABASE_URL;
  if (process.env.CI !== "true" || !raw) return false;
  const u = new URL(raw);
  return u.protocol === "postgresql:" && u.hostname === "127.0.0.1"
    && u.port === "5432" && u.pathname === "/app_db"
    && u.username === "postgres" && u.password === "postgres"
    && !u.search && !u.hash;
})();

test("final bank bytes refuse one-cent corruption, a missing row and a committed payout ledger", {
  skip: !local, timeout: 60_000,
}, async () => {
  assert.notEqual(process.env.XENDIT_PAYOUTS_ENABLED, "true");
  assert.notEqual(process.env.PAYMONGO_DISBURSEMENTS_ENABLED, "true");
  const [org] = await db.insert(organizations).values({
    name: "Fictional bank-file rehearsal " + randomUUID(),
    legalName: "Fictional Employer - No Bank Upload",
  }).returning({ id: organizations.id });
  let templateId: number | null = null;
  try {
    const [entity] = await db.insert(legalEntities).values({
      organizationId: org.id, code: "BANKFIC", legalName: "Fictional Employer",
      displayName: "Fictional Employer", primaryEntity: true,
    }).returning({ id: legalEntities.id });
    // Hex UUIDs can contain "cbc", which the exporter intentionally treats
    // as a proprietary China Bank adapter. Preserve uniqueness using decimal
    // digits so this GCash fixture never randomly selects a different bank.
    const templateName = "GCash Synthetic " + BigInt("0x" + randomUUID().replaceAll("-", "")).toString(10);
    const [template] = await db.insert(bankTemplates).values({
      name: templateName, version: "v1", format: "CSV", active: true,
    }).returning({ id: bankTemplates.id });
    templateId = template.id;
    const people = await db.insert(employees).values([
      {
        organizationId: org.id, legalEntityId: entity.id, employeeNo: "FIC1",
        firstName: "Fictional", lastName: "First", title: "Tester",
        avatarInitials: "FF", basicRate: "500.00", startDate: "2026-10-01",
        mobile: "09170000001",
      },
      {
        organizationId: org.id, legalEntityId: entity.id, employeeNo: "FIC2",
        firstName: "Fictional", lastName: "Second", title: "Tester",
        avatarInitials: "FS", basicRate: "1000.00", startDate: "2026-10-01",
        mobile: "09170000002",
      },
    ]).returning({ id: employees.id, employeeNo: employees.employeeNo });
    const [run] = await db.insert(payrollRuns).values({
      organizationId: org.id, legalEntityId: entity.id,
      periodLabel: "Fictional bank file integrity",
      periodStart: "2026-10-01", periodEnd: "2026-10-15",
      payDate: "2026-10-20", status: "Released",
      employeeCount: 2, grossPay: "1500.00", netPay: "1500.00",
    }).returning({ id: payrollRuns.id });
    const payment = (no: string, mobile: string) => ({
      payment: {
        employeeName: no === "FIC1" ? "Fictional First" : "Fictional Second",
        employeeNo: no, firstName: "Fictional", lastName: no === "FIC1" ? "First" : "Second",
        middleName: null, email: null, bankAccount: null, bankCode: null, mobile,
      },
    });
    let entries = await db.insert(payrollEntries).values([
      {
        payrollRunId: run.id, employeeId: people[0].id,
        grossPay: "500.00", deductions: "0.00", netPay: "500.00",
        trace: payment("FIC1", "09170000001"),
      },
      {
        payrollRunId: run.id, employeeId: people[1].id,
        grossPay: "1000.00", deductions: "0.00", netPay: "1000.00",
        trace: payment("FIC2", "09170000002"),
      },
    ]).returning({ id: payrollEntries.id, employeeId: payrollEntries.employeeId });

    const clean = await generateBankFile(run.id, templateName, false);
    assert.equal(clean.validation.rowCount, 2);
    assert.equal(clean.validation.totalNet, "1500.00");
    assert.equal(clean.validation.files.reduce((sum, file) => sum + file.rowCount, 0), 2);
    assert.match(String(clean.body), /Fictional First/);
    assert.match(String(clean.body), /Fictional Second/);

    // Simulate a damaged middle row after release, without adjusting the run.
    await db.update(payrollEntries).set({ netPay: "999.99" })
      .where(eq(payrollEntries.id, entries[1].id));
    await assert.rejects(
      () => generateBankFile(run.id, templateName, false),
      /PAYOUT_REGISTER_RECONCILIATION_FAILED/,
    );
    await db.update(payrollEntries).set({ netPay: "1000.00" })
      .where(eq(payrollEntries.id, entries[1].id));

    // A partly committed register must refuse to produce a plausible ZIP/CSV.
    await db.delete(payrollEntries).where(eq(payrollEntries.id, entries[1].id));
    await assert.rejects(
      () => generateBankFile(run.id, templateName, false),
      /PAYOUT_REGISTER_RECONCILIATION_FAILED/,
    );
    const [restored] = await db.insert(payrollEntries).values({
      payrollRunId: run.id, employeeId: people[1].id,
      grossPay: "1000.00", deductions: "0.00", netPay: "1000.00",
      trace: payment("FIC2", "09170000002"),
    }).returning({ id: payrollEntries.id, employeeId: payrollEntries.employeeId });
    entries = [entries[0], restored];

    // An existing committed provider ledger must exclude bank-file creation
    // even when an internal caller bypasses the HTTP route's lock/check.
    const intents = entries.map((entry, index) => ({
      employeeId: entry.employeeId,
      payrollEntryId: entry.id,
      referenceNumber: "PAY-" + run.id + "-" + people[index].employeeNo,
      amountCents: index === 0 ? 50000 : 100000,
    }));
    await prepareInitialPayoutBatch({
      organizationId: org.id, payrollRunId: run.id,
      provider: "xendit", intents,
    });
    await assert.rejects(
      () => generateBankFile(run.id, templateName, false),
      /PAYOUT_BANK_FILE_LEDGER_ALREADY_CLAIMED/,
    );
  } finally {
    await db.delete(payoutBatchTransfers).where(eq(payoutBatchTransfers.organizationId, org.id));
    await db.delete(payoutTransfers).where(eq(payoutTransfers.organizationId, org.id));
    await db.delete(payoutBatches).where(eq(payoutBatches.organizationId, org.id));
    await db.delete(organizations).where(eq(organizations.id, org.id));
    if (templateId !== null) await db.delete(bankTemplates).where(eq(bankTemplates.id, templateId));
  }
});
