"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, Rocket, ServerCog, ShieldCheck } from "lucide-react";
import { PageHeading, Status } from "@/components/workspace/ui";

type Gate = {
  key: string;
  label: string;
  ready: boolean;
  detail: string;
  blocks: "launch" | "scale" | "none";
  manualWorkaround: string | null;
};

type ReadinessPayload = {
  status: "launch-ready" | "not-launch-ready";
  launchBlockersRemaining: number;
  scaleGapsRemaining: number;
  summary: string;
  manualLaunch: { ready: boolean; summary: string };
  generatedAt: string;
  gates: Gate[];
};

export function LaunchReadinessPanel({ organizationId }: { organizationId: number }) {
  const [payload, setPayload] = useState<ReadinessPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/readiness/workspace?organizationId=${organizationId}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error ?? "Rollout readiness could not be loaded.");
        return;
      }
      setPayload(body);
    } catch {
      setError("Rollout readiness could not be loaded because the server could not be reached.");
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => { void load(); }, [load]);

  const launch = useMemo(
    () => (payload?.gates ?? []).filter((gate) => gate.blocks === "launch").sort((a, b) => Number(a.ready) - Number(b.ready)),
    [payload],
  );
  const scale = useMemo(
    () => (payload?.gates ?? []).filter((gate) => gate.blocks === "scale").sort((a, b) => Number(a.ready) - Number(b.ready)),
    [payload],
  );
  const proven = useMemo(
    () => (payload?.gates ?? []).filter((gate) => gate.ready).length,
    [payload],
  );

  return (
    <>
      <PageHeading
        eyebrow="ROLLOUT READINESS"
        title="Prove launch, don’t infer it."
        copy="Deployment readiness is evidence-based. A green code path is not treated as proof of agency acceptance, bank acceptance, live delivery or production payroll reconciliation."
        actions={
          <button className="secondary-button" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={15} /> {loading ? "Checking…" : "Refresh evidence"}
          </button>
        }
      />

      {error && (
        <div className="notice notice-red" style={{ marginBottom: 16 }}>
          <AlertTriangle size={15} />
          <span>{error}</span>
        </div>
      )}

      {payload && (
        <>
          <section className="stats-grid">
            <article className="stat-card">
              <div className="stat-icon green"><Rocket size={18} /></div>
              <p>LAUNCH BLOCKERS</p>
              <h3>{payload.launchBlockersRemaining}</h3>
              <span>{payload.launchBlockersRemaining ? "external or operational proof still missing" : "all launch gates green"}</span>
            </article>
            <article className="stat-card">
              <div className="stat-icon blue"><ServerCog size={18} /></div>
              <p>SCALE GAPS</p>
              <h3>{payload.scaleGapsRemaining}</h3>
              <span>do not block a controlled launch unless promoted to launch scope</span>
            </article>
            <article className="stat-card">
              <div className="stat-icon purple"><ShieldCheck size={18} /></div>
              <p>MANUAL PILOT</p>
              <h3>{payload.manualLaunch.ready ? "Ready" : "Blocked"}</h3>
              <span>counts documented workarounds separately from full automation</span>
            </article>
            <article className="stat-card">
              <div className="stat-icon mint"><CheckCircle2 size={18} /></div>
              <p>PROVEN GATES</p>
              <h3>{proven}</h3>
              <span>gates with evidence in this deployment</span>
            </article>
          </section>

          <div className={payload.status === "launch-ready" ? "notice notice-green" : "notice notice-amber"} style={{ marginBottom: 16 }}>
            {payload.status === "launch-ready" ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
            <span><strong>{payload.status === "launch-ready" ? "Launch-ready." : "Not launch-ready yet."}</strong> {payload.summary}</span>
          </div>

          <article className="card" style={{ marginBottom: 16 }}>
            <div className="card-header">
              <div>
                <div className="card-kicker">CONTROLLED PILOT</div>
                <h2>Manual operations are not hidden.</h2>
                <p>{payload.manualLaunch.summary}</p>
              </div>
              <Status value={payload.manualLaunch.ready ? "Pilot ready" : "Blocked"} />
            </div>
          </article>

          <ReadinessSection
            title="Launch gates"
            copy="These must be green, or have an explicitly documented manual pilot path where policy allows it."
            gates={launch}
          />

          <ReadinessSection
            title="Scale gates"
            copy="These matter for enterprise scale and operational durability but do not automatically block a controlled launch."
            gates={scale}
          />

          <p style={{ margin: "12px 2px 0", color: "var(--muted)", fontSize: 11 }}>
            Evidence evaluated {new Date(payload.generatedAt).toLocaleString("en-PH")}. This page intentionally omits deployment secrets and cross-tenant counts.
          </p>
        </>
      )}
    </>
  );
}

function ReadinessSection({ title, copy, gates }: { title: string; copy: string; gates: Gate[] }) {
  return (
    <article className="card" style={{ marginBottom: 16 }}>
      <div className="card-header">
        <div>
          <div className="card-kicker">EVIDENCE GATES</div>
          <h2>{title}</h2>
          <p>{copy}</p>
        </div>
      </div>
      <div className="card-body" style={{ paddingTop: 0, display: "grid", gap: 10 }}>
        {gates.length === 0 ? (
          <div className="empty-state">No gates are currently classified in this group.</div>
        ) : gates.map((gate) => (
          <section key={gate.key} className="leave-request" style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start", justifyContent: "space-between" }}>
              <div>
                <strong>{gate.label}</strong>
                <p style={{ margin: "4px 0 0" }}>{gate.detail}</p>
              </div>
              <Status value={gate.ready ? "Ready" : gate.blocks === "launch" ? "Launch blocker" : "Scale gap"} />
            </div>
            {!gate.ready && gate.manualWorkaround && (
              <div className="notice notice-blue" style={{ margin: 0 }}>
                <ShieldCheck size={14} />
                <span><strong>Controlled pilot path:</strong> {gate.manualWorkaround}</span>
              </div>
            )}
          </section>
        ))}
      </div>
    </article>
  );
}
