import assert from "node:assert/strict";
import test from "node:test";
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { legalEntities, payrollEntries, payrollJobs, payslips, payoutBatches,
  payoutTransfers, bankFileValidations, yearEndAdjustments,
  historicalPayrollEntries, separationRecords } from "../src/db/schema";

test("disabled multi-entity legacy ORM reads and writes work without proposed columns", async () => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/app_db");
  const previous = process.env.MULTI_ENTITY_ENABLED;
  process.env.MULTI_ENTITY_ENABLED = "false";
  try {
    await db.transaction(async tx => {
      const cases = [
        ["legal_entities", legalEntities, "registered_address"],
        ["payroll_entries", payrollEntries, "legal_entity_id"],
        ["payroll_jobs", payrollJobs, "legal_entity_id"],
        ["payslips", payslips, "legal_entity_id"],
        ["payout_batches", payoutBatches, "legal_entity_id"],
        ["payout_transfers", payoutTransfers, "legal_entity_id"],
        ["bank_file_validations", bankFileValidations, "legal_entity_id"],
        ["year_end_adjustments", yearEndAdjustments, "legal_entity_id"],
        ["historical_payroll_entries", historicalPayrollEntries, "legal_entity_id"],
        ["separation_records", separationRecords, "legal_entity_id"],
      ] as const;
      for (const [name, table, absent] of cases) {
        // Empty connection-local tables: no public data copied or altered.
        await tx.execute(sql.raw(`CREATE TEMP TABLE "${name}" ON COMMIT DROP AS SELECT * FROM public."${name}" WITH NO DATA`));
        await tx.execute(sql.raw(`ALTER TABLE pg_temp."${name}" DROP COLUMN IF EXISTS "${absent}"`));
        assert.deepEqual(await tx.select().from(table), []);
        // CTAS deliberately omits constraints: exercise ORM's generated column
        // list/RETURNING against the legacy shape, without real business writes.
        const inserted = await tx.insert(table).values({} as never).returning();
        assert.equal(inserted.length, 1);
        assert.equal(await tx.select().from(table).then(rows => rows.length), 1);
      }
    });
  } finally {
    if (previous === undefined) delete process.env.MULTI_ENTITY_ENABLED;
    else process.env.MULTI_ENTITY_ENABLED = previous;
  }
});
