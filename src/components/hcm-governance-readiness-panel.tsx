"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, ShieldAlert } from "lucide-react";
import { HcmGovernanceWorklistPanel } from "@/components/hcm-governance-worklist-panel";

type HcmGovernanceReport = {
  asOf: string;
  status: "manual_review_required" | "inventory_only";
  summary: {
    employeeCount: number;
    currentWorkers: number;
    highPriorityCategories: number;
    reviewCategories: number;
    inProgressBusinessProcesses: number;
    pendingHcmSteps: number;
    overdueHcmSteps: number;
  };
  findings: Array<{
    code: string;
    severity: "high" | "review";
    affected: number;
    title: string;
    nextAction: string;
  }>;
  processes: Array<{
    processType: string;
    configuredDefinitions: number;
    currentActiveDefinitions: number;
    scopedDefinitions: number;
    policyState: string;
  }>;
  limitations: string[];
};

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
  const [error, setError] = useState("");
  const [checked, setChecked] = useState(false);

  const refresh = useCallback(async () => {
    const requestId = ++requestGeneration.current;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/hcm/governance-readiness?organizationId=${organizationId}`,
        { cache: "no-store" },
      );
      const payload = await response.json().catch(() => ({}));
      // Never display an old employer's results after the active workspace
      // changes or a more recent refresh has been requested.
      if (requestId !== requestGeneration.current) return;
      if (!response.ok) {
        if (response.status === 403) {
          setError("Company-wide People administrator access is required for this aggregate readiness report.");
        } else {
          throw new Error(payload.error ?? "Could not load HCM governance readiness.");
        }
        setReport(null);
        return;
      }
      setReport(payload as HcmGovernanceReport);
      setLoadedOrganizationId(organizationId);
    } catch (caught) {
      if (requestId !== requestGeneration.current) return;
      setReport(null);
      setError(caught instanceof Error ? caught.message : "HCM readiness is unavailable.");
    } finally {
      if (requestId === requestGeneration.current) {
        setChecked(true);
        setBusy(false);
      }
    }
  }, [organizationId]);

  useEffect(() => {
    setChecked(false);
    void refresh();
    return () => { requestGeneration.current += 1; };
  }, [refresh]);

  // Render only the report associated with this exact tenant, even during
  // the render before a React effect has run on an organization switch.
  const report = loadedOrganizationId === organizationId ? storedReport : null;

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
          onClick={() => void refresh()}
          disabled={busy}
        >
          <RefreshCw size={14} /> {busy ? "Checking..." : "Refresh checks"}
        </button>
      </div>
      {error && <div className="notice notice-amber"><span>{error}</span></div>}
      {!checked && <p>Checking HCM governance records...</p>}
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
