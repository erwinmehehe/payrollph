/**
 * One uncredited GAP row. Shared write runner proves:
 * A/B authenticated signed-in owner succeeds only for its own generated filing,
 * same owner naming the actual higher-ID victim organization is denied,
 * same owner naming the higher-ID victim filing under its own organization is
 * not found; the victim's whole PostgreSQL snapshot remains unchanged.
 *
 * Only fictional REJECTED records are positively exercised. There is NO
 * agency acceptance, submission, remittance, payment or payroll release.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { and, sql } from "drizzle-orm";
import {
  FILING_METHOD, FILING_PERIOD, filingRejectionBody,
  proveOwnRejectedFiling, proveFilingDenied, proveFilingStateUntouched,
} from "../../tenant-compliance-filing-contract.mjs";

export function createRows({
  asc, auditBusinessSnapshot, auditEvents, db, employees, eq,
  employeePayProfiles, governmentFilingValidations, payrollRuns,
}) {
  async function state(organizationId) {
    const list = table => db.select().from(table)
      .where(eq(table.organizationId, organizationId))
      .orderBy(asc(table.id));
    const [filings, runs, workers, payProfiles, audits] = await Promise.all([
      list(governmentFilingValidations), list(payrollRuns), list(employees),
      list(employeePayProfiles), list(auditEvents),
    ]);
    return {
      filings, runs, employees: workers, payProfiles,
      audit: auditBusinessSnapshot(audits),
    };
  }

  async function seed(e) {
    const [run] = await db.insert(payrollRuns).values({
      organizationId: e.org.id,
      legalEntityId: e.entity.id,
      scopeOrgUnitId: e.unit.id,
      periodLabel: e.marker + " fictional SSS R-3 source",
      periodStart: FILING_PERIOD.periodStart,
      periodEnd: FILING_PERIOD.periodEnd,
      payDate: FILING_PERIOD.payDate,
      status: "Released",
      employeeCount: 1,
      grossPay: (20_000 + e.rank * 123).toFixed(2),
      netPay: (17_000 + e.rank * 113).toFixed(2),
    }).returning();
    assert.ok(Number.isSafeInteger(run.id) && run.id > 0,
      "real Released source payroll ID required");
    assert.equal(run.organizationId, e.org.id);
    assert.equal(run.legalEntityId, e.entity.id);

    // Fictional worksheet hash. This does NOT claim official submission,
    // external acceptance, or reproduction of government file bytes.
    const sha = createHash("sha256").update(
      "disposable-synthetic-sss-r3:" + e.marker + ":" + run.id,
    ).digest("hex");
    const [filing] = await db.insert(governmentFilingValidations).values({
      organizationId: e.org.id,
      legalEntityId: e.entity.id,
      payrollRunId: run.id,
      agency: "SSS", form: "R-3",
      periodLabel: run.periodLabel,
      applicableMonth: FILING_PERIOD.applicableMonth,
      employeeCount: 1,
      reportedTotal: (20_000 + e.rank * 123).toFixed(2),
      fileName: e.marker + "-synthetic-sss-r3.csv",
      fileSha256: sha,
      generatorVersion: "sss-r3-worksheet-v2",
      generatedBy: e.marker + " fictional worksheet fixture",
      status: "generated",
    }).returning();
    assert.ok(Number.isSafeInteger(filing.id) && filing.id > 0,
      "real persisted filing ID required");
    assert.equal(filing.organizationId, e.org.id);
    assert.equal(filing.legalEntityId, e.entity.id);
    assert.equal(filing.payrollRunId, run.id);
    assert.equal(filing.status, "generated");
    assert.match(filing.fileSha256, /^[a-f0-9]{64}$/);
    return { id: filing.id, runId: run.id };
  }

  return [
    {
      key: "PATCH compliance/filing-validations/[id]",
      pathIds: { id: "id" },
      state,
      seed,
      ownBody: c => filingRejectionBody(c),
      foreignBody: c => filingRejectionBody(c, c.victim.org.id),
      forged: {
        status: 404,
        body: c => filingRejectionBody(c),
      },
      expect: (before, after, ctx, response) =>
        proveOwnRejectedFiling(before, after, ctx, response),

      // The successful own status is immutable. Test this through the real
      // PATCH route; neither the filing nor its one new audit may be revised.
      exercise: async (ctx, { request, expectStatus, cookie }) => {
        const url = "/api/compliance/filing-validations/" + ctx.seeded.id;
        const ownBefore = await state(ctx.orgId);
        const victimBefore = await state(ctx.victim.org.id);
        const markerPair = [ctx.marker, ctx.victim.marker];
        const cases = [
          {
            label: "repeat an already recorded rejection",
            body: filingRejectionBody(ctx),
            status: 409,
          },
          {
            label: "fabricate agency acceptance without an agency reference",
            body: {
              ...filingRejectionBody(ctx),
              outcome: "accepted",
              agencyReference: "",
              submittedAt: "2026-09-16",
            },
            status: 400,
          },
          {
            label: "supply a nonexistent calendar date",
            body: {
              ...filingRejectionBody(ctx),
              submittedAt: "2026-02-30",
            },
            status: 400,
          },
        ];
        for (const item of cases) {
          const result = expectStatus(await request(url, {
            method: "PATCH", cookie, body: item.body,
          }), item.status, "filing cannot " + item.label);
          proveFilingDenied(result, item.status, markerPair);
          proveFilingStateUntouched(ownBefore, await state(ctx.orgId));
          proveFilingStateUntouched(victimBefore,
            await state(ctx.victim.org.id));
        }
        // Synthetic audit-insert veto: if the status transition is not in the
        // same PostgreSQL transaction as its audit, this real HTTP request
        // would commit "rejected" even though the audit INSERT fails.
        // The extra generated source is a disposable local fixture ONLY.
        const [vetoFiling] = await db.insert(governmentFilingValidations).values({
          organizationId: ctx.orgId,
          legalEntityId: ctx.entityId,
          payrollRunId: ctx.seeded.runId,
          agency: "SSS", form: "R-3",
          periodLabel: ctx.marker + " atomic-veto-fixture",
          applicableMonth: FILING_PERIOD.applicableMonth,
          fileName: ctx.marker + "-atomic-veto-fixture.csv",
          fileSha256: createHash("sha256").update(
            "ci-only-audit-veto:" + ctx.marker + ":" + ctx.seeded.runId,
          ).digest("hex"),
          generatorVersion: "sss-r3-worksheet-v2",
          generatedBy: ctx.marker + " fictional atomicity fixture",
          status: "generated",
        }).returning();
        assert.equal(vetoFiling.organizationId, ctx.orgId);
        assert.equal(vetoFiling.legalEntityId, ctx.entityId);
        assert.ok(vetoFiling.id > ctx.seeded.id);
        const beforeVeto = await state(ctx.orgId);
        const victimBeforeVeto = await state(ctx.victim.org.id);
        let vetoFunctionCreated = false;
        let vetoTriggerCreated = false;
        try {
          await db.execute(sql.raw(`
            CREATE FUNCTION ci_filing_audit_veto() RETURNS trigger
            LANGUAGE plpgsql AS $ci_filing_audit$
            BEGIN
              IF NEW.action = 'SSS R-3 filing rejected'
                 AND NEW.resource LIKE '%atomic-veto-fixture%' THEN
                RAISE EXCEPTION 'CI_ONLY_FILING_AUDIT_VETO';
              END IF;
              RETURN NEW;
            END;
            $ci_filing_audit$;
          `));
          vetoFunctionCreated = true;
          await db.execute(sql.raw(`
            CREATE TRIGGER ci_filing_audit_veto_trigger
            BEFORE INSERT ON audit_events
            FOR EACH ROW EXECUTE FUNCTION ci_filing_audit_veto();
          `));
          vetoTriggerCreated = true;
          const response = expectStatus(await request(
            "/api/compliance/filing-validations/" + vetoFiling.id, {
              method: "PATCH", cookie, body: filingRejectionBody(ctx),
            }), 409, "atomic filing decision must roll back on a failed audit insert");
          proveFilingDenied(response, 409, markerPair);
          proveFilingStateUntouched(beforeVeto, await state(ctx.orgId));
          proveFilingStateUntouched(victimBeforeVeto,
            await state(ctx.victim.org.id));
        } finally {
          if (vetoTriggerCreated) {
            await db.execute(sql.raw(
              "DROP TRIGGER ci_filing_audit_veto_trigger ON audit_events",
            ));
          }
          if (vetoFunctionCreated) {
            await db.execute(sql.raw("DROP FUNCTION ci_filing_audit_veto()"));
          }
          // Never contaminate another write-table method's fixture with this
          // extra generated source; direct SQL setup/cleanup is CI-only.
          const removed = await db.delete(governmentFilingValidations).where(and(
            eq(governmentFilingValidations.id, vetoFiling.id),
            eq(governmentFilingValidations.organizationId, ctx.orgId),
          )).returning({ id: governmentFilingValidations.id });
          assert.deepEqual(removed.map(row => row.id), [vetoFiling.id]);
        }
        return {
          repeatedDecisionBlocked: true,
          fabricatedAcceptanceBlocked: true,
          impossibleDateBlocked: true,
          atomicAuditInsertRollbackProven: true,
          immutableReleasedRun: true,
          realAgencySubmissionOrMoneyMovement: false,
        };
      },
    },
  ];
}
