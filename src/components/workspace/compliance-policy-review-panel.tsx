"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, RefreshCw, ShieldCheck } from "lucide-react";
import { Status } from "@/components/workspace/ui";

type Finding = {
  key: string; domain: string; severity: "high" | "medium" | "info" | "pass"; title: string; detail: string;
  governingRule: string; sourceLabel: string; sourceUrl: string; affectedEmployees?: number; affectedPatterns?: string[]; remediation: string;
};
type Payload = { generatedAt: string; reviewWindow: { startDate: string; endDate: string }; summary: { high: number; medium: number; pass: number; info: number }; findings: Finding[] };

function label(severity: Finding["severity"]) {
  if (severity === "high") return "High";
  if (severity === "medium") return "Review";
  if (severity === "pass") return "Pass";
  return "Info";
}

export function CompliancePolicyReviewPanel({ organizationId }: { organizationId: number }) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showPassing, setShowPassing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/compliance/policy-review?organizationId=" + organizationId, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) { setError(body.error ?? "Policy review could not be loaded."); return; }
      setPayload(body);
    } catch { setError("Policy review could not be loaded because the server could not be reached."); }
    finally { setLoading(false); }
  }, [organizationId]);

  useEffect(() => { void load(); }, [load]);
  const findings = useMemo(() => (payload?.findings ?? []).filter((finding) => showPassing || finding.severity !== "pass"), [payload, showPassing]);

  return (
    <article className="card" data-compliance-policy-review style={{ marginBottom: 16 }}>
      <div className="card-header">
        <div>
          <div className="card-kicker">POLICY COMPLIANCE REVIEW</div>
          <h2>Catch risky payroll policy settings before payroll proves them wrong.</h2>
          <p>Reviews actual released pay dates, pay-profile coverage, standard hours, active weekly rest-day scheduling and leave treatment against Philippine labor controls.</p>
        </div>
        <button className="secondary-button" type="button" disabled={loading} onClick={() => void load()}><RefreshCw size={14} /> {loading ? "Checking…" : "Review policies"}</button>
      </div>

      {error ? <div className="card-body" style={{ paddingTop: 0 }}><div className="notice notice-red" style={{ margin: 0 }}><AlertTriangle size={15} /><span>{error}</span></div></div> : payload ? (
        <div className="card-body" style={{ paddingTop: 0, display: "grid", gap: 14 }}>
          <div className="run-stats" style={{ margin: 0 }}>
            <div><span>High</span><strong className={payload.summary.high ? "red-number" : "green-number"}>{payload.summary.high}</strong><small>configuration defects</small></div>
            <div><span>Needs review</span><strong>{payload.summary.medium}</strong><small>legal basis or exception needed</small></div>
            <div><span>Passing controls</span><strong className="green-number">{payload.summary.pass}</strong><small>supported by current settings</small></div>
            <div><span>Review window</span><strong>6 months</strong><small>{payload.reviewWindow.startDate} to {payload.reviewWindow.endDate}</small></div>
          </div>

          <div className="notice notice-blue" style={{ margin: 0 }}><ShieldCheck size={15} /><span>This is a configuration review, not a legal opinion or DOLE certification. Exemptions, CBAs and lawful alternative work arrangements can change the result.</span></div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className={!showPassing ? "primary-button brand" : "secondary-button"} onClick={() => setShowPassing(false)}>Needs attention ({payload.summary.high + payload.summary.medium})</button>
            <button className={showPassing ? "primary-button brand" : "secondary-button"} onClick={() => setShowPassing(true)}>All controls ({payload.findings.length})</button>
          </div>

          {findings.length === 0 ? <div className="notice notice-green" style={{ margin: 0 }}><CheckCircle2 size={15} /><span><strong>No policy controls need attention.</strong> Passing controls are hidden in this view.</span></div> : (
            <div style={{ display: "grid", gap: 10 }}>
              {findings.map((finding) => (
                <section className="leave-request" key={finding.key} style={{ display: "grid", gap: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <div><div className="card-kicker">{finding.domain}</div><strong>{finding.title}</strong></div>
                    <Status value={label(finding.severity)} />
                  </div>
                  <p style={{ margin: 0 }}>{finding.detail}</p>
                  {finding.affectedPatterns?.length ? <div><strong style={{ fontSize: 11 }}>Affected schedule patterns</strong><p style={{ margin: "3px 0 0", fontSize: 11 }}>{finding.affectedPatterns.join(", ")}</p></div> : null}
                  <div className={finding.severity === "pass" ? "notice notice-green" : "notice notice-amber"} style={{ margin: 0 }}><span><strong>Rule:</strong> {finding.governingRule}</span></div>
                  <p style={{ margin: 0, color: "var(--muted)", fontSize: 11 }}><strong>Next:</strong> {finding.remediation}</p>
                  <a className="link-button" href={finding.sourceUrl} target="_blank" rel="noreferrer" style={{ width: "fit-content" }}>{finding.sourceLabel} <ExternalLink size={12} /></a>
                </section>
              ))}
            </div>
          )}
          <p style={{ margin: 0, color: "var(--muted)", fontSize: 11 }}>Generated {new Date(payload.generatedAt).toLocaleString("en-PH")}</p>
        </div>
      ) : <div className="card-body" style={{ paddingTop: 0 }}><p style={{ color: "var(--muted)", fontSize: 12 }}>Reviewing configured payroll policies…</p></div>}
    </article>
  );
}