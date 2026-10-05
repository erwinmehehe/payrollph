import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("src/app/api/compliance/statutory-remittances/route.ts", "utf8");

test("remittance creation independently audits statutory contributions before snapshot", () => {
  assert.ok(route.includes("auditStatutoryContributionMonth"));
  assert.ok(route.includes("Statutory remittance blocked by contribution assurance"));
  assert.ok(route.includes("must be corrected first"));
  assert.ok(route.indexOf("auditStatutoryContributionMonth") < route.indexOf("buildStatutoryRemittanceSnapshot({"));
});

test("assurance failure is audit logged with affected employees and never creates a batch", () => {
  assert.ok(route.includes("checkedEmployees: assurance.checkedEmployees"));
  assert.ok(route.includes("issueCount: assurance.issues.length"));
  assert.ok(route.includes("issues: assurance.issues.slice(0, 25)"));
  assert.ok(route.includes("return Response.json({"));
  assert.ok(route.includes("assurance,"));
});
