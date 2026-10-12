"use client";

import { useState } from "react";
import type { FirstPayrollReadiness } from "@/lib/first-payroll-readiness";
import { firstPayrollPreview } from "@/lib/first-payroll-preview";

type Props = {
  readiness: FirstPayrollReadiness;
  organizationId: number;
  canAssign: boolean;
  allowedPages: readonly string[];
  onPage: (page: string) => void;
  onNewRun: () => void;
  onSettings?: (tab: "organization" | "team") => void;
};

/** Evidence preview only; a green setup row never authorizes payroll release. */
export function FirstPayrollInline({ readiness, organizationId, canAssign, allowedPages, onPage, onNewRun, onSettings }: Props) {
  const findings = firstPayrollPreview(readiness);
  const [opened, setOpened] = useState<string | null>(findings.find(row => row.kind !== "complete")?.step.key ?? null);
  const [sending, setSending] = useState<string | null>(null);
  const [sent, setSent] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  async function send(step: string) {
    setSending(step); setError("");
    try {
      const response = await fetch("/api/first-payroll/handoffs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, step }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Assignment could not be saved.");
      setSent(existing => ({ ...existing, [step]: `Sent to ${data.team} · case #${data.caseId}` }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send the request.");
    } finally {
      setSending(null);
    }
  }
  function act(row: ReturnType<typeof firstPayrollPreview>[number]) {
    if (!allowedPages.includes(row.step.page)) return;
    if (row.step.settingsTab) onSettings?.(row.step.settingsTab);
    if (row.step.key === "payroll" && !readiness.firstPayrollStarted && readiness.ready) onNewRun();
    else onPage(row.step.page);
  }
  return <div className="card" style={{ padding: 16, marginTop: 16 }} data-first-payroll-inline>
    <div className="card-kicker">INLINE FIRST PAYROLL</div>
    <h3>Readiness preview and next actions</h3>
    <p>These checks indicate setup, not government acceptance or a released payroll. Open any step for its blockers and accountable team.</p>
    <div className="data-table-wrap" style={{ overflowX: "auto", marginBottom: 14 }}>
      <table className="data-table" aria-label="First payroll blockers preview">
        <thead><tr><th>Step</th><th>Readiness</th><th>Action</th></tr></thead>
        <tbody>{findings.map(({ step, kind }) => <tr key={step.key}>
          <td>{step.title}</td>
          <td><strong>{kind === "complete" ? "Setup complete" : kind === "blocker" ? "Blocked / upcoming" : "Human review"}</strong></td>
          <td><button type="button" className="secondary-button" aria-expanded={opened === step.key}
            onClick={() => setOpened(current => current === step.key ? null : step.key)}>Open step</button></td>
        </tr>)}</tbody>
      </table>
    </div>
    {error && <div role="alert" className="notice notice-amber">{error}</div>}
    {findings.map(row => opened === row.step.key && <section key={row.step.key}
      className="card" aria-label={row.step.title + " details"}
      style={{ boxShadow: "none", border: "1px solid var(--line)", padding: 14, marginBottom: 8 }}>
      <h4>{row.step.title}</h4>
      <p>{row.message}</p>
      {row.step.key === "people" && <p>Active roster: {readiness.activeEmployees}. Missing payout details: {readiness.employeesMissingPayout}.</p>}
      {row.step.key === "reviewers" && <p>Payroll makers: {readiness.payrollOfficerCount}. Independent checkers: {readiness.checkerCount}.</p>}
      {row.step.key === "payroll" && <p>Payroll run recorded: {readiness.firstPayrollStarted ? "Yes" : "No"}. Released: {readiness.firstPayrollReleased ? "Yes" : "No"}.</p>}
      {row.step.key === "time" && <div role="note" className="notice notice-amber">Period attendance and exceptions must be reviewed in Time; this setup preview cannot approve punches.</div>}
      {row.step.key === "exports" && <div role="note" className="notice notice-amber">Download is not agency acceptance. Record external acknowledgement separately.</div>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        {allowedPages.includes(row.step.page) && <button type="button" className="primary-button" onClick={() => act(row)}>
          {row.step.actionLabel}
        </button>}
        {canAssign && row.kind !== "complete" && <button type="button" className="secondary-button"
          disabled={sending === row.step.key} onClick={() => void send(row.step.key)}>
          {sending === row.step.key ? "Sending…" : "Send to responsible team"}
        </button>}
        {sent[row.step.key] && <span role="status">{sent[row.step.key]}</span>}
      </div>
    </section>)}
  </div>;
}
