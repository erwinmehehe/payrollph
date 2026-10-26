// Batch 2: allowlisted workforce GET proofs. Owned rows are inserted in disposable PG16.
export const fixtureOrder = {};

export function createRows({ assert, db }) {
  let schema;
  const tables = async () => (schema ??= await import("../../../../src/db/schema"));
  const manilaToday = () => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila",
      year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const value = key => parts.find(x => x.type === key).value;
    return value("year") + "-" + value("month") + "-" + value("day");
  };
  const dateBack = days => new Date(Date.parse(manilaToday() + "T00:00:00Z") -
    days * 86_400_000).toISOString().slice(0, 10);
  const seededSite = async (e, suffix) => {
    const { worksites } = await tables();
    const [site] = await db.insert(worksites).values({
      organizationId: e.org.id, orgUnitId: e.unit.id, code: (e.marker + suffix).slice(0, 32),
      name: e.marker + " " + suffix + " fictional worksite",
      timezone: "Asia/Manila", active: true,
    }).returning();
    return site;
  };
  return [
    { key: "GET workforce/schedule-receipt-review", profile: "allowlisted-reads",
      flags: ["WFM_SCHEDULE_RECEIPTS_ENABLED"],
      seed: async e => {
        const { users, userOrganizations } = await tables();
        const [account] = await db.insert(users).values({
          email: (e.marker + "-schedule@example.invalid").toLowerCase(),
          name: e.marker + " fictional self-service account",
          role: "employee", employeeId: e.worker.id, active: true,
          passwordHash: "fictional-non-login-test-value",
        }).returning();
        await db.insert(userOrganizations).values({
          userId: account.id, organizationId: e.org.id, role: "employee", active: true,
          workerEmployeeId: e.worker.id,
        });
        return { id: account.id, employeeId: e.worker.id };
      },
      query: c => "employeeId=" + c.workerId,
      prove: (response, c) => {
        assert.equal(response.json?.employee?.employeeNo, c.marker);
        assert.equal(response.json?.employee?.name, "Table " + c.marker);
        assert.equal(response.json?.account, "ready");
        assert.ok(Array.isArray(response.json?.days) && response.json.days.length === 7,
          "real employee schedule receipt summary required");
        const counts = response.json?.summary;
        assert.ok(counts && ["acknowledged", "pending", "changed", "unavailable"]
          .every(k => Number.isSafeInteger(counts[k]) && counts[k] >= 0));
        assert.equal(counts.acknowledged + counts.pending + counts.changed + counts.unavailable, 7);
      } },
    { key: "GET workforce/demand-outlook", profile: "allowlisted-reads",
      flags: ["WFM_HISTORICAL_OUTLOOK_ENABLED"],
      seed: async e => {
        const { shiftDefinitions, staffingRequirements } = await tables();
        const site = await seededSite(e, "-HIS");
        const [shift] = await db.insert(shiftDefinitions).values({
          organizationId: e.org.id, code: (e.marker + "-HIS").slice(0, 32),
          name: e.marker + " historical shift", startTime: "09:00", endTime: "17:00",
        }).returning();
        for (const daysAgo of [7, 14, 21, 28]) {
          await db.insert(staffingRequirements).values({
            organizationId: e.org.id, worksiteId: site.id, shiftDefinitionId: shift.id,
            workDate: dateBack(daysAgo), requiredHeadcount: 3 + e.rank,
            createdBy: e.marker + " fictional staffing",
          });
        }
        return { id: site.id, name: site.name };
      },
      query: c => "worksiteId=" + c.seeded.id + "&horizonDays=7",
      prove: (response, c) => {
        assert.equal(response.json?.readOnly, true);
        assert.equal(response.json?.scope?.organizationId, c.orgId);
        assert.equal(response.json?.scope?.worksiteId, c.seeded.id);
        assert.equal(response.json?.scope?.worksiteName, c.seeded.name);
        assert.ok(response.json?.outlook && typeof response.json.outlook === "object",
          "owned historical staffing forecast response required");
      } },
    { key: "GET workforce/demand-observations/outlook", profile: "allowlisted-reads",
      flags: ["WFM_OPERATIONAL_DEMAND_ENABLED"],
      seed: async e => {
        const { workforceDemandImportBatches, workforceDemandObservationRevisions } = await tables();
        const site = await seededSite(e, "-OPS");
        const sourceKey = ("ttbl_" + e.marker).toLowerCase();
        const [batch] = await db.insert(workforceDemandImportBatches).values({
          organizationId: e.org.id, worksiteId: site.id,
          sourceKey, metricKind: "transactions", intervalMinutes: 60,
          idempotencyKey: e.marker + "-batch", requestSha256: "a".repeat(64),
          rowCount: 12, createdByUserId: e.owner.id,
        }).returning();
        for (let daysAgo = 1; daysAgo <= 12; daysAgo++) {
          await db.insert(workforceDemandObservationRevisions).values({
            organizationId: e.org.id, worksiteId: site.id, importBatchId: batch.id,
            sourceKey, metricKind: "transactions", intervalMinutes: 60,
            intervalStart: new Date(Date.parse(dateBack(daysAgo) + "T02:00:00Z")),
            revision: 1, observedCount: 8 + e.rank, quality: "complete",
          });
        }
        return { id: site.id, sourceKey, batchId: batch.id };
      },
      query: c => "worksiteId=" + c.seeded.id + "&sourceKey=" + encodeURIComponent(c.seeded.sourceKey)
        + "&metricKind=transactions&intervalMinutes=60&horizonDays=7",
      prove: (response, c) => {
        assert.equal(response.json?.readOnly, true);
        assert.equal(response.json?.scope?.organizationId, c.orgId);
        assert.equal(response.json?.scope?.worksiteId, c.seeded.id);
        assert.equal(response.json?.scope?.sourceKey, c.seeded.sourceKey);
        assert.equal(response.json?.scope?.metricKind, "transactions");
        assert.equal(response.json?.scope?.intervalMinutes, 60);
        assert.ok(response.json?.forecast && typeof response.json.forecast === "object",
          "owned operational demand source must produce a forecast envelope");
      } },
  ];
}
