"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarCheck, RefreshCcw, TrendingUp } from "lucide-react";
import type {
  FrozenDemandScoreReport, IssuedDemandSnapshot,
} from "@/lib/workforce-issued-demand-evidence";
import type { DemandMetric } from "@/lib/workforce-operational-demand-import";

type Site = { id: number; code: string; name: string; active: boolean };
type Issued = {
  id: number; worksiteId: number; sourceKey: string; metricKind: DemandMetric;
  horizonDays: number; issuedAt: string; pointsCount: number;
  snapshotSha256: string; integrity: "matches_issued_hash" | "source_review";
  snapshot: IssuedDemandSnapshot | null;
  score: null | {
    status: "frozen" | "source_review"; id: number; scoredAt: string;
    reportSha256: string; report: FrozenDemandScoreReport | null;
  };
};
type ResponseData = {
  readOnly: true; scope: { organizationId: number; worksiteId: number };
  issued: Issued[];
};
const METRICS: DemandMetric[] = ["transactions", "visits", "orders", "appointments", "calls"];

/**
 * Exact-org manager review. Issuing/scoring are privileged POSTs, never a
 * background cron or a shortcut to shift publishing/payroll calculations.
 */
export function WorkforceIssuedDemandPanel({
  organizationId, worksites, canManage,
}: { organizationId: number; worksites: Site[]; canManage: boolean }) {
  const [selectedSiteId, setSelectedSiteId] = useState<number | null>(null);
  const [sourceKey, setSourceKey] = useState("pos-main");
  const [metricKind, setMetricKind] = useState<DemandMetric>("transactions");
  const [intervalMinutes, setIntervalMinutes] = useState<15 | 30 | 60>(30);
  const [horizonDays, setHorizonDays] = useState<7 | 14>(7);
  const [acknowledged, setAcknowledged] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; value: ResponseData } | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [inflight, setInflight] = useState<{ fingerprint: string; idempotencyKey: string } | null>(null);

  const site = useMemo(() =>
    worksites.find(x => x.id === selectedSiteId && x.active)
    ?? worksites.find(x => x.active) ?? null, [worksites, selectedSiteId]);
  const worksiteId = site?.id ?? 0;
  const key = organizationId + ":" + worksiteId + ":" + refresh;

  useEffect(() => {
    if (!worksiteId || !organizationId) return;
    const abort = new AbortController();
    async function read() {
      setLoadingKey(key);
      try {
        const qs = new URLSearchParams({
          organizationId: String(organizationId), worksiteId: String(worksiteId),
        });
        const response = await fetch("/api/workforce/demand-observations/issued?" + qs, {
          cache: "no-store", signal: abort.signal,
        });
        const value = await response.json().catch(() => ({})) as Partial<ResponseData> & { error?: string };
        if (!response.ok) throw new Error(value.error ?? "Issued demand history unavailable.");
        if (value.readOnly !== true || value.scope?.organizationId !== organizationId
          || value.scope?.worksiteId !== worksiteId || !Array.isArray(value.issued)) {
          throw new Error("Issued demand response scope was not verified.");
        }
        if (!abort.signal.aborted) { setLoaded({ key, value: value as ResponseData }); setError(null); }
      } catch (reason) {
        if (!abort.signal.aborted) setError({ key,
          message: reason instanceof Error ? reason.message : "Issued demand history unavailable." });
      } finally {
        if (!abort.signal.aborted) setLoadingKey(null);
      }
    }
    void read();
    return () => abort.abort();
  }, [organizationId, worksiteId, refresh, key]);

  const issued = loaded?.key === key ? loaded.value.issued : [];
  const issue = error?.key === key ? error.message : null;

  async function createIssue() {
    if (!canManage || !worksiteId || !acknowledged || busy) return;
    setBusy(true); setMessage("");
    const payload = { organizationId, worksiteId, sourceKey, metricKind, intervalMinutes, horizonDays };
    const fingerprint = JSON.stringify(payload);
    const idempotencyKey = inflight?.fingerprint === fingerprint
      ? inflight.idempotencyKey : crypto.randomUUID();
    setInflight({ fingerprint, idempotencyKey });
    try {
      const result = await fetch("/api/workforce/demand-observations/issued", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, idempotencyKey, acknowledged: true }),
      });
      const response = await result.json().catch(() => ({}));
      if (!result.ok) throw new Error(response.error ?? "Could not issue future aggregate forecast.");
      setMessage(response.replayed
        ? "Same forecast issue request safely replayed."
        : "Forecast #" + response.issueId + " issued for " + response.pointsCount +
          " future workload intervals. No roster changes were made.");
      setInflight(null); setRefresh(n => n + 1);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Could not issue a forecast.");
    } finally { setBusy(false); }
  }

  async function finalScore(issueId: number) {
    if (!canManage || !acknowledged || busy) return;
    setBusy(true); setMessage("");
    try {
      const result = await fetch("/api/workforce/demand-observations/issued/score", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, issueId, acknowledged: true }),
      });
      const response = await result.json().catch(() => ({}));
      if (!result.ok) throw new Error(response.error
        ? response.error + (response.missingIntervals ? " Missing: " + response.missingIntervals : "")
        : "Forecast is not ready for final scoring.");
      setMessage("Forecast #" + issueId + (response.replayed ? " was already scored." :
        " scored and sealed. Subsequent corrections will not change its frozen score."));
      setRefresh(n => n + 1);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Final score unavailable.");
    } finally { setBusy(false); }
  }

  return (
    <section data-wfm-issued-demand style={{ padding: "0 18px 18px" }}>
      <article className="card" style={{ margin: 0 }}>
        <div className="card-header">
          <div>
            <div className="card-kicker">Future demand evidence · restricted pilot</div>
            <h3>Issue forecasts now. Score against later actuals.</h3>
            <p>Freeze the prediction and its input cutoff before the work occurs. Final MAE and WAPE are recorded only after complete, settled aggregate observations arrive.</p>
          </div>
          <button className="secondary-button" type="button" onClick={() => setRefresh(n => n + 1)}
            disabled={!worksiteId || loadingKey === key}><RefreshCcw size={14} /> Refresh</button>
        </div>

        <div className="notice notice-slate" style={{ margin: "0 18px 16px" }}>
          No provider-level accuracy guarantee. This measures source-reported counts, not labor headcount.
          Issuance, scoring, and any later schedule proposal are separate processes.
        </div>
        <div className="setting-form" style={{ padding: "0 18px 18px" }}>
          <label>Worksite<select value={worksiteId || ""}
            onChange={event => { setSelectedSiteId(Number(event.target.value)); setInflight(null); }}>
            {worksites.filter(site => site.active).map(site => (
              <option key={site.id} value={site.id}>{site.code} · {site.name}</option>
            ))}
          </select></label>
          {canManage && <>
            <label>Aggregate source key<input value={sourceKey} maxLength={64}
              onChange={event => { setSourceKey(event.target.value); setInflight(null); }}/></label>
            <label>Activity unit<select value={metricKind} onChange={event => { setMetricKind(event.target.value as DemandMetric); setInflight(null); }}>
              {METRICS.map(kind => <option key={kind} value={kind}>{kind}</option>)}
            </select></label>
            <label>Interval<select value={intervalMinutes}
              onChange={event => { setIntervalMinutes(Number(event.target.value) as 15 | 30 | 60); setInflight(null); }}>
              <option value={15}>15 min</option><option value={30}>30 min</option><option value={60}>60 min</option>
            </select></label>
            <label>Future horizon<select value={horizonDays}
              onChange={event => { setHorizonDays(event.target.value === "14" ? 14 : 7); setInflight(null); }}>
              <option value={7}>Next 7 PH days (starting tomorrow)</option>
              <option value={14}>Next 14 PH days (starting tomorrow)</option>
            </select></label>
          </>}
        </div>
        {canManage && <div style={{ padding: "0 18px 18px" }}>
          <label style={{ display: "flex", alignItems: "start", gap: 8 }}>
            <input type="checkbox" checked={acknowledged}
              onChange={event => setAcknowledged(event.target.checked)}/>
            I understand predictions and scores use only reported aggregate activity and do not publish rosters or make payroll decisions.
          </label>
          <button type="button" className="primary-button" style={{ marginTop: 12 }}
            disabled={!acknowledged || !worksiteId || busy} onClick={() => void createIssue()}>
            <CalendarCheck size={14} /> {busy ? "Processing…" : "Issue future forecast"}
          </button>
        </div>}

        {loadingKey === key && <p role="status" style={{ padding: "0 18px" }}>Loading issued forecasts…</p>}
        {issue && <div role="alert" className="notice notice-amber" style={{ margin: "0 18px 16px" }}>{issue}</div>}
        {message && <p role="status" style={{ padding: "0 18px 16px" }}>{message}</p>}

        {issued.length > 0 && <div className="data-table-wrap" style={{ margin: "0 18px 18px" }}>
          <table className="data-table" data-wfm-issued-demand-records>
            <thead><tr>
              <th>ISSUE</th><th>REPORT SOURCE</th><th>FUTURE INTERVALS</th>
              <th>PROSPECTIVE SCORE</th><th>REVIEW ACTION</th>
            </tr></thead>
            <tbody>{issued.map(entry => {
              const score = entry.score?.report;
              return <tr key={entry.id}>
                <td><strong>#{entry.id}</strong>
                  <div className="id">{new Date(entry.issuedAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" })} PH</div></td>
                <td>{entry.sourceKey} · {entry.metricKind}</td>
                <td>{entry.pointsCount} · {entry.horizonDays} days</td>
                <td>{entry.integrity !== "matches_issued_hash"
                  || entry.score?.status === "source_review" ? "Source review required"
                  : score ? (score.wapePercent == null ? "WAPE undefined" : score.wapePercent.toFixed(1) + "% WAPE") +
                    " · " + score.comparisonCount + " comparisons" : "Awaiting future actuals"}</td>
                <td>{canManage && !entry.score && entry.integrity === "matches_issued_hash"
                  ? <button type="button" className="secondary-button" disabled={busy || !acknowledged}
                    onClick={() => void finalScore(entry.id)}>Finalize score</button>
                  : entry.score?.status === "frozen" ? "Frozen evidence" : "Review source"}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>}
        {!issue && !loadingKey && issued.length === 0 && worksiteId > 0 &&
          <p style={{ padding: "0 18px 16px" }}>No issued forecasts for this worksite. Historical aggregate imports are required before a future forecast can be issued.</p>}
        <div className="id" style={{ padding: "0 18px 18px" }}><TrendingUp size={13}/>
          An already-scored forecast is never silently recalculated after later provider corrections.
          Missing and partial interval evidence cannot be scored as zero.
        </div>
      </article>
    </section>
  );
}
