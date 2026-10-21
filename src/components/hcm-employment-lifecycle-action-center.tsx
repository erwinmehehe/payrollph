"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  hcmReadScopeKey, hcmReadScopeParams, hcmReadScopeValid,
  type HcmReadScope,
} from "@/lib/hcm-client-employer-scope";
import { AlertTriangle, CalendarClock, CheckCircle2, RefreshCw, UserRoundCog } from "lucide-react";
import { readVerifiedLifecycleResponse, type VerifiedLifecyclePayload as LifecyclePayload, type VerifiedLifecycleRow as LifecycleRow } from "@/lib/hcm-employment-lifecycle-read";


function actionLabel(action: LifecycleRow["action"]) {
  if (action === "configure_terms") return "Configure terms";
  if (action === "record_decision") return "Record decision";
  if (action === "review_decision") return "Review decision";
  if (action === "retry_decision") return "Resolve failure";
  if (action === "start_separation") return "Start Separation";
  if (action === "continue_separation") return "Open Separation";
  if (action === "await_effective_date") return "View worker";
  return "View worker";
}

export function HcmEmploymentLifecycleActionCenter({
  organizationId,
  legalEntityId = null,
  multiEntityEnabled = false,
  onOpenEmployee,
  onOpenSeparation,
}: {
  organizationId: number;
  legalEntityId?: number | null;
  multiEntityEnabled?: boolean;
  onOpenEmployee: (employeeId: number) => void;
  onOpenSeparation: () => void;
}) {
  const scope: HcmReadScope = { organizationId, legalEntityId, multiEntityEnabled };
  if (!hcmReadScopeValid(scope)) return (
    <section className="notice notice-amber" role="status">
      Select one authorized legal employer before loading employment lifecycle information.
    </section>
  );
  return <ScopedHcmEmploymentLifecycleActionCenter key={hcmReadScopeKey(scope)}
    scope={scope} onOpenEmployee={onOpenEmployee} onOpenSeparation={onOpenSeparation}/>;
}

function ScopedHcmEmploymentLifecycleActionCenter({
  scope, onOpenEmployee, onOpenSeparation,
}: {
  scope: HcmReadScope;
  onOpenEmployee: (employeeId: number) => void;
  onOpenSeparation: () => void;
}) {
  const selection = useMemo<HcmReadScope>(() => ({
    organizationId: scope.organizationId,
    multiEntityEnabled: scope.multiEntityEnabled,
    legalEntityId: scope.legalEntityId,
  }), [scope.organizationId, scope.multiEntityEnabled, scope.legalEntityId]);
  const activeRequest = useRef<AbortController | null>(null);
  const [payload, setPayload] = useState<LifecyclePayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setLoading(true);
    // A refresh is a new authorization boundary: never keep worker names,
    // actions or employment dates from an earlier completed request visible
    // while the next request may reject a revoked grant or changed scope.
    setPayload(null);
    setError("");
    // A disabled or missing employer selection cannot issue a broad request.
    const params = hcmReadScopeParams(selection);
    if (!params) {
      setPayload(null);
      setError("Select one legal employer.");
      setLoading(false);
      return;
    }
    try {
      const response = await fetch(
        "/api/hcm/lifecycle-readiness?" + params.toString(),
        { cache: "no-store", signal: controller.signal },
      );
      const data: unknown = await response.json().catch(() => null);
      if (controller.signal.aborted) return;
      const verified = readVerifiedLifecycleResponse(response.ok, data, selection);
      if (!verified) throw new Error("Employment lifecycle source unavailable or not verified for the selected employer.");
      setPayload(verified);
    } catch (loadError) {
      if (controller.signal.aborted) return;
      setPayload(null);
      setError(loadError instanceof Error ? loadError.message : "Could not load employment lifecycle readiness.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [selection]);

  useEffect(() => {
    let retired = false;
    // Keep initial state updates outside the synchronous effect phase and
    // suppress Strict Mode's retired first setup.
    queueMicrotask(() => { if (!retired) void load(); });
    return () => {
      retired = true;
      activeRequest.current?.abort();
    };
  }, [load]);

  const actionable = payload?.rows.filter((row) =>
    ["action_required", "upcoming", "in_progress", "unconfigured"].includes(row.state),
  ).slice(0, 10) ?? [];

  return (
    <section className="card" style={{ marginBottom: 18 }}>
      <div className="card-header">
        <div>
          <div className="card-kicker">HCM CORE 3 · EMPLOYMENT LIFECYCLE</div>
          <h2>Lifecycle action center</h2>
          <p>
            Probation reviews, contract endings, governed decisions, and non-renewal handoffs are surfaced here.
            Dates create action evidence; they never change employment status by themselves.
          </p>
        </div>
        <button className="secondary-button" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {error && <div className="notice notice-amber" role="alert"><AlertTriangle size={15} /><span>{error}</span></div>}
      {!loading && !payload && <div className="notice notice-amber" role="status">Lifecycle status is unavailable. Use Refresh to retry; no clear status or actions are shown.</div>}

      {payload && (
        <>
          <div className="stats-grid" style={{ gridTemplateColumns: "repeat(5, minmax(0, 1fr))", marginBottom: 14 }}>
            <article className="stat-card">
              <div className="stat-icon orange"><AlertTriangle size={18} /></div>
              <p>ACTION REQUIRED</p>
              <h3>{payload.summary.actionRequired}</h3>
              <span>Decision or handoff due</span>
            </article>
            <article className="stat-card">
              <div className="stat-icon blue"><CalendarClock size={18} /></div>
              <p>UPCOMING</p>
              <h3>{payload.summary.upcoming}</h3>
              <span>Within {payload.policy.actionWindowDays} days</span>
            </article>
            <article className="stat-card">
              <div className="stat-icon purple"><UserRoundCog size={18} /></div>
              <p>IN PROGRESS</p>
              <h3>{payload.summary.inProgress}</h3>
              <span>Approved or in Separation</span>
            </article>
            <article className="stat-card">
              <div className="stat-icon orange"><UserRoundCog size={18} /></div>
              <p>UNCONFIGURED</p>
              <h3>{payload.summary.unconfigured}</h3>
              <span>No governed terms yet</span>
            </article>
            <article className="stat-card">
              <div className="stat-icon mint"><CheckCircle2 size={18} /></div>
              <p>SEPARATION READY</p>
              <h3>{payload.summary.handoffReady}</h3>
              <span>Approved non-renewals</span>
            </article>
          </div>

          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>EMPLOYEE</th>
                  <th>EMPLOYMENT TERMS</th>
                  <th>LIFECYCLE STATE</th>
                  <th>DUE</th>
                  <th>ACTION</th>
                </tr>
              </thead>
              <tbody>
                {actionable.length === 0 && (
                  <tr><td colSpan={5}><div className="empty-state">No employment lifecycle actions are due.</div></td></tr>
                )}
                {actionable.map((row) => (
                  <tr key={row.employeeId}>
                    <td>
                      <strong>{row.employeeName}</strong>
                      <small style={{ display: "block", color: "var(--muted)" }}>{row.employeeNo}</small>
                    </td>
                    <td>
                      {row.term ? (
                        <>
                          <span style={{ textTransform: "capitalize" }}>{row.term.termKind.replaceAll("_", " ")}</span>
                          <small style={{ display: "block", color: "var(--muted)" }}>{row.term.employmentType}</small>
                        </>
                      ) : (
                        <span className="status status-needs-review">Not configured</span>
                      )}
                    </td>
                    <td>
                      <strong>{row.label}</strong>
                      <small style={{ display: "block", color: "var(--muted)", maxWidth: 420 }}>{row.detail}</small>
                    </td>
                    <td>
                      {row.dueDate ?? "—"}
                      {row.daysUntil != null && (
                        <small style={{ display: "block", color: "var(--muted)" }}>
                          {row.daysUntil < 0
                            ? `${Math.abs(row.daysUntil)} day${Math.abs(row.daysUntil) === 1 ? "" : "s"} overdue`
                            : row.daysUntil === 0
                              ? "Today"
                              : `${row.daysUntil} day${row.daysUntil === 1 ? "" : "s"}`}
                        </small>
                      )}
                    </td>
                    <td>
                      <button
                        className={row.action === "start_separation" ? "primary-button" : "secondary-button"}
                        onClick={() => {
                          if (row.action === "start_separation" || row.action === "continue_separation") onOpenSeparation();
                          else onOpenEmployee(row.employeeId);
                        }}
                      >
                        {actionLabel(row.action)}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {loading && !payload && <div className="empty-state">Loading employment lifecycle readiness…</div>}
    </section>
  );
}
