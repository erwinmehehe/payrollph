export const fixtureOrder = {};
export function createRows({ assert, db, employeeMweClassifications, payrollRuns, workerEffectiveChanges }) {
  return [
    { key: "GET employees/[id]/mwe-classifications", pathIds: { id: "employeeId" },
      seed: async e => (await db.insert(employeeMweClassifications).values({ organizationId: e.org.id, employeeId: e.worker.id,
        isMwe: false, region: "NCR", employeeDailyWage: String(1000 + e.rank), statutoryMinimumWage: "600.00",
        wageOrderReference: "FICTIONAL-" + e.marker, evidenceReference: e.marker, effectiveFrom: "2026-02-01",
        status: "rejected", requestedByUserId: e.owner.id, requestedByName: e.owner.name }).returning())[0],
      prove: (response, c) => {
        assert.equal(response.json.employee.id, c.workerId); assert.equal(response.json.employee.employeeNo, c.marker);
        assert.ok(Array.isArray(response.json.classifications) && response.json.classifications.length > 0);
        const row = response.json.classifications.find(row => row.id === c.seeded.id);
        assert.ok(row); assert.equal(row.organizationId, c.orgId); assert.equal(row.employeeId, c.workerId);
        assert.equal(row.evidenceReference, c.marker); assert.equal(row.wageOrderReference, "FICTIONAL-" + c.marker);
        assert.equal(row.status, "rejected"); assert.equal(row.isMwe, false); assert.equal(row.requestedByUserId, c.owner.id);
        assert.equal(Number(row.employeeDailyWage), 1000 + c.rank);
      } },
    { key: "GET payroll-runs/[id]/connected-impact", pathIds: { id: "id" }, profile: "flagged-reads", flags: ["PAYROLL_CONNECTED_IMPACT_ENABLED"],
      seed: async e => {
        const [run] = await db.insert(payrollRuns).values({ organizationId: e.org.id, legalEntityId: null, scopeOrgUnitId: null,
          periodLabel: e.marker, periodStart: "2026-06-01", periodEnd: "2026-06-15", payDate: "2026-06-15", status: "Draft" }).returning();
        const [change] = await db.insert(workerEffectiveChanges).values({ organizationId: e.org.id, employeeId: e.worker.id,
          effectiveDate: "2026-06-02", reason: e.marker, requestedBy: e.owner.name }).returning();
        return { id: run.id, changeId: change.id };
      },
      prove: (response, c) => {
        const body = response.json; assert.equal(body.runId, c.seeded.id); assert.equal(body.runStatus, "Draft");
        assert.equal(body.periodStart, "2026-06-01"); assert.equal(body.periodEnd, "2026-06-15"); assert.equal(body.advisoryOnly, true);
        assert.ok(body.total > 0 && body.summary.HRIS > 0); assert.equal(body.incomplete, false);
        const finding = body.findings.find(row => row.sourceId === c.seeded.changeId && row.code === "HRIS_CHANGE_NOT_APPLIED");
        assert.ok(finding); assert.equal(finding.employeeId, c.workerId); assert.equal(finding.date, "2026-06-02");
      } },
  ];
}
