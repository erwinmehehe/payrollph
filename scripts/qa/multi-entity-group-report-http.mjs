import assert from "node:assert/strict";
import pg from "pg";

/**
 * Real, authenticated group-report GET proofs, invoked by the existing flag-ON
 * Multi-Entity Browser and HTTP Acceptance workflow. Fictional employers ONLY.
 * No production DB, real salary release, transfer, provider, or filing.
 */
export async function verifyMultiEntityReportTenantIsolation({
  newSyntheticContext, login, request, group, on, checks,
}) {
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.MULTI_ENTITY_QA_MODE, "synthetic-postgres-only");
  assert.equal(process.env.PAYMONGO_DISBURSEMENTS_ENABLED, "false");
  assert.equal(process.env.XENDIT_PAYOUTS_ENABLED, "false");
  const databaseUrl = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(databaseUrl.protocol, "postgresql:");
  assert.ok(["127.0.0.1", "localhost"].includes(databaseUrl.hostname));
  assert.equal(databaseUrl.port, "5432");
  assert.equal(databaseUrl.pathname, "/app_db");
  // Method-specific three-tenant proof: each of TWO independent group-reader
  // principals first gets actual nonempty own report data, then explicitly
  // fails to read the populated foreign organizations through the SAME GET.
  // The B-only victim worker IDs are persisted above 6, not guessed IDs.
  const database = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await database.connect();
  try {
    const bVictims = await database.query(
      "SELECT id, organization_id FROM employees WHERE organization_id = $1 AND employee_no LIKE $2 AND id > 6 ORDER BY id",
      [2, "B-VICTIM-%"],
    );
    assert.ok(bVictims.rows.length >= 5, "Victim-exclusive high IDs must exist in real disposable PG");
    assert.ok(bVictims.rows.every(row => row.organization_id === 2));
    for (const actor of [
      { email: "entity-attacker-b@example.test", ownId: 2, ownCount: 9, otherId: 3 },
      { email: "entity-attacker-c@example.test", ownId: 3, ownCount: 1, otherId: 2 },
    ]) {
      const caller = await newSyntheticContext();
      try {
        await login(caller, on, actor.email);
        const ownReport = await request(caller, on, "/api/multi-entity/reports?organizationId=" + actor.ownId);
        assert.equal(ownReport.status, 200, "Real group reader must read its own tenant");
        assert.equal(ownReport.data?.totals?.headcount, actor.ownCount);
        assert.equal(ownReport.data?.entities?.length, 1);
        assert.ok(!JSON.stringify(ownReport.data).includes("Alpha Legal"));
        assert.ok(!JSON.stringify(ownReport.data).includes("Beta Legal"));
        const deniedVictim = await request(caller, on, "/api/multi-entity/reports?organizationId=1");
        assert.equal(deniedVictim.status, 403, "Cross-tenant group report must fail");
        const deniedOther = await request(caller, on,
          "/api/multi-entity/reports?organizationId=" + actor.otherId);
        assert.equal(deniedOther.status, 403, "Second foreign employer must also fail");
        for (const denied of [deniedVictim, deniedOther]) {
          assert.ok(!JSON.stringify(denied.data).includes("Alpha Legal"));
          assert.ok(!JSON.stringify(denied.data).includes("Foreign Legal"));
          assert.ok(!JSON.stringify(denied.data).includes("Third Legal"));
          assert.ok(!JSON.stringify(denied.data).includes("B-VICTIM-"));
        }
      } finally {
        await caller.close();
      }
    }
    checks.push("Three-tenant report own 200, two independent foreign 403 and real high-ID victim fixtures");

    // Reproduce the non-null foreign legal-employer attribution defect using
    // a reversible *fictional* employee row. The old report silently dropped
    // this worker; the fixed report must refuse totals rather than undercount.
    const source = await database.query(
      "SELECT id, legal_entity_id FROM employees WHERE organization_id = $1 AND employee_no = $2",
      [1, "A-01"],
    );
    const foreignEntity = await database.query(
      "SELECT id FROM legal_entities WHERE organization_id = $1 AND code = $2",
      [2, "PRIMARY"],
    );
    assert.equal(source.rows.length, 1);
    assert.equal(foreignEntity.rows.length, 1);
    const targetEmployee = source.rows[0];
    const untouchedVictim = await database.query(
      "SELECT id, organization_id, legal_entity_id, employee_no FROM employees WHERE organization_id = $1 ORDER BY id", [2]);
    try {
      const changed = await database.query(
        "UPDATE employees SET legal_entity_id = $1 WHERE id = $2 AND organization_id = $3 RETURNING id",
        [foreignEntity.rows[0].id, targetEmployee.id, 1],
      );
      assert.equal(changed.rowCount, 1, "Synthetic cross-tenant FK attribution must really be written");
      const refused = await request(group, on, "/api/multi-entity/reports?organizationId=1");
      assert.equal(refused.status, 409, "Foreign non-null entity reference cannot disappear from group totals");
      assert.equal(refused.data?.code, "ENTITY_ATTRIBUTION_REQUIRED");
      assert.ok(!JSON.stringify(refused.data).includes("Foreign Legal"));
      assert.ok(!JSON.stringify(refused.data).includes("A-01"));
    } finally {
      await database.query(
        "UPDATE employees SET legal_entity_id = $1 WHERE id = $2 AND organization_id = $3",
        [targetEmployee.legal_entity_id, targetEmployee.id, 1],
      );
    }
    const intact = await database.query(
      "SELECT id, organization_id, legal_entity_id, employee_no FROM employees WHERE organization_id = $1 ORDER BY id", [2]);
    assert.deepEqual(intact.rows, untouchedVictim.rows, "Victim tenant's real database rows remain unchanged");
    const restored = await request(group, on, "/api/multi-entity/reports?organizationId=1");
    assert.equal(restored.status, 200, "Valid own report restores after the fictional corrupt row is removed");
    assert.equal(restored.data?.totals?.headcount, 2);
    checks.push("Non-null foreign employer attribution now fails closed with HTTP 409, then restores own report");
  } finally {
    await database.end();
  }

}
