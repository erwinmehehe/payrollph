import assert from "node:assert/strict";
import test from "node:test";
import { parseAuthorizedLegalEmployers } from "../src/lib/government-loan-employer-scope";

const entity = { id: 18, code: "PRIMARY", displayName: "Fictional employer", active: true, primaryEntity: true };
const directory = { organizationId: 7, legalEntities: [entity] };

test("authorized directory preserves only validated active legal employers", () => {
  assert.deepEqual(parseAuthorizedLegalEmployers(directory, 7), [entity]);
  assert.deepEqual(parseAuthorizedLegalEmployers({ ...directory, legalEntities: [entity, { ...entity, id: 19, primaryEntity: false }] }, 7)?.map(x => x.id), [18, 19]);
  assert.deepEqual(parseAuthorizedLegalEmployers({ ...directory, legalEntities: [] }, 7), []);
});

test("foreign, duplicate, inactive and partial directories cannot establish scope", () => {
  for (const input of [null, [], {}, { ...directory, organizationId: 99 },
    { ...directory, legalEntities: [entity, entity] },
    { ...directory, legalEntities: Array(1001).fill(entity) },
    ...[0, -1, 1.5, "18", NaN].map(id => ({ ...directory, legalEntities: [{ ...entity, id }] })),
    ...[{ active: false }, { active: undefined }, { displayName: " " }, { code: 1 }, { primaryEntity: "true" }]
      .map(change => ({ ...directory, legalEntities: [{ ...entity, ...change }] })),
  ]) assert.equal(parseAuthorizedLegalEmployers(input, 7), null);
});
