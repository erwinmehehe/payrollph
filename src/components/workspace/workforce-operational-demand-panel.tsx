"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCcw, TrendingUp, Upload } from "lucide-react";
import type { DemandMetric } from "@/lib/workforce-operational-demand-import";
import type { WorkloadDemandForecast } from "@/lib/workforce-operational-demand-forecast";

const METRICS: DemandMetric[] = ["transactions", "visits", "orders", "appointments", "calls"];
const CSV_HEADER = "intervalStart,observedCount,quality,revision";
type Site = { id: number; code: string; name: string; active: boolean };
type Payload = {
  readOnly: true;
  scope: { organizationId: number; worksiteId: number; sourceKey: string; metricKind: string; intervalMinutes: number };
  forecast: WorkloadDemandForecast;
};

function parseAggregateCsv(value: string) {
  const lines = value.trim().split(/\r?\n/).map(line => line.trim());
  if (lines[0] !== CSV_HEADER || lines.length < 2 || lines.length > 101) {
    throw new Error("Paste 1–100 CSV rows with exactly: " + CSV_HEADER);
  }
  return lines.slice(1).map((line, index) => {
    const cells = line.split(",");
    if (cells.length !== 4) {
      throw new Error("Row " + (index + 2) + " must contain only four aggregate CSV columns.");
    }
    if (!/^[0-9]+$/.test(cells[1]) || !/^[0-9]+$/.test(cells[3])) {
      throw new Error("Only whole-number counts and revisions are supported.");
    }
    return {
      intervalStart: cells[0], observedCount: Number(cells[1]),
      quality: cells[2], revision: Number(cells[3]),
    };
  });
}

export function WorkforceOperationalDemandPanel({
  organizationId, worksites, canManage,
}: { organizationId: number; worksites: Site[]; canManage: boolean }) {
  const [siteId, setSiteId] = useState<number | null>(null);
  const [sourceKey, setSourceKey] = useState("pos-main");
  const [metricKind, setMetricKind] = useState<DemandMetric>("transactions");
  const [intervalMinutes, setIntervalMinutes] = useState<15 | 30 | 60>(30);
  const [horizonDays, setHorizonDays] = useState<7 | 14>(7);
  const [csv, setCsv] = useState(CSV_HEADER + "\n");
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [inflight, setInflight] = useState<{ fingerprint: string; idempotencyKey: string } | null>(null);
  const [response, setResponse] = useState<{ key: string; value: Payload } | null>(null);
  const [error, setError] = useState<{ key: string; value: string } | null>(null);
  const [loading, setLoading] = useState<string | null>(null);

  const activeSite = useMemo(() =>
    worksites.find(site => site.id === siteId && site.active)
    ?? worksites.find(site => site.active) ?? null, [worksites, siteId]);
  const chosenSiteId = activeSite?.id ?? 0;
  const scopeKey = [organizationId, chosenSiteId, sourceKey, metricKind, intervalMinutes, horizonDays, refresh].join(":");

  useEffect(() => {
    if (!chosenSiteId || !/^[a-z][a-z0-9._-]{2,63}$/.test(sourceKey)) return;
    const abort = new AbortController();
    async function load() {
      setLoading(scopeKey);
      try {
        const params = new URLSearchParams({
          organizationId: String(organizationId), worksiteId: String(chosenSiteId),
          sourceKey, metricKind, intervalMinutes: String(intervalMinutes),
          horizonDays: String(horizonDays),
        });
        const r = await fetch("/api/workforce/demand-observations/outlook?" + params, {
          cache: "no-store", signal: abort.signal,
        });
        const data = await r.json().catch(() => ({})) as Partial<Payload> & { error?: string };
        if (!r.ok) throw new Error(data.error ?? "Workload data unavailable.");
        if (data.readOnly !== true || data.scope?.organizationId !== organizationId
          || data.scope?.worksiteId !== chosenSiteId || data.scope?.sourceKey !== sourceKey
          || data.scope?.metricKind !== metricKind || data.scope?.intervalMinutes !== intervalMinutes
          || !data.forecast) throw new Error("The workload source scope could not be verified.");
        if (!abort.signal.aborted) { setResponse({ key: scopeKey, value: data as Payload }); setError(null); }
      } catch (err) {
        if (!abort.signal.aborted) setError({ key: scopeKey,
          value: err instanceof Error ? err.message : "Workload data unavailable." });
      } finally {
        if (!abort.signal.aborted) setLoading(null);
      }
    }
    void load();
    return () => abort.abort();
  }, [organizationId, chosenSiteId, sourceKey, metricKind, intervalMinutes, horizonDays, refresh, scopeKey]);

  async function importRows() {
    if (!acknowledged || !canManage || !chosenSiteId || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const rows = parseAggregateCsv(csv);
      const fingerprint = JSON.stringify({
        organizationId, worksiteId: chosenSiteId, sourceKey, metricKind, intervalMinutes, rows,
      });
      // Reuse one idempotency key when retrying the *same* failed request.
      const idempotencyKey = inflight?.fingerprint === fingerprint
        ? inflight.idempotencyKey : crypto.randomUUID();
      setInflight({ fingerprint, idempotencyKey });
      const r = await fetch("/api/workforce/demand-observations/import", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId, worksiteId: chosenSiteId, sourceKey, metricKind,
          intervalMinutes, idempotencyKey, acknowledged: true, rows,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error ?? "Aggregate import was not accepted.");
      setMessage(data.replayed ? "Identical import safely replayed. No additional records were created."
        : "Recorded " + data.rowCount + " aggregate interval revisions. No schedule or payroll action occurred.");
      setInflight(null);
      setRefresh(value => value + 1);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Unable to import aggregate counts.");
    } finally { setBusy(false); }
  }

  const forecast = response?.key === scopeKey ? response.value.forecast : null;
  const issue = error?.key === scopeKey ? error.value : null;
  return (
    <section data-wfm-operational-demand style={{ padding: "0 18px 18px" }}>
      <article className="card" style={{ margin: 0 }}>
        <div className="card-header">
          <div>
            <div className="card-kicker">Observed workload · opt-in pilot</div>
            <h3>Compare staffing forecasts with reported business activity</h3>
            <p>Import aggregate interval counts from an approved source export. No personal customer, patient, payment or employee records are accepted.</p>
          </div>
          <button type="button" className="secondary-button" disabled={!chosenSiteId || loading === scopeKey}
            onClick={() => setRefresh(x => x + 1)}><RefreshCcw size={14} /> Reload observations</button>
        </div>
        <div className="setting-form" style={{ padding: "0 18px 14px" }}>
          <label>Worksite<select value={chosenSiteId || ""} onChange={e => setSiteId(Number(e.target.value))}>
            {worksites.filter(site => site.active).map(site => <option key={site.id} value={site.id}>{site.code} · {site.name}</option>)}
          </select></label>
          <label>Approved aggregate source key<input value={sourceKey} maxLength={64} onChange={e => setSourceKey(e.target.value)}
            placeholder="pos-main" /></label>
          <label>Activity unit<select value={metricKind}
            onChange={e => setMetricKind(e.target.value as DemandMetric)}>
            {METRICS.map(metric => <option key={metric} value={metric}>{metric}</option>)}
          </select></label>
          <label>Interval<select value={intervalMinutes}
            onChange={e => setIntervalMinutes(Number(e.target.value) as 15 | 30 | 60)}>
            <option value={15}>15 minutes</option><option value={30}>30 minutes</option><option value={60}>60 minutes</option>
          </select></label>
          <label>Lookahead<select value={horizonDays}
            onChange={e => setHorizonDays(e.target.value === "14" ? 14 : 7)}>
            <option value={7}>Next 7 days</option><option value={14}>Next 14 days</option>
          </select></label>
        </div>
        {loading === scopeKey && <p role="status" style={{ padding: "0 18px" }}>Reviewing recorded workload intervals…</p>}
        {!chosenSiteId && <div className="notice notice-amber" role="status">No active site is available.</div>}
        {issue && <div className="notice notice-amber" role="alert" style={{ margin: "0 18px 14px" }}>{issue}</div>}
        {forecast && (
          <>
            <div className="notice notice-slate" style={{ margin: "0 18px 16px" }}>
              <TrendingUp size={15} /><span><strong>Evidence boundary.</strong> {forecast.boundary}</span>
            </div>
            <section className="stats-grid" style={{ padding: "0 18px 18px" }}>
              <div className="stat-card"><p>REPORTED INTERVALS</p><h3>{forecast.latestIntervals}</h3>
                <span>{forecast.qualityExcluded} excluded as partial/unverified</span></div>
              <div className="stat-card"><p>FUTURE INTERVAL ESTIMATES</p><h3>{forecast.predictedIntervals}</h3>
                <span>Unknown slots remain unestimated</span></div>
              <div className="stat-card"><p>HELD-OUT INTERVALS</p><h3>{forecast.backtest.comparisons}</h3>
                <span>Retrospective, not frozen live predictions</span></div>
              <div className="stat-card"><p>ACTIVITY COUNT WAPE</p>
                <h3>{forecast.backtest.wapePercent == null ? "Not measurable" : forecast.backtest.wapePercent.toFixed(1) + "%"}</h3>
                <span>Against source-reported aggregate observations</span></div>
            </section>
            {forecast.status !== "ready" && <div className="notice notice-amber" role="status"
              style={{ margin: "0 18px 18px" }}>
              Insufficient complete, recent matching weekday and time-slot observations.
              Missing data is unknown and cannot be treated as zero demand.
            </div>}
            {forecast.points.length > 0 && <div className="data-table-wrap" style={{ margin: "0 18px 18px" }}>
              <table className="data-table" data-wfm-workload-forecasts>
                <thead><tr><th>PH WORK DATE</th><th>TIME SLOT</th><th>ACTIVITY ESTIMATE</th>
                  <th>LOW / HIGH SCENARIO</th><th>HISTORICAL SOURCE</th></tr></thead>
                <tbody>{forecast.points.slice(0, 40).map(row => (
                  <tr key={row.workDate + ":" + row.startTime}>
                    <td>{row.workDate}</td><td>{row.startTime}</td>
                    <td><strong>{row.predictedCount}</strong></td>
                    <td>{row.lowerScenarioCount} / {row.upperScenarioCount}</td>
                    <td>{row.evidenceCount} samples · last {row.lastSourceDate}</td>
                  </tr>
                ))}</tbody>
              </table>
              {forecast.points.length > 40 && <p style={{ padding: 12 }}>
                Showing 40 of {forecast.points.length} forecast intervals; no roster updates are generated.
              </p>}
            </div>}
          </>
        )}

        {canManage && <div style={{ padding: "0 18px 18px" }}>
          <div className="card-kicker">Source import · company-wide People admin only</div>
          <p>Paste only the four aggregate columns below from an approved provider export.
            One batch supports up to 100 intervals; revisions must increase exactly by one.
            Retry the same failed batch without modifying the fields.</p>
          <label>Aggregate CSV (Philippine time +08:00)
            <textarea rows={5} value={csv} onChange={e => { setCsv(e.target.value); setInflight(null); }}
              spellCheck={false} style={{ display: "block", width: "100%" }} />
          </label>
          <label style={{ display: "flex", alignItems: "start", gap: 8, marginTop: 10 }}>
            <input type="checkbox" checked={acknowledged}
              onChange={e => setAcknowledged(e.target.checked)} />
            I confirm this contains only approved aggregate business activity, no customer or employee-level data.
          </label>
          <button type="button" className="primary-button" onClick={() => void importRows()}
            disabled={busy || !acknowledged || !chosenSiteId} style={{ marginTop: 12 }}>
            <Upload size={14} /> {busy ? "Importing…" : "Import aggregate counts"}
          </button>
          {message && <p role="status">{message}</p>}
        </div>}
      </article>
    </section>
  );
}
