import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseSelfPayExplanationEntryId } from "../src/lib/self-pay-explanation-entry-id";

const route = readFileSync(new URL("../src/app/api/self/payslips/[id]/explain/route.ts", import.meta.url), "utf8");

test("Explain My Pay accepts only positive canonical safe employee-entry IDs", () => {
  for (const id of [1, 12, Number.MAX_SAFE_INTEGER]) {
    assert.equal(parseSelfPayExplanationEntryId(String(id)), id);
  }
  for (const value of ["", "0", "-2", "+1", "001", "1.0", "1e3", " 1", "1 ",
    "Infinity", "NaN", "9007199254740992", "1/2", "1?entry=2", "1 OR 1=1"]) {
    assert.equal(parseSelfPayExplanationEntryId(value), null, value);
  }
  assert.match(route, /const entryId = parseSelfPayExplanationEntryId\(\(await params\)\.id\)/);
  assert.match(route, /if \(entryId === null\) return missingEntry\(\)/);
});

test("current payroll entry is tied to the authenticated employee and released company run", () => {
  const current = route.slice(route.indexOf("const [row] = await db"), route.indexOf("if (!row) return missingEntry();"));
  assert.match(current, /eq\(payrollEntries\.id, entryId\)/);
  assert.match(current, /eq\(payrollEntries\.employeeId, session\.employeeId\)/);
  assert.match(current, /eq\(payrollRuns\.organizationId, employee\.organizationId\)/);
  assert.match(current, /eq\(payrollRuns\.status, "Released"\)/);
  assert.match(current, /multiEntityEnabled \? eq\(payrollRuns\.legalEntityId, employee\.legalEntityId!\) : undefined/);
});

test("active membership and employer attribution are checked before any payroll entry reads", () => {
  const auth=route.indexOf("const session = await getSessionUser();");
  const employee=route.indexOf("const [employee] = await db.select(");
  const membership=route.indexOf("const membershipDenied = await assertMembership(");
  const entity=route.indexOf("const multiEntityEnabled = criticalReleaseFlagEnabled(");
  const current=route.indexOf("const [row] = await db");
  assert.ok(auth>=0 && auth<employee && employee<membership && membership<entity && entity<current);
  assert.match(route, /if \(multiEntityEnabled && \(!Number\.isSafeInteger\(employee\.legalEntityId\)/);
  assert.match(route, /status: 409, headers: PRIVATE_HEADERS/);
});

test("previous payroll evidence requires an actual entry owned by the same employee", () => {
  const priorStart = route.indexOf("const [previous] = await db");
  const priorEnd = route.indexOf("return Response.json({", priorStart);
  assert.ok(priorStart >= 0 && priorEnd > priorStart);
  const previous = route.slice(priorStart, priorEnd);
  assert.match(previous, /\.from\(payrollEntries\)/);
  assert.match(previous, /\.innerJoin\(payrollRuns, eq\(payrollEntries\.payrollRunId, payrollRuns\.id\)\)/);
  assert.match(previous, /eq\(payrollEntries\.employeeId, session\.employeeId\)/);
  assert.match(previous, /eq\(payrollRuns\.organizationId, employee\.organizationId\)/);
  assert.match(previous, /eq\(payrollRuns\.status, "Released"\)/);
  assert.match(previous, /lt\(payrollRuns\.payDate, run\.payDate\)/);
  assert.match(previous, /multiEntityEnabled \? eq\(payrollRuns\.legalEntityId, employee\.legalEntityId!\) : undefined/);
  assert.match(previous, /orderBy\(desc\(payrollRuns\.payDate\), desc\(payrollRuns\.id\), desc\(payrollEntries\.id\)\)/);
  assert.doesNotMatch(route, /const \[previousRun\] = await db\.select\(\)\.from\(payrollRuns\)/);
  assert.doesNotMatch(route, /const \[previousEntry\] =/);
});

test("previous-run metadata and pay calculation both come from one joined row", () => {
  assert.match(route, /previousRun: previous\s*\?/);
  assert.match(route, /id: previous\.previousRun\.id/);
  assert.match(route, /buildPayExplanation\(entry, previous\?\.previousEntry \?\? null\)/);
});

test("missing and foreign entry IDs receive indistinguishable private no-store 404", () => {
  assert.match(route, /const missingEntry = \(\) => Response\.json\(\{ error: "Pay explanation not found\." \},/);
  assert.match(route, /\{ status: 404, headers: PRIVATE_HEADERS \}/);
  assert.equal(route.split("return missingEntry();").length - 1, 3);
  assert.match(route, /"Cache-Control": "private, no-store"/);
  assert.match(route, /\}, \{ headers: PRIVATE_HEADERS \}\);/);
});
