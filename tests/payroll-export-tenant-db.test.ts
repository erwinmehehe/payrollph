import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import {
  bankTemplates, employees, legalEntities, organizations, payrollEntries, payrollRuns,
} from "../src/db/schema";
import {
  generateBankFile, generateGovernmentDraft, generateJournalCsv,
} from "../src/lib/exporters";

// This fixture cannot run against Neon, staging, or production, and contacts
// no bank, payroll provider, or remittance agency.
const local = (() => {
  const raw = process.env.DATABASE_URL;
  if (process.env.CI !== "true" || !raw) return false;
  const uri = new URL(raw);
  return uri.protocol === "postgresql:" && uri.hostname === "127.0.0.1"
    && uri.port === "5432" && uri.pathname === "/app_db"
    && uri.username === "postgres" && uri.password === "postgres"
    && !uri.search && !uri.hash;
})();

const denial = /Payroll export unavailable: employee ownership could not be verified\./;

test("bank preview, journal and monthly/annual government drafts reject mismatched workers", {
  skip: !local,
  timeout: 60_000,
}, async () => {
  assert.notEqual(process.env.PAYMONGO_DISBURSEMENTS_ENABLED, "true");
  assert.notEqual(process.env.XENDIT_PAYOUTS_ENABLED, "true");
  const [own, victim] = await db.insert(organizations).values([
    { name: "Synthetic owner " + randomUUID(), legalName: "Fictional employer A" },
    { name: "Synthetic victim " + randomUUID(), legalName: "Fictional employer B" },
  ]).returning({ id: organizations.id });
  let templateId: number | null = null;
  try {
    const [entity] = await db.insert(legalEntities).values({
      organizationId: own.id, code: "FIC" + String(own.id),
      legalName: "Fictional employer A", displayName: "Fictional employer A",
      primaryEntity: true,
    }).returning({ id: legalEntities.id });
    const [ownWorker] = await db.insert(employees).values({
      organizationId: own.id, legalEntityId: entity.id,
      employeeNo: "OWN-" + own.id, firstName: "Fictional", lastName: "Owner",
      title: "Worker", avatarInitials: "FO", basicRate: "1000.00",
      startDate: "2026-01-01",
    }).returning({ id: employees.id });
    const [victimWorker] = await db.insert(employees).values({
      organizationId: victim.id,
      employeeNo: "VICTIM-" + victim.id,
      firstName: "PRIVATE-FOREIGN-MARKER", lastName: "Worker",
      title: "Worker", avatarInitials: "VW", basicRate: "1000.00",
      startDate: "2026-01-01",
    }).returning({ id: employees.id });
    const templateName = "GCash Synthetic "
      + BigInt("0x" + randomUUID().replaceAll("-", "")).toString(10);
    const [template] = await db.insert(bankTemplates).values({
      name: templateName, version: "v1", format: "CSV", active: true,
    }).returning({ id: bankTemplates.id });
    templateId = template.id;

    const addRun = async (periodStart: string, periodEnd: string, payDate: string) => {
      const [run] = await db.insert(payrollRuns).values({
        organizationId: own.id, legalEntityId: entity.id,
        periodLabel: "Fictional payroll - no money", periodStart, periodEnd,
        payDate, status: "Released", employeeCount: 1,
        grossPay: "1000.00", netPay: "1000.00",
      }).returning({ id: payrollRuns.id });
      await db.insert(payrollEntries).values({
        payrollRunId: run.id, employeeId: ownWorker.id,
        grossPay: "1000.00", deductions: "0.00", netPay: "1000.00",
      });
      return run;
    };
    // The payroll run belongs to A, but its extra entry references a real
    // employee belonging to B. A global employee FK alone does not prevent it.
    const finalCutoff = await addRun("2026-09-16", "2026-09-30", "2026-09-30");
    const [foreignEntry] = await db.insert(payrollEntries).values({
      payrollRunId: finalCutoff.id, employeeId: victimWorker.id,
      grossPay: "1000.00", deductions: "0.00", netPay: "1000.00",
    }).returning({ id: payrollEntries.id });

    await assert.rejects(
      () => generateBankFile(finalCutoff.id, templateName, true),
      denial,
      "a dry-run bank preview must not export a foreign worker",
    );
    await assert.rejects(
      () => generateJournalCsv(finalCutoff.id),
      denial,
      "accounting CSV must not expose foreign payroll-worker data",
    );
    await assert.rejects(
      () => generateGovernmentDraft(finalCutoff.id, "philhealth-rf1"),
      denial,
      "selected government-draft run must reject a foreign worker",
    );

    await db.delete(payrollEntries).where(eq(payrollEntries.id, foreignEntry.id));
    const earlier = await addRun("2026-09-01", "2026-09-15", "2026-09-15");
    await db.insert(payrollEntries).values({
      payrollRunId: earlier.id, employeeId: victimWorker.id,
      grossPay: "1000.00", deductions: "0.00", netPay: "1000.00",
    });
    await assert.rejects(
      () => generateGovernmentDraft(finalCutoff.id, "philhealth-rf1"),
      denial,
      "earlier payrolls in a monthly statutory file must also be tenant-owned",
    );
    const octoberRun = await addRun("2026-10-01", "2026-10-15", "2026-10-15");
    await assert.rejects(
      () => generateGovernmentDraft(octoberRun.id, "bir-1604c-source"),
      denial,
      "a foreign worker in another released run must block annual BIR source",
    );

    const persisted = await db.select({ employeeId: payrollEntries.employeeId })
      .from(payrollEntries).where(eq(payrollEntries.payrollRunId, earlier.id));
    assert.ok(persisted.some((row) => row.employeeId === victimWorker.id),
      "denied exports never alter the foreign worker's entry or payroll state");
  } finally {
    await db.delete(organizations).where(inArray(organizations.id, [own.id, victim.id]));
    if (templateId != null) {
      await db.delete(bankTemplates).where(eq(bankTemplates.id, templateId));
    }
  }
});
