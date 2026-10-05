"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  ClipboardCheck,
  Download,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import type { Notify } from "@/components/workspace/types";
import { Status, money } from "@/components/workspace/ui";

type Remediation = {
  id: number;
  status: string;
  storedStatus: string;
  owner: string | null;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  resolutionNote: string | null;
  evidenceReference: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
};

type Finding = {
  key: string;
  ruleCode: string;
  category: string;
  severity: "high" | "medium" | "info";
  title: string;
  detail: string;
  employeeNo?: string;
  employeeName?: string;
  periodLabel?: string;
  exposureAmount: number | null;
  exposureConfidence: "recorded-liability" | "screening-estimate" | null;
  governingRule: string;
  sourceLabel: string;
  sourceUrl: string;
  evidenceRequired: string[];
  remediationHint: string;
  defaultOwner: "Payroll" | "People Ops" | "Finance" | "Compliance";
  remediation: Remediation | null;
};

type ReadyToClose = {
  id: number;
  findingKey: string;
  ruleCode: string;
  owner: string | null;
  status: string;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
};

type Payload = {
  generatedAt: string;
  range: { startDate: string; endDate: string; label: string };
  findings: Finding[];
  summary: {
    high: number;
    medium: number;
    info: number;
    affectedEmployees: number;
    recordedExposure: number;
    screeningExposure: number;
  };
  inspectionEvidence: string[];
  remediation: {
    readyToClose: ReadyToClose[];
    closed: Array<{
      id: number;
      findingKey: string;
      ruleCode: string;
      owner: string | null;
      resolutionNote: string | null;
      evidenceReference: string | null;
      resolvedBy: string | null;
      resolvedAt: string | null;
    }>;
    tracked: number;
  };
};

const OWNER_OPTIONS = ["Payroll", "People Ops", "Finance", "Compliance"] as const;

function severityLabel(value: Finding["severity"]) {
  if (value === "high") return "High";
  if (value === "medium") return "Review";
  return "Info";
}

function confidenceLabel(value: Finding["exposureConfidence"]) {
  if (value === "recorded-liability") return "recorded liability";
  if (value === "screening-estimate") return "screening estimate";
  return "";
}

export function LaborInspectionReadinessPanel({
  organizationId,
  notify,
}: {
  organizationId: number;
  notify: Notify;
}) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [owners, setOwners] = useState<Record<string, string>>({});
  const [attentionOnly, setAttentionOnly] = useState(true);
  const [closingKey, setClosingKey] = useState<string | null>(null);
  const [closeReference, setCloseReference] = useState("");
  const [closeNote, setCloseNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch(
        `/api/compliance/labor-inspection?organizationId=${organizationId}`,
        { cache: "no-store" },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setLoadError(body.error ?? "Labor inspection readiness could not be loaded.");
        return;
      }
      setPayload(body);
    } catch {
      setLoadError("Labor inspection readiness could not be loaded because the server could not be reached.");
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => { void load(); }, [load]);

  const visibleFindings = useMemo(
    () => (payload?.findings ?? []).filter((finding) => !attentionOnly || finding.severity !== "info"),
    [payload, attentionOnly],
  );

  async function downloadEvidencePack() {
    setBusy("export");
    try {
      const response = await fetch(
        `/api/compliance/labor-inspection/evidence-pack?organizationId=${organizationId}`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? "Inspection evidence pack could not be generated.");
      }
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const filename = disposition.match(/filename="([^"]+)"/)?.[1]
        ?? `labor-inspection-evidence-${organizationId}.json`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      const hash = response.headers.get("x-payrollph-evidence-sha256");
      notify(hash ? `Evidence pack exported · SHA-256 ${hash.slice(0, 12)}…` : "Evidence pack exported.", "ok");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Inspection evidence pack could not be generated.", "err");
    } finally {
      setBusy(null);
    }
  }

  async function mutate(
    action: "assign" | "acknowledge" | "close",
    findingKey: string,
    extra: Record<string, unknown> = {},
  ) {
    setBusy(`${action}:${findingKey}`);
    try {
      const response = await fetch("/api/compliance/labor-inspection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, action, findingKey, ...extra }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Inspection remediation action failed.");
      notify(
        action === "close"
          ? "Inspection finding closed with verified evidence."
          : action === "acknowledge"
            ? "Inspection finding acknowledged."
            : "Remediation owner assigned.",
        "ok",
      );
      setClosingKey(null);
      setCloseReference("");
      setCloseNote("");
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Inspection remediation action failed.", "err");
    } finally {
      setBusy(null);
    }
  }

  return (
    <article className="card" data-labor-inspection-readiness style={{ marginBottom: 16 }}>
      <div className="card-header">
        <div>
          <div className="card-kicker">LABOR INSPECTION READINESS</div>
          <h2>Show the evidence before an inspector asks for it.</h2>
          <p>
            Deterministic checks across payroll, DTR evidence, payslips, 13th month, final pay and mandatory remittances.
            Findings are not hidden by acknowledgement. Close-out is allowed only after the issue is no longer detected.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            className="secondary-button"
            type="button"
            onClick={() => void downloadEvidencePack()}
            disabled={busy !== null || loading}
          >
            <Download size={14} /> {busy === "export" ? "Building pack…" : "Download evidence pack"}
          </button>
          <button className="secondary-button" type="button" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={14} /> {loading ? "Checking…" : "Run inspection check"}
          </button>
        </div>
      </div>
      <div style={{ padding: "0 18px 12px", color: "var(--muted)", fontSize: 11 }}>
        Evidence pack includes payroll, policy review, filing/calendar evidence and employee contribution cases. Sensitive account, member, device and authentication identifiers remain excluded.
      </div>

      {loadError ? (
        <div className="card-body" style={{ paddingTop: 0 }}>
          <div className="notice notice-red" style={{ margin: 0 }}>
            <AlertTriangle size={15} />
            <span><strong>Inspection check unavailable.</strong> {loadError}</span>
          </div>
        </div>
      ) : payload ? (
        <div className="card-body" style={{ paddingTop: 0, display: "grid", gap: 14 }}>
          <div className="run-stats" style={{ margin: 0 }}>
            <div>
              <span>High findings</span>
              <strong className={payload.summary.high ? "red-number" : "green-number"}>{payload.summary.high}</strong>
              <small>{payload.summary.high ? "needs action before inspection" : "no high findings detected"}</small>
            </div>
            <div>
              <span>Affected employees</span>
              <strong>{payload.summary.affectedEmployees}</strong>
              <small>{payload.range.label}</small>
            </div>
            <div>
              <span>Recorded exposure</span>
              <strong>{money(payload.summary.recordedExposure)}</strong>
              <small>stored final-pay/remittance liabilities only</small>
            </div>
            <div>
              <span>Screening estimate</span>
              <strong>{money(payload.summary.screeningExposure)}</strong>
              <small>confirm legal coverage before treating as liability</small>
            </div>
          </div>

          <div className="notice notice-blue" style={{ margin: 0 }}>
            <ClipboardCheck size={15} />
            <span>
              This is an inspection-readiness control, not a DOLE certification. Wage categories, exemptions and facts outside PayrollPH can change the legal result.
            </span>
          </div>

          <section className="leave-request" style={{ display: "grid", gap: 8 }}>
            <div>
              <strong>Inspection evidence pack</strong>
              <p style={{ margin: "3px 0 0" }}>PayrollPH checks whether the core payroll records DOLE commonly asks employers to prepare are present and internally consistent.</p>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {payload.inspectionEvidence.map((item) => (
                <span className="status status-verified" key={item}>{item}</span>
              ))}
            </div>
          </section>

          {payload.remediation.readyToClose.length > 0 && (
            <section className="leave-request" style={{ display: "grid", gap: 10 }}>
              <div>
                <div className="card-kicker">READY FOR VERIFIED CLOSE-OUT</div>
                <strong>{payload.remediation.readyToClose.length} tracked finding{payload.remediation.readyToClose.length === 1 ? "" : "s"} no longer reproduce</strong>
                <p style={{ margin: "3px 0 0" }}>Add the evidence reference and resolution note. Closing requires recent MFA.</p>
              </div>
              {payload.remediation.readyToClose.map((item) => (
                <div key={item.findingKey} style={{ display: "grid", gap: 8, paddingTop: 8, borderTop: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                    <div><strong>{item.ruleCode}</strong><div className="id">{item.owner ? `Owner: ${item.owner}` : "No owner assigned"}</div></div>
                    <Status value="Ready to close" />
                  </div>
                  {closingKey === item.findingKey ? (
                    <div className="setting-form">
                      <label>Evidence reference<input value={closeReference} onChange={(event) => setCloseReference(event.target.value)} placeholder="Bank ref, corrected payroll, agency receipt, document ID" /></label>
                      <label>Resolution note<textarea value={closeNote} onChange={(event) => setCloseNote(event.target.value)} placeholder="What changed and how the evidence proves it" /></label>
                      <div style={{ alignSelf: "end", display: "flex", gap: 6 }}>
                        <button className="secondary-button" onClick={() => setClosingKey(null)}>Cancel</button>
                        <button
                          className="primary-button brand"
                          disabled={busy !== null || closeReference.trim().length < 4 || closeNote.trim().length < 8}
                          onClick={() => void mutate("close", item.findingKey, { evidenceReference: closeReference, resolutionNote: closeNote })}
                        >
                          <ShieldCheck size={14} /> Verify and close
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button className="secondary-button" style={{ width: "fit-content" }} onClick={() => setClosingKey(item.findingKey)}>
                      <CheckCircle2 size={14} /> Close with evidence
                    </button>
                  )}
                </div>
              ))}
            </section>
          )}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className={attentionOnly ? "primary-button brand" : "secondary-button"} onClick={() => setAttentionOnly(true)}>
              Actionable ({payload.summary.high + payload.summary.medium})
            </button>
            <button className={!attentionOnly ? "primary-button brand" : "secondary-button"} onClick={() => setAttentionOnly(false)}>
              All findings ({payload.findings.length})
            </button>
          </div>

          {visibleFindings.length === 0 ? (
            <div className="notice notice-green" style={{ margin: 0 }}>
              <CheckCircle2 size={15} />
              <span><strong>No active findings in this view.</strong> This means the stored payroll evidence passed these checks, not that DOLE has certified the employer.</span>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {visibleFindings.map((finding) => {
                const remediation = finding.remediation;
                const owner = owners[finding.key] ?? remediation?.owner ?? finding.defaultOwner;
                return (
                  <section className="leave-request" key={finding.key} style={{ display: "grid", gap: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                      <div>
                        <div className="card-kicker">{finding.category} · {finding.ruleCode}</div>
                        <strong>{finding.title}</strong>
                        {(finding.employeeNo || finding.periodLabel) && (
                          <p style={{ margin: "3px 0 0" }}>
                            {[finding.employeeNo && `${finding.employeeNo}${finding.employeeName ? ` · ${finding.employeeName}` : ""}`, finding.periodLabel].filter(Boolean).join(" · ")}
                          </p>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-start" }}>
                        <Status value={severityLabel(finding.severity)} />
                        {remediation && <Status value={remediation.status === "reopened" ? "Reopened" : remediation.status} />}
                      </div>
                    </div>

                    <p style={{ margin: 0 }}>{finding.detail}</p>

                    {finding.exposureAmount != null && (
                      <div className={finding.exposureConfidence === "recorded-liability" ? "notice notice-red" : "notice notice-amber"} style={{ margin: 0 }}>
                        <AlertTriangle size={14} />
                        <span>
                          <strong>{money(finding.exposureAmount)}</strong> · {confidenceLabel(finding.exposureConfidence)}
                          {finding.exposureConfidence === "screening-estimate" ? ". Confirm coverage before treating this amount as a legal liability." : ""}
                        </span>
                      </div>
                    )}

                    <div className="notice" style={{ margin: 0 }}>
                      <CircleAlert size={14} />
                      <span><strong>Rule:</strong> {finding.governingRule}</span>
                    </div>

                    <div style={{ display: "grid", gap: 5 }}>
                      <strong style={{ fontSize: 11 }}>Evidence needed</strong>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {finding.evidenceRequired.map((item) => <span className="status" key={item}>{item}</span>)}
                      </div>
                      <p style={{ margin: "3px 0 0", color: "var(--muted)", fontSize: 11 }}>{finding.remediationHint}</p>
                    </div>

                    <a className="link-button" href={finding.sourceUrl} target="_blank" rel="noreferrer" style={{ width: "fit-content" }}>
                      {finding.sourceLabel} <ExternalLink size={12} />
                    </a>

                    <div style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
                      <label className="field" style={{ minWidth: 170 }}>
                        <span>Remediation owner</span>
                        <select value={owner} onChange={(event) => setOwners((current) => ({ ...current, [finding.key]: event.target.value }))}>
                          {OWNER_OPTIONS.map((option) => <option key={option}>{option}</option>)}
                        </select>
                      </label>
                      <button
                        className="secondary-button"
                        disabled={busy !== null}
                        onClick={() => void mutate("assign", finding.key, { owner })}
                      >
                        <UserCheck size={14} /> {remediation?.owner ? "Update owner" : "Assign owner"}
                      </button>
                      <button
                        className="primary-button brand"
                        disabled={busy !== null || remediation?.status === "acknowledged"}
                        onClick={() => void mutate("acknowledge", finding.key, { owner })}
                      >
                        <ShieldCheck size={14} /> {remediation?.status === "acknowledged" ? "Acknowledged" : "Acknowledge finding"}
                      </button>
                    </div>
                  </section>
                );
              })}
            </div>
          )}

          {payload.remediation.closed.length > 0 && (
            <details>
              <summary style={{ cursor: "pointer", fontWeight: 800, fontSize: 12 }}>
                Closed with evidence ({payload.remediation.closed.length})
              </summary>
              <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                {payload.remediation.closed.slice(0, 12).map((item) => (
                  <div className="notice notice-green" style={{ margin: 0 }} key={item.id}>
                    <CheckCircle2 size={14} />
                    <span>
                      <strong>{item.ruleCode}</strong>
                      {item.owner ? ` · owner ${item.owner}` : ""}
                      {item.evidenceReference ? ` · evidence ${item.evidenceReference}` : ""}
                      {item.resolvedBy ? ` · closed by ${item.resolvedBy}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          )}

          <p style={{ margin: 0, color: "var(--muted)", fontSize: 11 }}>
            Evaluated {new Date(payload.generatedAt).toLocaleString("en-PH")} · {payload.range.startDate} to {payload.range.endDate}
          </p>
        </div>
      ) : (
        <div className="card-body" style={{ paddingTop: 0 }}><p style={{ color: "var(--muted)", fontSize: 12 }}>Evaluating payroll inspection evidence…</p></div>
      )}
    </article>
  );
}
