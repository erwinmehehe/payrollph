import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("BP definition mutations share a policy lock with direct route checks", () => {
  const source = readFileSync("src/app/api/hcm/business-processes/definitions/route.ts", "utf8");
  assert.equal((source.match(/pg_advisory_xact_lock\(4195/g) ?? []).length, 3);
});

test("published plan cannot skip configured HCM create-position review", () => {
  const source = readFileSync("src/app/api/workforce-planning/position-executions/route.ts", "utf8");
  assert.match(source, /createsApprovedPosition/);
  assert.match(source, /action\.kind === "create"/);
  assert.match(source, /pg_advisory_xact_lock\(4195/);
  assert.match(source, /hcmBusinessProcessDefinitions\.processType, "create_position"/);
  assert.match(source, /POSITION_EXECUTION_GOVERNED_REVIEW_REQUIRED/);
});
