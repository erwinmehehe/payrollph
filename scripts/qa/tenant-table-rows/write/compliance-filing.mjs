/**
 * One uncredited GAP row. Shared write runner proves:
 * A/B authenticated signed-in owner succeeds only for its own generated filing,
 * same owner naming the actual higher-ID victim organization is denied,
 * same owner naming the higher-ID victim filing under its own organization is
 * not found; the victim's whole PostgreSQL snapshot remains unchanged.
 *
 * Both fictional rejected and ACCEPTED status branches are exercised, but
 * no government acknowledgement, submission, remittance, payment or payroll
 * release actually occurs. All agency references are CI-only fixtures.
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
    // Real numeric victim filing IDs must be above BOTH attacker filings
    // and greater than 6. Seed six inert, fictional, never-used SQL objects
    // per employer BEFORE its own target; no guessed IDs or fake lookups.
    // They are ordinary generated draft fixtures, with no acceptance, audit,
    // remittance or provider side effects in the isolated PG16 database.
    for (let pad = 0; pad < 6; pad++) {
      const padded = await db.insert(governmentFilingValidations).values({
        organizationId: e.org.id, legalEntityId: e.entity.id,
        payrollRunId: run.id, agency: "SSS", form: "R-3",
        periodLabel: e.marker + " inert-victim-ID-pad-" + pad,
        applicableMonth: FILING_PERIOD.applicableMonth,
        employeeCount: 1,
        reportedTotal: (20_000 + e.rank * 123).toFixed(2),
        fileName: e.marker + "-fictional-inert-" + pad + ".csv",
        fileSha256: createHash("sha256").update(
          "disposable-inert-filing-id:" + e.marker + ":" + run.id + ":" + pad,
        ).digest("hex"),
        generatorVersion: "sss-r3-worksheet-v2",
        generatedBy: e.marker + " synthetic ID-order fixture",
        status: "generated",
      }).returning({ id: governmentFilingValidations.id });
      assert.equal(padded.length, 1,
        "a real persisted padding filing is mandatory");
    }
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
    assert.ok(Number.isSafeInteger(filing.id) && filing.id > 6,
      "real persisted filing ID above six required");
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
        // Recover the separate accepted-outcome POST/PATCH branch as a
        // genuine signed-in HTTP and persisted DB proof for EACH attacker
        // employer. This creates only a FICTIONAL acknowledgement in the
        // verified empty PG16 database: no real SSS portal, submission, funds,
        // payroll release, or government response is implied or contacted.
        const fictionalReference = "CI-ONLY-SSS-" + ctx.seeded.id;
        // The real PATCH source-integrity guard re-generates the worksheet
        // from its Released payroll run. The CI-only accepted path must use
        // those exact bytes, not a fabricated file hash or an early cutoff.
        const { generateGovernmentDraft } = await import("../../../../src/lib/exporters.ts");
        const sourceFile = await generateGovernmentDraft(ctx.seeded.runId, "sss-r3");
        assert.match(sourceFile.body, /^# DRAFT ONLY, not a certified government submission file/);
        assert.match(sourceFile.filename, /^sss-ecl-r3-worksheet-\d+\.csv$/);
        const sourceHash = createHash("sha256").update(sourceFile.body, "utf8").digest("hex");
        assert.match(sourceHash, /^[a-f0-9]{64}$/);
        const [acceptFixture] = await db.insert(governmentFilingValidations).values({
          organizationId: ctx.orgId, legalEntityId: ctx.entityId,
          payrollRunId: ctx.seeded.runId,
          agency: "SSS", form: "R-3",
          periodLabel: ctx.marker + " CI-only accepted-path fixture",
          applicableMonth: FILING_PERIOD.applicableMonth,
          employeeCount: 1, reportedTotal: (20_000 + ctx.rank * 123).toFixed(2),
          fileName: sourceFile.filename,
          fileSha256: sourceHash,
          generatorVersion: "sss-r3-worksheet-v2",
          generatedBy: ctx.marker + " fictional branch-coverage fixture",
          status: "generated",
        }).returning();
        assert.equal(acceptFixture.organizationId, ctx.orgId);
        assert.equal(acceptFixture.legalEntityId, ctx.entityId);
        assert.equal(acceptFixture.payrollRunId, ctx.seeded.runId);
        assert.ok(acceptFixture.id > ctx.seeded.id,
          "new accepted-path source must be a real later persisted filing");
        const acceptedBody = {
          organizationId: ctx.orgId, outcome: "accepted",
          submissionMethod: "manual_entry",
          agencyReference: fictionalReference,
          submittedAt: "2025-08-01",
          note: "Fictional branch-coverage acceptance only; never submitted to SSS",
        };
        const beforeAccepted = await state(ctx.orgId);
        const victimBeforeAccepted = await state(ctx.victim.org.id);
        const acceptedHttp = expectStatus(await request(
          "/api/compliance/filing-validations/" + acceptFixture.id, {
            method: "PATCH", cookie, body: acceptedBody,
          }), 200, "real own authorized SSS R-3 accepted decision branch");
        const afterAccepted = await state(ctx.orgId);
        const persistedAccepted = afterAccepted.filings.find(
          row => row.id === acceptFixture.id);
        assert.ok(persistedAccepted, "own acceptance must commit genuine PG16 row");
        assert.equal(persistedAccepted.organizationId, ctx.orgId);
        assert.equal(persistedAccepted.legalEntityId, ctx.entityId);
        assert.equal(persistedAccepted.payrollRunId, ctx.seeded.runId);
        assert.equal(persistedAccepted.status, "accepted");
        assert.equal(persistedAccepted.submissionMethod, "manual_entry");
        assert.equal(persistedAccepted.agencyReference, fictionalReference);
        assert.equal(persistedAccepted.submittedAt?.toISOString?.().slice(0, 10),
          "2025-08-01");
        assert.equal(persistedAccepted.recordedBy, ctx.owner.name);
        assert.ok(persistedAccepted.recordedAt,
          "an authorized accepted decision must have a persisted actor timestamp");
        assert.deepEqual(acceptedHttp.json?.record,
          JSON.parse(JSON.stringify(persistedAccepted)),
          "own 200 must return exactly the committed acceptance row");
        for (const name of ["runs", "employees", "payProfiles"]) {
          assert.deepEqual(afterAccepted[name], beforeAccepted[name],
            "a filing acceptance must not change payroll/worker/pay profiles: " + name);
        }
        assert.deepEqual(afterAccepted.filings.filter(row => row.id !== acceptFixture.id),
          beforeAccepted.filings.filter(row => row.id !== acceptFixture.id),
          "a synthetic acceptance cannot change another own filing");
        assert.equal(afterAccepted.audit.length, beforeAccepted.audit.length + 1,
          "one own acceptance must commit exactly one actor audit");
        assert.deepEqual(afterAccepted.audit.slice(0, -1), beforeAccepted.audit,
          "acceptance must not mutate any earlier audit event");
        const acceptedAudit = afterAccepted.audit.at(-1);
        assert.equal(acceptedAudit.organizationId, ctx.orgId);
        assert.equal(acceptedAudit.actor, ctx.owner.name);
        assert.equal(acceptedAudit.action, "SSS R-3 filing accepted");
        assert.equal(acceptedAudit.resource, persistedAccepted.periodLabel);
        assert.deepEqual(acceptedAudit.metadata, {
          recordId: acceptFixture.id, runId: ctx.seeded.runId,
          fileSha256: persistedAccepted.fileSha256,
          submissionMethod: "manual_entry", agencyReference: fictionalReference,
          submittedAt: persistedAccepted.submittedAt.toISOString(),
        });
        assert.ok(!acceptedHttp.text.includes(ctx.victim.marker),
          "real own accepted HTTP response must not leak victim filing evidence");
        proveFilingStateUntouched(victimBeforeAccepted,
          await state(ctx.victim.org.id));

        // Repeat denial and the SAME victim/forged selectors applied to the
        // accepted action, not merely the previously tested rejection action.
        for (const deniedCase of [
          {
            label: "repeat immutable accepted decision",
            url: "/api/compliance/filing-validations/" + acceptFixture.id,
            body: acceptedBody, status: 409,
          },
          {
            label: "foreign organization accepted decision",
            url: "/api/compliance/filing-validations/" + ctx.victimSeeded.id,
            body: { ...acceptedBody, organizationId: ctx.victim.org.id },
            status: 403,
          },
          {
            label: "forged victim filing ID within own organization",
            url: "/api/compliance/filing-validations/" + ctx.victimSeeded.id,
            body: acceptedBody, status: 404,
          },
        ]) {
          const deniedResponse = expectStatus(await request(deniedCase.url, {
            method: "PATCH", cookie, body: deniedCase.body,
          }), deniedCase.status,
          "Fictional accepted-path " + deniedCase.label);
          proveFilingDenied(deniedResponse, deniedCase.status,
            [ctx.marker, ctx.victim.marker]);
          proveFilingStateUntouched(afterAccepted, await state(ctx.orgId));
          proveFilingStateUntouched(victimBeforeAccepted,
            await state(ctx.victim.org.id));
        }

        // Synthetic audit-insert veto: test BOTH outcome branches. If either
        // status transition is not in the same PostgreSQL transaction as its
        // audit, the real HTTP request would commit despite a failed INSERT.
        // The extra generated source is a disposable local fixture ONLY.
        // government_filing_file_unique forbids two records for the same
        // employer, form and file SHA. Use a second fictional Released run
        // with a different month, then clean up BOTH the run and filing.
        const [vetoRun] = await db.insert(payrollRuns).values({
          organizationId: ctx.orgId,
          legalEntityId: ctx.entityId,
          scopeOrgUnitId: ctx.unit.id,
          periodLabel: ctx.marker + " CI-only audit-veto source",
          periodStart: "2024-07-01", periodEnd: "2024-07-31",
          payDate: "2024-07-31", status: "Released",
          employeeCount: 0, grossPay: "0.00", netPay: "0.00",
        }).returning();
        assert.ok(vetoRun.id > ctx.seeded.runId,
          "audit veto must use its own real later source run");
        const vetoWorksheet = await generateGovernmentDraft(vetoRun.id, "sss-r3");
        const vetoHash = createHash("sha256").update(vetoWorksheet.body, "utf8").digest("hex");
        assert.notEqual(vetoHash, sourceHash,
          "audit-veto source must not conflict with existing accepted filing unique SHA");
        const [vetoFiling] = await db.insert(governmentFilingValidations).values({
          organizationId: ctx.orgId,
          legalEntityId: ctx.entityId,
          payrollRunId: vetoRun.id,
          agency: "SSS", form: "R-3",
          periodLabel: ctx.marker + " atomic-veto-fixture",
          applicableMonth: FILING_PERIOD.applicableMonth,
          // Acceptance must pass regeneration/integrity checks and actually
          // reach the audit INSERT trigger, rather than 409 on a bad SHA.
          fileName: vetoWorksheet.filename,
          fileSha256: vetoHash,
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
              IF NEW.action IN ('SSS R-3 filing rejected', 'SSS R-3 filing accepted')
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
          // A valid accepted submission has a matching regenerable worksheet
          // and a nonempty fictional reference. Thus the audit INSERT veto,
          // not a source-integrity 409, must prevent acceptance atomically.
          const acceptedAuditVeto = expectStatus(await request(
            "/api/compliance/filing-validations/" + vetoFiling.id, {
              method: "PATCH", cookie,
              body: { ...acceptedBody, agencyReference: "CI-ONLY-SSS-VETO-" + vetoFiling.id },
            }), 409, "accepted filing outcome must roll back on a failed audit insert");
          proveFilingDenied(acceptedAuditVeto, 409, markerPair);
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
          const removedRun = await db.delete(payrollRuns).where(and(
            eq(payrollRuns.id, vetoRun.id),
            eq(payrollRuns.organizationId, ctx.orgId),
          )).returning({ id: payrollRuns.id });
          assert.deepEqual(removedRun.map(row => row.id), [vetoRun.id]);
        }
        return {
          acceptedOwnDecisionPG16: true,
          acceptedForeignAndForgedDenied: true,
          acceptedVictimDbAndAuditUnchanged: true,
          acceptedBranchNoRealAgencySubmission: true,
          repeatedDecisionBlocked: true,
          fabricatedAcceptanceBlocked: true,
          impossibleDateBlocked: true,
          atomicAuditInsertRollbackProven: true,
          acceptedAuditInsertRollbackProven: true,
          immutableReleasedRun: true,
          realAgencySubmissionOrMoneyMovement: false,
        };
      },
    },
  ];
}
