"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, History, Play, RefreshCw, ShieldCheck } from "lucide-react";
import type { Notify } from "@/components/workspace/types";
import { Status, money } from "@/components/workspace/ui";

type Drill = {
  id: number;
  status: "blocked" | "needs-work" | "evidence-ready";
  rangeLabel: string;
  evidencePackSha256: string;
  evidencePackVersion: string;
  snapshotSha256: string;
  summary: {
    high: number;
    medium: number;
    info: number;
    recordedExposure: number;
    screeningExposure: number;
    unownedActionable: number;
    readyToClose: number;
  };
  blockers: Array<{
    key: string;
    ruleCode: string;
    category: string;
    title: string;
    employeeNo: string | null;
    periodLabel: string | null;
    owner: string;
    exposureAmount: number | null;
    exposureConfidence: string | null;
  }>;
  actionPlan: Array<{
    priority: "P0" | "P1" | "P2";
    owner: string;
    findingKey: string;
    ruleCode: string;
    title: string;
  }>;
  generatedBy: string;
  createdAt: string;
};

function statusLabel(status: Drill["status"]) {
  if (status === "blocked") return "Blocked";
  if (status === "needs-work") return "Needs work";
  return "Evidence ready";
}

export function LaborInspectionDrillPanel({
  organizationId,
  notify,
}: {
  organizationId: number;
  notify: Notify;
}) {
  const [drills, setDrills] = useState<Drill[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/compliance/labor-inspection/drills?organizationId=${organizationId}`,
        { cache: "no-store" },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Inspection drill history could not be loaded.");
      setDrills(body.drills ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Inspection drill history could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => { void load(); }, [load]);

  async function runDrill() {
    setRunning(true);
    try {
      const response = await fetch("/api/compliance/labor-inspection/drills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Inspection drill could not be completed.");
      notify(
        body.drill?.status === "evidence-ready"
          ? "Inspection drill complete. No actionable payroll findings detected."
          : `Inspection drill complete: ${body.drill?.status === "blocked" ? "blocked" : "needs work"}.`,
        body.drill?.status === "evidence-ready" ? "ok" : "info",
      );
      await load();
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "Inspection drill could not be completed.", "err");
    } finally {
      setRunning(false);
    }
  }

  const latest = drills[0] ?? null;
  const previous = drills[1] ?? null;
  const highDelta = latest && previous ? latest.summary.high - previous.summary.high : null;
  const exposureDelta = latest && previous
    ? latest.summary.recordedExposure - previous.summary.recordedExposure
    : null;
  const topActions = useMemo(() => latest?.actionPlan.slice(0, 5) ?? [], [latest]);

  return (
    <article className="card" data-labor-inspection-drill style={{ marginBottom: 16 }}>
      <div className="card-header">
        <div>
          <div className="card-kicker">INSPECTION DRILL</div>
          <h2>Freeze the evidence state and prove improvement over time.</h2>
          <p>
            A drill records the current finding summary and tamper-evident evidence-pack hash. It does not duplicate the evidence pack and does not claim DOLE approval.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="secondary-button" type="button" disabled={loading} onClick={() => void load()}>
            <RefreshCw size={14} /> Refresh
          </button>
          <button className="primary-button brand" type="button" disabled={running} onClick={() => void runDrill()}>
            <Play size={14} /> {running ? "Running drill…" : "Run inspection drill"}
          </button>
        </div>
      </div>

      {error && (
        <div className="card-body" style={{ paddingTop: 0 }}>
          <div className="notice notice-red" style={{ margin: 0 }}>
            <AlertTriangle size={14} />
            <span>{error}</span>
          </div>
        </div>
      )}

      {latest ? (
        <div className="card-body" style={{ paddingTop: 0, display: "grid", gap: 14 }}>
          <div className="run-stats" style={{ margin: 0 }}>
            <div>
              <span>Latest status</span>
              <strong>{statusLabel(latest.status)}</strong>
              <small>{new Date(latest.createdAt).toLocaleString("en-PH")}</small>
            </div>
            <div>
              <span>High findings</span>
              <strong className={latest.summary.high ? "red-number" : "green-number"}>{latest.summary.high}</strong>
              <small>{highDelta == null ? "first recorded drill" : highDelta < 0 ? `${Math.abs(highDelta)} fewer vs previous` : highDelta > 0 ? `${highDelta} more vs previous` : "unchanged vs previous"}</small>
            </div>
            <div>
              <span>Recorded exposure</span>
              <strong>{money(latest.summary.recordedExposure)}</strong>
              <small>{exposureDelta == null ? "first recorded drill" : exposureDelta < 0 ? `${money(Math.abs(exposureDelta))} lower` : exposureDelta > 0 ? `${money(exposureDelta)} higher` : "unchanged"}</small>
            </div>
            <div>
              <span>Evidence hash</span>
              <strong style={{ fontSize: 13 }}>{latest.evidencePackSha256.slice(0, 12)}…</strong>
              <small>{latest.evidencePackVersion}</small>
            </div>
          </div>

          <div className={latest.status === "evidence-ready" ? "notice notice-green" : latest.status === "blocked" ? "notice notice-red" : "notice notice-amber"} style={{ margin: 0 }}>
            {latest.status === "evidence-ready" ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
            <span>
              <strong>{statusLabel(latest.status)}.</strong>{" "}
              {latest.status === "evidence-ready"
                ? "No high or medium payroll inspection findings remain in the stored evidence."
                : latest.status === "blocked"
                  ? "At least one high-severity payroll inspection finding remains."
                  : "No high-severity blocker remains, but review items or verified close-outs are still pending."}
            </span>
          </div>

          {topActions.length > 0 && (
            <section className="leave-request" style={{ display: "grid", gap: 8 }}>
              <div>
                <div className="card-kicker">NEXT ACTIONS</div>
                <strong>Highest-priority pre-inspection work</strong>
              </div>
              {topActions.map((item) => (
                <div key={item.findingKey} style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                  <div>
                    <strong>{item.priority} · {item.title}</strong>
                    <div className="id">{item.ruleCode} · owner {item.owner}</div>
                  </div>
                  <Status value={item.priority} />
                </div>
              ))}
            </section>
          )}

          <details>
            <summary style={{ cursor: "pointer", fontWeight: 800, fontSize: 12 }}>
              Drill history ({drills.length})
            </summary>
            <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
              {drills.map((drill) => (
                <div className="notice" style={{ margin: 0 }} key={drill.id}>
                  <History size={14} />
                  <span>
                    <strong>{statusLabel(drill.status)}</strong> · {new Date(drill.createdAt).toLocaleString("en-PH")}
                    {" · "}high {drill.summary.high}
                    {" · "}recorded exposure {money(drill.summary.recordedExposure)}
                    {" · "}snapshot {drill.snapshotSha256.slice(0, 12)}…
                    {" · "}by {drill.generatedBy}
                  </span>
                </div>
              ))}
            </div>
          </details>

          <div className="notice notice-blue" style={{ margin: 0 }}>
            <ShieldCheck size={14} />
            <span>
              Each drill stores hashes and summary metadata only. The underlying evidence remains in the inspection evidence pack and operational records.
            </span>
          </div>
        </div>
      ) : !loading && !error ? (
        <div className="card-body" style={{ paddingTop: 0 }}>
          <div className="notice notice-blue" style={{ margin: 0 }}>
            <History size={14} />
            <span>No inspection drill has been recorded yet. Run one to create the baseline.</span>
          </div>
        </div>
      ) : null}
    </article>
  );
}
