import React, { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { WorkforceIssuedDemandPanel } from "../../src/components/workspace/workforce-issued-demand-panel";

const root = createRoot(document.getElementById("root"));
const sites = [
  { id: 5, code: "A", name: "Synthetic shop", active: true },
  { id: 6, code: "B", name: "Synthetic depot", active: true },
];
window.requests = [];
window.readyToScore = false;
window.hasFinalScore = false;
window.renderTenant = organizationId => {
  root.render(<StrictMode><WorkforceIssuedDemandPanel
    key={organizationId} organizationId={organizationId}
    worksites={sites} canManage={true} /></StrictMode>);
};
const snapshot = {
  version: 1, source: "source_reported_aggregate_workload",
  scope: { organizationId: 100, worksiteId: 5, sourceKey: "pos-main",
    metricKind: "transactions", intervalMinutes: 30, horizonDays: 7 },
  issuedAt: "2026-10-01T01:00:00.000Z",
  sourceCutoffAt: "2026-10-01T01:00:00.000Z",
  horizonStartPh: "2026-10-02",
  trainingEvidenceSha256: "a".repeat(64),
  retrospectiveComparisons: 3,
  points: [{ intervalStart: "2026-10-02T01:00:00.000Z",
    predictedCount: 4, lowerScenarioCount: 3, upperScenarioCount: 5,
    historicalEvidenceCount: 12 }],
  boundary: "Source-reported only, no payroll or roster updates.",
};
window.fetch = async (uri, options = {}) => {
  const url = new URL(String(uri), "http://local.invalid");
  const method = options.method || "GET";
  const org = Number(url.searchParams.get("organizationId"));
  const site = Number(url.searchParams.get("worksiteId"));
  window.requests.push({ path: url.pathname, method, org, site });
  if (method === "POST" && url.pathname.endsWith("/issued")) {
    const body = JSON.parse(options.body);
    window.requests.push({ body, action: "issue" });
    if (body.acknowledged !== true || body.organizationId !== 100 || body.worksiteId !== 5)
      throw Error("Issue mutation escaped its consent or scope.");
    return Response.json({ issueId: 88, pointsCount: 1, replayed: false }, { status: 201 });
  }
  if (method === "POST" && url.pathname.endsWith("/issued/score")) {
    const body = JSON.parse(options.body);
    window.requests.push({ body, action: "score" });
    if (body.acknowledged !== true || body.organizationId !== 100 || body.issueId !== 88)
      throw Error("Score mutation escaped its consent or scope.");
    if (!window.readyToScore) return Response.json({
      error: "Final scoring requires complete settled observations.", missingIntervals: 1,
    }, { status: 409 });
    window.hasFinalScore = true;
    return Response.json({ issueId: 88, scoreId: 91, replayed: false,
      report: { wapePercent: 25, comparisonCount: 1 } }, { status: 201 });
  }
  if (method !== "GET" || !url.pathname.endsWith("/issued")) {
    throw Error("Unexpected route: " + method + " " + url.pathname);
  }
  if (org !== 100) return Response.json({ error: "Workforce manager access is required." }, { status: 403 });
  return Response.json({
    readOnly: true, scope: { organizationId: org, worksiteId: site },
    issued: site === 5 ? [{
      id: 88, worksiteId: site, sourceKey: "pos-main", metricKind: "transactions",
      horizonDays: 7, pointsCount: 1, issuedAt: snapshot.issuedAt,
      snapshotSha256: "b".repeat(64), integrity: "matches_issued_hash", snapshot,
      score: window.hasFinalScore ? {
        id: 91, status: "frozen", scoredAt: "2026-10-10T00:00:00.000Z",
        reportSha256: "c".repeat(64),
        report: { wapePercent: 25, comparisonCount: 1 },
      } : null,
    }] : [],
  });
};
window.renderTenant(100);
