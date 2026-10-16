import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
const enabled = (() => { try { const u = new URL(process.env.DATABASE_URL ?? ""); return process.env.CI === "true" && process.env.MONEY_CLOSES_POSTGRES_QA === "true" && u.hostname === "127.0.0.1" && u.pathname === "/app_db"; } catch { return false; } })();
test("rollback-only local PostgreSQL executes canonical 0127 and its tenant/checker constraints", { skip: !enabled }, async () => {
  const { db, pool } = await import("../src/db");
  const { organizations, employees, users, yearEndPriorEvidence } = await import("../src/db/schema");
  const { encryptGovernmentId } = await import("../src/lib/government-id-crypto");
  const migration = await readFile("drizzle/0127_year_end_prior_evidence.sql", "utf8");
  const rollback = new Error("EXPECTED_REHEARSAL_ROLLBACK");
  try {
    const before = await db.select().from(yearEndPriorEvidence); assert.equal(before.length, 0, "Empty disposable intake table required");
    await assert.rejects(db.transaction(async tx => {
      await tx.execute(sql`DROP TABLE year_end_prior_evidence`);
      await tx.execute(sql.raw(migration));
      const orgs = await tx.insert(organizations).values([{ name: "Fictional rehearsal A", legalName: "Fictional A" }, { name: "Fictional rehearsal B", legalName: "Fictional B" }]).returning();
      const [worker] = await tx.insert(employees).values({ organizationId: orgs[0].id, employeeNo: "REHEARSAL", firstName: "Fictional", lastName: "Worker", title: "QA", avatarInitials: "FW", basicRate: "50000", startDate: "2025-07-01" }).returning();
      const actors = await tx.insert(users).values([0,1].map(i => ({ name: "Fictional reviewer", email: `migration-${orgs[0].id}-${i}@example.test`, passwordHash: "no-login" }))).returning();
      const values = { organizationId: orgs[0].id, employeeId: worker.id, taxYear: 2025, encryptedEvidence: encryptGovernmentId("fictional", { required: true })!, sourceDigest: "a".repeat(64), makerUserId: actors[0].id };
      const [record] = await tx.insert(yearEndPriorEvidence).values(values).returning();
      assert.equal(record.revision, 1);
      for (const bad of [{ ...values, organizationId: orgs[1].id }, { ...values, taxYear: 2026, checkerUserId: actors[0].id, approvedAt: new Date() }, { ...values, taxYear: 2027, encryptedEvidence: "plaintext" }]) {
        await tx.execute(sql`SAVEPOINT reject_invalid`);
        await assert.rejects(tx.insert(yearEndPriorEvidence).values(bad));
        await tx.execute(sql`ROLLBACK TO SAVEPOINT reject_invalid`);
      }
      const constraints = await tx.execute(sql`SELECT conname FROM pg_constraint WHERE conrelid = 'year_end_prior_evidence'::regclass`);
      assert.ok(constraints.rows.some(row => row.conname === "year_end_prior_evidence_employee_scope_fk"));
      throw rollback;
    }), error => error === rollback);
    assert.equal((await db.select().from(yearEndPriorEvidence)).length, 0, "Rollback restores original empty table and removes fictional evidence");
  } finally { await pool.end(); }
});
