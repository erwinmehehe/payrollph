import assert from "node:assert/strict";
import test from "node:test";
import { parseDashboardSnapshotRead } from "../src/lib/dashboard-snapshot-read";
import { emptyDashboard, recordedRun, employer } from "./fixtures/fail-closed-dashboard";

test("role-overview-v2: upstream validation distinguishes verified empty/recorded zero from unavailable", () => {
  assert.equal(parseDashboardSnapshotRead(true, emptyDashboard, employer), emptyDashboard);
  const valid = {...emptyDashboard, payrollRuns: [recordedRun]};
  assert.equal(parseDashboardSnapshotRead(true, valid, employer), valid);
  for (const value of [null, {}, [], {...emptyDashboard, employees: undefined},
    {...valid, selectedOrganization: {...emptyDashboard.selectedOrganization, id: employer+1}},
    {...valid, payrollRuns: [{...recordedRun, organizationId: employer+1}]},
    ...[undefined, null, "", "NaN", NaN, Infinity, {}].map(bad =>
      ({...valid, payrollRuns: [{...recordedRun, netPay: bad}]})),
  ]) assert.equal(parseDashboardSnapshotRead(true, value, employer), null);
  assert.equal(parseDashboardSnapshotRead(false, valid, employer), null);
  assert.equal(parseDashboardSnapshotRead(true, valid, 0), null);
});
