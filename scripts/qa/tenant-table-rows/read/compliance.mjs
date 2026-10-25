// Fictional fixtures only. Shared runners enforce all HTTP/DB isolation controls.
// Preserve the existing fixture order; new rows may omit an order until integration.
export const fixtureOrder = {
  "GET compliance/remittance-actions": 3,
  "GET compliance/audit-chain": 21,
  "GET compliance/labor-inspection/drills": 22,
  "GET compliance/labor-inspection": 23,
  "GET compliance/policy-review": 24,
  "GET compliance/contribution-issues": 44,
  "GET compliance/data-requests": 48,
  "GET compliance/payroll-month-close": 70
};

export function createRows({ activeWorkers, addWorker, assert, auditCount, auditEvents, dataRequests, db, hex64, laborInspectionDrills, proofs }) {
  return [
  { key: "GET compliance/remittance-actions",
    prove: proofs.all(proofs.echoesOrganization(), proofs.listsOwnMarker("assignees", "name")) },
  { key: "GET compliance/audit-chain",
    // A different number of audit events per employer; the chain report must count exactly the own employer's.
    seed: async (e) => {
      for (let i = 0; i < e.rank + 2; i++) {
        await db.insert(auditEvents).values({ organizationId: e.org.id, actor: e.marker, action: "tenant_table.seed", resource: e.marker });
      }
    },
    prove: async (r, c) => {
      const own = await auditCount(c.orgId);
      assert.notEqual(own, await auditCount(c.victim.org.id), "seeded audit counts must differ between employers");
      assert.equal(r.json?.verified, true, "own audit chain must verify");
      assert.equal(r.json.chainedEvents + r.json.pendingSealEvents, own, "the chain report must count the own employer's events");
    } },
  { key: "GET compliance/labor-inspection/drills",
    seed: (e) => db.insert(laborInspectionDrills).values({ organizationId: e.org.id, status: "needs-work", rangeLabel: e.marker,
      evidencePackSha256: hex64(), evidencePackVersion: "fictional-v1", snapshotSha256: hex64(), generatedBy: e.marker }),
    prove: proofs.listsOwnMarker("drills", "rangeLabel") },
  { key: "GET compliance/labor-inspection",
    // A worker without a pay profile yields a high finding naming that worker.
    seed: (e) => addWorker(e, "NOPAY", { payProfile: false }),
    prove: proofs.listsOwnMarker("findings", "employeeNo") },
  { key: "GET compliance/policy-review",
    // A different active headcount per employer; the rest-day control must report the own headcount.
    seed: async (e) => { for (let i = 0; i < e.rank; i++) await addWorker(e, "PR" + i); },
    prove: async (r, c) => {
      const own = await activeWorkers(c.orgId);
      assert.notEqual(own, await activeWorkers(c.victim.org.id), "seeded headcounts must differ between employers");
      const rest = r.json?.findings?.find((finding) => finding.key === "WEEKLY_REST_CONTROL");
      assert.ok(String(rest?.detail ?? "").startsWith(own + " active employee(s)"), "rest-day control must count the own employer's workers");
    } },
  { key: "GET compliance/contribution-issues", prove: proofs.valueHasOwnMarker("legalEntity.code") },
  { key: "GET compliance/data-requests",
    seed: (e) => db.insert(dataRequests).values({ organizationId: e.org.id, subjectEmail: e.marker + "@example.invalid",
      requestType: "access", dueAt: new Date(Date.now() + 30 * 86_400_000) }),
    prove: proofs.listsOwnMarker("requests", "subjectEmail") },
  { key: "GET compliance/payroll-month-close", query: () => "applicableMonth=2026-03", prove: proofs.valueHasOwnMarker("legalEntity.code") },
  ];
}
