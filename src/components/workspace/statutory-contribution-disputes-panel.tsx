"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldCheck } from "lucide-react";
import type { Notify } from "./types";
import { Spinner, Status } from "./ui";

type Dispute = {
  id: number;
  employeeId: number;
  employeeNo: string;
  firstName: string;
  lastName: string;
  memberId: number | null;
  agency: string;
  applicableMonth: string;
  issueType: string;
  description: string;
  status: string;
  reportedByName: string;
  resolutionCode: string | null;
  resolutionNote: string | null;
  resolvedByName: string | null;
  resolvedAt: string | null;
  createdAt: string;
};

function issueLabel(issueType: string) {
  if (issueType === "missing_posting") return "Missing posting";
  if (issueType === "wrong_amount") return "Wrong amount";
  if (issueType === "wrong_reference") return "Wrong reference";
  return "Other";
}

export function StatutoryContributionDisputesPanel({
  organizationId,
  role,
  notify,
}: {
  organizationId: number;
  role: string;
  notify: Notify;
}) {
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [resolutionCode, setResolutionCode] = useState("posted_confirmed");
  const [resolutionNote, setResolutionNote] = useState("");
  const canDismissAsNotError = ["owner", "admin", "checker"].includes(role);
  const canPostResolution = ["owner", "admin", "bookkeeper", "payroll"].includes(role);

  const load = useCallback(async () => {
    const response = await fetch(
      `/api/compliance/contribution-disputes?organizationId=${organizationId}`,
      { cache: "no-store" },
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? "Could not load contribution disputes.");
    setDisputes(Array.isArray(body.disputes) ? body.disputes : []);
  }, [organizationId]);

  useEffect(() => {
    void load().catch((error) => notify(
      error instanceof Error ? error.message : "Could not load contribution disputes.",
      "err",
    ));
  }, [load, notify]);

  const openDisputes = useMemo(
    () => disputes.filter((dispute) => dispute.status !== "resolved"),
    [disputes],
  );

  async function resolve(dispute: Dispute) {
    if (resolutionNote.trim().length < 8) {
      notify("Add a resolution note of at least 8 characters.", "err");
      return;
    }
    setBusy(dispute.id);
    try {
      const response = await fetch("/api/compliance/contribution-disputes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organizationId,
          disputeId: dispute.id,
          action: "resolve",
          resolutionCode,
          resolutionNote,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Could not resolve contribution dispute.");
      notify("Employee contribution dispute resolved and audit-logged.", "ok");
      setSelected(null);
      setResolutionNote("");
      await load();
      window.dispatchEvent(new Event("statutory-remittance-changed"));
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not resolve contribution dispute.", "err");
    } finally {
      setBusy(null);
    }
  }

  return (
    <article className="card" style={{ marginBottom: 16 }} data-contribution-disputes>
      <div className="card-header">
        <div>
          <div className="card-kicker">EMPLOYEE CONTRIBUTION REPORTS</div>
          <h2>Employee-reported statutory issues</h2>
          <p>
            Missing or incorrect SSS, PhilHealth and Pag-IBIG postings reported from employee self-service.
          </p>
        </div>
        <button className="secondary-button" type="button" onClick={() => void load()}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      <div className="card-body" style={{ paddingTop: 0, display: "grid", gap: 12 }}>
        {openDisputes.length === 0 ? (
          <div className="notice" style={{ margin: 0 }}>
            <CheckCircle2 size={15} />
            <span><strong>No unresolved employee contribution reports.</strong></span>
          </div>
        ) : (
          <div className="data-table-wrap slim-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Agency / month</th>
                  <th>Issue</th>
                  <th>Report</th>
                  <th>Status</th>
                  <th>Resolution</th>
                </tr>
              </thead>
              <tbody>
                {openDisputes.map((dispute) => (
                  <tr key={dispute.id}>
                    <td>
                      <strong>{dispute.firstName} {dispute.lastName}</strong>
                      <div className="id">{dispute.employeeNo}</div>
                    </td>
                    <td>{dispute.agency} · {dispute.applicableMonth}</td>
                    <td><Status value={issueLabel(dispute.issueType)} /></td>
                    <td style={{ maxWidth: 360 }}>
                      <span>{dispute.description}</span>
                      <div className="id">Reported by {dispute.reportedByName}</div>
                    </td>
                    <td><Status value="Open" /></td>
                    <td>
                      {selected === dispute.id ? (
                        <div style={{ display: "grid", gap: 6, minWidth: 260 }}>
                          <select value={resolutionCode} onChange={(event) => setResolutionCode(event.target.value)}>
                            {canPostResolution && <option value="posted_confirmed">Agency posting confirmed</option>}
                            {canPostResolution && <option value="corrected">Contribution corrected</option>}
                            {canDismissAsNotError && <option value="not_an_error">Verified as not an error</option>}
                            {canPostResolution && <option value="duplicate">Duplicate report</option>}
                          </select>
                          <textarea
                            rows={2}
                            maxLength={500}
                            value={resolutionNote}
                            onChange={(event) => setResolutionNote(event.target.value)}
                            placeholder="Explain what was verified or corrected."
                          />
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            <button
                              className="primary-button brand"
                              type="button"
                              disabled={busy === dispute.id}
                              onClick={() => void resolve(dispute)}
                            >
                              {busy === dispute.id ? <Spinner label="Saving" /> : <ShieldCheck size={13} />}
                              Resolve
                            </button>
                            <button className="secondary-button" type="button" onClick={() => setSelected(null)}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button className="secondary-button" type="button" onClick={() => {
                          setSelected(dispute.id);
                          setResolutionCode(canPostResolution ? "posted_confirmed" : "not_an_error");
                          setResolutionNote("");
                        }}>
                          Review
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {openDisputes.length > 0 && (
          <div className="notice notice-amber" style={{ margin: 0 }}>
            <AlertTriangle size={15} />
            <span>
              <strong>Queue acknowledgement is not resolution.</strong> Corrected/confirmed outcomes require matching agency posting evidence. Dismissal as “not an error” requires Owner, Admin, or independent Checker review.
            </span>
          </div>
        )}

        {disputes.filter((dispute) => dispute.status === "resolved").slice(0, 5).map((dispute) => (
          <div className="notice" style={{ margin: 0 }} key={dispute.id}>
            <CheckCircle2 size={14} />
            <span>
              <strong>{dispute.employeeNo} · {dispute.agency} {dispute.applicableMonth}</strong>
              {" "}resolved by {dispute.resolvedByName ?? "Payroll"}.
              {dispute.resolutionNote ? ` ${dispute.resolutionNote}` : ""}
            </span>
          </div>
        ))}
      </div>
    </article>
  );
}
