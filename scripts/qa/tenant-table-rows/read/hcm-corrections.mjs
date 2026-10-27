import { createRows as writeRows } from "../write/hcm-corrections.mjs";
export const fixtureOrder = {};
export function createRows({ assert, addWorker }) {
  const fixtures = writeRows({ assert, addWorker, auditBusinessSnapshot: value => value });
  return [
    { key: "GET hcm/effective-change-corrections", seed: e => fixtures[1].seed(e), query: c => "changeId=" + c.seeded.id,
      foreignQuery: c => "changeId=" + c.victimSeeded.id,
      prove: (response, c) => {
        assert.equal(response.json.organizationId, c.orgId); assert.equal(response.json.changeId, c.seeded.id);
        assert.equal(response.json.employeeId, c.seeded.workerId);
        assert.equal(response.json.note, "Please correct the fictional effective date.");
        assert.equal(response.json.reviewer, c.marker + " independent"); assert.ok(Number.isFinite(Date.parse(response.json.returnedAt)));
      } },
  ];
}
