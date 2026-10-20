/**
 * Exact-method tenant tests for the fail-closed payroll read sweep.
 * Executed only inside the already-guarded localhost/PG16 three-employer
 * Security HTTP Smoke. All records are fictional, no money is transferred.
 */
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { db } from "../../src/db";
import {
  managedPayrollEngagements, managedPayrollGates, managedPayrollRunApprovals,
  payrollEntries, statutoryRemittanceBatches, statutoryRemittanceCorrectionRequests,
  userOrganizations, users,
} from "../../src/db/schema";

async function victimSnapshot(f) {
  const org = f.orgs[0];
  const engagements = await db.select().from(managedPayrollEngagements)
    .where(eq(managedPayrollEngagements.organizationId, org.id)).orderBy(managedPayrollEngagements.id);
  const gates = engagements.length ? await db.select().from(managedPayrollGates)
    .where(eq(managedPayrollGates.engagementId, engagements[0].id))
    .orderBy(managedPayrollGates.id) : [];
  const approvals = engagements.length ? await db.select().from(managedPayrollRunApprovals)
    .where(eq(managedPayrollRunApprovals.engagementId, engagements[0].id))
    .orderBy(managedPayrollRunApprovals.id) : [];
  const corrections = await db.select().from(statutoryRemittanceCorrectionRequests)
    .where(eq(statutoryRemittanceCorrectionRequests.organizationId, org.id))
    .orderBy(statutoryRemittanceCorrectionRequests.id);
  const entries = await db.select().from(payrollEntries)
    .where(eq(payrollEntries.payrollRunId, f.victimRun.id))
    .orderBy(payrollEntries.id);
  return { engagements, gates, approvals, corrections, entries };
}

export async function verifyPayrollReadSweep(f, { request, expectStatus }) {
  assert.equal(process.env.CI, "true");
  assert.equal(process.env.TENANT_SECOND_PASS_MODE, "isolated-ci-only");
  assert.equal(new URL(process.env.DATABASE_URL).hostname, "127.0.0.1");
  assert.equal(new URL(process.env.SECURITY_SMOKE_URL).hostname, "127.0.0.1");
  assert.notEqual(process.env.PAYMONGO_DISBURSEMENTS_ENABLED, "true");
  assert.notEqual(process.env.XENDIT_PAYOUTS_ENABLED, "true");

  const victim = f.orgs[0];
  const ownVictim = f.ownerSessions[0].cookie;
  const victimCreated = expectStatus(await request("/api/managed-payroll", {
    method: "POST", cookie: ownVictim,
    body: { organizationId: victim.id, slaHours: 24 },
  }), 201, "Real fictional victim managed payroll must be enabled");
  assert.equal(victimCreated.json?.organizationId, victim.id);
  const victimGate = victimCreated.json.gates[0];
  assert.ok(victimGate?.id > 0);

  // Seed a real pending correction for each employer. An approved/rejected
  // decision uses the authenticated HTTP handler, not direct DB mutation.
  const makerUsers = await db.insert(users).values(f.orgs.map((org, idx) => ({
    email: "read-sweep-maker-" + org.id + "-" + idx + "@example.invalid",
    name: "Fictional payroll maker " + idx,
    role: "payroll", passwordHash: "isolated-test-only",
  }))).returning({ id: users.id, name: users.name });
  await db.insert(userOrganizations).values(f.orgs.map((org, idx) => ({
    userId: makerUsers[idx].id, organizationId: org.id, role: "payroll", active: true,
  })));
  const seeded = [];
  for (let idx = 0; idx < f.orgs.length; idx++) {
    const org = f.orgs[idx];
    const [batch] = await db.select().from(statutoryRemittanceBatches).where(and(
      eq(statutoryRemittanceBatches.organizationId, org.id),
      eq(statutoryRemittanceBatches.legalEntityId, f.entities[idx].id),
      eq(statutoryRemittanceBatches.applicableMonth, "2026-09"),
      eq(statutoryRemittanceBatches.agency, "SSS"),
    )).limit(1);
    assert.ok(batch?.id > 0, "Actual fictional employer remittance batch must exist");
    const [correction] = await db.insert(statutoryRemittanceCorrectionRequests).values({
      organizationId: org.id, targetType: "batch_payment", batchId: batch.id,
      originalSnapshot: { expectedTotal: String(batch.expectedTotal) },
      proposedSnapshot: { expectedTotal: String(batch.expectedTotal), reviewed: true },
      reason: "Fictional reconciliation correction evidence for HTTP tenant proof",
      requestedByUserId: makerUsers[idx].id,
      requestedByName: makerUsers[idx].name,
      status: "pending",
    }).returning({ id: statutoryRemittanceCorrectionRequests.id });
    seeded.push({ batch, correction });
  }
  const before = await victimSnapshot(f);
  assert.ok(seeded[0].correction.id > 0 && before.corrections.some((x) =>
    x.id === seeded[0].correction.id), "Victim-only pending correction must be real and present");

  for (const idx of [1, 2]) {
    const org = f.orgs[idx], cookie = f.ownerSessions[idx].cookie;
    const ownManagedPost = expectStatus(await request("/api/managed-payroll", {
      method: "POST", cookie, body: { organizationId: org.id, slaHours: 24 },
    }), 201, "Managed payroll POST own positive");
    assert.equal(ownManagedPost.json?.organizationId, org.id);
    assert.equal(ownManagedPost.json?.viewerUserId, f.owners[idx].id);
    const gate = ownManagedPost.json?.gates?.[0];
    assert.ok(gate?.id > 0 && gate.engagementId === ownManagedPost.json.engagement.id);
    const ownManagedGet = expectStatus(await request("/api/managed-payroll?organizationId=" + org.id, { cookie }), 200, "Managed payroll GET own positive");
    assert.equal(ownManagedGet.json?.engagement?.organizationId, org.id);
    assert.ok(ownManagedGet.json?.gates?.some((row) => row.id === gate.id));
    expectStatus(await request(
      "/api/managed-payroll?organizationId=" + victim.id, { cookie },
    ), 403, "Managed payroll GET real victim denied");
    expectStatus(await request("/api/managed-payroll", {
      method: "POST", cookie, body: { organizationId: victim.id, slaHours: 24 },
    }), 403, "Managed payroll POST real victim denied");

    const ownManagedPatch = expectStatus(await request("/api/managed-payroll", {
      method: "PATCH", cookie,
      body: { organizationId: org.id, action: "gate", gateId: gate.id,
        status: "verified", evidenceRef: "SYNTHETIC-PG-SWEEP-" + idx },
    }), 200, "Managed payroll PATCH own positive");
    assert.ok(ownManagedPatch.json?.gates?.some((row) =>
      row.id === gate.id && row.status === "verified" &&
      row.evidenceRef === "SYNTHETIC-PG-SWEEP-" + idx));
    expectStatus(await request("/api/managed-payroll", {
      method: "PATCH", cookie,
      body: { organizationId: victim.id, action: "gate", gateId: victimGate.id,
        status: "verified", evidenceRef: "FORGED-CROSS-EMPLOYER" },
    }), 403, "Managed payroll PATCH real victim denied");

    const ownRun = f.ownRuns[idx], employee = f.ownedEmployees[idx - 1];
    const ownExplain = expectStatus(await request("/api/payroll-runs/" + ownRun.id + "/explain/" + employee.id, { cookie }), 200, "Explain pay GET own stored run and employee");
    assert.equal(ownExplain.json?.run?.id, ownRun.id);
    assert.equal(ownExplain.json?.employeeId, employee.id);
    assert.equal(ownExplain.json?.organizationId, org.id);
    assert.equal(ownExplain.json?.legalEntityId, f.entities[idx].id);
    assert.equal(ownExplain.json?.explanation?.currentNet, 4500);
    expectStatus(await request(
      "/api/payroll-runs/" + f.victimRun.id + "/explain/" + f.victimEmployee.id,
      { cookie },
    ), 403, "Explain pay GET real victim-only run denied");

    const ownCorrectionGet = expectStatus(await request("/api/compliance/statutory-remittance-corrections?organizationId=" + org.id +
      "&legalEntityId=" + f.entities[idx].id, { cookie }), 200, "Remittance corrections GET own real pending evidence");
    assert.equal(ownCorrectionGet.json?.organizationId, org.id);
    assert.equal(ownCorrectionGet.json?.legalEntity?.id, f.entities[idx].id);
    assert.ok(ownCorrectionGet.json?.corrections?.some((x) =>
      x.id === seeded[idx].correction.id && x.batchId === seeded[idx].batch.id));
    expectStatus(await request(
      "/api/compliance/statutory-remittance-corrections?organizationId=" + victim.id +
      "&legalEntityId=" + f.entities[0].id, { cookie },
    ), 403, "Remittance corrections GET real victim denied");

    const ownCorrectionPost = expectStatus(await request("/api/compliance/statutory-remittance-corrections", {
        method: "POST", cookie,
        body: { organizationId: org.id, action: "reject",
          correctionId: seeded[idx].correction.id, decisionNote: "Fictional synthetic negative proof" },
      },
    ), 200, "Remittance corrections POST own real pending request");
    assert.equal(ownCorrectionPost.json?.correction?.status, "rejected");
    assert.equal(ownCorrectionPost.json?.correction?.organizationId, org.id);
    expectStatus(await request("/api/compliance/statutory-remittance-corrections", {
      method: "POST", cookie,
      body: { organizationId: victim.id, action: "reject",
        correctionId: seeded[0].correction.id, decisionNote: "FORGED-CROSS-EMPLOYER" },
    }), 403, "Remittance corrections POST real victim denied");
    console.log("PASS payroll-read-sweep three-employer own HTTP 200/201 + victim-denied 403, attacker " + idx);
  }
  const after = await victimSnapshot(f);
  assert.deepEqual(after, before, "Foreign GET/POST/PATCH and pay-explain calls cannot mutate victim managed payroll, correction or payroll rows");
  console.log(JSON.stringify({ kind: "SYNTHETIC_PG_ONLY", protectedMethods: 6,
    victimDatabaseUnchanged: true, realEmployerAccepted: false, actualMoneySent: false }));
}
