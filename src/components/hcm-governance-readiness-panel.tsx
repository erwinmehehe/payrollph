"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw, ShieldAlert } from "lucide-react";
import { HcmGovernanceWorklistPanel } from "@/components/hcm-governance-worklist-panel";
import { parseHcmGovernanceReadinessResponse, type HcmGovernanceReport } from "@/lib/hcm-governance-verified-read";

function policyLabel(state: string) {
  if (state === "active_definition_exists") return "At least one active policy";
  if (state === "configured_without_current_active_definition") return "Configured; none current";
  return "System fallback / no explicit definition";
}

export function HcmGovernanceReadinessPanel({ organizationId }: { organizationId: number }) {
  const [storedReport, setReport] = useState<HcmGovernanceReport | null>(null);
  const [loadedOrganizationId, setLoadedOrganizationId] = useState<number | null>(null);
  const requestGeneration = useRef(0);
  const [busy, setBusy] = useState(false);
  const [errorState, setErrorState] = useState<{ organizationId: number; message: string } | null>(null);
  const [checkedOrganizationId, setCheckedOrganizationId] = useState<number | null>(null);

  // Increment only from a user-initiated refresh event. The effect itself
  // synchronizes with the HTTP source and receives data asynchronously.
  const [refreshNonce, setRefreshNonce] = useState(0);

  function retryRead() {
    setBusy(true);
    setReport(null);
    setCheckedOrganizationId(null);
    setErrorState(null);
    setRefreshNonce((current) => current + 1);
  }

  useEffect(() => {
    const requestId = ++requestGeneration.current;
    const controller = new AbortController();
    void fetch(
      `/api/hcm/governance-readiness?organizationId=${organizationId}`,
      { cache: "no-store", signal: controller.signal },
    )
      .then(async (response) => {
        const payload: unknown = await response.json().catch(() => null);
        // A late response, denied read or malformed 200 must never publish
        // another employer's counts or a false "no exceptions" inventory.
        if (requestId !== requestGeneration.current) return;
        if (controller.signal.aborted) return;
        const verified = parseHcmGovernanceReadinessResponse(response.status, payload, organizationId);
        setErrorState(null);
        setReport(verified);
        setLoadedOrganizationId(organizationId);
      })
      .catch((caught) => {
        if (requestId !== requestGeneration.current) return;
        if (caught instanceof Error && caught.name === "AbortError") return;
        setReport(null);
        setErrorState({ organizationId, message: caught instanceof Error ? caught.message : "HCM readiness is unavailable." });
      })
      .finally(() => {
        if (requestId === requestGeneration.current) {
          setCheckedOrganizationId(organizationId);
          setBusy(false);
        }
      });
    return () => {
      controller.abort();
      requestGeneration.current += 1;
    };
  }, [organizationId, refreshNonce]);

  // Render only the report associated with this exact tenant, even during
  // the render before a React effect has run on an organization switch.
  const report = loadedOrganizationId === organizationId ? storedReport : null;
  // Derive completion from the selected employer during render, not an effect.
  // An employer cannot inherit another employer's completed-check indicator.
  const checked = checkedOrganizationId === organizationId;
  const error = errorState?.organizationId === organizationId ? errorState.message : "";

  return (
    <section style={{ padding: "12px 16px 4px" }} aria-label="Read-only HCM governance readiness">
      <div className="card-header" style={{ padding: 0, marginBottom: 10 }}>
        <div>
          <div className="card-kicker">READ-ONLY · HCM CONTROL INVENTORY</div>
          <h2 style={{ fontSize: 14 }}>Approval coverage and employee-record exceptions</h2>
          <p>Aggregated company-wide indicators only. No employee identities, financial amounts, or bank data are displayed.</p>
        </div>
        <button
          type="button"
          className="secondary-button"
          onClick={retryRead}
          disabled={busy || !checked}
        >
          <RefreshCw size={14} /> {busy ? "Checking..." : "Refresh checks"}
        </button>
      </div>
      {checked && !report && (
        <div className="notice notice-amber" role="alert">
          <ShieldAlert size={16} />
          <span>Unavailable, retry. {error || "HCM governance records could not be verified for this employer."}</span>
          <button type="button" className="secondary-button" onClick={retryRead}>Retry</button>
        </div>
      )}
      {!checked && <p role="status">Checking HCM governance records...</p>}
      {report && (
        <>
          <div className="module-grid three" style={{ margin: "0 0 12px" }}>
            <div>
              <strong>{report.summary.employeeCount}</strong>
              <small style={{ display: "block" }}>Employees · {report.summary.currentWorkers} current</small>
            </div>
            <div>
              <strong>{report.summary.highPriorityCategories}</strong>
              <small style={{ display: "block" }}>High-priority exception categories</small>
            </div>
            <div>
              <strong>{report.summary.reviewCategories}</strong>
              <small style={{ display: "block" }}>Other review categories</small>
            </div>
          </div>
          <div className="notice notice-amber">
            <ShieldAlert size={16} />
            <span>
              <strong>Inventory, not certification.</strong> {report.asOf} ·
              {report.summary.inProgressBusinessProcesses} HCM processes in progress ·
              {report.summary.pendingHcmSteps} pending work items ·
              {report.summary.overdueHcmSteps} overdue pending items.
              This report does not authorize salary changes, final-pay release, agency filings, or production rollout.
            </span>
          </div>
          <div className="data-table-wrap slim-scroll" style={{ marginTop: 12 }}>
            <table className="data-table">
              <thead><tr><th>HCM exception</th><th>Count</th><th>Review direction</th></tr></thead>
              <tbody>
                {report.findings.length === 0 ? (
                  <tr>
                    <td colSpan={3}>No exceptions detected by these aggregate checks. Separate payroll and policy approval reviews are still required.</td>
                  </tr>
                ) : report.findings.map(finding => (
                  <tr key={finding.code}>
                    <td><strong>{finding.title}</strong><small style={{ display: "block" }}>{finding.severity === "high" ? "High priority" : "Review"} · {finding.code}</small></td>
                    <td className="mono">{finding.affected}</td>
                    <td>{finding.nextAction}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="data-table-wrap slim-scroll" style={{ marginTop: 12 }}>
            <table className="data-table">
              <thead><tr><th>Business process</th><th>Configured</th><th>Current</th><th>Policy state</th></tr></thead>
              <tbody>
                {report.processes.map(policy => (
                  <tr key={policy.processType}>
                    <td>{policy.processType.replaceAll("_", " ")}</td>
                    <td className="mono">{policy.configuredDefinitions}</td>
                    <td className="mono">{policy.currentActiveDefinitions}</td>
                    <td>{policyLabel(policy.policyState)}{policy.scopedDefinitions > 0 ? ` · ${policy.scopedDefinitions} scoped` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <HcmGovernanceWorklistPanel key={organizationId} report={report} />
          <small style={{ display: "block", marginTop: 9, color: "var(--muted)" }}>
            Policy-state counts do not prove complete employee/supervisory-unit coverage. This endpoint never mutates employee or payroll records.
          </small>
        </>
      )}
    </section>
  );
}
