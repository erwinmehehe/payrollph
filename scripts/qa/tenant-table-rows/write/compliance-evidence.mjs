import { createHash } from "node:crypto";
export const fixtureOrder = {};
const sha = text => createHash("sha256").update(text).digest("hex");

export function createRows({ assert, db, eq, asc, addWorker, governmentFilingValidations, laborInspectionDrills,
  laborInspectionRemediations, payrollRuns, payrollEntries, employees, auditEvents, auditBusinessSnapshot }) {
  const read = (table, orgId) => db.select().from(table).where(eq(table.organizationId, orgId)).orderBy(asc(table.id));
  const state = async orgId => ({
    filings: await read(governmentFilingValidations, orgId), drills: await read(laborInspectionDrills, orgId),
    remediations: await read(laborInspectionRemediations, orgId), workers: await read(employees, orgId), runs: await read(payrollRuns, orgId),
    entries: await db.select({ entry: payrollEntries }).from(payrollEntries).innerJoin(payrollRuns, eq(payrollEntries.payrollRunId, payrollRuns.id))
      .where(eq(payrollRuns.organizationId, orgId)).orderBy(asc(payrollEntries.id)),
    audits: auditBusinessSnapshot(await read(auditEvents, orgId)),
  });
  const retain = (before, after, changed) => {
    assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort());
    for (const key of Object.keys(before)) if (![changed, "audits"].includes(key)) assert.deepEqual(after[key], before[key], key + " must be retained");
  };
  const created = (before, after, c) => {
    assert.equal(after.length, before.length + 1); const added = after.filter(row => !before.some(old => old.id === row.id));
    assert.equal(added.length, 1); const row = added[0]; assert.ok(Number.isSafeInteger(row.id) && row.id > 0); assert.equal(row.organizationId, c.orgId);
    assert.deepEqual(after.filter(item => item.id !== row.id), before); return row;
  };
  const audit = (before, after, c, action, resource) => {
    const event = created(before.audits, after.audits, c); assert.equal(event.actor, c.owner.name);
    assert.equal(event.action, action); assert.equal(event.resource, resource); return event;
  };
  return [
    { key: "POST compliance/validate", state: state,
      ownBody: c => ({ organizationId: c.orgId }), foreignBody: c => ({ organizationId: c.victim.org.id }),
      expect: (before, after, c, response) => {
        retain(before, after, null); const body = response.json;
        assert.equal(body?.ok, true); assert.equal(body.organizationName, c.org.name); assert.equal(body.portalValidated, false);
        assert.equal(body.overallStatus, "LOCAL_PREFLIGHT_COMPLETE_NOT_PORTAL_VALIDATED"); assert.ok(Number.isFinite(Date.parse(body.checkedAt)));
        assert.ok(before.workers.some(worker => worker.id === c.workerId && worker.organizationId === c.orgId && worker.employeeNo === c.marker));
        assert.equal(body.dataCompleteness?.employees, before.workers.length); assert.ok(before.workers.length > 0);
        for (const [counter, field] of Object.entries({ missingEmployeeTin: "tin", missingEmployeeTinBranch: "tinBranchCode", missingMiddleName: "middleName", missingSss: "sssNo", missingPhilHealth: "philHealthNo", missingPagIbig: "pagIbigNo" })) {
          assert.ok(before.workers.every(worker => !worker[field]), "fictional fixture has no government identifiers");
          assert.equal(body.dataCompleteness[counter], before.workers.length);
        }
        assert.equal(body.validations?.length, 5); assert.deepEqual(body.validations.map(item => item.agency), ["BIR", "BIR", "SSS", "PhilHealth", "Pag-IBIG"]);
        for (const item of body.validations) { assert.equal(item.portalValidated, false); assert.ok(["LOCAL_PASS", "LOCAL_WARNING", "LOCAL_FAIL"].includes(item.status)); assert.ok(item.checks.length > 0); }
        assert.ok(body.validations[0].checks.some(check => check.message.includes(c.marker)), "own employee marker must occur in the preflight evidence");
        const event = audit(before, after, c, "Government filing local preflight executed", c.org.name);
        assert.deepEqual(event.metadata, { formsChecked: 5, localPasses: body.validations.filter(item => item.status === "LOCAL_PASS").length,
          localWarnings: body.validations.filter(item => item.status === "LOCAL_WARNING").length, localFailures: body.validations.filter(item => item.status === "LOCAL_FAIL").length,
          portalValidated: false, ruleVersion: body.engineRuleVersion });
        assert.equal(typeof body.engineRuleVersion, "string"); assert.ok(body.engineRuleVersion.length > 0);
      } },
    { key: "POST compliance/filing-validations", status: 201, state: state,
      seed: async e => {
        const [run] = await db.insert(payrollRuns).values({ organizationId: e.org.id, legalEntityId: e.entity.id,
          periodLabel: e.marker + " compliance fixture", periodStart: "2026-09-16", periodEnd: "2026-09-30", payDate: "2026-09-30", status: "Released",
          employeeCount: 1, grossPay: "20000.00", netPay: "19000.00" }).returning();
        await db.insert(payrollEntries).values({ payrollRunId: run.id, employeeId: e.worker.id, grossPay: "20000.00", deductions: "1000.00", netPay: "19000.00",
          lineItems: [{ code: "WHT", amount: -(100 + e.rank) }], trace: { fictional: true } });
        return run;
      },
      ownBody: c => ({ organizationId: c.orgId, runId: c.seeded.id, agency: "BIR", form: "1601-C" }),
      foreignBody: c => ({ organizationId: c.victim.org.id, runId: c.victimSeeded.id, agency: "BIR", form: "1601-C" }),
      forged: { status: 404, body: c => ({ organizationId: c.orgId, runId: c.victimSeeded.id, agency: "BIR", form: "1601-C" }) },
      expect: (before, after, c, response) => {
        retain(before, after, "filings"); const row = created(before.filings, after.filings, c);
        assert.equal(row.payrollRunId, c.seeded.id); assert.equal(row.legalEntityId, c.entityId); assert.equal(row.agency, "BIR"); assert.equal(row.form, "1601-C");
        assert.equal(row.periodLabel, c.marker + " compliance fixture"); assert.equal(row.applicableMonth, "2026-09"); assert.equal(row.employeeCount, 1);
        assert.equal(row.reportedTotal, (100 + c.rank).toFixed(2)); assert.equal(row.status, "generated"); assert.equal(row.generatedBy, c.owner.name);
        assert.equal(row.generatorVersion, "bir-1601c-monthly-v1"); assert.equal(row.fileName, `bir-1601c-monthly-draft-2026-09-run-${c.seeded.id}.csv`);
        const body = ["# DRAFT ONLY, not a certified government submission file", "# kind=bir-1601c", `# payrollRun=${c.seeded.id}`,
          `# period=${c.marker} compliance fixture`, "# Validate against the live government portal before filing.",
          "# BIR Form 1601-C is monthly. This worksheet aggregates all released payroll runs in 2026-09, plus this run when it is the current final cutoff.",
          "Form,ApplicableMonth,WithholdingTax,Employees,PayrollRunsIncluded,Status", `"1601-C","2026-09","${(100 + c.rank).toFixed(2)}","1","1","DRAFT"`].join("\n");
        assert.equal(row.fileSha256, sha(body));
        for (const key of ["agencyReference", "submissionMethod", "submittedAt", "recordedBy", "recordedAt"]) assert.equal(row[key], null);
        assert.equal(response.json?.created, true); assert.deepEqual(response.json.record, row);
        const event = audit(before, after, c, "BIR 1601-C filing record created", row.periodLabel);
        assert.deepEqual(event.metadata, { runId: c.seeded.id, legalEntityId: c.entityId, recordId: row.id, fileSha256: row.fileSha256,
          generatorVersion: row.generatorVersion, applicableMonth: "2026-09", employeeCount: 1, reportedTotal: 100 + c.rank, submittedToAgency: false });
      } },
    { key: "POST compliance/labor-inspection/drills", status: 201, state: state,
      seed: e => addWorker(e, "CE-DRILL", { payProfile: false }),
      ownBody: c => ({ organizationId: c.orgId }), foreignBody: c => ({ organizationId: c.victim.org.id }),
      expect: (before, after, c, response) => {
        retain(before, after, "drills"); const row = created(before.drills, after.drills, c), drill = response.json?.drill;
        assert.equal(drill?.id, row.id); assert.equal(row.generatedBy, c.owner.name); assert.equal(drill.generatedBy, c.owner.name);
        assert.ok(["blocked", "needs-work", "evidence-ready"].includes(row.status)); assert.equal(drill.status, row.status);
        assert.equal(drill.rangeLabel, row.rangeLabel); assert.equal(drill.evidencePackVersion, row.evidencePackVersion);
        assert.equal(drill.evidencePackSha256, row.evidencePackSha256); assert.equal(drill.snapshotSha256, row.snapshotSha256);
        assert.match(row.evidencePackSha256, /^[a-f0-9]{64}$/); assert.match(row.snapshotSha256, /^[a-f0-9]{64}$/);
        assert.deepEqual(drill.sectionRowCounts, row.sectionRowCounts); assert.equal(row.sectionRowCounts.workerRoster, before.workers.length);
        assert.deepEqual(drill.blockers, row.blockerSummary); assert.deepEqual(drill.actionPlan, row.actionPlan);
        assert.ok(drill.blockers.some(item => item.employeeNo === c.seeded.employeeNo), "drill must contain its own fictional missing-pay-profile finding");
        for (const [column, field] of Object.entries({ highFindings: "high", mediumFindings: "medium", infoFindings: "info", unownedActionable: "unownedActionable", readyToClose: "readyToClose" })) assert.equal(row[column], drill.summary[field]);
        assert.equal(Number(row.recordedExposure), drill.summary.recordedExposure); assert.equal(Number(row.screeningExposure), drill.summary.screeningExposure);
        const canonical = { status: drill.status, summary: drill.summary, blockers: drill.blockers, actionPlan: drill.actionPlan,
          evidencePackSha256: drill.evidencePackSha256, evidencePackVersion: drill.evidencePackVersion, rangeLabel: drill.rangeLabel, sectionRowCounts: drill.sectionRowCounts };
        assert.equal(sha(JSON.stringify(canonical)), row.snapshotSha256);
        const event = audit(before, after, c, "Labor inspection drill completed", row.rangeLabel);
        assert.deepEqual(event.metadata, { drillId: row.id, status: row.status, snapshotSha256: row.snapshotSha256, evidencePackSha256: row.evidencePackSha256,
          evidencePackVersion: row.evidencePackVersion, summary: drill.summary, certificationClaimed: false });
      } },
  ];
}
