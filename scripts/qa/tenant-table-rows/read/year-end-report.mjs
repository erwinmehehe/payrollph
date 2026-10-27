// Synthetic-only year-end JSON report read. No annualization, filing or pay changes.
// The shared PG16/localhost HTTP reader supplies two independent signed-in
// attacker employers and a real, higher-ID victim; never infer coverage from this row alone.
export const fixtureOrder = {};

export function createRows({ assert, db, yearEndAdjustments: injectedYearEndAdjustments }) {
  const yearEndTable = async () => injectedYearEndAdjustments ??
    (await import("../../../../src/db/schema.ts")).yearEndAdjustments;
  const gross = rank => (23_000 + rank).toFixed(2);
  const adjustment = rank => "-" + (10 + rank).toFixed(2);
  return [
    {
      key: "GET year-end",
      query: () => "taxYear=2026&format=json",
      seed: async employer => {
        const [record] = await db.insert(await yearEndTable()).values({
          organizationId: employer.org.id,
          employeeId: employer.worker.id,
          taxYear: 2026,
          grossCompensation: gross(employer.rank),
          taxableIncome: gross(employer.rank),
          taxDue: "0.00",
          taxWithheld: (10 + employer.rank).toFixed(2),
          adjustment: adjustment(employer.rank),
          outcome: "refund",
          status: "computed",
          mwe: false,
          payrollRunId: null,
          breakdown: { fixture: "tenant-year-end-read", fictional: true, marker: employer.marker },
        }).returning();
        assert.equal(record.organizationId, employer.org.id);
        assert.equal(record.employeeId, employer.worker.id);
        assert.equal(record.taxYear, 2026);
        return record;
      },
      prove: (response, ctx) => {
        const body = response.json;
        assert.ok(body && typeof body === "object" && !Array.isArray(body));
        assert.deepEqual(Object.keys(body).sort(),
          ["taxYear", "count", "totalRefund", "totalCollect", "rows"].sort());
        assert.equal(body.taxYear, 2026);
        assert.equal(body.count, 1, "the own employer has one actual seeded adjustment");
        assert.equal(body.totalRefund, 10 + ctx.rank);
        assert.equal(body.totalCollect, 0);
        assert.ok(Array.isArray(body.rows));
        assert.equal(body.rows.length, 1);
        const row = body.rows[0];
        assert.deepEqual(Object.keys(row).sort(), [
          "employeeId", "employeeNo", "name", "mwe", "grossCompensation",
          "taxableIncome", "taxDue", "taxWithheld", "adjustment", "outcome",
          "status", "payrollRunId", "approvedAt", "settledAt",
        ].sort(), "year-end JSON must not expose unreviewed fields");
        assert.equal(row.employeeId, ctx.workerId);
        assert.equal(row.employeeNo, ctx.marker);
        assert.equal(row.name, "Table " + ctx.marker);
        assert.equal(row.mwe, false);
        assert.equal(row.grossCompensation, gross(ctx.rank));
        assert.equal(row.taxableIncome, gross(ctx.rank));
        assert.equal(row.taxDue, "0.00");
        assert.equal(row.taxWithheld, (10 + ctx.rank).toFixed(2));
        assert.equal(row.adjustment, adjustment(ctx.rank));
        assert.equal(row.outcome, "refund");
        assert.equal(row.status, "computed");
        assert.equal(row.payrollRunId, null, "no real payroll run is referenced");
        assert.equal(row.approvedAt, null);
        assert.equal(row.settledAt, null);
        assert.ok(!JSON.stringify(body).includes(ctx.victim.marker), "no higher-ID victim marker");
      },
    },
  ];
}
