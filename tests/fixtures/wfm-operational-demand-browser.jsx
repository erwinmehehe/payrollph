import React, { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { WorkforceOperationalDemandPanel } from "../../src/components/workspace/workforce-operational-demand-panel";

const root = createRoot(document.getElementById("root"));
const worksites = [
  { id: 5, code: "A", name: "Synthetic retail", active: true },
  { id: 6, code: "B", name: "Synthetic warehouse", active: true },
];
window.requests = [];
window.renderTenant = organizationId => {
  root.render(<StrictMode><WorkforceOperationalDemandPanel
    key={organizationId} organizationId={organizationId}
    worksites={worksites} canManage={true}
  /></StrictMode>);
};
const forecast = site => ({
  readOnly: true,
  scope: {
    organizationId: 100, worksiteId: site, sourceKey: "pos-main",
    metricKind: "transactions", intervalMinutes: 30,
  },
  forecast: {
    status: site === 5 ? "ready" : "insufficient_history",
    source: "reported_aggregate_operational_counts", metricKind: "transactions",
    intervalMinutes: 30, horizonDays: 7,
    historicalVersions: site === 5 ? 17 : 0,
    latestIntervals: site === 5 ? 17 : 0, qualityExcluded: 0,
    predictedIntervals: site === 5 ? 1 : 0, unknownIntervals: 0,
    backtest: {
      comparisons: site === 5 ? 3 : 0, mae: site === 5 ? 2 : null,
      wapePercent: site === 5 ? 25 : null,
    },
    boundary: "Source reported aggregate counts; not a frozen live-production accuracy score.",
    points: site === 5 ? [{
      workDate: "2026-10-12", startTime: "09:00", predictedCount: 17,
      lowerScenarioCount: 15, upperScenarioCount: 19,
      heldOutMae: 2, heldOutWapePercent: 25, evidenceCount: 12,
      lastSourceDate: "2026-10-05",
    }] : [],
  },
});

window.fetch = async (uri, options = {}) => {
  const url = new URL(String(uri), "http://localhost");
  const method = options.method ?? "GET";
  const orgId = Number(url.searchParams.get("organizationId"));
  const siteId = Number(url.searchParams.get("worksiteId"));
  const request = { method, path: url.pathname, orgId, siteId };
  window.requests.push(request);
  if (method === "POST" && url.pathname === "/api/workforce/demand-observations/import") {
    const batch = JSON.parse(options.body);
    window.requests.push({ batch });
    if (!batch.acknowledged || batch.rows.some(row => Object.keys(row).length !== 4)) {
      throw new Error("Unexpected personal data in aggregate import");
    }
    return Response.json({ rowCount: batch.rows.length, replayed: false }, { status: 201 });
  }
  if (method !== "GET" || url.pathname !== "/api/workforce/demand-observations/outlook") {
    throw new Error("Unexpected endpoint requested: " + method + " " + url.pathname);
  }
  if (orgId !== 100) return Response.json({ error: "Workforce manager access is required." }, { status: 403 });
  const answer = forecast(siteId);
  answer.forecast.horizonDays = Number(url.searchParams.get("horizonDays"));
  return Response.json(answer);
};
window.renderTenant(100);
