import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { verifyTimesheetRenewal } from "../scripts/qa/timesheet-employer-credit.mjs";
import { TIMESHEET_ROUTE } from "../scripts/qa/timesheet-source-accounting.mjs";

const load = () => JSON.parse(readFileSync("scripts/qa/tenant-isolation-coverage-manifest.json"));
test("both timesheet methods require the exact corresponding PG16 receipt", () => {
  assert.equal(verifyTimesheetRenewal(load()), 2);
  for (const name of ["GET", "POST"]) {
    const manifest = load();
    const method = manifest.allApiRouteFiles[TIMESHEET_ROUTE].methods.find(row => row.name === name);
    method.testedBy = null;
    assert.throws(() => verifyTimesheetRenewal(manifest), /two reviewed timesheet citations/);
  }
});
test("a changed proof, scope predicate, profile or receipt cannot renew the pair", () => {
  for (const target of [TIMESHEET_ROUTE, "src/lib/multi-entity-server.ts", "scripts/qa/timesheet-employer-pg16.mjs",
    "scripts/qa/timesheet-employer-local.mjs", "scripts/qa/timesheet-employer-receipt.json"]) {
    const read = path => path === target ? Buffer.from("changed") : readFileSync(path);
    assert.throws(() => verifyTimesheetRenewal(load(), read), /Timesheet (proof input|receipt) changed/);
  }
});
