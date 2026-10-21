/** Real HTTP + disposable PostgreSQL proof; never run against a deployed service. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../../src/db/index.ts";
import { auditEvents, employees, importBatches, payrollRuns } from "../../src/db/schema.ts";

export const IMPORT_HISTORY_METHOD = "GET employees/import";

function requireDisposableImportHistory() {
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.TENANT_SECOND_PASS_MODE, "isolated-ci-only");
  assert.equal(process.env.SECURITY_SMOKE_URL, "http://127.0.0.1:3000");
  const url = new URL(process.env.DATABASE_URL);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
  assert.equal(url.port, "5432");
  assert.equal(url.pathname, "/app_db");
}

async function snapshotVictimImportHistory(organizationId) {
  const [batches, staff, runs, audit] = await Promise.all([
    db.select().from(importBatches).where(eq(importBatches.organizationId, organizationId)).orderBy(importBatches.id),
    db.select().from(employees).where(eq(employees.organizationId, organizationId)).orderBy(employees.id),
    db.select().from(payrollRuns).where(eq(payrollRuns.organizationId, organizationId)).orderBy(payrollRuns.id),
    db.select().from(auditEvents).where(eq(auditEvents.organizationId, organizationId)).orderBy(auditEvents.id),
  ]);
  return { batches, staff, runs, audit };
}

function assertOwnHistory(response, ownOrgId, owned, victim) {
  assert.ok(Array.isArray(response.json?.batches), "Actual history array required");
  assert.ok(response.json.batches.length > 0, "An empty own list is not proof");
  assert.ok(response.json.batches.some(row => row.id === owned.id && row.fileName === owned.fileName),
    "Actual owned PostgreSQL batch must be returned, not a template or dummy list");
  assert.ok(response.json.batches.every(row => row.organizationId === ownOrgId));
  assert.ok(!response.json.batches.some(row => row.id === victim.id));
  assert.ok(!response.text.includes(victim.fileName), "Victim import filename must never be disclosed");
}

export async function verifyTenantImportHistory(f, { request, expectStatus }) {
  requireDisposableImportHistory();
  assert.equal(new Set(f.orgs.map(org => org.id)).size, 3);
  assert.equal(new Set(f.owners.map(owner => owner.id)).size, 3);
  const nonce = randomUUID();
  const rows = [];
  // Sequential inserts place the real victim-only target AFTER BOTH attackers.
  for (const orgIndex of [0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 0]) {
    const [row] = await db.insert(importBatches).values({
      organizationId: f.orgs[orgIndex].id,
      fileName: "fictional-import-" + nonce + "-" + rows.length + ".csv",
      sourceSystem: "dl01-disposable-ci",
      importKind: "employees_csv",
      totalRows: 1, createdCount: 1, updatedCount: 0, errorCount: 0,
      status: "completed", errors: [], createdBy: "Fictional CI importer",
    }).returning();
    assert.ok(row?.id > 0);
    rows.push(row);
  }
  const victimOrg = f.orgs[0];
  const victim = rows[10];
  const [persistedVictim] = await db.select().from(importBatches).where(eq(importBatches.id, victim.id));
  assert.equal(persistedVictim?.organizationId, victimOrg.id);
  assert.equal(persistedVictim?.fileName, victim.fileName);
  assert.ok(victim.id > 6 && victim.id > rows[8].id && victim.id > rows[9].id);
  const [victimEmployee] = await db.select().from(employees).where(eq(employees.id, f.victimEmployee.id));
  const [victimRun] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, f.victimRun.id));
  assert.equal(victimEmployee?.organizationId, victimOrg.id);
  assert.equal(victimRun?.organizationId, victimOrg.id);
  const before = await snapshotVictimImportHistory(victimOrg.id);

  const victimRead = expectStatus(await request("/api/employees/import?organizationId=" + victimOrg.id,
    { cookie: f.ownerSessions[0].cookie }), 200, "Victim owner sees its actual import history");
  assert.ok(victimRead.json?.batches?.some(row => row.id === victim.id && row.fileName === victim.fileName));

  const receipts = [];
  for (const idx of [1, 2]) {
    const ownOrg = f.orgs[idx];
    const owned = rows[7 + idx];
    const cookie = f.ownerSessions[idx].cookie;
    assert.equal(owned.organizationId, ownOrg.id);
    assert.notEqual(ownOrg.id, persistedVictim.organizationId);
    assert.ok(victim.id > owned.id);
    const account = expectStatus(await request("/api/account", { cookie }), 200,
      "The real attacker session must still be authenticated");
    assert.equal(account.json?.profile?.id, f.owners[idx].id);

    const own = expectStatus(await request("/api/employees/import?organizationId=" + ownOrg.id,
      { cookie }), 200, IMPORT_HISTORY_METHOD + " populated own history");
    assertOwnHistory(own, ownOrg.id, owned, victim);
    const foreign = expectStatus(await request("/api/employees/import?organizationId=" + victimOrg.id +
      "&batchId=" + victim.id, { cookie }), 403, IMPORT_HISTORY_METHOD + " real victim-only history denied");
    assert.ok(!foreign.text.includes(victim.fileName));
    assert.ok(!foreign.json?.batches?.length);

    const ignored = expectStatus(await request("/api/employees/import?organizationId=" + ownOrg.id +
      "&employeeId=" + victimEmployee.id + "&runId=" + victimRun.id + "&batchId=" + victim.id,
      { cookie }), 200, IMPORT_HISTORY_METHOD + " forged object selectors cannot change employer scope");
    assertOwnHistory(ignored, ownOrg.id, owned, victim);
    assert.deepEqual(ignored.json.batches, own.json.batches);
    const rejected = expectStatus(await request("/api/employees/import?organizationId=" + victimOrg.id +
      "&employeeId=" + victimEmployee.id + "&runId=" + victimRun.id + "&batchId=" + victim.id,
      { cookie }), 403, IMPORT_HISTORY_METHOD + " forged victim employer rejected");
    assert.ok(!rejected.text.includes(victim.fileName));
    const after = await snapshotVictimImportHistory(victimOrg.id);
    assert.deepEqual(after, before, "Victim import, employee, payroll and audit rows must remain unchanged");
    receipts.push({ method: IMPORT_HISTORY_METHOD, attacker: ownOrg.id, ownObjectId: owned.id,
      victimOrganizationId: victimOrg.id, victimObjectId: victim.id, ownStatus: own.status,
      victimStatus: foreign.status, forgedOwnStatus: ignored.status, forgedVictimStatus: rejected.status,
      victimDatabaseUnchanged: true });
    console.log("PASS DL-01 " + IMPORT_HISTORY_METHOD + " authenticated attacker " + idx);
  }
  assert.equal(receipts.length, 2);
  console.log(JSON.stringify({ kind: "DISPOSABLE_PG16_REAL_HTTP", auditSuite: "dl01-import-history",
    receipts, productionTested: false, certified: false }));
}
