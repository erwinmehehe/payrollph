"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarClock, RefreshCcw, TrendingUp } from "lucide-react";
import type { StaffingOutlook } from "@/lib/workforce-demand-outlook";

type Worksite = { id: number; name: string; code: string; active: boolean };
type Shift = { id: number; name: string; code: string };
type Role = { id: number; title: string };

type ReadResult = {
  scope: { organizationId: number; worksiteId: number; worksiteName: string };
  outlook: StaffingOutlook;
  sourceQuality: string;
  readOnly: true;
};

const integer = (value: number) => new Intl.NumberFormat("en-PH").format(value);

/** Source-only manager preview; no save, approve, publish or wage action. */
export function WorkforceDemandOutlookPanel({
  organizationId, worksites, shifts, jobProfiles,
}: {
  organizationId: number;
  worksites: Worksite[];
  shifts: Shift[];
  jobProfiles: Role[];
}) {
  const [chosenWorksite, setChosenWorksite] = useState<number | null>(null);
  const [horizonDays, setHorizonDays] = useState<7 | 14>(7);
  const [roleFilter, setRoleFilter] = useState("all");
  const [refresh, setRefresh] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; value: ReadResult } | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const activeSite = useMemo(() =>
    worksites.find(site => site.id === chosenWorksite && site.active)
    ?? worksites.find(site => site.active) ?? null, [worksites, chosenWorksite]);
  const siteId = activeSite?.id ?? 0;
  const key = organizationId + ":" + siteId + ":" + horizonDays + ":" + refresh;

  useEffect(() => {
    if (!siteId || !Number.isSafeInteger(organizationId) || organizationId <= 0) return;
    const abort = new AbortController();
    async function load() {
      setPending(key);
      setError(null);
      try {
        const params = new URLSearchParams({
          organizationId: String(organizationId),
          worksiteId: String(siteId),
          horizonDays: String(horizonDays),
        });
        const response = await fetch("/api/workforce/demand-outlook?" + params, {
          cache: "no-store", signal: abort.signal,
        });
        const json = await response.json().catch(() => ({})) as Partial<ReadResult> & { error?: string };
        if (!response.ok) throw new Error(json.error ?? "Could not review staffing history.");
        if (!json.outlook || json.readOnly !== true
          || json.scope?.organizationId !== organizationId
          || json.scope?.worksiteId !== siteId) {
          throw new Error("The staffing outlook scope was not verified.");
        }
        if (!abort.signal.aborted) setLoaded({ key, value: json as ReadResult });
      } catch (cause) {
        if (!abort.signal.aborted) setError({
          key, message: cause instanceof Error ? cause.message : "Staffing outlook is unavailable.",
        });
      } finally {
        if (!abort.signal.aborted) setPending(null);
      }
    }
    void load();
    return () => abort.abort();
  }, [organizationId, siteId, horizonDays, refresh, key]);

  const record = loaded?.key === key ? loaded.value : null;
  const issue = error?.key === key ? error.message : null;
  const loading = pending === key || (siteId > 0 && !record && !issue);

  const shiftNames = useMemo(() => new Map(shifts.map(row => [row.id, row.code + " · " + row.name])), [shifts]);
  const roleNames = useMemo(() => new Map(jobProfiles.map(row => [row.id, row.title])), [jobProfiles]);
  const outlook = record?.outlook;
  const presentRoleKeys = [...new Set((outlook?.forecasts ?? []).map(
    row => row.jobProfileId === null ? "any" : String(row.jobProfileId),
  ))].sort();
  const effectiveRoleFilter = presentRoleKeys.includes(roleFilter) ? roleFilter : "all";
  const rows = (outlook?.forecasts ?? []).filter(row =>
    effectiveRoleFilter === "all" ||
    (row.jobProfileId === null ? "any" : String(row.jobProfileId)) === effectiveRoleFilter);

  return (
    <section data-wfm-demand-outlook style={{ padding: "0 18px 18px" }}>
      <article className="card" style={{ margin: 0 }}>
        <div className="card-header">
          <div>
            <div className="card-kicker">Workforce demand intelligence · read-only</div>
            <h3>Preview staffing needs from past weekly patterns</h3>
            <p>Weekday planning estimates and walk-forward backtests of past staffing requirements, not external traffic or measured business demand.</p>
          </div>
          <button type="button" className="secondary-button"
            disabled={loading || siteId === 0}
            onClick={() => setRefresh(previous => previous + 1)}>
            <RefreshCcw size={14} /> Refresh
          </button>
        </div>

        <div className="setting-form" style={{ padding: "0 18px 14px" }}>
          <label>Worksite
            <select value={siteId || ""} disabled={!worksites.some(site => site.active)}
              onChange={event => setChosenWorksite(Number(event.target.value))}>
              {worksites.filter(site => site.active).map(site => (
                <option key={site.id} value={site.id}>{site.code} · {site.name}</option>
              ))}
            </select>
          </label>
          <label>Planning horizon
            <select value={horizonDays} onChange={event => setHorizonDays(event.target.value === "14" ? 14 : 7)}>
              <option value={7}>Next 7 days</option>
              <option value={14}>Next 14 days</option>
            </select>
          </label>
          <label>Role filter
            <select value={effectiveRoleFilter} onChange={event => setRoleFilter(event.target.value)}>
              <option value="all">All roles and general requirements</option>
              {presentRoleKeys.map(id => (
                <option key={id} value={id}>
                  {id === "any" ? "No job profile specified" : roleNames.get(Number(id)) ?? "Role #" + id}
                </option>
              ))}
            </select>
          </label>
        </div>

        {loading && <p role="status" style={{ padding: "0 18px 14px" }}>Reviewing historical staffing requirements…</p>}
        {!siteId && <div className="notice notice-amber" style={{ margin: "0 18px 16px" }}>No active worksite is available in your current manager scope.</div>}
        {issue && <div className="notice notice-amber" role="alert" style={{ margin: "0 18px 16px" }}>{issue}</div>}
        {outlook && (
          <>
            <div className="notice notice-slate" style={{ margin: "0 18px 16px" }}>
              <TrendingUp size={15} />
              <span><strong>Source boundary.</strong> {outlook.boundary}</span>
            </div>
            <section className="stats-grid" style={{ padding: "0 18px 18px" }}>
              <div className="stat-card">
                <p>HISTORICAL REQUIREMENT ROWS</p>
                <h3>{integer(outlook.historicalRows)}</h3>
                <span>lookback: {outlook.lookbackStart} to the day before {outlook.today}</span>
              </div>
              <div className="stat-card">
                <p>ESTIMATED WORK DATES</p>
                <h3>{outlook.daysForecast} / {outlook.horizonDays}</h3>
                <span>missing days are unknown, not zero</span>
              </div>
              <div className="stat-card">
                <p>WALK-FORWARD TESTS</p>
                <h3>{outlook.holdout.comparisons}</h3>
                <span>held out from model training</span>
              </div>
              <div className="stat-card">
                <p>HISTORICAL PLAN WAPE</p>
                <h3>{outlook.holdout.wapePercent == null ? "Not measurable" : outlook.holdout.wapePercent.toFixed(1) + "%"}</h3>
                <span>error against prior entered staffing plans only</span>
              </div>
            </section>

            {outlook.status !== "ready" && (
              <div className="notice notice-amber" role="status" style={{ margin: "0 18px 16px" }}>
                {record?.sourceQuality}
              </div>
            )}

            {outlook.status === "ready" && (
              <div className="data-table-wrap" style={{ margin: "0 18px 18px" }}>
                <table className="data-table" data-wfm-demand-outlook-rows>
                  <thead>
                    <tr>
                      <th>WORK DATE</th><th>SHIFT</th><th>ROLE</th>
                      <th>ESTIMATED HC</th><th>LOW / HIGH SCENARIO</th><th>SOURCE SUPPORT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 30).map(row => (
                      <tr key={[row.workDate, row.shiftDefinitionId, row.jobProfileId ?? "any"].join(":")}>
                        <td><strong>{row.workDate}</strong></td>
                        <td>{shiftNames.get(row.shiftDefinitionId) ?? "Shift #" + row.shiftDefinitionId}</td>
                        <td>{row.jobProfileId == null ? "Unassigned role" : roleNames.get(row.jobProfileId) ?? "Role #" + row.jobProfileId}</td>
                        <td><strong>{integer(row.estimatedHeadcount)}</strong></td>
                        <td>{row.lowerScenarioHeadcount} / {row.upperScenarioHeadcount}</td>
                        <td>{row.trainingObservations} history rows · {row.backtestObservations} tests · {row.evidence} evidence</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.length > 30 && (
                  <p style={{ padding: "12px" }}>
                    Showing the first 30 of {rows.length} estimates. Use the role filter to review individual shift/role combinations. No rows are automatically published.
                  </p>
                )}
              </div>
            )}
            <p className="id" style={{ padding: "0 18px 18px" }}>
              <CalendarClock size={13} /> Historical plan error is not customer-demand forecast accuracy; sensitivity ranges are not statistical confidence intervals.
              Never use this preview to create or approve shifts, change pay, or infer employee attendance.
            </p>
          </>
        )}
      </article>
    </section>
  );
}
