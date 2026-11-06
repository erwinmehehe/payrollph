import assert from "node:assert/strict";
import test from "node:test";
import { getTableColumns } from "drizzle-orm";
import { employees } from "../src/db/schema";
import { managedClientWorkerFixture } from "../scripts/qa/managed-client-worker-fixture";

test("managed client HTTP fixture supplies every required nondefault employee column", () => {
  const worker = managedClientWorkerFixture(17, "FICTIONAL-17", "Attacker A");
  const values = worker as Record<string, unknown>;
  for (const [name, column] of Object.entries(getTableColumns(employees))) {
    if (column.notNull && !column.hasDefault) {
      assert.notEqual(values[name], undefined, "required employee fixture column: " + name);
      assert.notEqual(values[name], null, "non-null employee fixture column: " + name);
    }
  }
  assert.equal(worker.organizationId, 17);
  assert.ok(worker.startDate < "2026-01-01", "employment starts before the fixture payroll cutoff");
});
