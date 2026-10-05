"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, MessageSquareWarning, Send, X } from "lucide-react";

type Contribution = {
  agency: string;
  applicableMonth: string;
  postingStatus: string;
};

type Dispute = {
  id: number;
  agency: string;
  applicableMonth: string;
  issueType: string;
  description: string;
  status: string;
  resolutionCode: string | null;
  resolutionNote: string | null;
  resolvedByName: string | null;
  createdAt: string;
};

function currentManilaMonth() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
}

function issueLabel(issueType: string) {
  if (issueType === "missing_posting") return "Missing agency posting";
  if (issueType === "wrong_amount") return "Wrong contribution amount";
  if (issueType === "wrong_reference") return "Wrong posting reference";
  return "Other contribution issue";
}

export function ContributionDisputeReporter({
  organizationId,
  contributions,
}: {
  organizationId: number;
  contributions: Contribution[];
}) {
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [open, setOpen] = useState(false);
  const [agency, setAgency] = useState(contributions[0]?.agency ?? "SSS");
  const [applicableMonth, setApplicableMonth] = useState(
    contributions[0]?.applicableMonth ?? currentManilaMonth(),
  );
  const [issueType, setIssueType] = useState("missing_posting");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const response = await fetch(
      `/api/self/contribution-disputes?organizationId=${organizationId}`,
      { cache: "no-store" },
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? "Could not load contribution reports.");
    setDisputes(Array.isArray(body.disputes) ? body.disputes : []);
  }, [organizationId]);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  const unresolved = useMemo(
    () => disputes.filter((dispute) => dispute.status !== "resolved"),
    [disputes],
  );

  async function submit() {
    if (description.trim().length < 8) {
      setError("Please describe what looks wrong in at least 8 characters.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/self/contribution-disputes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organizationId,
          agency,
          applicableMonth,
          issueType,
          description,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "Could not submit contribution report.");
      setDescription("");
      setOpen(false);
      await load();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not submit contribution report.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 10, marginTop: 12 }} data-contribution-dispute-reporter>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <strong>Something looks wrong?</strong>
          <div className="id">Report a missing or incorrect mandatory contribution without waiting for a benefit claim.</div>
        </div>
        <button className="secondary-button" type="button" onClick={() => setOpen((value) => !value)}>
          {open ? <X size={13} /> : <MessageSquareWarning size={13} />}
          {open ? "Cancel" : "Report a problem"}
        </button>
      </div>

      {open && (
        <div className="employee-pay-row-detail" style={{ display: "grid", gap: 8 }}>
          <label>
            Agency
            <select value={agency} onChange={(event) => setAgency(event.target.value)}>
              <option value="SSS">SSS</option>
              <option value="PhilHealth">PhilHealth</option>
              <option value="Pag-IBIG">Pag-IBIG</option>
            </select>
          </label>
          <label>
            Contribution month
            <input
              type="month"
              max={currentManilaMonth()}
              value={applicableMonth}
              onChange={(event) => setApplicableMonth(event.target.value)}
            />
          </label>
          <label>
            What looks wrong?
            <select value={issueType} onChange={(event) => setIssueType(event.target.value)}>
              <option value="missing_posting">Missing agency posting</option>
              <option value="wrong_amount">Wrong contribution amount</option>
              <option value="wrong_reference">Wrong posting reference</option>
              <option value="other">Other contribution issue</option>
            </select>
          </label>
          <label>
            Details
            <textarea
              rows={3}
              maxLength={500}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Example: My SSS account does not show the September contribution."
            />
          </label>
          {error && (
            <div className="notice notice-red" style={{ margin: 0 }}>
              <AlertTriangle size={14} />
              <span>{error}</span>
            </div>
          )}
          <div>
            <button className="primary-button brand" type="button" disabled={busy} onClick={() => void submit()}>
              <Send size={13} /> {busy ? "Submitting…" : "Submit report"}
            </button>
          </div>
        </div>
      )}

      {unresolved.map((dispute) => (
        <div className="notice notice-amber" style={{ margin: 0 }} key={dispute.id}>
          <AlertTriangle size={14} />
          <span>
            <strong>{dispute.agency} · {dispute.applicableMonth} · {issueLabel(dispute.issueType)}</strong>
            {" "}Your report is with payroll for review.
          </span>
        </div>
      ))}

      {disputes
        .filter((dispute) => dispute.status === "resolved")
        .slice(0, 3)
        .map((dispute) => (
          <div className="notice" style={{ margin: 0 }} key={dispute.id}>
            <CheckCircle2 size={14} />
            <span>
              <strong>{dispute.agency} · {dispute.applicableMonth} resolved.</strong>
              {dispute.resolutionNote ? ` ${dispute.resolutionNote}` : ""}
            </span>
          </div>
        ))}
    </div>
  );
}
