/** Hold historical organization-only evidence after legal-employer hardening. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const TIMESHEET_ROUTE = "src/app/api/workforce/timesheets/route.ts";
const PREVIOUS_TIMESHEET_SOURCE = "d0032f4d7bd749b9d80e0aebb820276f9c91485e";
const SCOPED_TIMESHEET_SOURCE = "88b225c992073e7f075062da18e6e2894073d719";
export const TIMESHEET_HOLD_KIND = "timesheet-legal-employer-source-withdrawal";

export function verifiedTimesheetHoldKeys(manifest, read = readFileSync) {
  const route = manifest.allApiRouteFiles[TIMESHEET_ROUTE];
  if (!route?.methods.some(row => row.reviewedUncertified?.kind === TIMESHEET_HOLD_KIND)) return new Set();
  assert.equal(route.gitBlobSha, SCOPED_TIMESHEET_SOURCE);
  const source = Buffer.from(String(read(TIMESHEET_ROUTE)).replaceAll("\r\n", "\n"));
  assert.equal(createHash("sha1").update("blob " + source.length + "\0").update(source).digest("hex"),
    SCOPED_TIMESHEET_SOURCE);
  const methods = ["GET", "POST"];
  for (const name of methods) {
    const method = route.methods.find(row => row.name === name);
    assert.equal(method?.status, "GAP");
    assert.equal(method.testedBy, null);
    assert.deepEqual(method.reviewedUncertified, {
      kind: TIMESHEET_HOLD_KIND, priorRouteBlobSha: PREVIOUS_TIMESHEET_SOURCE,
      routeBlobSha: SCOPED_TIMESHEET_SOURCE, coverageCredits: 0, exactHeadPg16Http: "NOT_RUN",
    });
  }
  return new Set(methods.map(name => name + " " + TIMESHEET_ROUTE));
}

export function reviewedTimesheetSourceHold(before, after) {
  const previous = before.allApiRouteFiles[TIMESHEET_ROUTE];
  if (previous?.gitBlobSha !== PREVIOUS_TIMESHEET_SOURCE) return new Set();
  const keys = verifiedTimesheetHoldKeys(after);
  if (!keys.size) return keys;
  for (const name of ["GET", "POST"])
    assert.equal(previous.methods.find(row => row.name === name)?.status, "COVERED");
  return keys;
}
