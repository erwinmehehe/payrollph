import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { verifyStaffingPolicyGetCredit, STAFFING_GET_ROUTE } from
  "../scripts/qa/tenant-staffing-policy-get-credit.mjs";
const load = () => JSON.parse(readFileSync(
  "scripts/qa/tenant-isolation-coverage-manifest.json", "utf8"));
const clone = v => JSON.parse(JSON.stringify(v));
test("source-current dual-mode PG16 proves one provisional staffing GET method only", () => {
  const m = load();
  assert.equal(verifyStaffingPolicyGetCredit(m), 1);
  const liveMethodCount = Object.values(m.allApiRouteFiles)
    .reduce((sum, route) => sum + route.methods.length, 0);
  assert.equal(m.metrics.coveredAfter + m.metrics.publicByDesign + m.metrics.gap,
    liveMethodCount);
  assert.match(m.acceptanceStatus, /^NOT ACCEPTED:/);
  assert.equal(m.scopedPages.filter(p => p.status === "GAP").length, 17);
});
test("no invented review, stale source, empty modes, duplicated or borrowed receipts", () => {
  const m = load();
  const bad = [
    x => { x.allApiRouteFiles[STAFFING_GET_ROUTE].methods[0].status = "GAP"; },
    x => { x.allApiRouteFiles[STAFFING_GET_ROUTE].methods[0].testedBy = null; },
    x => { x.allApiRouteFiles[STAFFING_GET_ROUTE].methods[0].testedBy.workflowRunId = 0; },
    x => { x.allApiRouteFiles[STAFFING_GET_ROUTE].methods[0].testedBy.approvedWorkflowRunId = 0; },
    x => { x.allApiRouteFiles[STAFFING_GET_ROUTE].methods[0].testedBy.independentlyAccepted = true; },
    x => { x.allApiRouteFiles[STAFFING_GET_ROUTE].methods[0].testedBy.productionCertified = true; },
    x => { x.allApiRouteFiles[STAFFING_GET_ROUTE].methods[0].testedBy.routeBlobSha = "wrong"; },
    x => { x.allApiRouteFiles[STAFFING_GET_ROUTE].methods[0].testedBy.methodActions = ["manage"]; },
    x => { x.allApiRouteFiles[STAFFING_GET_ROUTE].gitBlobSha = "wrong"; },
  ];
  for(const f of bad){const x=clone(m);f(x);assert.throws(()=>verifyStaffingPolicyGetCredit(x));}
});
