import React, { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { WorkforceDemandStaffingPanel } from "../../src/components/workspace/workforce-demand-staffing-panel";

const root = createRoot(document.getElementById("root"));
const workDate = "2099-01-02";
const sites = [
  { id: 5, code: "A", name: "Synthetic shop", active: true },
  { id: 6, code: "B", name: "Synthetic depot", active: true },
];
const shifts = [{
  id: 11, code: "DAY", name: "Morning", startTime: "09:00",
  endTime: "10:00", spansMidnight: false, breakMinutes: 0,
}];
const coverage = [{
  requirementId: 21, worksiteId: 5, workDate,
  shiftDefinitionId: 11, jobProfileId: 3, availableScheduledHeadcount: 2,
}];
const snapshot = {
  version: 1, source: "source_reported_aggregate_workload",
  scope: { organizationId: 100, worksiteId: 5, sourceKey: "pos-main",
    metricKind: "transactions", intervalMinutes: 30, horizonDays: 7 },
  issuedAt: "2099-01-01T00:00:00.000Z",
  sourceCutoffAt: "2099-01-01T00:00:00.000Z",
  horizonStartPh: workDate, retrospectiveComparisons: 30,
  trainingEvidenceSha256: "a".repeat(64),
  points: [
    { intervalStart: "2099-01-02T01:00:00.000Z", predictedCount: 10,
      lowerScenarioCount: 8, upperScenarioCount: 12, historicalEvidenceCount: 10 },
    { intervalStart: "2099-01-02T01:30:00.000Z", predictedCount: 20,
      lowerScenarioCount: 15, upperScenarioCount: 24, historicalEvidenceCount: 10 },
  ],
  boundary: "Synthetic, provider-reported only.",
};
window.requests = [];
window.missingSlot = false;
window.corrupt = false;
window.renderTenant = (organizationId) => {
  root.render(<StrictMode><WorkforceDemandStaffingPanel
    key={organizationId}
    organizationId={organizationId}
    worksites={sites}
    shifts={shifts}
    jobProfiles={[{id:3,title:"Cashier"}]}
    coverage={coverage}
    laborCostVisible={true}
    laborRows={[{requirementId:21,benchmarkHourlyRate:150}]}
    recoveryOptions={[{requirementId:21,gap:1,recommendations:[{
      employeeId:12,employeeName:"Synthetic Worker",workloadRisk:"low",
      scheduledMinutesInWindow:480,consecutiveWorkingDaysBeforeShift:2,
      reasons:["Verified fixture role"],
    }]}]}
    guardrailBlockers={0} rosterStatus="ready"
    windowStart={workDate} windowEnd={workDate} dynamicGroupCode=""
  /></StrictMode>);
};
window.fetch = async (uri, options = {}) => {
  const url = new URL(String(uri), "http://local.invalid");
  const method = options.method ?? "GET";
  const org = Number(url.searchParams.get("organizationId"));
  const site = Number(url.searchParams.get("worksiteId"));
  window.requests.push({method, path:url.pathname, org, site});
  if (method !== "GET" || url.pathname !== "/api/workforce/demand-observations/issued") {
    throw Error("Planner attempted unauthorized mutation/endpoint: " + method + " " + url.pathname);
  }
  if (org !== 100) {
    return Response.json({error:"Workforce manager access is required."},{status:403});
  }
  return Response.json({
    readOnly:true,scope:{organizationId:org,worksiteId:site},
    issued:site===5?[{
      id:77,worksiteId:site,issuedAt:snapshot.issuedAt,
      snapshotSha256:"b".repeat(64),
      integrity:window.corrupt?"source_review":"matches_issued_hash",
      snapshot:window.corrupt?null:{
        ...snapshot, points: window.missingSlot?snapshot.points.slice(0,1):snapshot.points,
      },
    }]:[],
  });
};
window.renderTenant(100);
