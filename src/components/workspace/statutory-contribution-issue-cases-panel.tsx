"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, RefreshCcw, SearchCheck } from "lucide-react";
import type { Notify } from "./types";
import { Spinner, Status } from "./ui";

type ContributionIssueCase = {
  id: number;
  employeeId: number;
  employeeNo: string;
  employeeName: string;
  agency: string;
  applicableMonth: string;
  issueType: string;
  description: string;
  status: string;
  assignedToUserId: number | null;
  assignedToName: string | null;
  reviewStartedAt: string | null;
  resolutionOutcome: string | null;
  resolutionNote: string | null;
  resolvedByName: string | null;
  resolvedAt: string | null;
  createdAt: string;
};

const OUTCOMES = [
  ["posting_confirmed", "Agency posting confirmed"],
  ["correction_completed", "Correction completed"],
  ["no_issue_found", "No issue found"],
  ["employee_advised", "Employee advised"],
  ["referred_to_agency", "Referred to agency"],
] as const;

export function StatutoryContributionIssueCasesPanel({
  organizationId,
  notify,
}: {
  organizationId: number;
  notify: Notify;
}) {
  const [cases, setCases] = useState<ContributionIssueCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [resolveId, setResolveId] = useState<number | null>(null);
  const [resolutionOutcome, setResolutionOutcome] = useState("posting_confirmed");
  const [resolutionNote, setResolutionNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/compliance/contribution-issues?organizationId=${organizationId}`,
        { cache: "no-store" },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Could not load employee contribution cases.");
      setCases(Array.isArray(body.cases) ? body.cases : []);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not load employee contribution cases.", "err");
    } finally {
      setLoading(false);
    }
  }, [notify, organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const active = useMemo(
    () => cases.filter((issue) => issue.status !== "resolved"),
    [cases],
  );
  const resolved = useMemo(
    () => cases.filter((issue) => issue.status === "resolved").slice(0, 8),
    [cases],
  );

  async function mutate(
    action: "start_review" | "resolve",
    caseId: number,
    payload: Record<string, unknown>,
    success: string,
  ) {
    setBusy(`${action}:${caseId}`);
    try {
      const response = await fetch("/api/compliance/contribution-issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, caseId, action, ...payload }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Contribution case could not be updated.");
      notify(success, "ok");
      await load();
      window.dispatchEvent(new Event("statutory-remittance-changed"));
      return true;
    } catch (error) {
      notify(error instanceof Error ? error.message : "Contribution case could not be updated.", "err");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function resolveCase(issue: ContributionIssueCase) {
    if (resolutionNote.trim().length < 20) {
      notify("Add a resolution note of at least 20 characters.", "err");
      return;
    }
    const ok = await mutate(
      "resolve",
      issue.id,
      { resolutionOutcome, resolutionNote },
      "Employee contribution issue resolved with an audit trail.",
    );
    if (ok) {
      setResolveId(null);
      setResolutionNote("");
      setResolutionOutcome("posting_confirmed");
    }
  }

  return (
    <article className="card" style={{ marginBottom: 16 }} data-contribution-issue-cases>
      <div className="card-header">
        <div>
          <div className="card-kicker">EMPLOYEE CONTRIBUTION CASES</div>
          <h2>Employees can report what does not match their agency record.</h2>
          <p>
            Review the employee&apos;s report against payroll, remittance and posting evidence. This screen does not change statutory records.
          </p>
        </div>
        <button className="secondary-button" onClick={() => void load()} disabled={loading}>
          {loading ? <Spinner label="Loading" /> : <RefreshCcw size={14} />} Refresh
        </button>
      </div>

      <div className="card-body" style={{ paddingTop: 0, display: "grid", gap: 14 }}>
        {active.length === 0 ? (
          <div className="notice notice-green" style={{ margin: 0 }}>
            <CheckCircle2 size={15} />
            <span><strong>No unresolved employee contribution cases.</strong></span>
          </div>
        ) : (
          <div className="data-table-wrap slim-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Agency / month</th>
                  <th>Reported issue</th>
                  <th>Status</th>
                  <th>Review</th>
                </tr>
              </thead>
              <tbody>
                {active.map((issue) => (
                  <tr key={issue.id}>
                    <td>
                      <strong>{issue.employeeName}</strong>
                      <div className="id">{issue.employeeNo} · case #{issue.id}</div>
                      <a
                        className="secondary-button"
                        style={{ marginTop: 6 }}
                        href={`/api/compliance/contribution-issues/evidence?organizationId=${organizationId}&caseId=${issue.id}`}
                      >
                        <Download size={13} /> Evidence
                      </a>
                    </td>
                    <td>
                      <strong>{issue.agency}</strong>
                      <div className="id">{issue.applicableMonth}</div>
                    </td>
                    <td style={{ maxWidth: 420 }}>
                      <strong>{issue.issueType.replaceAll("_", " ")}</strong>
                      <div className="id" style={{ whiteSpace: "normal" }}>{issue.description}</div>
                    </td>
                    <td>
                      <Status value={issue.status === "in_review" ? "In review" : "Open"} />
                      {issue.assignedToName && <div className="id">{issue.assignedToName}</div>}
                    </td>
                    <td>
                      {issue.status === "open" ? (
                        <button
                          className="secondary-button"
                          disabled={busy !== null}
                          onClick={() => void mutate(
                            "start_review",
                            issue.id,
                            {},
                            "Contribution case assigned to you for review.",
                          )}
                        >
                          {busy === `start_review:${issue.id}` ? <Spinner label="Saving" /> : <SearchCheck size={14} />}
                          Start review
                        </button>
                      ) : resolveId === issue.id ? (
                        <div style={{ display: "grid", gap: 6, minWidth: 250 }}>
                          <select value={resolutionOutcome} onChange={(event) => setResolutionOutcome(event.target.value)}>
                            {OUTCOMES.map(([value, label]) => (
                              <option key={value} value={value}>{label}</option>
                            ))}
                          </select>
                          <textarea
                            value={resolutionNote}
                            onChange={(event) => setResolutionNote(event.target.value)}
                            placeholder="Explain what payroll verified and what the employee should expect next."
                            maxLength={600}
                          />
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            <button
                              className="primary-button brand"
                              disabled={busy !== null || resolutionNote.trim().length < 20}
                              onClick={() => void resolveCase(issue)}
                            >
                              {busy === `resolve:${issue.id}` ? <Spinner label="Saving" /> : "Resolve case"}
                            </button>
                            <button className="secondary-button" onClick={() => setResolveId(null)}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <button
                          className="secondary-button"
                          onClick={() => {
                            setResolveId(issue.id);
                            setResolutionOutcome("posting_confirmed");
                            setResolutionNote("");
                          }}
                        >
                          Resolve
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {active.some((issue) => issue.status === "open") && (
          <div className="notice notice-amber" style={{ margin: 0 }}>
            <AlertTriangle size={15} />
            <span>
              Employee reports are not evidence edits. If payroll or agency data is wrong, use the existing audited remittance correction workflow before closing the case.
            </span>
          </div>
        )}

        {resolved.length > 0 && (
          <div>
            <div className="card-kicker" style={{ marginBottom: 8 }}>Recently resolved</div>
            <div className="policy-lines">
              {resolved.map((issue) => (
                <span key={issue.id}>
                  <b>{issue.employeeNo} · {issue.agency} · {issue.applicableMonth}</b>
                  <small style={{ display: "block", color: "var(--muted)" }}>
                    {issue.resolutionOutcome?.replaceAll("_", " ") ?? "resolved"} · {issue.resolutionNote}
                  </small>
                  <a
                    className="secondary-button"
                    style={{ marginTop: 6 }}
                    href={`/api/compliance/contribution-issues/evidence?organizationId=${organizationId}&caseId=${issue.id}`}
                  >
                    <Download size={13} /> Download evidence
                  </a>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </article>
  );
}
