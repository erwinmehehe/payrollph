import React, { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { WorkforceDemandOutlookPanel } from "../../src/components/workspace/workforce-demand-outlook-panel";

const root = createRoot(document.getElementById("root"));
const worksites = [
  { id: 5, code: "SITE-A", name: "Synthetic north", active: true },
  { id: 6, code: "SITE-B", name: "Synthetic south", active: true },
];
const shifts = [{ id: 2, code: "DAY", name: "Day shift" }];
const jobProfiles = [{ id: 3, title: "Fictional operations" }, { id: 4, title: "Fictional support" }];
window.requests = [];
window.org = 100;
window.rerenderForEmployer = organizationId => {
  window.org = organizationId;
  root.render(<StrictMode><WorkforceDemandOutlookPanel
    key={organizationId} organizationId={organizationId}
    worksites={worksites} shifts={shifts} jobProfiles={jobProfiles}
  /></StrictMode>);
};

const readOnlyForecast = (site, horizon) => ({
  scope: { organizationId: 100, worksiteId: site, worksiteName: "Fictional site" },
  readOnly: true,
  sourceQuality: site === 5
    ? "Historical staffing-plan consistency only."
    : "Not enough same-weekday historical staffing requirements.",
  outlook: {
    status: site === 5 ? "ready" : "insufficient_history",
    source: "historical_staffing_requirements",
    model: "trailing-six-same-weekday-weighted-average",
    today: "2026-10-11",
    lookbackStart: "2026-04-12",
    horizonDays: horizon,
    historicalRows: site === 5 ? 50 : 2, distinctCohorts: 2,
    daysForecast: site === 5 ? 1 : 0, missingEvidenceSlots: 0,
    forecasts: site !== 5 ? [] : [3, 4].map(jobProfileId => ({
      workDate: "2026-10-12", worksiteId: 5, shiftDefinitionId: 2, jobProfileId,
      weekday: 1, estimatedHeadcount: jobProfileId === 3 ? 4 : 2,
      lowerScenarioHeadcount: 3, upperScenarioHeadcount: 5,
      trainingObservations: 12, latestHistoricalWorkDate: "2026-10-05",
      backtestObservations: 3, backtestMaeHeadcount: 1,
      backtestWapePercent: 25, evidence: "limited",
    })),
    holdout: site === 5
      ? { comparisons: 6, maeHeadcount: 1, wapePercent: 25 }
      : { comparisons: 0, maeHeadcount: null, wapePercent: null },
    boundary: "Read-only staffing-plan preview; not measured customer demand, payroll or attendance.",
  },
});

window.fetch = async (url, options = {}) => {
  const parsed = new URL(String(url), "http://fixture.local");
  const org = Number(parsed.searchParams.get("organizationId"));
  const site = Number(parsed.searchParams.get("worksiteId"));
  const horizon = Number(parsed.searchParams.get("horizonDays"));
  const method = options.method || "GET";
  window.requests.push({ org, site, horizon, method });
  if (method !== "GET" || parsed.pathname !== "/api/workforce/demand-outlook") {
    throw new Error("Unexpected mutation or API call: " + String(url));
  }
  if (org !== 100) {
    return Response.json({ error: "Workforce manager access is required." }, { status: 403 });
  }
  return Response.json(readOnlyForecast(site, horizon));
};
window.rerenderForEmployer(100);
