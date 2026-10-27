/**
 * Read-only POST /api/loans/schedule-preview isolation.
 * Real production-mode localhost Next + freshly empty fictional PG16.
 * No deduction, approval, posting, payout, remittance or provider call.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  requireDisposableLoanPreview, requirePrivateNoStore,
  previewInputs, proveCompany, proveAgency, proveFloor,
} from "./tenant-loan-schedule-tenant-proof.mjs";

export async function verifyLoanSchedulePreviewTenantHttp() {
  // Fail closed before loading any app modules or connecting to PostgreSQL.
  requireDisposableLoanPreview();
  const [{ db, pool }, schema, { and, eq, asc }, table] = await Promise.all([
    import("../../src/db/index.ts"),
    import("../../src/db/schema.ts"),
    import("drizzle-orm"),
    import("./tenant-table-http.mjs"),
  ]);
  const {
    organizations, employees, employeeLoans, loanPayments,
    employeePayProfiles, employeePayRevisions, payrollRuns,
    payrollEntries, auditEvents,
  } = schema;
  const { seedEmployer, standaloneMakeSession, standaloneRequest } = table;
  try {
    const original = await db.select({ id: organizations.id }).from(organizations).limit(1);
    assert.equal(original.length, 0,
      "LOAN_PREVIEW_PROOF_REFUSED: a genuinely EMPTY disposable database is required");

    const nonce = randomUUID().replaceAll("-", "").slice(0, 10);
    const attackerA = await seedEmployer("ATTA", nonce, standaloneMakeSession);
    const attackerB = await seedEmployer("ATTB", nonce, standaloneMakeSession);
    const victim = await seedEmployer("VICTIM", nonce, standaloneMakeSession);
    assert.ok(victim.org.id > attackerA.org.id && victim.org.id > attackerB.org.id);
    assert.ok(victim.worker.id > attackerA.worker.id && victim.worker.id > attackerB.worker.id);
    assert.ok(victim.owner.id > attackerA.owner.id && victim.owner.id > attackerB.owner.id);

    const snapshot = async orgId => ({
      org: await db.select().from(organizations).where(eq(organizations.id, orgId)),
      employees: await db.select().from(employees).where(eq(employees.organizationId, orgId)).orderBy(asc(employees.id)),
      profiles: await db.select().from(employeePayProfiles).where(eq(employeePayProfiles.organizationId, orgId)).orderBy(asc(employeePayProfiles.id)),
      payRevisions: await db.select().from(employeePayRevisions).where(eq(employeePayRevisions.organizationId, orgId)).orderBy(asc(employeePayRevisions.id)),
      loans: await db.select().from(employeeLoans).where(eq(employeeLoans.organizationId, orgId)).orderBy(asc(employeeLoans.id)),
      payments: await db.select({ payment: loanPayments }).from(loanPayments)
        .innerJoin(employeeLoans, eq(loanPayments.loanId, employeeLoans.id))
        .where(eq(employeeLoans.organizationId, orgId)).orderBy(asc(loanPayments.id)),
      payrollRuns: await db.select().from(payrollRuns).where(eq(payrollRuns.organizationId, orgId)).orderBy(asc(payrollRuns.id)),
      payrollEntries: await db.select({ entry: payrollEntries }).from(payrollEntries)
        .innerJoin(payrollRuns, eq(payrollEntries.payrollRunId, payrollRuns.id))
        .where(eq(payrollRuns.organizationId, orgId)).orderBy(asc(payrollEntries.id)),
      audit: await db.select().from(auditEvents).where(eq(auditEvents.organizationId, orgId)).orderBy(asc(auditEvents.id)),
    });
    const baseline = await Promise.all([attackerA, attackerB, victim].map(e => snapshot(e.org.id)));
    assert.ok(baseline.every(b => b.employees.length > 0 && b.profiles.length > 0),
      "a real persisted employee and pay profile are required for every employer");

    const forbidden = [attackerA.cookie, attackerB.cookie, victim.cookie]
      .map(cookie => cookie.split("=")[1]);
    async function post({ cookie, body }, expected, label) {
      const response = await standaloneRequest("/api/loans/schedule-preview", {
        method: "POST", cookie, body,
      });
      assert.equal(response.status, expected,
        label + ": expected exact HTTP " + expected + ", got " + response.status);
      for (const token of forbidden) {
        assert.ok(!response.text.includes(token),
          label + ": fictional bearer token must never appear in a response");
      }
      if (expected === 200) requirePrivateNoStore(response.headers);
      assert.ok(!response.text.includes(victim.marker) || cookie === victim.cookie,
        label + ": real victim marker leaked to an attacker");
      return response.json;
    }
    const prepare = (e, kind) => ({
      cookie: e.cookie,
      body: { organizationId: e.org.id, ...previewInputs(e.rank, e.marker)[kind] },
    });
    // The owner of the genuine victim employer has an authorized positive
    // control, proving the victim is not just a fabricated unauthorized ID.
    const victimCompany = await post(prepare(victim, "company"), 200, "victim own company");
    proveCompany(victimCompany, victim.rank);

    const firstResponses = new Map();
    for (const e of [attackerA, attackerB]) {
      const ownCompany = await post(prepare(e, "company"), 200, "own company");
      proveCompany(ownCompany, e.rank);
      const ownAgency = await post(prepare(e, "agency"), 200, "own imported agency");
      proveAgency(ownAgency, e.rank, e.marker);
      const ownFloor = await post(prepare(e, "floor"), 200, "own net-pay floor");
      proveFloor(ownFloor, e.rank);
      if (e === attackerA) {
        firstResponses.set("company", ownCompany);
        firstResponses.set("agency", ownAgency);
        firstResponses.set("floor", ownFloor);
      } else {
        assert.throws(() => proveCompany(firstResponses.get("company"), e.rank),
          "one employer's real schedule must fail the other employer's proof");
        assert.throws(() => proveAgency(firstResponses.get("agency"), e.rank, e.marker));
        assert.throws(() => proveFloor(firstResponses.get("floor"), e.rank));
      }

      // Both attacker sessions name a real, higher-ID victim employer in a
      // fully valid request. Authorization, not malformed input, must deny it.
      for (const foreign of [victim, e === attackerA ? attackerB : attackerA]) {
        await post({
          cookie: e.cookie,
          body: { organizationId: foreign.org.id, ...previewInputs(e.rank, e.marker).company },
        }, 403, "foreign real employer company preview");
      }
      await post({ cookie: e.cookie, body: {
        organizationId: e.org.id, kind: "unknown",
      } }, 422, "unsupported kind denied");
      await post({ cookie: e.cookie, body: {
        organizationId: e.org.id, ...previewInputs(e.rank, e.marker).company,
        principal: "1000.001",
      } }, 422, "lossy centavos denied");

      // An attempted override in an untrusted body cannot grant deduction
      // authority; the route forwards only the four preview inputs.
      const ignoredOverride = await post({ cookie: e.cookie, body: {
        organizationId: e.org.id, ...previewInputs(e.rank, e.marker).floor,
        override: {
          requesterUserId: e.owner.id, approverUserId: victim.owner.id,
          legalAuthorityReviewed: true,
          approvalEvidenceReference: "SYNTHETIC-NOT-APPROVED",
          reason: "Synthetic external evidence must not approve any deduction.",
        },
      } }, 200, "forged floor override ignored");
      proveFloor(ignoredOverride, e.rank);
    }

    await post({ cookie: undefined, body: {
      organizationId: victim.org.id, ...previewInputs(victim.rank, victim.marker).company,
    } }, 401, "anonymous cannot preview victim employer");
    await post({ cookie: "__Host-linaw_session=" + "f".repeat(64), body: {
      organizationId: victim.org.id, ...previewInputs(victim.rank, victim.marker).company,
    } }, 401, "unknown bearer cannot preview victim employer");

    // No pending balance, payroll ledger or audit may move during previews.
    const after = await Promise.all([attackerA, attackerB, victim].map(e => snapshot(e.org.id)));
    assert.deepEqual(after, baseline,
      "preview must leave both attackers and the genuine victim's loans, money, people and audit unchanged");
    console.log(JSON.stringify({
      kind: "loan-schedule-preview-tenant-http",
      method: "POST loans/schedule-preview",
      employers: 3, independentAttackers: 2, higherIdVictim: true,
      companyAgencyFloorOwnPositive: true, discriminatingEmployerEvidence: true,
      foreignEmployer403: true, malformed422: true, anonymous401: true,
      snapshotIncludesLoansPaymentsPayrollAndAudit: true,
      everyEmployerDatabaseUnchanged: true, deductionsEnabled: false,
      monetaryPosting: false, productionTested: false, credited: 0,
    }));
    return { provenMethod: "POST loans/schedule-preview", credited: 0 };
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("scripts/qa/tenant-loan-schedule-tenant-http.mjs")) {
  verifyLoanSchedulePreviewTenantHttp().catch(error => {
    console.error(error instanceof Error ? error.message : "Loan preview proof failed");
    process.exitCode = 1;
  });
}
