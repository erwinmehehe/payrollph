"use client";

import { useEffect, useState } from "react";
import type { ConnectedImpactFinding, ConnectedImpactReport } from "@/lib/payroll-connected-impact";

type ViewData = ConnectedImpactReport & { runId: number; runStatus: string };

export function PayrollConnectedImpactPanel({
  runId,
  onPage,
  allowedPages,
}: {
  runId: number;
  onPage: (page: string) => void;
  allowedPages: readonly string[];
}) {
  const [report, setReport] = useState<ViewData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setReport(null);
    setError("");
    setLoading(true);
    setEnabled(true);
    void fetch("/api/payroll-runs/" + runId + "/connected-impact", {
      cache: "no-store",
      signal: controller.signal,
    }).then(async (response) => {
      if (controller.signal.aborted) return;
      if (response.status === 204) {
        // Default-OFF is normal. Never trigger a browser-console 404 or try
        // to parse the body of a no-content response.
        setEnabled(false);
        return;
      }
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Connected payroll review is unavailable.");
      setReport(body as ViewData);
    }).catch((cause) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load review.");
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [runId, reload]);

  if (!enabled) return null;
  return (
    <section className="card" aria-label="Payroll connected impact review" style={{ marginBottom: 16 }}>
      <div className="card-body" style={{ display: "grid", gap: 12 }}>
        <div className="line-title" style={{ margin: 0 }}>
          <div>
            <strong>Upstream payroll impact review</strong>
            <span>HRIS · WFM · HCM — cutoff-specific, read-only evidence</span>
          </div>
          <button className="secondary-button" disabled={loading} onClick={() => setReload((n) => n + 1)}>
            Refresh review
          </button>
        </div>
        {loading && <p role="status">Loading upstream changes…</p>}
        {error && <p role="alert">Review unavailable: {error}. Continue using the existing payroll checks.</p>}
        {report && (
          <>
            <p>
              <strong>{report.attention} need attention</strong> · {report.review} to review ·
              HRIS {report.summary.HRIS} · WFM {report.summary.WFM} · HCM {report.summary.HCM}
            </p>
            {report.incomplete && (
              <p role="alert">
                Incomplete evidence: source query limit reached ({report.truncatedSources.join(", ")}).
                This result cannot be treated as a clean handoff.
              </p>
            )}
            {report.total === 0 && !report.incomplete && (
              <p>No upstream changes were flagged in this advisory view. This is not a payroll-release clearance.</p>
            )}
            <div style={{ display: "grid", gap: 8 }}>
              {report.findings.map((finding: ConnectedImpactFinding) => (
                <div className="exception-row" key={finding.area + "-" + finding.code + "-" + finding.sourceId}
                  style={{ alignItems: "flex-start" }}>
                  <span className={"status " + (finding.severity === "attention" ? "status-review" : "")}>
                    {finding.area}
                  </span>
                  <div style={{ flex: 1 }}>
                    <strong>{finding.title}</strong>
                    <small style={{ display: "block" }}>
                      Employee ID {finding.employeeId} · {finding.date ?? "Current request"} · {finding.status}
                    </small>
                    <p>{finding.detail}</p>
                  </div>
                  {allowedPages.includes(finding.action) ? (
                    <button className="secondary-button" onClick={() => onPage(finding.action)}>
                      Open {finding.action}
                    </button>
                  ) : (
                    <small>Ask a permitted HR, workforce or finance reviewer to resolve this item.</small>
                  )}
                </div>
              ))}
            </div>
            {report.total > report.findings.length && (
              <p role="alert">Showing the first {report.findings.length} of {report.total} items; check source workflows for the rest.</p>
            )}
            <small>
              Advisory only. No payroll amounts, bank details, statutory IDs, or approvals are changed by this review.
              Existing timesheet, assurance, checker and release gates remain authoritative.
            </small>
          </>
        )}
      </div>
    </section>
  );
}
