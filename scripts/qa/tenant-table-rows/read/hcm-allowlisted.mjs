// Batch 2: real allowlisted HCM reads, not generic empty/default-success probes.
// Shared PG16 read runner supplies two signed-in attackers and higher-ID victim.
export const fixtureOrder = {};

export function createRows({ assert, db }) {
  let schema;
  const tables = async () => (schema ??= await import("../../../../src/db/schema"));
  const month = () => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila",
      year: "numeric", month: "2-digit" }).formatToParts(new Date());
    return parts.find(p => p.type === "year").value + "-" + parts.find(p => p.type === "month").value;
  };
  const ownTenant = (r, c, field = "organizationId") =>
    assert.equal(r.json?.[field], c.orgId, field + " must identify authenticated employer");
  return [
    { key: "GET hcm/team-leave-calendar", profile: "allowlisted-reads",
      flags: ["HCM_TEAM_LEAVE_CALENDAR_ENABLED"],
      seed: async e => {
        const { leaveRequests } = await tables();
        const [row] = await db.insert(leaveRequests).values({
          organizationId: e.org.id, employeeId: e.worker.id, leaveType: "Vacation",
          startDate: month() + "-15", endDate: month() + "-15",
          days: "1.0", reason: e.marker + " fictional leave span", status: "Pending",
        }).returning();
        return { id: row.id, month: month() };
      },
      query: c => "month=" + encodeURIComponent(c.seeded.month),
      prove: (response, c) => {
        ownTenant(response, c);
        assert.equal(response.json?.month, c.seeded.month);
        assert.equal(response.json?.scope?.kind, "company");
        const found = response.json?.cases?.find(r => r.requestId === c.seeded.id);
        assert.ok(found, "actual own request span required");
        assert.equal(found.employeeId, c.workerId);
        assert.equal(found.employeeNo, c.worker.employeeNo ?? c.marker);
        assert.equal(found.status, "Pending");
        assert.ok(response.json.summary.pendingRequestRecords >= 1);
      } },
    { key: "GET hcm/process-monitor", profile: "allowlisted-reads",
      flags: ["HCM_PROCESS_MONITOR_ENABLED"],
      seed: async e => {
        const { hcmBusinessProcessInstances } = await tables();
        const [row] = await db.insert(hcmBusinessProcessInstances).values({
          organizationId: e.org.id, definitionCode: e.marker.slice(0, 64), definitionVersion: 1,
          processType: "change_job", sourceType: "tenant_table", sourceKey: e.marker,
          employeeId: e.worker.id, status: "in_progress", currentStepIndex: 0,
          definitionSnapshot: {}, initiatedByUserId: e.owner.id, initiatedByName: e.owner.name,
        }).returning();
        return { id: row.id };
      },
      prove: (response, c) => {
        ownTenant(response, c, "tenantId");
        assert.equal(response.json?.filter, "all");
        const process = response.json?.items?.find(p => p.id === c.seeded.id);
        assert.ok(process, "actual own HCM business process required");
        assert.equal(process.tenantId, c.orgId);
        assert.equal(process.type, "change_job");
        assert.equal(process.status, "in_progress");
      } },
    { key: "GET hcm/position-history", profile: "allowlisted-reads",
      flags: ["HCM_ORG_EXPLORER_ENABLED"],
      seed: async e => {
        const { jobProfiles, positions, positionAssignments } = await tables();
        const [profile] = await db.insert(jobProfiles).values({
          organizationId: e.org.id, title: e.marker + " fictional role",
        }).returning();
        const [position] = await db.insert(positions).values({
          organizationId: e.org.id, code: (e.marker + "-POS").slice(0, 48),
          jobProfileId: profile.id, orgUnitId: e.unit.id, status: "planned",
        }).returning();
        const [assignment] = await db.insert(positionAssignments).values({
          organizationId: e.org.id, positionId: position.id, employeeId: e.worker.id,
          effectiveFrom: "2026-01-05", assignmentType: "primary", createdByUserId: e.owner.id,
        }).returning();
        return { id: position.id, assignmentId: assignment.id, code: position.code };
      },
      query: c => "positionId=" + c.seeded.id,
      prove: (response, c) => {
        ownTenant(response, c, "tenantId");
        assert.equal(response.json?.positionId, c.seeded.id);
        assert.equal(response.json?.position?.id, c.seeded.id);
        assert.equal(response.json?.position?.code, c.seeded.code);
        const history = response.json?.history?.preview?.items;
        assert.ok(Array.isArray(history));
        const actual = history.find(item => item.id === c.seeded.assignmentId);
        assert.ok(actual, "real own historical position assignment required");
        assert.equal(actual.employeeId, c.workerId);
      } },
    { key: "GET hcm/org-explorer", profile: "allowlisted-reads",
      flags: ["HCM_ORG_EXPLORER_ENABLED"],
      seed: async e => {
        const { orgUnits } = await tables();
        const [unit] = await db.insert(orgUnits).values({
          organizationId: e.org.id, legalEntityId: e.entity.id, parentId: e.unit.id,
          code: (e.marker + "-ALW").slice(0, 30), name: e.marker + " mapped unit",
          type: "department", active: true,
        }).returning();
        return { id: unit.id, name: unit.name };
      },
      prove: (response, c) => {
        ownTenant(response, c, "tenantId");
        const unit = response.json?.units?.find(item => item.id === c.seeded.id);
        assert.ok(unit, "own organizational child unit required");
        assert.equal(unit.name, c.seeded.name);
        assert.equal(unit.parentId, c.unitId);
        assert.equal(unit.relationship, "linked");
        assert.ok(Array.isArray(response.json?.positions));
      } },
    { key: "GET hcm/manager-decision-inbox", profile: "allowlisted-reads",
      flags: ["HCM_MANAGER_DECISION_INBOX_ENABLED"],
      seed: async e => {
        const { approvalTasks, leaveRequests } = await tables();
        const [task] = await db.insert(approvalTasks).values({
          organizationId: e.org.id, title: e.marker + " decision task",
          detail: "Fictional leave decision, no actual approval", approver: "role:owner",
          dueLabel: "Fixture due", status: "Pending",
        }).returning();
        const [leave] = await db.insert(leaveRequests).values({
          organizationId: e.org.id, employeeId: e.worker.id, leaveType: "Vacation",
          startDate: "2026-11-06", endDate: "2026-11-06",
          days: "1.0", reason: e.marker + " fictional decision", status: "Pending",
          approvalTaskId: task.id,
        }).returning();
        return { id: leave.id, taskId: task.id };
      },
      query: () => "source=leave",
      prove: (response, c) => {
        ownTenant(response, c);
        assert.equal(response.json?.source, "leave");
        assert.equal(response.json?.scope?.kind, "company");
        const item = response.json?.items?.find(x => x.sourceRecordId === c.seeded.id);
        assert.ok(item, "real own pending leave decision required");
        assert.equal(item.approvalTaskId, c.seeded.taskId);
        assert.equal(item.employee?.id, c.workerId);
        assert.equal(item.employee?.employeeNo, c.marker);
        assert.equal(item.status, "pending");
        assert.ok(response.json.totals.assignedItemsThisPage >= 1);
      } },
  ];
}
