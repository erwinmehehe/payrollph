import assert from "node:assert/strict";
import { test } from "node:test";
import { createRows } from "../scripts/qa/tenant-table-rows/read/offline-claims.mjs";

test("offline review proof rejects foreign, missing and mismatched claims", () => {
  const [row] = createRows({ assert, db: {} });
  const ctx = { orgId: 11, workerId: 12, owner: { id: 13 }, marker: "fictional-one", seeded: { id: 14 } };
  const claim = { id: 14, organizationId: 11, employeeId: 12, submittedByUserId: 13,
    status: "pending_review", employeeName: "Table fictional-one" };
  const response = { json: { organizationId: 11, claims: [claim] } };
  row.prove(response, ctx);
  assert.throws(() => row.prove({ json: { ...response.json, organizationId: 20 } }, ctx));
  assert.throws(() => row.prove({ json: { ...response.json, claims: [] } }, ctx));
  assert.throws(() => row.prove({ json: { ...response.json, claims: [{ ...claim, employeeId: 20 }] } }, ctx));
  assert.throws(() => row.prove(response, { ...ctx, marker: "fictional-two", orgId: 21 }));
});
