"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, RefreshCcw, SearchCheck } from "lucide-react";
import {
  allowedContributionCaseOutcomes,
  contributionCaseResolutionPolicyMessage,
  type ContributionResolutionOutcome,
} from "@/lib/statutory-contribution-case-resolution";
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
  remittanceMemberId: number | null;
  status: string;
  assignedToUserId: number | null;
  assignedToName: string | null;
  reviewStartedAt: string | null;
  resolutionOutcome: string | null;
  resolutionNote: string | null;
  resolvedByName: string | null;
  resolvedAt: string | null;
  createdAt: string;
  events: Array<{
    id: number;
    eventType: string;
    visibility: string;
    message: string;
    actorName: string;
    createdAt: string;
  }>;
  service: {
    state: "resolved" | "on_track" | "review_due_today" | "review_overdue" | "resolution_due_today" | "resolution_overdue";
    overdue: boolean;
    targetDate: string | null;
    targetLabel: string;
    ageDays: number;
    firstReviewDue: string;
    resolutionDue: string;
    internalPolicyNote: string;
  };
};

const OUTCOME_LABELS: Record<ContributionResolutionOutcome, string> = {
  posting_confirmed: "Agency posting confirmed",
  correction_completed: "Correction completed",
  no_issue_found: "No issue found",
  employee_advised: "Employee advised",
  referred_to_agency: "Referred to agency · keep case open",
};

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
  const [updateId, setUpdateId] = useState<number | null>(null);
  const [updateMessage, setUpdateMessage] = useState("");
  const [resolutionOutcome, setResolutionOutcome] = useState<ContributionResolutionOutcome>("posting_confirmed");
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
    () => cases
      .filter((issue) => issue.status !== "resolved")
      .sort((a, b) => Number(b.service.overdue) - Number(a.service.overdue) || b.service.ageDays - a.service.ageDays),
    [cases],
  );
  const resolved = useMemo(
    () => cases.filter((issue) => issue.status === "resolved").slice(0, 8),
    [cases],
  );

  async function mutate(
    action: "start_review" | "add_update" | "resolve",
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

  async function postUpdate(issue: ContributionIssueCase) {
    if (updateMessage.trim().length < 20) {
      notify("Add an employee-visible update of at least 20 characters.", "err");
      return;
    }
    const ok = await mutate(
      "add_update",
      issue.id,
      { message: updateMessage },
      "Employee-visible contribution case update posted.",
    );
    if (ok) {
      setUpdateId(null);
      setUpdateMessage("");
    }
  }

  async function resolveCase(issue: ContributionIssueCase) {
    if (resolutionNote.trim().length < 20) {
      notify("Add a resolution note of at least 20 characters.", "err");
      return;
    }
    const referred = resolutionOutcome === "referred_to_agency";
    const ok = await mutate(
      "resolve",
      issue.id,
      { resolutionOutcome, resolutionNote },
      referred
        ? "Contribution case referred to the agency and kept open."
        : "Employee contribution issue resolved with an audit trail.",
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
                      {issue.events.length > 0 && (
                        <div style={{ display: "grid", gap: 4, marginTop: 8 }}>
                          {issue.events.slice(0, 3).map((event) => (
                            <div className="id" key={event.id} style={{ whiteSpace: "normal" }}>
                              <strong>{event.eventType.replaceAll("_", " ")}</strong> · {event.actorName} · {new Date(event.createdAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}<br />
                              {event.message}
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                    <td>
                      <Status value={issue.service.state === "review_overdue"
                        ? "Review overdue"
                        : issue.service.state === "resolution_overdue"
                          ? "Resolution overdue"
                          : issue.status === "in_review" ? "In review" : "Open"} />
                      {issue.assignedToName && <div className="id">{issue.assignedToName}</div>}
                      <div className="id">
                        {issue.service.targetLabel}: {issue.service.targetDate ?? "complete"} · age {issue.service.ageDays}d
                      </div>
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
                      ) : updateId === issue.id ? (
                        <div style={{ display: "grid", gap: 6, minWidth: 260 }}>
                          <textarea
                            value={updateMessage}
                            onChange={(event) => setUpdateMessage(event.target.value)}
                            placeholder="Tell the employee what payroll checked, what is pending, or what happens next."
                            maxLength={1000}
                          />
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            <button
                              className="primary-button brand"
                              disabled={busy !== null || updateMessage.trim().length < 20}
                              onClick={() => void postUpdate(issue)}
                            >
                              {busy === `add_update:${issue.id}` ? <Spinner label="Saving" /> : "Post update"}
                            </button>
                            <button className="secondary-button" onClick={() => { setUpdateId(null); setUpdateMessage(""); }}>Cancel</button>
                          </div>
                        </div>
                      ) : resolveId === issue.id ? (
                        <div style={{ display: "grid", gap: 6, minWidth: 250 }}>
                          <select
                            value={resolutionOutcome}
                            onChange={(event) => setResolutionOutcome(event.target.value as ContributionResolutionOutcome)}
                          >
                            {allowedContributionCaseOutcomes(
                              issue.issueType,
                              { hasLinkedPosting: issue.remittanceMemberId != null },
                            ).map((value) => (
                              <option key={value} value={value}>{OUTCOME_LABELS[value]}</option>
                            ))}
                          </select>
                          <div className="id" style={{ whiteSpace: "normal" }}>
                            {contributionCaseResolutionPolicyMessage(issue.issueType)}
                          </div>
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
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <button
                            className="secondary-button"
                            onClick={() => {
                              setUpdateId(issue.id);
                              setUpdateMessage("");
                              setResolveId(null);
                            }}
                          >
                            Post update
                          </button>
                          <button
                            className="secondary-button"
                            onClick={() => {
                              setResolveId(issue.id);
                              setUpdateId(null);
                              setResolutionOutcome(allowedContributionCaseOutcomes(
                                issue.issueType,
                                { hasLinkedPosting: issue.remittanceMemberId != null },
                              )[0]);
                              setResolutionNote("");
                            }}
                          >
                            Resolve
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {active.some((issue) => issue.service.overdue) && (
          <div className="notice notice-red" style={{ margin: 0 }}>
            <AlertTriangle size={15} />
            <span>
              One or more employee contribution cases missed a PayrollPH internal service target. These are operational targets, not statutory or agency deadlines.
            </span>
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
