// Fictional fixtures only. Shared runners enforce all HTTP/DB isolation controls.
// Preserve the existing fixture order; new rows may omit an order until integration.
export const fixtureOrder = {
  "GET invitations": 5,
  "GET provisioning": 14,
  "GET spend": 15,
  "GET workforce-planning": 16,
  "GET biometrics/sync": 20,
  "GET developer": 25,
  "GET employee-identifier-requests": 26,
  "GET integration-connectors": 30,
  "GET migrations": 32,
  "GET outbox": 33,
  "GET workforce-planning/allocations": 37,
  "GET workforce-planning/position-executions": 38,
  "GET workforce-planning/scenarios": 39,
  "GET automation-studio": 43,
  "GET treasury-controls": 47,
  "GET discipline": 50,
  "GET dynamic-worker-groups": 51,
  "GET web-bundy": 60,
  "GET workforce-planning/baselines": 63,
  "GET payout-destination-changes": 66,
  "GET bir/annual-employer": 71,
  "GET workforce-planning/forecast": 73,
  "GET governed-handoffs": 77
};

export function createRows({ activeWorkers, addWorker, apiKeys, approvalChainPolicies, assert, biometricDevices, db, disciplinaryCases, dynamicWorkerGroups, employeePayoutChangeRequests, essIdentifierRequests, hex64, importBatches, integrationConnectors, outbox, proofs, seedPlan, timePunches, workforcePlanAllocations, workforcePlanBaselines, workforcePlanPositionExecutions, workforcePlanningScenarios }) {
  return [
  { key: "GET invitations", prove: proofs.listsOwnMarker("members", "name") },
  { key: "GET provisioning", prove: proofs.listsOwnMarker("employees", "name") },
  { key: "GET spend", prove: proofs.listsOwnMarker("employees", "lastName") },
  { key: "GET workforce-planning",
    prove: proofs.all(proofs.listsOwnMarker("orgUnits", "name"), proofs.listsOwnMarker("legalEntities", "code")) },
  { key: "GET biometrics/sync",
    seed: (e) => db.insert(biometricDevices).values({ organizationId: e.org.id, deviceModel: "Fictional K40", serialNumber: e.marker, branchName: e.marker }),
    prove: proofs.listsOwnMarker("devices", "branchName") },
  { key: "GET developer",
    seed: (e) => db.insert(apiKeys).values({ organizationId: e.org.id, name: e.marker, prefix: "ttbl", keyHash: hex64() }),
    prove: proofs.listsOwnMarker("apiKeys", "name") },
  { key: "GET employee-identifier-requests",
    seed: (e) => db.insert(essIdentifierRequests).values({ organizationId: e.org.id, employeeId: e.worker.id, kind: "tin",
      proposedEncrypted: "fictional-unencrypted", requestedByUserId: e.owner.id }),
    prove: proofs.listsOwnMarker("requests", "employeeNo") },
  { key: "GET integration-connectors",
    seed: (e) => db.insert(integrationConnectors).values({ organizationId: e.org.id, provider: "slack", name: e.marker,
      credentialCiphertext: "fictional-not-a-credential", config: { defaultChannelId: "C0TTBL0001", allowedChannelIds: ["C0TTBL0001"] } }),
    prove: proofs.listsOwnMarker("connectors", "name") },
  { key: "GET migrations",
    seed: (e) => db.insert(importBatches).values({ organizationId: e.org.id, fileName: e.marker + ".csv", createdBy: e.marker }),
    prove: proofs.listsOwnMarker("batches", "fileName") },
  { key: "GET outbox",
    seed: (e) => db.insert(outbox).values({ organizationId: e.org.id, recipient: e.marker.toLowerCase() + "@example.invalid",
      subject: e.marker, body: "Fictional tenant-table message; never delivered.", purpose: "tenant-table" }),
    prove: proofs.listsOwnMarker("messages", "subject") },
  { key: "GET workforce-planning/allocations",
    seed: async (e) => {
      const plan = await seedPlan(e, "allocation plan");
      await db.insert(workforcePlanAllocations).values({ organizationId: e.org.id, planId: plan.id, orgUnitId: e.unit.id });
    },
    prove: proofs.listsOwnMarker("allocations", "orgUnitName") },
  { key: "GET workforce-planning/position-executions",
    seed: async (e) => {
      const plan = await seedPlan(e, "execution plan");
      const [scenario] = await db.insert(workforcePlanningScenarios).values({ organizationId: e.org.id, planId: plan.id, name: e.marker + " exec",
        startDate: "2026-01-01", endDate: "2026-12-31", snapshotHash: hex64(), createdByUserId: e.owner.id }).returning();
      const [baseline] = await db.insert(workforcePlanBaselines).values({ organizationId: e.org.id, planId: plan.id, scenarioId: scenario.id,
        snapshotHash: hex64(), publishedByUserId: e.owner.id, publishedBy: e.marker }).returning();
      await db.insert(workforcePlanPositionExecutions).values({ organizationId: e.org.id, planId: plan.id, baselineId: baseline.id,
        baselineSnapshotHash: baseline.snapshotHash, executionHash: hex64(), createdByUserId: e.owner.id, createdBy: e.marker });
    },
    prove: proofs.listsOwnMarker("executions", "createdBy") },
  { key: "GET workforce-planning/scenarios",
    seed: (e) => db.insert(workforcePlanningScenarios).values({ organizationId: e.org.id, name: e.marker, startDate: "2026-01-01",
      endDate: "2026-12-31", snapshotHash: hex64(), createdByUserId: e.owner.id }),
    prove: proofs.listsOwnMarker("scenarios", "name") },
  { key: "GET automation-studio", prove: proofs.listsOwnMarker("orgUnits", "name") },
  { key: "GET treasury-controls", prove: proofs.listsOwnMarker("candidates", "name") },
  { key: "GET discipline",
    seed: (e) => db.insert(disciplinaryCases).values({ organizationId: e.org.id, employeeId: e.worker.id, caseNumber: e.marker,
      offense: e.marker, incidentDate: "2026-02-02" }),
    prove: proofs.listsOwnMarker("cases", "caseNumber") },
  { key: "GET dynamic-worker-groups",
    seed: (e) => db.insert(dynamicWorkerGroups).values({ organizationId: e.org.id, code: e.marker, name: e.marker }),
    prove: proofs.listsOwnMarker("groups", "name") },
  { key: "GET web-bundy",
    seed: (e) => db.insert(timePunches).values({ organizationId: e.org.id, employeeId: e.worker.id,
      workDate: new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10) }),
    prove: proofs.listsOwnMarker("punches", "employeeName") },
  { key: "GET workforce-planning/baselines",
    seed: async (e) => {
      const plan = await seedPlan(e, "baseline plan");
      const [scenario] = await db.insert(workforcePlanningScenarios).values({ organizationId: e.org.id, planId: plan.id, name: e.marker + " baseline",
        startDate: "2026-01-01", endDate: "2026-12-31", snapshotHash: hex64(), createdByUserId: e.owner.id }).returning();
      await db.insert(workforcePlanBaselines).values({ organizationId: e.org.id, planId: plan.id, scenarioId: scenario.id,
        snapshotHash: hex64(), publishedByUserId: e.owner.id, publishedBy: e.marker });
    },
    prove: proofs.listsOwnMarker("baselines", "publishedBy") },
  { key: "GET payout-destination-changes",
    seed: (e) => db.insert(employeePayoutChangeRequests).values({ organizationId: e.org.id, employeeId: e.worker.id, reason: e.marker,
      originalSnapshot: {}, originalStateSha256: hex64(), requestedByUserId: e.owner.id, requestedByName: e.marker }),
    prove: proofs.listsOwnMarker("requests", "reason") },
  { key: "GET bir/annual-employer", query: (c) => "taxYear=2026&legalEntityId=" + c.entityId,
    prove: proofs.all(proofs.valueHasOwnMarker("employer.code"), proofs.echoesOwn("reconciliation.legalEntityId", "entityId")) },
  { key: "GET workforce-planning/forecast",
    query: () => "startDate=2026-03-01&endDate=2026-03-31&demandGrowthPercent=0&vacancyFillPercent=100&employerLoadPercent=0&annualAttritionPercent=0&attritionBackfillPercent=100",
    // A different active head count per employer: the forecast must start from exactly the own employer's workers.
    seed: async (e) => { for (let i = 0; i < e.rank; i++) await addWorker(e, "FC" + i); },
    prove: async (r, c) => {
      const own = await activeWorkers(c.orgId);
      assert.notEqual(own, await activeWorkers(c.victim.org.id), "seeded head counts must differ between employers");
      assert.equal(r.json?.forecast?.summary?.activeHeadcount, own, "the forecast must start from the own employer's active workers");
    } },
  { key: "GET governed-handoffs", query: () => "sourceType=hcm_separation_readiness",
    seed: (e) => db.insert(approvalChainPolicies).values({ organizationId: e.org.id, code: e.marker.slice(0, 64), name: e.marker, purpose: "automation" }),
    prove: proofs.listsOwnMarker("approvalChains", "name") },
  ];
}
